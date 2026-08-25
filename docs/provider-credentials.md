# Provider credentials and live-call setup

The repository is safe to demo without credentials (`INTEGRATION_MODE=mock`). Never commit any value from this document’s secret fields or paste secrets into the desktop build.

## Bolna (the implemented live adapter)

1. Create or sign in to a Bolna account at [bolna.ai](https://www.bolna.ai/).
2. In the Bolna dashboard, create an agent and copy its **Agent ID**. The agent should use the immutable prompt in `prompts/v1/system.md` and the seven definitions in `prompts/v1/bolna-tools.json`.
3. Create an API key from the account/API settings and set it as `BOLNA_API_KEY`.
4. Create a separate random token for authenticated custom functions and set it as `BOLNA_TOOL_TOKEN`. Configure that same token as the custom-function authorization header in the agent.
5. Confirm the account has an outbound number. Set `BOLNA_FROM_PHONE_NUMBER` only when the account does not provide a default.
6. Use a phone number you own or have explicit permission to call as `DEMO_RECIPIENT_PHONE`.
7. Set `BOLNA_AGENT_ID`, `BOLNA_API_KEY`, `BOLNA_TOOL_TOKEN`, and `DEMO_RECIPIENT_PHONE` only in the Vercel production environment or a local server `.env` file. The desktop must never receive them.

The backend sends `dispatch_call_id`, `booking_id`, and `prompt_version` through Bolna `user_data`; tools remain policy-controlled by the API. Start with fixture mode, then set `INTEGRATION_MODE=live` only after one supervised call succeeds.

## Sarvam (alternative provider)

Sarvam can provide Indian-language speech-to-text/text-to-speech, but it is not a drop-in replacement for the current Bolna call adapter. Sarvam does not supply the same outbound execution lifecycle and custom-function transport used by this repository. To use it, obtain a Sarvam API key from [dashboard.sarvam.ai](https://dashboard.sarvam.ai/), then implement a provider adapter that supplies:

- outbound telephony and call execution IDs;
- authenticated tool callbacks to `/v1/tools/*`;
- transcript and terminal-status webhooks;
- retry, polling, and recording/cost normalization.

Keep the existing Bolna adapter and fixtures while adding that adapter. Do not label Sarvam-backed runs as `live_call` until the complete lifecycle and tool evidence has been captured.

## Supabase project

The free-tier project is `dispatchloop` in `ap-south-1` with URL:

`https://fzodflkekmnpvcggvgrd.supabase.co`

The committed migration is applied and seeded with three synthetic bookings. To connect the API, copy the **service_role** key from Supabase Project Settings → API into `SUPABASE_SERVICE_ROLE_KEY` and set `SUPABASE_URL` to the URL above. Keep RLS enabled; the browser must not use the service-role key.
