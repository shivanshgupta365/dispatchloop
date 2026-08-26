import { randomUUID } from "node:crypto";
import type { AuditEvent, Booking, Call, CallDetail, ToolEvent, ToolName } from "@dispatchloop/contracts";
import type { AppEnv, DispatchRepository, Mutation, ToolMutationResult } from "./types.js";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const statusRank: Record<Call["status"], number> = { scheduled: 0, queued: 1, rescheduled: 2, initiated: 3, ringing: 4, "in-progress": 5, "call-disconnected": 6, completed: 7, "balance-low": 7, busy: 7, "no-answer": 7, canceled: 7, failed: 7, stopped: 7, error: 7 };
const asString = (value: unknown) => value === null || value === undefined ? null : String(value);

const booking = (row: Row): Booking => ({
  id: String(row.id), professionalName: String(row.professional_name), serviceType: String(row.service_type), appointmentAt: String(row.appointment_at), locality: String(row.locality), safeLandmark: String(row.safe_landmark), professionalStatus: row.professional_status as Booking["professionalStatus"], etaMinutes: row.eta_minutes === null ? null : Number(row.eta_minutes), riskReason: String(row.risk_reason), version: Number(row.version), updatedAt: String(row.updated_at)
});
const call = (row: Row): Call => ({
  id: String(row.id), bookingId: String(row.booking_id), bolnaExecutionId: asString(row.bolna_execution_id), status: row.status as Call["status"], mode: row.mode as Call["mode"], evidenceSource: row.evidence_source as Call["evidenceSource"], promptVersion: String(row.prompt_version), transcript: asString(row.transcript_redacted), outcome: asString(row.outcome), escalated: Boolean(row.escalated), startedAt: asString(row.started_at), completedAt: asString(row.completed_at), updatedAt: String(row.updated_at)
});
const audit = (row: Row): AuditEvent => ({ id: String(row.id), bookingId: String(row.booking_id), action: String(row.action), before: row.before_state ? booking(row.before_state as Row) : null, after: row.after_state ? booking(row.after_state as Row) : null, source: row.source as AuditEvent["source"], correlationId: String(row.correlation_id), createdAt: String(row.created_at) });
const toolEvent = (row: Row): ToolEvent => ({ id: String(row.id), callId: String(row.call_id), toolName: row.tool_name as ToolName, input: row.input as Record<string, unknown>, result: row.result as Record<string, unknown>, success: Boolean(row.success), errorCode: asString(row.error_code) as ToolEvent["errorCode"], latencyMs: Number(row.latency_ms), createdAt: String(row.created_at) });

export class SupabaseDispatchRepository implements DispatchRepository {
  constructor(private readonly url: string, private readonly key: string) {}

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, { ...init, headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`Supabase request failed (${response.status}).`);
    return await response.json() as T;
  }
  private async rows(path: string) { return this.rest<Row[]>(path); }
  private async one(path: string) { const rows = await this.rows(path); return rows[0] ?? null; }

  async listBookings() {
    const [bookings, calls] = await Promise.all([this.rows("bookings?select=*&order=updated_at.desc"), this.rows("calls?select=*&order=updated_at.desc")]);
    return bookings.map((item) => { const current = booking(item); const latest = calls.find((candidate) => candidate.booking_id === current.id); return { ...current, latestCall: latest ? call(latest) : null }; });
  }
  async getBooking(id: string) { const row = await this.one(`bookings?select=*&id=eq.${encodeURIComponent(id)}`); return row ? booking(row) : null; }
  async getBookingDetail(id: string) {
    const current = await this.getBooking(id); if (!current) return null;
    const [calls, events] = await Promise.all([this.rows(`calls?select=*&booking_id=eq.${encodeURIComponent(id)}&order=updated_at.desc`), this.rows(`audit_events?select=*&booking_id=eq.${encodeURIComponent(id)}&order=created_at.desc`)]);
    return { booking: current, calls: calls.map(call), auditEvents: events.map(audit) };
  }
  async getCallRaw(id: string) { const row = await this.one(`calls?select=*&id=eq.${encodeURIComponent(id)}`); return row ? call(row) : null; }
  async getCall(id: string): Promise<CallDetail | null> {
    const current = await this.getCallRaw(id); if (!current) return null; const currentBooking = await this.getBooking(current.bookingId); if (!currentBooking) return null;
    const [tools, audits] = await Promise.all([this.rows(`tool_events?select=*&call_id=eq.${encodeURIComponent(id)}&order=created_at.asc`), this.rows(`audit_events?select=*&booking_id=eq.${encodeURIComponent(current.bookingId)}&order=created_at.asc`)]);
    return { call: current, booking: currentBooking, toolEvents: tools.map(toolEvent), auditEvents: audits.map(audit) };
  }
  async findCallByExecution(executionId: string) { const row = await this.one(`calls?select=*&bolna_execution_id=eq.${encodeURIComponent(executionId)}`); return row ? call(row) : null; }
  async createCall(input: { bookingId: string; idempotencyKey: string; mode: Call["mode"]; executionId: string | null }) {
    const existing = await this.one(`calls?select=*&booking_id=eq.${encodeURIComponent(input.bookingId)}&idempotency_key=eq.${encodeURIComponent(input.idempotencyKey)}`); if (existing) return { call: call(existing), idempotentReplay: true };
    const payload = { booking_id: input.bookingId, idempotency_key: input.idempotencyKey, bolna_execution_id: input.executionId, status: "queued", mode: input.mode, evidence_source: input.mode === "live" ? "live_call" : input.mode === "fixture" ? "bolna_fixture" : "deterministic_test", prompt_version: "v1" };
    const created = await this.rest<Row[]>("calls", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }); return { call: call(created[0]!), idempotentReplay: false };
  }
  async attachExecution(callId: string, executionId: string | null) { const rows = await this.rest<Row[]>(`calls?id=eq.${encodeURIComponent(callId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ bolna_execution_id: executionId, updated_at: now() }) }); return rows[0] ? call(rows[0]) : null; }
  async mutate(input: { callId: string; bookingId: string; toolName: ToolName; idempotencyKey: string; expectedVersion?: number | undefined; mutation: Mutation }): Promise<ToolMutationResult | { code: "BOOKING_NOT_FOUND" | "CALL_NOT_FOUND" | "STALE_STATE" | "POLICY_DENIED"; message: string }> {
    const result = await this.rest<{ ok: boolean; code?: "BOOKING_NOT_FOUND" | "CALL_NOT_FOUND" | "STALE_STATE" | "POLICY_DENIED"; message?: string; idempotent_replay?: boolean; result?: Row }>("rpc/dispatch_apply_tool_mutation", { method: "POST", body: JSON.stringify({ p_call_id: input.callId, p_booking_id: input.bookingId, p_tool_name: input.toolName, p_idempotency_key: input.idempotencyKey, p_expected_version: input.expectedVersion ?? null, p_action: input.mutation.action, p_payload: input.mutation }) });
    if (!result.ok) return { code: result.code ?? "POLICY_DENIED", message: result.message ?? "Action was not allowed." };
    const event = await this.one(`tool_events?select=*&call_id=eq.${encodeURIComponent(input.callId)}&idempotency_key=eq.${encodeURIComponent(input.idempotencyKey)}`); if (!result.result || !event) throw new Error("Supabase mutation result was incomplete.");
    return { booking: booking(result.result), toolEvent: toolEvent(event), idempotentReplay: Boolean(result.idempotent_replay) };
  }
  async updateCallStatus(callId: string, status: Call["status"], final?: { transcript?: string | null; outcome?: string | null }) {
    const current = await this.getCallRaw(callId); if (!current || statusRank[status] < statusRank[current.status]) return current;
    const terminal = statusRank[status] >= 7; const started = current.startedAt ?? (["initiated", "ringing", "in-progress"] as string[]).includes(status) ? now() : null;
    const patch = { status, started_at: started, completed_at: terminal ? now() : current.completedAt, transcript_redacted: terminal ? (final?.transcript ?? current.transcript) : current.transcript, outcome: terminal ? (final?.outcome ?? current.outcome) : current.outcome, updated_at: now() };
    const rows = await this.rest<Row[]>(`calls?id=eq.${encodeURIComponent(callId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) }); return rows[0] ? call(rows[0]) : null;
  }
  async recordWebhook(input: { executionId: string; status: Call["status"]; payloadHash: string }) { await this.rest<Row[]>("webhook_events?on_conflict=execution_id,payload_hash", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ execution_id: input.executionId, status: input.status, payload_hash: input.payloadHash }) }); }
  async reset() { throw new Error("Demo reset is disabled for the persistent Supabase repository."); }
}

export const supabaseRepositoryFromEnv = (env: AppEnv): DispatchRepository | null => env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseDispatchRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null;
