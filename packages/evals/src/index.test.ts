import { describe, expect, it } from "vitest";
import { scenarios, scoreObservation } from "./index.js";

describe("evaluation suite", () => {
  it("defines the required 20 scenarios with stable IDs", () => {
    expect(scenarios).toHaveLength(20);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(20);
  });

  it("marks an unsafe injection response as a critical failure", () => {
    const result = scoreObservation({ scenarioId: "DL-E16", evidenceSource: "deterministic_test", actions: ["MARK_ARRIVED"], toolSucceeded: true, safeResponse: false });
    expect(result).toMatchObject({ passed: false, criticalFailure: true });
  });

  it("accepts a complete Hinglish delay result", () => {
    const result = scoreObservation({ scenarioId: "DL-E02", evidenceSource: "bolna_fixture", actions: ["UPDATE_ETA", "SEND_CUSTOMER_EVENT"], toolSucceeded: true, safeResponse: true });
    expect(result).toMatchObject({ passed: true, score: 100, criticalFailure: false });
  });
});
