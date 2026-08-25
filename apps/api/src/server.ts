import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { callStatusSchema, createCallRequestSchema, escalateRequestSchema, getBookingContextRequestSchema, markArrivedRequestSchema, markUnavailableRequestSchema, requestReplacementRequestSchema, sendCustomerEventRequestSchema, updateEtaRequestSchema } from "@dispatchloop/contracts";
import type { ApiFailure, ApiResponse } from "@dispatchloop/contracts";
import { InMemoryDispatchRepository } from "./repository.js";
import type { AppEnv, DispatchRepository, Mutation } from "./types.js";

type HonoEnv = { Bindings: AppEnv; Variables: { repo: DispatchRepository } };
const requestId = () => randomUUID();
const failure = (id: string, code: ApiFailure["error"]["code"], message: string, retryable = false, nextAction?: string): ApiFailure => ({ ok: false, error: { code, message, retryable, ...(nextAction ? { nextAction } : {}) }, meta: { requestId: id } });
const success = <T>(id: string, data: T, meta: Record<string, unknown> = {}): ApiResponse<T> => ({ ok: true, data, meta: { requestId: id, ...meta } } as ApiResponse<T>);
const bearer = (value: string | undefined, expected: string | undefined) => Boolean(expected && value?.replace(/^Bearer\s+/i, "") === expected);

async function liveCall(env: AppEnv, bookingId: string, localCallId: string) {
  if (!env.BOLNA_API_KEY || !env.BOLNA_AGENT_ID || !env.DEMO_RECIPIENT_PHONE) throw new Error("Live integration is not configured.");
  const payload = { agent_id: env.BOLNA_AGENT_ID, recipient_phone_number: env.DEMO_RECIPIENT_PHONE, user_data: { dispatch_call_id: localCallId, booking_id: bookingId, prompt_version: "v1" }, ...(env.BOLNA_FROM_PHONE_NUMBER ? { from_phone_number: env.BOLNA_FROM_PHONE_NUMBER } : {}) };
  const response = await fetch("https://api.bolna.ai/call", { method: "POST", headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Bolna call request failed with ${response.status}`);
  const body: unknown = await response.json();
  const parsed = z.object({ execution_id: z.string().uuid().optional(), id: z.string().uuid().optional() }).safeParse(body);
  return parsed.success ? (parsed.data.execution_id ?? parsed.data.id ?? null) : null;
}

async function canonicalExecutionStatus(env: AppEnv, executionId: string) {
  if (!env.BOLNA_API_KEY) return null;
  const response = await fetch(`https://api.bolna.ai/executions/${executionId}`, { headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}` }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const parsed = z.object({ status: z.string().optional(), execution: z.object({ status: z.string().optional() }).optional() }).safeParse(body);
  if (!parsed.success) return null;
  return callStatusSchema.safeParse(parsed.data.status ?? parsed.data.execution?.status).data ?? null;
}

export function createApp(options: { repo?: DispatchRepository; env?: AppEnv } = {}) {
  const app = new Hono<HonoEnv>();
  const repo = options.repo ?? new InMemoryDispatchRepository(); const env = options.env ?? process.env as AppEnv;
  app.use("*", async (c, next) => { c.set("repo", repo); await next(); });
  app.onError((error, c) => c.json(failure(requestId(), "INTERNAL_ERROR", error instanceof Error ? error.message : "Unexpected error."), 500));
  const integrationMode = () => env.INTEGRATION_MODE ?? env.DISPATCHLOOP_MODE ?? "mock";
  app.get("/health", (c) => c.json(success(requestId(), { status: "ok", mode: integrationMode(), dependencies: { database: "mock", bolna: integrationMode() === "live" ? "configured" : "disabled" } })));
  const operator: MiddlewareHandler<HonoEnv> = async (c, next) => { if (!bearer(c.req.header("Authorization"), env.DISPATCHLOOP_OPERATOR_TOKEN ?? env.OPERATOR_TOKEN ?? "dev-operator-token")) return c.json(failure(requestId(), "UNAUTHORIZED", "Operator authentication is required."), 401); await next(); };
  app.use("/v1/bookings", operator);
  app.use("/v1/bookings/*", operator);
  app.use("/v1/calls/*", operator);
  app.use("/v1/demo/*", operator);
  app.use("/v1/eval-runs", operator);
  app.use("/v1/eval-runs/*", operator);
  app.get("/v1/bookings", async (c) => c.json(success(requestId(), await c.var.repo.listBookings())));
  app.get("/v1/bookings/:bookingId", async (c) => { const item = await c.var.repo.getBookingDetail(c.req.param("bookingId")); return item ? c.json(success(requestId(), item)) : c.json(failure(requestId(), "BOOKING_NOT_FOUND", "Booking was not found."), 404); });
  app.post("/v1/bookings/:bookingId/calls", async (c) => {
    const id = requestId(); const key = c.req.header("Idempotency-Key"); if (!key) return c.json(failure(id, "VALIDATION_ERROR", "Idempotency-Key is required."), 400);
    const body = createCallRequestSchema.safeParse(await c.req.json().catch(() => ({}))); if (!body.success) return c.json(failure(id, "VALIDATION_ERROR", "Invalid call request."), 400);
    const booking = await c.var.repo.getBooking(c.req.param("bookingId")); if (!booking) return c.json(failure(id, "BOOKING_NOT_FOUND", "Booking was not found."), 404);
    if (body.data.expectedVersion && body.data.expectedVersion !== booking.version) return c.json(failure(id, "STALE_STATE", "Booking changed; refresh before calling."), 409);
    const mode = integrationMode(); const preliminary = await c.var.repo.createCall({ bookingId: booking.id, idempotencyKey: key, mode, executionId: null });
    if (preliminary.idempotentReplay || mode !== "live") return c.json(success(id, { callId: preliminary.call.id, executionId: preliminary.call.bolnaExecutionId, status: preliminary.call.status, mode: preliminary.call.mode }, { idempotentReplay: preliminary.idempotentReplay }));
    try { const executionId = await liveCall(env, booking.id, preliminary.call.id); const call = await c.var.repo.attachExecution(preliminary.call.id, executionId); return c.json(success(id, { callId: preliminary.call.id, executionId, status: call?.status ?? preliminary.call.status, mode })); } catch { await c.var.repo.updateCallStatus(preliminary.call.id, "error", { outcome: "Bolna call creation failed" }); return c.json(failure(id, "INTEGRATION_UNAVAILABLE", "Call provider is unavailable; no call was placed.", true), 503); }
  });
  app.get("/v1/calls/:callId", async (c) => { const item = await c.var.repo.getCall(c.req.param("callId")); return item ? c.json(success(requestId(), item)) : c.json(failure(requestId(), "CALL_NOT_FOUND", "Call was not found."), 404); });
  app.post("/v1/demo/reset", async (c) => { await c.var.repo.reset(); return c.json(success(requestId(), { reset: true })); });
  app.post("/v1/eval-runs", (c) => c.json(failure(requestId(), "INTEGRATION_UNAVAILABLE", "Evaluation runner is provided by @dispatchloop/evals."), 501));
  app.get("/v1/eval-runs/:runId", (c) => c.json(failure(requestId(), "INTEGRATION_UNAVAILABLE", "Evaluation run was not found."), 404));
  app.post("/v1/bolna/webhook", async (c) => {
    const id = requestId(); const payload: unknown = await c.req.json().catch(() => null); const parsed = z.object({ execution_id: z.string().uuid(), status: callStatusSchema }).safeParse(payload);
    if (!parsed.success) return c.json(failure(id, "VALIDATION_ERROR", "Webhook did not contain a recognized execution and status."), 400);
    const call = await c.var.repo.findCallByExecution(parsed.data.execution_id); if (!call) return c.json({ accepted: true }, 202);
    let status = parsed.data.status;
    if (integrationMode() === "live") {
      const canonicalStatus = await canonicalExecutionStatus(env, parsed.data.execution_id);
      if (!canonicalStatus) return c.json({ accepted: false, reason: "canonical_execution_unavailable" }, 202);
      status = canonicalStatus;
    }
    await c.var.repo.recordWebhook({ executionId: parsed.data.execution_id, status, payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") });
    await c.var.repo.updateCallStatus(call.id, status); return c.json({ accepted: true }, 202);
  });
  const tool: MiddlewareHandler<HonoEnv> = async (c, next) => { if (!bearer(c.req.header("Authorization"), env.BOLNA_TOOL_TOKEN ?? "dev-tool-token")) return c.json(failure(requestId(), "UNAUTHORIZED", "Tool authentication is required."), 401); await next(); };
  app.use("/v1/tools/*", tool);
  app.post("/v1/tools/get-booking-context", async (c) => { const id = requestId(); const p = getBookingContextRequestSchema.safeParse(await c.req.json().catch(() => null)); if (!p.success) return c.json(failure(id, "VALIDATION_ERROR", "Invalid booking context request."), 400); const booking = await c.var.repo.getBooking(p.data.bookingId); return booking ? c.json(success(id, booking, { bookingVersion: booking.version })) : c.json(failure(id, "BOOKING_NOT_FOUND", "Booking was not found."), 404); });
  const mutationRoute = (path: string, schema: z.ZodType, toMutation: (data: any) => Mutation, toolName: any) => app.post(path, async (c) => { const id = requestId(); const p = schema.safeParse(await c.req.json().catch(() => null)); if (!p.success) return c.json(failure(id, "VALIDATION_ERROR", "Invalid tool request."), 400); const data: any = p.data; const output = await c.var.repo.mutate({ callId: data.dispatchCallId, bookingId: data.bookingId, toolName, idempotencyKey: c.req.header("Idempotency-Key") ?? `${data.callSid}:${toolName}`, expectedVersion: "expectedVersion" in data ? data.expectedVersion : undefined, mutation: toMutation(data) }); if ("code" in output) return c.json(failure(id, output.code, output.message, output.code === "STALE_STATE", output.code === "STALE_STATE" ? "Call get-booking-context and retry." : undefined), output.code === "BOOKING_NOT_FOUND" || output.code === "CALL_NOT_FOUND" ? 404 : 409); return c.json(success(id, { booking: output.booking, toolEvent: output.toolEvent }, { bookingVersion: output.booking.version, idempotentReplay: output.idempotentReplay })); });
  mutationRoute("/v1/tools/update-eta", updateEtaRequestSchema, (d) => ({ action: "update-eta", etaMinutes: d.etaMinutes }), "update-eta");
  mutationRoute("/v1/tools/mark-unavailable", markUnavailableRequestSchema, (d) => ({ action: "mark-unavailable", reason: d.reason }), "mark-unavailable");
  mutationRoute("/v1/tools/mark-arrived", markArrivedRequestSchema, () => ({ action: "mark-arrived" }), "mark-arrived");
  mutationRoute("/v1/tools/request-replacement", requestReplacementRequestSchema, () => ({ action: "request-replacement" }), "request-replacement");
  mutationRoute("/v1/tools/send-customer-event", sendCustomerEventRequestSchema, (d) => ({ action: "send-customer-event", event: d.event }), "send-customer-event");
  mutationRoute("/v1/tools/escalate", escalateRequestSchema, (d) => ({ action: "escalate", reason: d.reason, ...(d.notes ? { notes: d.notes } : {}) }), "escalate");
  return app;
}

const app = createApp(); export default app;
