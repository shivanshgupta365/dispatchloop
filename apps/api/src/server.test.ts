import { describe, expect, it } from "vitest";
import { createApp } from "./server.js";

const app = () => createApp({ env: { DISPATCHLOOP_OPERATOR_TOKEN: "operator", BOLNA_TOOL_TOKEN: "tool", INTEGRATION_MODE: "mock" } });
const operator = { Authorization: "Bearer operator" };
const tool = { Authorization: "Bearer tool" };

describe("DispatchLoop API", () => {
  it("protects operator routes and lists seeded bookings", async () => {
    const api = app();
    expect((await api.request("http://test/v1/bookings")).status).toBe(401);
    const response = await api.request("http://test/v1/bookings", { headers: operator });
    const payload = await response.json() as { ok: boolean; data: unknown[] };
    expect(response.status).toBe(200); expect(payload.ok).toBe(true); expect(payload.data).toHaveLength(3);
  });

  it("requires idempotency and replays duplicate call requests", async () => {
    const api = app();
    expect((await api.request("http://test/v1/bookings/DL-10001/calls", { method: "POST", headers: operator, body: "{}" })).status).toBe(400);
    const headers = { ...operator, "Idempotency-Key": "call-001", "Content-Type": "application/json" };
    const first = await api.request("http://test/v1/bookings/DL-10001/calls", { method: "POST", headers, body: "{}" });
    const second = await api.request("http://test/v1/bookings/DL-10001/calls", { method: "POST", headers, body: "{}" });
    const a = await first.json() as { data: { callId: string } }; const b = await second.json() as { data: { callId: string }; meta: { idempotentReplay: boolean } };
    expect(a.data.callId).toBe(b.data.callId); expect(b.meta.idempotentReplay).toBe(true);
  });

  it("enforces optimistic versions and tool policy", async () => {
    const api = app();
    const callResponse = await api.request("http://test/v1/bookings/DL-10001/calls", { method: "POST", headers: { ...operator, "Idempotency-Key": "call-002", "Content-Type": "application/json" }, body: "{}" });
    const call = await callResponse.json() as { data: { callId: string } };
    const base = { dispatchCallId: call.data.callId, callSid: "test-sid", bookingId: "DL-10001" };
    const denied = await api.request("http://test/v1/tools/request-replacement", { method: "POST", headers: { ...tool, "Content-Type": "application/json" }, body: JSON.stringify({ ...base, expectedVersion: 1 }) });
    expect(denied.status).toBe(409);
    const changed = await api.request("http://test/v1/tools/update-eta", { method: "POST", headers: { ...tool, "Content-Type": "application/json", "Idempotency-Key": "eta-001" }, body: JSON.stringify({ ...base, expectedVersion: 1, etaMinutes: 50 }) });
    const changedBody = await changed.json() as { data: { booking: { version: number; professionalStatus: string } } };
    expect(changedBody.data.booking).toMatchObject({ version: 2, professionalStatus: "DELAYED" });
    const stale = await api.request("http://test/v1/tools/update-eta", { method: "POST", headers: { ...tool, "Content-Type": "application/json", "Idempotency-Key": "eta-002" }, body: JSON.stringify({ ...base, expectedVersion: 1, etaMinutes: 12 }) });
    expect(stale.status).toBe(409);
    const replacement = await api.request("http://test/v1/tools/request-replacement", { method: "POST", headers: { ...tool, "Content-Type": "application/json" }, body: JSON.stringify({ ...base, expectedVersion: 2 }) });
    expect(replacement.status).toBe(200);
  });

  it("rejects malformed webhooks and accepts unknown executions without state authority", async () => {
    const api = app();
    expect((await api.request("http://test/v1/bolna/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
    const response = await api.request("http://test/v1/bolna/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_id: "45b57f00-9bbe-405e-8a48-2332537ab5d7", status: "completed" }) });
    expect(response.status).toBe(202);
  });
});
