import type {
  AuditEvent,
  Booking,
  Call,
  CallDetail,
  CustomerEvent,
  EscalationReason,
  ProfessionalStatus,
  ToolEvent,
  ToolName,
  UnavailableReason
} from "@dispatchloop/contracts";

export type Mutation =
  | { action: "update-eta"; etaMinutes: number }
  | { action: "mark-unavailable"; reason: UnavailableReason }
  | { action: "mark-arrived" }
  | { action: "request-replacement" }
  | { action: "send-customer-event"; event: CustomerEvent }
  | { action: "escalate"; reason: EscalationReason; notes?: string | undefined };

export type ToolMutationResult = {
  booking: Booking;
  toolEvent: ToolEvent;
  idempotentReplay: boolean;
};

export interface DispatchRepository {
  listBookings(): Promise<Array<Booking & { latestCall: Call | null }>>;
  getBooking(id: string): Promise<Booking | null>;
  getBookingDetail(id: string): Promise<{ booking: Booking; calls: Call[]; auditEvents: AuditEvent[] } | null>;
  getCall(id: string): Promise<CallDetail | null>;
  getCallRaw(id: string): Promise<Call | null>;
  findCallByExecution(executionId: string): Promise<Call | null>;
  createCall(input: { bookingId: string; idempotencyKey: string; mode: Call["mode"]; executionId: string | null }): Promise<{ call: Call; idempotentReplay: boolean }>;
  attachExecution(callId: string, executionId: string | null): Promise<Call | null>;
  mutate(input: { callId: string; bookingId: string; toolName: ToolName; idempotencyKey: string; expectedVersion?: number | undefined; mutation: Mutation }): Promise<ToolMutationResult | { code: "BOOKING_NOT_FOUND" | "CALL_NOT_FOUND" | "STALE_STATE" | "POLICY_DENIED"; message: string }>;
  updateCallStatus(callId: string, status: Call["status"], final?: { transcript?: string | null; outcome?: string | null }): Promise<Call | null>;
  recordWebhook(input: { executionId: string; status: Call["status"]; payloadHash: string }): Promise<void>;
  reset(): Promise<void>;
}

export type AppEnv = {
  DISPATCHLOOP_OPERATOR_TOKEN?: string;
  /** @deprecated Use DISPATCHLOOP_OPERATOR_TOKEN. */
  OPERATOR_TOKEN?: string;
  BOLNA_TOOL_TOKEN?: string;
  BOLNA_API_KEY?: string;
  BOLNA_AGENT_ID?: string;
  BOLNA_FROM_PHONE_NUMBER?: string;
  DEMO_RECIPIENT_PHONE?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  INTEGRATION_MODE?: "live" | "fixture" | "mock";
  /** @deprecated Use INTEGRATION_MODE. */
  DISPATCHLOOP_MODE?: "live" | "fixture" | "mock";
};
