-- Golden Care OS — 0012 Service-role wrappers
-- PostgREST exposes only the public schema. These thin wrappers let trusted server code
-- (service role) reach internal app.* primitives. They are NOT executable by anon or
-- signed-in users.

create or replace function public.svc_portal_otp_issue(p_phone text, p_ip text)
returns table (code text, patient_id uuid, lang text) language sql volatile security definer set search_path = public, app, pg_temp as $$
  select * from app.portal_otp_issue(p_phone, p_ip)
$$;
create or replace function public.svc_portal_otp_verify(p_phone text, p_code text)
returns uuid language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.portal_otp_verify(p_phone, p_code)
$$;
create or replace function public.svc_portal_link_account(p_user uuid, p_patient uuid)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.portal_link_account(p_user, p_patient)
$$;
create or replace function public.svc_outbox_claim(p_limit int)
returns setof public.message_outbox language sql volatile security definer set search_path = public, app, pg_temp as $$
  select * from app.outbox_claim(p_limit)
$$;
create or replace function public.svc_outbox_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.outbox_result(p_id, p_ok, p_provider, p_provider_id, p_error)
$$;
create or replace function public.svc_outbox_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.outbox_status(p_provider_id, p_status)
$$;
create or replace function public.svc_enqueue_due_reminders()
returns int language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.enqueue_due_reminders()
$$;
create or replace function public.svc_log_otp_message(p_patient uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$
  -- Records that a sign-in code was sent, WITHOUT the code itself.
  insert into public.message_outbox (to_phone, template_code, vars, patient_id, idempotency_key, status, attempts, provider, provider_message_id, last_error, sent_at)
  select p.phone, 'portal_otp', '{}'::jsonb, p.id, 'otp-' || gen_random_uuid(), case when p_ok then 'sent' else 'failed' end, 1,
         p_provider, p_provider_id, p_error, case when p_ok then now() end
  from public.patients p where p.id = p_patient
$$;

revoke execute on function public.svc_portal_otp_issue(text, text), public.svc_portal_otp_verify(text, text),
  public.svc_portal_link_account(uuid, uuid), public.svc_outbox_claim(int), public.svc_outbox_result(uuid, boolean, text, text, text),
  public.svc_outbox_status(text, text), public.svc_enqueue_due_reminders(), public.svc_log_otp_message(uuid, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.svc_portal_otp_issue(text, text), public.svc_portal_otp_verify(text, text),
  public.svc_portal_link_account(uuid, uuid), public.svc_outbox_claim(int), public.svc_outbox_result(uuid, boolean, text, text, text),
  public.svc_outbox_status(text, text), public.svc_enqueue_due_reminders(), public.svc_log_otp_message(uuid, boolean, text, text, text)
  to service_role;
