# Prompt evolution and failure analysis

Prompt directories are immutable. Create `prompts/v2/` only after recording one genuine failure below and adding it as a permanent regression scenario.

| Field | Required record |
| --- | --- |
| Failure ID | Stable ID, date, prompt version |
| Evidence source | `live_call`, `bolna_fixture`, or `deterministic_test` |
| Transcript/trace | Redacted excerpt and tool result |
| Classification | Prompt, tool description, policy, integration, STT/latency, or UX |
| Impact | Whether it is critical and why |
| Narrow fix | One responsible layer only |
| Regression | Scenario ID and passing result |

No aggregate accuracy or latency claim is published without retained evidence and an evidence-source label.
