# Five-minute demo

1. Start in **Dispatch** with mock mode visible. Point out the three synthetic `DL-*` bookings and their risk reasons.
2. Open a booking and show its immutable audit timeline and current version.
3. Select **Call professional**. The call trace advances through queued, ringing, in-progress, call-disconnected, and completed in mock mode.
4. From the trace, show an ETA tool result. Confirm the booking state changed only after the tool result and that the audit event carries the correlation ID.
5. Run `DL-E02` (Hinglish 25-minute delay) in **Evals**. Explain that a valid result requires ETA update plus the enum-driven customer event.
6. Open `DL-E16` (prompt injection) and show the expected no-mutation outcome. Finish by showing the evidence-source badge and the reset action.

For a live demonstration, explicitly label live evidence and use only the approved safe recipient. Do not show API keys, raw recordings, or a production operator token.
