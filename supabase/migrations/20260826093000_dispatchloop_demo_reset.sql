-- Server-only demo reset. The function retains the synthetic seed data and audit boundary.
create or replace function public.dispatch_reset_demo()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.tool_events;
  delete from public.audit_events;
  delete from public.webhook_events;
  delete from public.evaluation_cases;
  delete from public.evaluation_runs;
  delete from public.calls;

  update public.bookings set
    professional_name = seed.professional_name,
    service_type = seed.service_type,
    appointment_at = seed.appointment_at,
    locality = seed.locality,
    safe_landmark = seed.safe_landmark,
    professional_status = seed.professional_status,
    eta_minutes = seed.eta_minutes,
    risk_reason = seed.risk_reason,
    version = 1,
    updated_at = now()
  from (values
    ('DL-10001', 'Aarav Mehta', 'AC repair', '2026-08-25T10:30:00Z'::timestamptz, 'Bandra West', 'Near Hill Road', 'UNKNOWN', null::integer, 'Awaiting professional check-in'),
    ('DL-10002', 'Riya Sharma', 'Plumbing', '2026-08-25T11:00:00Z'::timestamptz, 'Andheri East', 'Metro Gate 2', 'DELAYED', 25, 'ETA exceeds customer notice threshold'),
    ('DL-10003', 'Imran Khan', 'Appliance repair', '2026-08-25T12:00:00Z'::timestamptz, 'Powai', 'Main market', 'ON_TRACK', 12, 'On track')
  ) as seed(id, professional_name, service_type, appointment_at, locality, safe_landmark, professional_status, eta_minutes, risk_reason)
  where public.bookings.id = seed.id;

  insert into public.audit_events (booking_id, action, source, correlation_id)
  values ('DL-10001', 'demo_reset', 'system', 'demo-reset');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.dispatch_reset_demo() from public, anon, authenticated;
grant execute on function public.dispatch_reset_demo() to service_role;
