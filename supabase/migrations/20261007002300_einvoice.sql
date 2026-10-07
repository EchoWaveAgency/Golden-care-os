-- Golden Care OS — 0023 Electronic invoices / receipts (Egyptian Tax Authority) — queue and adapter, OFF by default
-- No tax treatment is assumed: every service needs its ETA item code and its tax type / subtype / rate set by the
-- clinic's accountant. Until then documents are queued as "blocked" with the reason. The submission itself is done by
-- a connector in server code (src/lib/einvoice); only a local simulator ships until the clinic's ETA credentials and
-- pre-production certification are available.

create table public.einvoice_settings (
  organization_id uuid primary key references public.organizations(id),
  enabled         boolean not null default false,
  document_kind   text not null default 'receipt' check (document_kind in ('receipt', 'invoice')),
  environment     text not null default 'preprod' check (environment in ('preprod', 'production')),
  taxpayer_rin    text check (taxpayer_rin is null or taxpayer_rin ~ '^[0-9]{9}$'),
  taxpayer_name   text,
  activity_code   text check (activity_code is null or activity_code ~ '^[0-9]{4}$'),
  branch_code     text,
  pos_serial      text,
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);
create trigger trg_audit_einvoice_settings after insert or update on public.einvoice_settings for each row execute function app.audit_row();

alter table public.services add column if not exists eta_item_type text check (eta_item_type is null or eta_item_type in ('EGS', 'GS1'));
alter table public.services add column if not exists eta_item_code text;
alter table public.services add column if not exists eta_unit text not null default 'EA';
alter table public.services add column if not exists tax_type text;       -- e.g. the ETA tax type code chosen by the accountant
alter table public.services add column if not exists tax_subtype text;
alter table public.services add column if not exists tax_rate numeric(6,3) check (tax_rate is null or tax_rate between 0 and 100);

create table public.einvoice_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id       uuid not null references public.branches(id),
  source_type     text not null check (source_type in ('invoice', 'refund', 'package_refund', 'invoice_void')),
  source_id       uuid not null,
  doc_no          text not null,
  kind            text not null check (kind in ('receipt', 'invoice', 'return', 'cancellation')),
  status          text not null default 'pending' check (status in ('pending', 'blocked', 'sent', 'accepted', 'rejected', 'failed', 'cancelled')),
  block_reason    text,
  payload         jsonb not null default '{}'::jsonb,
  provider        text,
  submission_id   text,
  document_uuid   text,
  long_id         text,
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  lease_until     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source_type, source_id)
);
create index on public.einvoice_documents (status, next_attempt_at);
create trigger trg_audit_einvoice_docs after insert or update on public.einvoice_documents for each row execute function app.audit_row();

-- Builds the document from the source and checks it is complete. Returns (payload, block reason).
create or replace function app.einvoice_payload(p_source_type text, p_source_id uuid, out payload jsonb, out reason text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare st public.einvoice_settings; i public.invoices; p public.patients; v_lines jsonb := '[]'::jsonb; l record; v_missing text[] := '{}';
        v_inv uuid; v_amount numeric; v_kind text; v_date timestamptz; v_doc text; v_tax numeric; v_tax_total numeric := 0; v_net_total numeric := 0;
        v_ratio numeric := 1; v_target numeric; v_n int; v_k int := 0; v_net numeric;
begin
  if p_source_type in ('invoice', 'invoice_void') then
    v_inv := p_source_id;
  elsif p_source_type = 'refund' then
    select invoice_id, amount, paid_at into v_inv, v_amount, v_date from public.refunds where id = p_source_id;
  else
    select pk.invoice_id, r.amount, r.paid_at into v_inv, v_amount, v_date from public.package_refunds r join public.patient_packages pk on pk.id = r.package_id where r.id = p_source_id;
  end if;
  select * into i from public.invoices where id = v_inv;
  select * into st from public.einvoice_settings where organization_id = app.org_of_branch(i.branch_id);
  select * into p from public.patients where id = i.patient_id;
  v_kind := case p_source_type when 'invoice' then st.document_kind when 'invoice_void' then 'cancellation' else 'return' end;
  v_doc := coalesce(i.invoice_no, i.id::text) || case p_source_type when 'refund' then '-R' when 'package_refund' then '-PR' when 'invoice_void' then '-X' else '' end;
  -- A return covers only the amount paid back: lines are scaled pro rata, the last line takes the rounding.
  if v_amount is not null and i.total > 0 then v_ratio := v_amount / i.total; end if;
  v_target := round(i.total * v_ratio, 2);
  select count(*) into v_n from public.invoice_lines where invoice_id = i.id;
  if st.taxpayer_rin is null then v_missing := v_missing || 'taxpayer registration number'::text; end if;
  if st.activity_code is null then v_missing := v_missing || 'activity code'::text; end if;
  if st.branch_code is null then v_missing := v_missing || 'branch code'::text; end if;
  if st.document_kind = 'receipt' and st.pos_serial is null then v_missing := v_missing || 'POS serial'::text; end if;
  for l in select il.*, s.code, s.name_ar, s.name_en, s.eta_item_type, s.eta_item_code, s.eta_unit, s.tax_type, s.tax_subtype, s.tax_rate
           from public.invoice_lines il join public.services s on s.id = il.service_id where il.invoice_id = i.id order by il.id loop
    if l.eta_item_code is null or l.eta_item_type is null then v_missing := v_missing || ('ETA code of ' || l.code); end if;
    if l.tax_type is null or l.tax_rate is null then v_missing := v_missing || ('tax setup of ' || l.code); end if;
    v_k := v_k + 1;
    v_net := case when v_k = v_n then v_target - v_net_total else round(l.line_total * v_ratio, 2) end;
    v_tax := round(v_net * coalesce(l.tax_rate, 0) / 100, 2);
    v_net_total := v_net_total + v_net; v_tax_total := v_tax_total + v_tax;
    v_lines := v_lines || jsonb_build_object('internal_code', l.code, 'description', coalesce(l.description, l.name_ar), 'description_en', l.name_en,
      'item_type', l.eta_item_type, 'item_code', l.eta_item_code, 'unit', l.eta_unit, 'quantity', l.quantity,
      'unit_price', case when v_ratio = 1 then l.unit_price else round(v_net / nullif(l.quantity, 0), 5) end,
      'discount', case when v_ratio = 1 then l.discount else 0 end, 'net', v_net,
      'taxes', case when l.tax_type is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type', l.tax_type, 'subtype', l.tax_subtype, 'rate', l.tax_rate, 'amount', v_tax)) end,
      'total', v_net + v_tax);
  end loop;
  payload := jsonb_build_object(
    'kind', v_kind, 'doc_no', v_doc, 'reference_doc_no', case when p_source_type <> 'invoice' then i.invoice_no end,
    'issued_at', coalesce(v_date, i.issued_at, now()), 'environment', st.environment,
    'seller', jsonb_build_object('rin', st.taxpayer_rin, 'name', st.taxpayer_name, 'activity_code', st.activity_code, 'branch_code', st.branch_code, 'pos_serial', st.pos_serial),
    'buyer', jsonb_build_object('type', 'P', 'name', p.first_name_ar || ' ' || p.last_name_ar),
    'lines', v_lines, 'total_discount', case when v_ratio = 1 then i.discount_total else 0 end, 'net_amount', v_net_total, 'tax_total', v_tax_total, 'total', v_net_total + v_tax_total,
    'refund_amount', v_amount);
  reason := case when cardinality(v_missing) > 0 then array_to_string(v_missing, ', ') end;
end $$;

create or replace function app.einvoice_enqueue(p_source_type text, p_source_id uuid, p_branch uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := app.org_of_branch(p_branch); b record;
begin
  if not coalesce((select enabled from public.einvoice_settings where organization_id = v_org), false) then return; end if;
  select * into b from app.einvoice_payload(p_source_type, p_source_id);
  insert into public.einvoice_documents (organization_id, branch_id, source_type, source_id, doc_no, kind, status, block_reason, payload)
  values (v_org, p_branch, p_source_type, p_source_id, b.payload->>'doc_no', b.payload->>'kind',
          case when b.reason is null then 'pending' else 'blocked' end, b.reason, b.payload)
  on conflict (source_type, source_id) do nothing;
end $$;

create or replace function app.einvoice_invoice_trigger()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if new.status = 'issued' and old.status = 'draft' then
    perform app.einvoice_enqueue('invoice', new.id, new.branch_id);
  elsif new.status = 'void' and old.status <> 'void' and exists (select 1 from public.einvoice_documents where source_type = 'invoice' and source_id = new.id) then
    perform app.einvoice_enqueue('invoice_void', new.id, new.branch_id);
  end if;
  return null;
end $$;
create trigger trg_invoices_einvoice after update of status on public.invoices for each row execute function app.einvoice_invoice_trigger();

create or replace function app.einvoice_refund_trigger()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if new.status = 'paid' and old.status <> 'paid' then
    perform app.einvoice_enqueue(case tg_table_name when 'refunds' then 'refund' else 'package_refund' end, new.id, new.branch_id);
  end if;
  return null;
end $$;
create trigger trg_refunds_einvoice after update of status on public.refunds for each row execute function app.einvoice_refund_trigger();
create trigger trg_package_refunds_einvoice after update of status on public.package_refunds for each row execute function app.einvoice_refund_trigger();

-- Staff RPCs
create or replace function public.save_einvoice_settings(p jsonb)
returns public.einvoice_settings language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := (select organization_id from public.branches order by created_at limit 1); r public.einvoice_settings;
begin
  perform app.require_permission('accounting.configure');
  insert into public.einvoice_settings (organization_id) values (v_org) on conflict do nothing;
  update public.einvoice_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled), document_kind = coalesce(nullif(p->>'document_kind', ''), document_kind),
    environment = coalesce(nullif(p->>'environment', ''), environment),
    taxpayer_rin = case when p ? 'taxpayer_rin' then nullif(trim(p->>'taxpayer_rin'), '') else taxpayer_rin end,
    taxpayer_name = case when p ? 'taxpayer_name' then nullif(trim(p->>'taxpayer_name'), '') else taxpayer_name end,
    activity_code = case when p ? 'activity_code' then nullif(trim(p->>'activity_code'), '') else activity_code end,
    branch_code = case when p ? 'branch_code' then nullif(trim(p->>'branch_code'), '') else branch_code end,
    pos_serial = case when p ? 'pos_serial' then nullif(trim(p->>'pos_serial'), '') else pos_serial end,
    updated_by = auth.uid(), updated_at = now()
  where organization_id = v_org returning * into r;
  return r;
end $$;

create or replace function public.set_service_tax(p_service uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('accounting.configure');
  update public.services set
    eta_item_type = nullif(p->>'eta_item_type', ''), eta_item_code = nullif(trim(p->>'eta_item_code'), ''),
    eta_unit = coalesce(nullif(trim(p->>'eta_unit'), ''), eta_unit),
    tax_type = nullif(trim(p->>'tax_type'), ''), tax_subtype = nullif(trim(p->>'tax_subtype'), ''), tax_rate = nullif(p->>'tax_rate', '')::numeric
  where id = p_service;
  if not found then raise exception 'service not found' using errcode = 'P0002'; end if;
end $$;

-- Blocked or failed documents are rebuilt from the source (after codes are fixed) and queued again.
create or replace function public.einvoice_retry(p_doc uuid)
returns public.einvoice_documents language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.einvoice_documents; b record;
begin
  perform app.require_permission('accounting.configure');
  select * into d from public.einvoice_documents where id = p_doc for update;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status not in ('blocked', 'failed', 'rejected') then raise exception 'only blocked, failed or rejected documents can be sent again' using errcode = '22023'; end if;
  select * into b from app.einvoice_payload(d.source_type, d.source_id);
  update public.einvoice_documents set payload = b.payload, block_reason = b.reason, status = case when b.reason is null then 'pending' else 'blocked' end,
    attempts = 0, last_error = null, next_attempt_at = now(), updated_at = now() where id = d.id returning * into d;
  return d;
end $$;

-- Service primitives for the connector
create or replace function app.einvoice_claim(p_limit int)
returns setof public.einvoice_documents language sql volatile security definer set search_path = public, pg_temp as $$
  update public.einvoice_documents d set status = 'sent', attempts = attempts + 1, lease_until = now() + interval '5 minutes', updated_at = now()
  where d.id in (select id from public.einvoice_documents where status = 'pending' and next_attempt_at <= now()
                 order by created_at limit p_limit for update skip locked)
  returning d.*
$$;

create or replace function app.einvoice_result(p_id uuid, p_status text, p_provider text, p_submission text, p_uuid text, p_long_id text, p_error text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.einvoice_documents set
    status = case when p_status in ('accepted', 'rejected') then p_status when attempts >= 6 then 'failed' else 'pending' end,
    provider = p_provider, submission_id = coalesce(p_submission, submission_id), document_uuid = coalesce(p_uuid, document_uuid),
    long_id = coalesce(p_long_id, long_id), last_error = left(p_error, 1000), lease_until = null,
    next_attempt_at = case when p_status in ('accepted', 'rejected') then next_attempt_at else now() + make_interval(mins => (5 * power(2, attempts))::int) end,
    updated_at = now()
  where id = p_id;
end $$;

create or replace function public.svc_einvoice_claim(p_limit int default 20)
returns setof public.einvoice_documents language sql volatile security definer set search_path = public, app, pg_temp as $$ select * from app.einvoice_claim(p_limit) $$;
create or replace function public.svc_einvoice_result(p_id uuid, p_status text, p_provider text, p_submission text, p_uuid text, p_long_id text, p_error text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.einvoice_result(p_id, p_status, p_provider, p_submission, p_uuid, p_long_id, p_error) $$;

alter table public.einvoice_settings enable row level security;
alter table public.einvoice_documents enable row level security;
create policy einvoice_settings_read on public.einvoice_settings for select to authenticated using (app.has_permission('accounting.read') or app.has_permission('accounting.configure'));
create policy einvoice_docs_read on public.einvoice_documents for select to authenticated using (app.has_permission('accounting.read', branch_id) or app.has_permission('accounting.configure'));
grant select on public.einvoice_settings, public.einvoice_documents to authenticated;

revoke execute on function app.einvoice_payload(text, uuid), app.einvoice_enqueue(text, uuid, uuid), app.einvoice_claim(int),
  app.einvoice_result(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.svc_einvoice_claim(int), public.svc_einvoice_result(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_einvoice_claim(int), public.svc_einvoice_result(uuid, text, text, text, text, text, text) to service_role;
revoke execute on function public.save_einvoice_settings(jsonb), public.set_service_tax(uuid, jsonb), public.einvoice_retry(uuid) from public, anon;
grant execute on function public.save_einvoice_settings(jsonb), public.set_service_tax(uuid, jsonb), public.einvoice_retry(uuid) to authenticated;

-- Receipt printing: the cashier sees the e-receipt status of an invoice they can read, nothing else of the tax queue.
create or replace function public.invoice_ereceipt(p_invoice uuid)
returns table (status text, document_uuid text, long_id text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.invoices where id = p_invoice;
  if v_branch is null or not app.has_permission('billing.read', v_branch) then return; end if;
  return query select d.status, d.document_uuid, d.long_id from public.einvoice_documents d
    where d.source_type = 'invoice' and d.source_id = p_invoice;
end $$;
revoke execute on function public.invoice_ereceipt(uuid) from public, anon;
grant execute on function public.invoice_ereceipt(uuid) to authenticated;
