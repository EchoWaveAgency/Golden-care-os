-- Golden Care OS — 0035 HORUS Engage integration
-- HORUS Engage (WhatsApp / Messenger / Instagram / comments automation) sends signed events to
-- POST /api/integrations/engage. Each event becomes (or joins) a call-center lead through the same capture rules as
-- WhatsApp (one open lead per phone + campaign), with the conversation summary and any booking request.
-- Idempotent per Engage event id.

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('meta', 'facebook', 'instagram', 'whatsapp', 'organic', 'manual', 'other', 'messenger', 'comment'));

-- p: Engage event payload (event, event_id, channel, source, campaign_code, referral, service_code, handoff_reason,
--    contact {name, phone, lang}, transcript [{at, from, text}], booking {day, period, note})
create or replace function app.lead_external(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  v_event text := p->>'event';
  v_channel text := coalesce(p->>'channel', 'whatsapp');
  v_phone text := app.normalize_phone(p->'contact'->>'phone');
  v_summary text; v_cap jsonb; l public.leads; v_booking jsonb := case when jsonb_typeof(p->'booking') = 'object' then p->'booking' end;
begin
  if v_event not in ('lead', 'booking_request', 'handoff', 'comment_complaint') then raise exception 'unknown event' using errcode = '22023'; end if;
  if nullif(p->>'event_id', '') is null then raise exception 'event id is required' using errcode = '22023'; end if;
  if v_phone is null then return jsonb_build_object('action', 'skipped', 'reason', 'no phone yet'); end if;
  -- What the call center reads first: campaign code (so the campaign is detected), service, what the customer said.
  v_summary := concat_ws(E'\n',
    concat_ws(' · ', '[HORUS Engage · ' || v_channel || ']', nullif(p->>'campaign_code', ''), nullif(p->>'service_code', ''),
              case v_event when 'booking_request' then 'طلب حجز / booking request' when 'handoff' then 'طلب موظف / wants a person: ' || coalesce(p->>'handoff_reason', '') else null end),
    case when v_booking is not null then 'الموعد المفضل / preferred: ' || coalesce(v_booking->>'day', '') || ' ' || coalesce(v_booking->>'period', '') end,
    (select string_agg(case when t->>'from' = 'contact' then '› ' else '‹ ' end || left(t->>'text', 300), E'\n')
       from jsonb_array_elements(coalesce(p->'transcript', '[]')) t where t->>'from' in ('contact', 'bot', 'agent')));
  v_cap := app.lead_capture(jsonb_build_object(
    'phone', v_phone, 'name', p->'contact'->>'name', 'provider_id', 'engage:' || (p->>'event_id'), 'text', left(v_summary, 4000),
    'referral', case when jsonb_typeof(p->'referral') = 'object' then p->'referral' end, 'force', true));
  select * into l from public.leads where id = (v_cap->>'lead_id')::uuid for update;
  -- Source as the customer actually came: Messenger page → facebook, Instagram → instagram, comment → its platform.
  if v_cap->>'action' = 'created' and v_channel in ('messenger', 'instagram') then
    update public.leads set source = case when v_channel = 'instagram' then 'instagram' else 'facebook' end,
      channel = 'social' where id = l.id;
  end if;
  if v_cap->>'action' <> 'duplicate' then
    if v_booking is not null then
      update public.leads set kind = 'booking' where id = l.id;
      insert into public.lead_activities (lead_id, kind, body, actor_id)
      values (l.id, 'system', concat_ws(' · ', 'booking request via HORUS Engage', v_booking->>'day', v_booking->>'period', nullif(p->>'service_code', '')), null);
    elsif v_event = 'handoff' then
      insert into public.lead_activities (lead_id, kind, body, actor_id) values (l.id, 'system', 'customer asked for a person (HORUS Engage): ' || coalesce(p->>'handoff_reason', ''), null);
    end if;
  end if;
  return jsonb_build_object('action', v_cap->>'action', 'ref', l.code, 'lead_id', l.id);
end $$;

create or replace function public.svc_lead_external(p jsonb)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.lead_external(p) $$;
revoke execute on function public.svc_lead_external(jsonb), app.lead_external(jsonb) from public, anon, authenticated;
grant execute on function public.svc_lead_external(jsonb) to service_role;
