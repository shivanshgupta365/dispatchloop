const required = [
  "BOLNA_API_KEY",
  "BOLNA_AGENT_ID",
  "BOLNA_TOOL_TOKEN",
  "DEMO_RECIPIENT_PHONE",
  "DISPATCHLOOP_OPERATOR_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];

for (const key of required) {
  process.stdout.write(`${key}=${process.env[key] ? "present" : "missing"}\n`);
}
