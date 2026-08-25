# Prompt v1

This directory is immutable after deployment. `system.md` is the conversational policy; `bolna-tools.json` is the service-agnostic source definition for the seven authenticated custom functions. A future prompt version must be created as a sibling directory and include a regression record in `docs/failure-analysis.md`.

Configuration never includes a real phone number, token, customer name, recording, or agent export. The deployment adapter injects the production API base URL and tool bearer token only at runtime.
