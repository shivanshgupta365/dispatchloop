import { describe, expect, it } from "vitest";
import type { Booking } from "@dispatchloop/contracts";
import { canRequestReplacement, canSendCustomerEvent, statusForEta } from "./index.js";

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "DL-48291",
  professionalName: "Ramesh",
  serviceType: "AC Repair",
  appointmentAt: "2026-08-25T10:30:00.000Z",
  locality: "HSR Layout",
  safeLandmark: "Main gate",
  professionalStatus: "UNKNOWN",
  etaMinutes: null,
  riskReason: "Arrival unconfirmed",
  version: 1,
  updatedAt: "2026-08-25T10:00:00.000Z",
  ...overrides
});

describe("dispatch policy", () => {
  it("classifies ETA at the on-track boundary", () => {
    expect(statusForEta(15)).toBe("ON_TRACK");
    expect(statusForEta(16)).toBe("DELAYED");
  });

  it("only permits replacement for unavailable or severe delay", () => {
    expect(canRequestReplacement(booking({ etaMinutes: 44 }))).toMatchObject({ allowed: false });
    expect(canRequestReplacement(booking({ etaMinutes: 45 }))).toMatchObject({ allowed: true });
    expect(canRequestReplacement(booking({ professionalStatus: "UNAVAILABLE" }))).toMatchObject({ allowed: true });
  });

  it("requires an arrival state before customer-unreachable notice", () => {
    expect(canSendCustomerEvent(booking(), "PROFESSIONAL_ARRIVED_CUSTOMER_UNREACHABLE")).toMatchObject({ allowed: false });
    expect(canSendCustomerEvent(booking({ professionalStatus: "ARRIVED" }), "PROFESSIONAL_ARRIVED_CUSTOMER_UNREACHABLE")).toMatchObject({ allowed: true });
  });
});
