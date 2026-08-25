# Known limitations

- This is a synthetic assessment application; it has no real marketplace, CRM, billing, or customer identity integration.
- Mock and fixture modes are intentionally retained for deterministic demos; they are visibly labelled and are not live-call evidence.
- Live calling requires a user-provided Bolna account, configured agent, outbound capability, and safe recipient.
- The app does not download or publish recordings.
- The initial release artifacts are unsigned unless Apple/Windows signing credentials are explicitly configured; macOS notarization is not implied.
- There is one operator boundary, not a multi-tenant authorization system.
- Webhook acceptance relies on local execution ownership plus canonical provider retrieval; it does not assume a provider signature exists.
