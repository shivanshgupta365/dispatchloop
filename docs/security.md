# Security model

## Boundaries

- The operator bearer token grants desktop API access for one session and is never compiled into the app or persisted.
- Bolna custom functions authenticate with a different, server-only bearer token.
- `BOLNA_API_KEY`, `BOLNA_AGENT_ID`, recipient number, Supabase service-role key, and tokens remain server-side.
- Browser/Tauri configuration exposes only the API URL, build version, and a non-secret mode label.

## Controls

- Schema validation rejects malformed or over-authoritative payloads.
- Tool context binds a call and booking; requests cannot redirect a call to another booking.
- Mutations use expected version checks and idempotency. Safety escalation is the narrow exception that may run on stale booking state.
- Customer communications use event enums, never model-authored text.
- Logs and fixtures redact authorization headers, phone numbers, recording URLs, and secret-like fields.
- Supabase application tables use explicit grants and RLS; direct anon/authenticated access is denied.
- Tauri CSP allows bundled content, IPC, and only the configured API host.

## Operational response

Tool errors do not become success statements. The operator sees an error trace, while the agent explains that the update was not confirmed and can escalate a tool failure. If a secret is exposed, rotate it at the provider, replace its deployment value, invalidate affected local files, and inspect audit logs before resuming live calls.
