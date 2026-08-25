-- DispatchLoop is server-mediated: browser roles receive no table or RPC access.
create extension if not exists pgcrypto;

create table public.bookings (
  id text primary key check (id ~ '^DL-[0-9]{5}$'),
  professional_name text not null,
  service_type text not null,
  appointment_at timestamptz not null,
  locality text not null,
  safe_landmark text not null,
  professional_status text not null check (professional_status in ('UNKNOWN','ON_TRACK','DELAYED','UNAVAILABLE','ARRIVED','ESCALATED')),
  eta_minutes integer check (eta_minutes between 1 and 180),
  risk_reason text not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null references public.bookings(id),
  idempotency_key text not null,
  bolna_execution_id uuid unique,
  status text not null check (status in ('scheduled','queued','rescheduled','initiated','ringing','in-progress','call-disconnected','completed','balance-low','busy','no-answer','canceled','failed','stopped','error')),
  mode text not null check (mode in ('live','fixture','mock')),
  evidence_source text not null check (evidence_source in ('live_call','bolna_fixture','deterministic_test')),
  prompt_version text not null,
  transcript_redacted text,
  outcome text,
  escalated boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index calls_booking_idempotency_idx on public.calls (booking_id, idempotency_key);
create index calls_booking_updated_idx on public.calls (booking_id, updated_at desc);

create table public.tool_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id),
  tool_name text not null check (tool_name in ('get-booking-context','update-eta','mark-unavailable','mark-arrived','request-replacement','send-customer-event','escalate')),
  input jsonb not null,
  result jsonb not null,
  success boolean not null,
  error_code text,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  idempotency_key text not null,
  booking_version_before integer,
  booking_version_after integer,
  created_at timestamptz not null default now(),
  unique (call_id, idempotency_key)
);
create index tool_events_call_created_idx on public.tool_events (call_id, created_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null references public.bookings(id),
  action text not null,
  before_state jsonb,
  after_state jsonb,
  source text not null check (source in ('operator','voice_tool','system')),
  correlation_id text not null,
  created_at timestamptz not null default now()
);
create index audit_events_booking_created_idx on public.audit_events (booking_id, created_at);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null,
  status text not null,
  payload_hash text not null,
  redacted_payload jsonb,
  created_at timestamptz not null default now(),
  unique (execution_id, payload_hash)
);

create table public.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  prompt_version text not null,
  evidence_source text not null check (evidence_source in ('live_call','bolna_fixture','deterministic_test')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total integer not null default 0,
  passed integer not null default 0
);
create table public.evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  scenario_id text not null,
  passed boolean not null,
  critical_failure boolean not null default false,
  score numeric(5,2) not null check (score between 0 and 100),
  notes text not null,
  unique (run_id, scenario_id)
);

-- No direct Data API access; only a server-side service-role client may operate.
alter table public.bookings enable row level security;
alter table public.calls enable row level security;
alter table public.tool_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.webhook_events enable row level security;
alter table public.evaluation_runs enable row level security;
alter table public.evaluation_cases enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Atomic optimistic mutation. This is intentionally not callable through the Data API.
create or replace function public.dispatch_apply_tool_mutation(
  p_call_id uuid,
  p_booking_id text,
  p_tool_name text,
  p_idempotency_key text,
  p_expected_version integer,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_before jsonb;
  v_result jsonb;
  v_existing jsonb;
  v_allowed boolean := true;
  v_reason text;
begin
  select result into v_existing from public.tool_events where call_id = p_call_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then return jsonb_build_object('ok', true, 'idempotent_replay', true, 'result', v_existing); end if;
  perform 1 from public.calls where id = p_call_id and booking_id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'CALL_NOT_FOUND'); end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND'); end if;
  if p_action <> 'escalate' and p_expected_version is distinct from v_booking.version then return jsonb_build_object('ok', false, 'code', 'STALE_STATE'); end if;
  if p_action = 'request-replacement' and v_booking.professional_status <> 'UNAVAILABLE' and coalesce(v_booking.eta_minutes, 0) < 45 then v_allowed := false; v_reason := 'replacement_not_allowed_for_current_state'; end if;
  if p_action = 'send-customer-event' and p_payload->>'event' = 'PROFESSIONAL_DELAYED' and coalesce(v_booking.eta_minutes, 0) < 20 then v_allowed := false; v_reason := 'delay_notice_requires_eta_at_least_20'; end if;
  if p_action = 'send-customer-event' and p_payload->>'event' = 'PROFESSIONAL_ARRIVED_CUSTOMER_UNREACHABLE' and v_booking.professional_status <> 'ARRIVED' then v_allowed := false; v_reason := 'arrival_event_requires_arrived_status'; end if;
  if not v_allowed then return jsonb_build_object('ok', false, 'code', 'POLICY_DENIED', 'message', v_reason); end if;
  v_before := to_jsonb(v_booking);
  update public.bookings set
    eta_minutes = case when p_action = 'update-eta' then (p_payload->>'etaMinutes')::integer when p_action = 'mark-unavailable' then null else eta_minutes end,
    professional_status = case
      when p_action = 'update-eta' then case when (p_payload->>'etaMinutes')::integer <= 15 then 'ON_TRACK' else 'DELAYED' end
      when p_action = 'mark-unavailable' then 'UNAVAILABLE'
      when p_action = 'mark-arrived' then 'ARRIVED'
      when p_action = 'escalate' then 'ESCALATED'
      else professional_status end,
    risk_reason = case when p_action = 'request-replacement' then 'Replacement requested' when p_action = 'escalate' then p_payload->>'reason' when p_action = 'mark-arrived' then 'Professional arrived' else risk_reason end,
    version = version + 1, updated_at = now()
  where id = p_booking_id returning to_jsonb(bookings) into v_result;
  insert into public.tool_events (call_id, tool_name, input, result, success, idempotency_key, booking_version_before, booking_version_after)
  values (p_call_id, p_tool_name, jsonb_build_object('action', p_action, 'payload', p_payload), v_result, true, p_idempotency_key, v_booking.version, (v_result->>'version')::integer);
  insert into public.audit_events (booking_id, action, before_state, after_state, source, correlation_id)
  values (p_booking_id, p_action, v_before, v_result, 'voice_tool', p_call_id::text);
  return jsonb_build_object('ok', true, 'idempotent_replay', false, 'result', v_result);
end;
$$;
revoke all on function public.dispatch_apply_tool_mutation(uuid, text, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.dispatch_apply_tool_mutation(uuid, text, text, text, integer, text, jsonb) to service_role;

insert into public.bookings (id, professional_name, service_type, appointment_at, locality, safe_landmark, professional_status, eta_minutes, risk_reason)
values
  ('DL-10001', 'Aarav Mehta', 'AC repair', '2026-08-25T10:30:00Z', 'Bandra West', 'Near Hill Road', 'UNKNOWN', null, 'Awaiting professional check-in'),
  ('DL-10002', 'Riya Sharma', 'Plumbing', '2026-08-25T11:00:00Z', 'Andheri East', 'Metro Gate 2', 'DELAYED', 25, 'ETA exceeds customer notice threshold'),
  ('DL-10003', 'Imran Khan', 'Appliance repair', '2026-08-25T12:00:00Z', 'Powai', 'Main market', 'ON_TRACK', 12, 'On track')
on conflict (id) do nothing;
