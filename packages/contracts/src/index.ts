import { z } from "zod";

export const integrationModeSchema = z.enum(["live", "fixture", "mock"]);
export type IntegrationMode = z.infer<typeof integrationModeSchema>;

export const evidenceSourceSchema = z.enum(["live_call", "bolna_fixture", "deterministic_test"]);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const professionalStatusSchema = z.enum([
  "UNKNOWN",
  "ON_TRACK",
  "DELAYED",
  "UNAVAILABLE",
  "ARRIVED",
  "ESCALATED"
]);
export type ProfessionalStatus = z.infer<typeof professionalStatusSchema>;

export const callStatusSchema = z.enum([
  "scheduled",
  "queued",
  "rescheduled",
  "initiated",
  "ringing",
  "in-progress",
  "call-disconnected",
  "completed",
  "balance-low",
  "busy",
  "no-answer",
  "canceled",
  "failed",
  "stopped",
  "error"
]);
export type CallStatus = z.infer<typeof callStatusSchema>;

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "BOOKING_NOT_FOUND",
  "CALL_NOT_FOUND",
  "STALE_STATE",
  "POLICY_DENIED",
  "INTEGRATION_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR"
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const customerEventSchema = z.enum([
  "PROFESSIONAL_ON_TRACK",
  "PROFESSIONAL_DELAYED",
  "PROFESSIONAL_ARRIVED_CUSTOMER_UNREACHABLE",
  "REPLACEMENT_REQUESTED"
]);
export type CustomerEvent = z.infer<typeof customerEventSchema>;

export const unavailableReasonSchema = z.enum([
  "VEHICLE_BREAKDOWN",
  "PERSONAL_EMERGENCY",
  "ILLNESS",
  "SAFETY_INCIDENT"
]);
export type UnavailableReason = z.infer<typeof unavailableReasonSchema>;

export const escalationReasonSchema = z.enum([
  "SAFETY_INCIDENT",
  "CUSTOMER_UNREACHABLE",
  "LOCATION_BLOCKER",
  "POLICY_EXCEPTION",
  "TOOL_FAILURE",
  "WRONG_RECIPIENT"
]);
export type EscalationReason = z.infer<typeof escalationReasonSchema>;

export const bookingSchema = z.object({
  id: z.string().regex(/^DL-\d{5}$/),
  professionalName: z.string(),
  serviceType: z.string(),
  appointmentAt: z.string().datetime(),
  locality: z.string(),
  safeLandmark: z.string(),
  professionalStatus: professionalStatusSchema,
  etaMinutes: z.number().int().min(1).max(180).nullable(),
  riskReason: z.string(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime()
});
export type Booking = z.infer<typeof bookingSchema>;

export const toolNameSchema = z.enum([
  "get-booking-context",
  "update-eta",
  "mark-unavailable",
  "mark-arrived",
  "request-replacement",
  "send-customer-event",
  "escalate"
]);
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolEventSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  toolName: toolNameSchema,
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  success: z.boolean(),
  errorCode: errorCodeSchema.nullable(),
  latencyMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
});
export type ToolEvent = z.infer<typeof toolEventSchema>;

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  bookingId: bookingSchema.shape.id,
  action: z.string(),
  before: bookingSchema.nullable(),
  after: bookingSchema.nullable(),
  source: z.enum(["operator", "voice_tool", "system"]),
  correlationId: z.string(),
  createdAt: z.string().datetime()
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const callSchema = z.object({
  id: z.string().uuid(),
  bookingId: bookingSchema.shape.id,
  bolnaExecutionId: z.string().uuid().nullable(),
  status: callStatusSchema,
  mode: integrationModeSchema,
  evidenceSource: evidenceSourceSchema,
  promptVersion: z.string(),
  transcript: z.string().nullable(),
  outcome: z.string().nullable(),
  escalated: z.boolean(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});
export type Call = z.infer<typeof callSchema>;

export const bookingDetailSchema = z.object({
  booking: bookingSchema,
  calls: z.array(callSchema),
  auditEvents: z.array(auditEventSchema)
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

export const callDetailSchema = z.object({
  call: callSchema,
  booking: bookingSchema,
  toolEvents: z.array(toolEventSchema),
  auditEvents: z.array(auditEventSchema)
});
export type CallDetail = z.infer<typeof callDetailSchema>;

export const apiMetaSchema = z.object({
  requestId: z.string().uuid(),
  idempotentReplay: z.boolean().optional(),
  bookingVersion: z.number().int().positive().optional()
});

export const apiSuccessSchema = <T extends z.ZodType>(data: T) =>
  z.object({ ok: z.literal(true), data, meta: apiMetaSchema });

export const apiFailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    nextAction: z.string().optional()
  }),
  meta: z.object({ requestId: z.string().uuid() })
});

export type ApiSuccess<T> = { ok: true; data: T; meta: z.infer<typeof apiMetaSchema> };
export type ApiFailure = z.infer<typeof apiFailureSchema>;
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const createCallRequestSchema = z.object({ expectedVersion: z.number().int().positive().optional() });
export const createCallResponseSchema = z.object({
  callId: z.string().uuid(),
  executionId: z.string().uuid().nullable(),
  status: callStatusSchema,
  mode: integrationModeSchema
});

export const toolBaseSchema = z.object({
  dispatchCallId: z.string().uuid(),
  callSid: z.string().min(1),
  bookingId: bookingSchema.shape.id
});

export const getBookingContextRequestSchema = toolBaseSchema;
export const updateEtaRequestSchema = toolBaseSchema.extend({
  expectedVersion: z.number().int().positive(),
  etaMinutes: z.number().int().min(1).max(180)
});
export const markUnavailableRequestSchema = toolBaseSchema.extend({
  expectedVersion: z.number().int().positive(),
  reason: unavailableReasonSchema
});
export const markArrivedRequestSchema = toolBaseSchema.extend({ expectedVersion: z.number().int().positive() });
export const requestReplacementRequestSchema = toolBaseSchema.extend({ expectedVersion: z.number().int().positive() });
export const sendCustomerEventRequestSchema = toolBaseSchema.extend({
  expectedVersion: z.number().int().positive(),
  event: customerEventSchema
});
export const escalateRequestSchema = toolBaseSchema.extend({
  reason: escalationReasonSchema,
  notes: z.string().max(180).optional()
});

export const evaluationCaseResultSchema = z.object({
  scenarioId: z.string(),
  passed: z.boolean(),
  criticalFailure: z.boolean(),
  score: z.number().min(0).max(100),
  notes: z.string()
});
export const evaluationRunSchema = z.object({
  id: z.string().uuid(),
  promptVersion: z.string(),
  evidenceSource: evidenceSourceSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  cases: z.array(evaluationCaseResultSchema)
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export const terminalCallStatuses = new Set<CallStatus>([
  "completed", "balance-low", "busy", "no-answer", "canceled", "failed", "stopped", "error"
]);
