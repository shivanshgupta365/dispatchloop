import { randomUUID } from "node:crypto";
import type { AuditEvent, Booking, Call, CallDetail, ToolEvent, ToolName } from "@dispatchloop/contracts";
import { canRequestReplacement, canSendCustomerEvent, statusForEta } from "@dispatchloop/policy";
import type { DispatchRepository, Mutation, ToolMutationResult } from "./types.js";

const now = () => new Date().toISOString();
const seed = (): Booking[] => [
  { id: "DL-10001", professionalName: "Aarav Mehta", serviceType: "AC repair", appointmentAt: "2026-08-25T10:30:00.000Z", locality: "Bandra West", safeLandmark: "Near Hill Road", professionalStatus: "UNKNOWN", etaMinutes: null, riskReason: "Awaiting professional check-in", version: 1, updatedAt: now() },
  { id: "DL-10002", professionalName: "Riya Sharma", serviceType: "Plumbing", appointmentAt: "2026-08-25T11:00:00.000Z", locality: "Andheri East", safeLandmark: "Metro Gate 2", professionalStatus: "DELAYED", etaMinutes: 25, riskReason: "ETA exceeds customer notice threshold", version: 1, updatedAt: now() },
  { id: "DL-10003", professionalName: "Imran Khan", serviceType: "Appliance repair", appointmentAt: "2026-08-25T12:00:00.000Z", locality: "Powai", safeLandmark: "Main market", professionalStatus: "ON_TRACK", etaMinutes: 12, riskReason: "On track", version: 1, updatedAt: now() }
];

const statuses: Record<Call["status"], number> = { scheduled: 0, queued: 1, rescheduled: 2, initiated: 3, ringing: 4, "in-progress": 5, "call-disconnected": 6, completed: 7, "balance-low": 7, busy: 7, "no-answer": 7, canceled: 7, failed: 7, stopped: 7, error: 7 };

export class InMemoryDispatchRepository implements DispatchRepository {
  private bookings = new Map(seed().map((booking) => [booking.id, booking]));
  private calls = new Map<string, Call>();
  private tools: ToolEvent[] = [];
  private audits: AuditEvent[] = [];
  private callKeys = new Map<string, string>();
  private mutationKeys = new Map<string, ToolMutationResult>();

  async listBookings() {
    return [...this.bookings.values()].map((booking) => ({
      ...booking,
      latestCall: [...this.calls.values()].filter((call) => call.bookingId === booking.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    }));
  }
  async getBooking(id: string) { return this.bookings.get(id) ?? null; }
  async getBookingDetail(id: string) {
    const booking = this.bookings.get(id); if (!booking) return null;
    return { booking, calls: [...this.calls.values()].filter((call) => call.bookingId === id), auditEvents: this.audits.filter((event) => event.bookingId === id) };
  }
  async getCallRaw(id: string) { return this.calls.get(id) ?? null; }
  async getCall(id: string): Promise<CallDetail | null> {
    const call = this.calls.get(id); if (!call) return null;
    const booking = this.bookings.get(call.bookingId); if (!booking) return null;
    return { call, booking, toolEvents: this.tools.filter((event) => event.callId === id), auditEvents: this.audits.filter((event) => event.bookingId === call.bookingId) };
  }
  async findCallByExecution(executionId: string) { return [...this.calls.values()].find((call) => call.bolnaExecutionId === executionId) ?? null; }
  async createCall(input: { bookingId: string; idempotencyKey: string; mode: Call["mode"]; executionId: string | null }) {
    const existingId = this.callKeys.get(`${input.bookingId}:${input.idempotencyKey}`);
    if (existingId) return { call: this.calls.get(existingId)!, idempotentReplay: true };
    const call: Call = { id: randomUUID(), bookingId: input.bookingId, bolnaExecutionId: input.executionId, status: "queued", mode: input.mode, evidenceSource: input.mode === "live" ? "live_call" : input.mode === "fixture" ? "bolna_fixture" : "deterministic_test", promptVersion: "v1", transcript: null, outcome: null, escalated: false, startedAt: null, completedAt: null, updatedAt: now() };
    this.calls.set(call.id, call); this.callKeys.set(`${input.bookingId}:${input.idempotencyKey}`, call.id);
    return { call, idempotentReplay: false };
  }
  async attachExecution(callId: string, executionId: string | null) {
    const call = this.calls.get(callId); if (!call) return null;
    const updated = { ...call, bolnaExecutionId: executionId, updatedAt: now() }; this.calls.set(callId, updated); return updated;
  }
  async mutate(input: { callId: string; bookingId: string; toolName: ToolName; idempotencyKey: string; expectedVersion?: number | undefined; mutation: Mutation }) {
    const key = `${input.callId}:${input.idempotencyKey}`; const replay = this.mutationKeys.get(key); if (replay) return { ...replay, idempotentReplay: true };
    const booking = this.bookings.get(input.bookingId); if (!booking) return { code: "BOOKING_NOT_FOUND" as const, message: "Booking was not found." };
    if (!this.calls.has(input.callId)) return { code: "CALL_NOT_FOUND" as const, message: "Call was not found." };
    if (input.expectedVersion !== undefined && input.mutation.action !== "escalate" && input.expectedVersion !== booking.version) return { code: "STALE_STATE" as const, message: "Booking changed; retrieve fresh context before retrying." };
    const decision = this.authorize(booking, input.mutation); if (decision) return { code: "POLICY_DENIED" as const, message: decision };
    const before = structuredClone(booking); const changed = this.apply(booking, input.mutation); this.bookings.set(booking.id, changed);
    const event: ToolEvent = { id: randomUUID(), callId: input.callId, toolName: input.toolName, input: { ...input.mutation, expectedVersion: input.expectedVersion }, result: { booking: changed }, success: true, errorCode: null, latencyMs: 0, createdAt: now() };
    const audit: AuditEvent = { id: randomUUID(), bookingId: booking.id, action: input.mutation.action, before, after: changed, source: "voice_tool", correlationId: input.callId, createdAt: now() };
    this.tools.push(event); this.audits.push(audit);
    const result: ToolMutationResult = { booking: changed, toolEvent: event, idempotentReplay: false }; this.mutationKeys.set(key, result); return result;
  }
  private authorize(booking: Booking, mutation: Mutation): string | null {
    if (mutation.action === "request-replacement") { const d = canRequestReplacement(booking); return d.allowed ? null : d.reason; }
    if (mutation.action === "send-customer-event") { const d = canSendCustomerEvent(booking, mutation.event); return d.allowed ? null : d.reason; }
    return null;
  }
  private apply(before: Booking, mutation: Mutation): Booking {
    const updatedAt = now(); let patch: Partial<Booking> = {};
    if (mutation.action === "update-eta") patch = { etaMinutes: mutation.etaMinutes, professionalStatus: statusForEta(mutation.etaMinutes), riskReason: mutation.etaMinutes > 15 ? `Professional ETA is ${mutation.etaMinutes} minutes` : "On track" };
    if (mutation.action === "mark-unavailable") patch = { professionalStatus: "UNAVAILABLE", etaMinutes: null, riskReason: mutation.reason };
    if (mutation.action === "mark-arrived") patch = { professionalStatus: "ARRIVED", etaMinutes: 1, riskReason: "Professional arrived" };
    if (mutation.action === "request-replacement") patch = { riskReason: "Replacement requested" };
    if (mutation.action === "escalate") patch = { professionalStatus: "ESCALATED", riskReason: mutation.reason };
    return { ...before, ...patch, version: before.version + 1, updatedAt };
  }
  async updateCallStatus(callId: string, status: Call["status"], final?: { transcript?: string | null; outcome?: string | null }) {
    const call = this.calls.get(callId); if (!call || statuses[status] < statuses[call.status]) return call ?? null;
    const terminal = statuses[status] >= 7;
    const updated: Call = { ...call, status, startedAt: call.startedAt ?? (status === "initiated" || status === "ringing" || status === "in-progress" ? now() : null), completedAt: terminal ? now() : null, transcript: terminal ? (final?.transcript ?? call.transcript) : call.transcript, outcome: terminal ? (final?.outcome ?? call.outcome) : call.outcome, updatedAt: now() };
    this.calls.set(callId, updated); return updated;
  }
  async recordWebhook(_: { executionId: string; status: Call["status"]; payloadHash: string }) { /* retained by Supabase adapter in production */ }
  async reset() { this.bookings = new Map(seed().map((booking) => [booking.id, booking])); this.calls.clear(); this.tools = []; this.audits = []; this.callKeys.clear(); this.mutationKeys.clear(); }
}
