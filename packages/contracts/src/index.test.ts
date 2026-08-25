import { describe, expect, it } from "vitest";
import { bookingSchema, updateEtaRequestSchema } from "./index.js";

describe("contracts", () => {
  it("accepts a safe seeded booking", () => {
    expect(bookingSchema.parse({
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
      updatedAt: "2026-08-25T10:00:00.000Z"
    })).toMatchObject({ id: "DL-48291" });
  });

  it("rejects an unsafe ETA", () => {
    expect(() => updateEtaRequestSchema.parse({
      dispatchCallId: "00000000-0000-4000-8000-000000000001",
      callSid: "call-1",
      bookingId: "DL-48291",
      expectedVersion: 1,
      etaMinutes: 181
    })).toThrow();
  });
});
