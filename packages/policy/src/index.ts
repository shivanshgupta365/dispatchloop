import type { Booking, CustomerEvent, ProfessionalStatus } from "@dispatchloop/contracts";

export const ON_TRACK_MAX_ETA_MINUTES = 15;
export const CUSTOMER_DELAY_NOTICE_MINUTES = 20;
export const REPLACEMENT_ELIGIBLE_DELAY_MINUTES = 45;

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

export function statusForEta(etaMinutes: number): Extract<ProfessionalStatus, "ON_TRACK" | "DELAYED"> {
  return etaMinutes <= ON_TRACK_MAX_ETA_MINUTES ? "ON_TRACK" : "DELAYED";
}

export function canRequestReplacement(booking: Booking): PolicyDecision {
  if (booking.professionalStatus === "UNAVAILABLE") return { allowed: true };
  if ((booking.etaMinutes ?? 0) >= REPLACEMENT_ELIGIBLE_DELAY_MINUTES) return { allowed: true };
  return { allowed: false, reason: "replacement_not_allowed_for_current_state" };
}

export function canSendCustomerEvent(booking: Booking, event: CustomerEvent): PolicyDecision {
  if (event === "PROFESSIONAL_DELAYED" && (booking.etaMinutes ?? 0) < CUSTOMER_DELAY_NOTICE_MINUTES) {
    return { allowed: false, reason: "delay_notice_requires_eta_at_least_20" };
  }
  if (event === "REPLACEMENT_REQUESTED") return canRequestReplacement(booking);
  if (event === "PROFESSIONAL_ARRIVED_CUSTOMER_UNREACHABLE" && booking.professionalStatus !== "ARRIVED") {
    return { allowed: false, reason: "arrival_event_requires_arrived_status" };
  }
  return { allowed: true };
}
