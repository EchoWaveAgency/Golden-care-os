-- Golden Care OS — 0026 Card / gateway settlements with fees, loyalty points, referrals
-- The patient "wallet" is the existing advance balance (0018). Loyalty and referral rules are the clinic's: every rate is
-- empty (programme off) until the chief accountant sets it.

insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, '4920', 'خصومات برنامج الولاء', 'Loyalty redemptions (contra revenue)', 'revenue'::public.account_type, true from public.organizations o
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a join (values ('bank_charges', '5400'), ('loyalty_redemptions', '4920')) m(k, code) on m.code = a.code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Settlements of card / InstaPay / wallet / online-gateway clearing accounts (the bank deposits net of fees)
-- ---------------------------------------------------------------------------
create table public.clearing_settlements (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('CLR'),
  organization_id  uuid not null references public.organizations(id),
  branch_id        uuid not null references public.branches(id),
  clearing_key     text not null check (clearing_key in ('card_clearing', 'gateway_clearing', 'instapay_clearing', 'wallet_clearing')),
  settled_on       date not null,
  gross            numeric(14,2) not null check (gross > 0),
  fees             numeric(14,2) not null default 0 check (fees >= 0),
  net              numeric(14,2) generated always as (gross - fees) stored,
  reference        text not null,
  journal_entry_id uuid not null references public.journal_entries(id),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint fees_below_gross check (fees < gross),
  unique (clearing_key, reference)
);
create trigger trg_audit_clearing_settlements after insert on public.clearing_settlements for each row execute function app.audit_row();
create trigger trg_clearing_settlements_immutable before delete or update on public.clearing_settlements for each row execute function app.block_delete();
alter table public.clearing_settlements enable row level security;
create policy clearing_settlements_read on public.clearing_settlements for select to authenticated using (app.has_permission('accounting.read', branch_id));
grant select on public.clearing_settlements to authenticated;

create or replace function app.account_balance(p_org uuid, p_key text, p_branch uuid default null)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
  where e.organization_id = p_org and l.account_id = app.account_for(p_org, p_key) and (p_branch is null or e.branch_id = p_branch)
$$;

create or replace function public.clearing_balances(p_branch uuid)
returns table (clearing_key text, balance numeric) language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_permission('accounting.read', p_branch) then return; end if;
  return query select k, app.account_balance(app.org_of_branch(p_branch), k, p_branch)
    from unnest(array['card_clearing', 'gateway_clearing', 'instapay_clearing', 'wallet_clearing']) k;
end $$;

create or replace function public.record_clearing_settlement(p_branch uuid, p_key text, p_date date, p_gross numeric, p_fees numeric, p_reference text)
returns public.clearing_settlements language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := app.org_of_branch(p_branch); v_je uuid; s public.clearing_settlements; v_bal numeric;
begin
  perform app.require_permission('accounting.post', p_branch);
  if p_key not in ('card_clearing', 'gateway_clearing', 'instapay_clearing', 'wallet_clearing') then raise exception 'unknown clearing account' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'enter the bank statement reference' using errcode = '22023'; end if;
  if coalesce(p_gross, 0) <= 0 or coalesce(p_fees, 0) < 0 or p_fees >= p_gross then raise exception 'gross must be positive and fees below it' using errcode = '22023'; end if;
  if p_date is null or p_date > app.cairo_today() then raise exception 'settlement date cannot be in the future' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('clearing:' || p_branch::text || p_key));
  v_bal := app.account_balance(v_org, p_key, p_branch);
  if round(p_gross, 2) > v_bal then raise exception 'the settlement is more than the uncleared balance (%)', v_bal using errcode = '22023'; end if;
  v_je := app.post_journal(v_org, p_branch, p_date, 'Settlement ' || p_key || ' ' || trim(p_reference), 'clearing_settlement', null,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'bank_main'), 'debit', round(p_gross - p_fees, 2), 'memo', trim(p_reference)),
      jsonb_build_object('account_id', app.account_for(v_org, p_key), 'credit', round(p_gross, 2), 'memo', trim(p_reference)))
    || case when p_fees > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'bank_charges'), 'debit', round(p_fees, 2), 'memo', trim(p_reference))) else '[]'::jsonb end);
  insert into public.clearing_settlements (organization_id, branch_id, clearing_key, settled_on, gross, fees, reference, journal_entry_id)
  values (v_org, p_branch, p_key, p_date, round(p_gross, 2), round(p_fees, 2), trim(p_reference), v_je) returning * into s;
  return s;
exception when unique_violation then
  raise exception 'this bank reference is already recorded for that account' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Loyalty points and referrals
-- ---------------------------------------------------------------------------
create table public.loyalty_settings (
  organization_id        uuid primary key references public.organizations(id),
  enabled                boolean not null default false,
  points_per_egp         numeric(8,4) check (points_per_egp > 0),     -- earned on money paid (not on points)
  egp_per_point          numeric(8,4) check (egp_per_point > 0),      -- value when redeemed
  min_redeem_points      int not null default 0 check (min_redeem_points >= 0),
  max_redeem_percent     numeric(5,2) not null default 100 check (max_redeem_percent between 0 and 100),  -- of the invoice
  expiry_months          int check (expiry_months > 0),               -- balance expires after this many months without activity
  referral_bonus_points  int check (referral_bonus_points > 0),       -- to the referrer, once, on the referred patient's first payment
  updated_by             uuid default auth.uid(),
  updated_at             timestamptz not null default now()
);
create trigger trg_audit_loyalty_settings after insert or update on public.loyalty_settings for each row execute function app.audit_row();

create table public.loyalty_entries (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id),
  branch_id   uuid references public.branches(id),
  kind        text not null check (kind in ('earn', 'redeem', 'refund_reversal', 'expire', 'referral', 'adjust')),
  points      int not null check (points <> 0),
  payment_id  uuid references public.payments(id),
  refund_id   uuid references public.refunds(id),
  invoice_id  uuid references public.invoices(id),
  referred_patient_id uuid references public.patients(id),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.loyalty_entries (patient_id, created_at);
create unique index loyalty_earn_once on public.loyalty_entries (payment_id) where kind in ('earn', 'redeem');
create unique index loyalty_refund_once on public.loyalty_entries (refund_id) where kind = 'refund_reversal';
create unique index loyalty_referral_once on public.loyalty_entries (referred_patient_id) where kind = 'referral';
create trigger trg_loyalty_entries_immutable before delete or update on public.loyalty_entries for each row execute function app.block_delete();

alter table public.patients add column if not exists referral_code text unique;
alter table public.patients add column if not exists referred_by uuid references public.patients(id);

create or replace function app.loyalty_balance(p_patient uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(points), 0)::int from public.loyalty_entries where patient_id = p_patient
$$;

create or replace function app.loyalty_cfg(p_branch uuid)
returns public.loyalty_settings language sql stable security definer set search_path = public, app, pg_temp as $$
  select * from public.loyalty_settings where organization_id = app.org_of_branch(p_branch) and enabled
$$;

create or replace function public.save_loyalty_settings(p jsonb)
returns public.loyalty_settings language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := (select organization_id from public.branches order by created_at limit 1); s public.loyalty_settings;
begin
  perform app.require_permission('accounting.configure');
  if coalesce((p->>'enabled')::boolean, false) and (nullif(p->>'points_per_egp', '') is null or nullif(p->>'egp_per_point', '') is null) then
    raise exception 'set how points are earned and what a point is worth before switching the programme on' using errcode = '22023';
  end if;
  insert into public.loyalty_settings (organization_id, enabled, points_per_egp, egp_per_point, min_redeem_points, max_redeem_percent, expiry_months, referral_bonus_points)
  values (v_org, coalesce((p->>'enabled')::boolean, false), nullif(p->>'points_per_egp', '')::numeric, nullif(p->>'egp_per_point', '')::numeric,
          coalesce(nullif(p->>'min_redeem_points', '')::int, 0), coalesce(nullif(p->>'max_redeem_percent', '')::numeric, 100),
          nullif(p->>'expiry_months', '')::int, nullif(p->>'referral_bonus_points', '')::int)
  on conflict (organization_id) do update set enabled = excluded.enabled, points_per_egp = excluded.points_per_egp, egp_per_point = excluded.egp_per_point,
    min_redeem_points = excluded.min_redeem_points, max_redeem_percent = excluded.max_redeem_percent, expiry_months = excluded.expiry_months,
    referral_bonus_points = excluded.referral_bonus_points, updated_by = auth.uid(), updated_at = now()
  returning * into s;
  return s;
end $$;

-- Internal method: paying part of an invoice with points (never chosen at the till).
insert into public.payment_methods (code, name_ar, name_en, account_key, requires_reference, requires_cash_session)
values ('loyalty', 'نقاط الولاء', 'Loyalty points', 'loyalty_redemptions', false, false)
on conflict (code) do nothing;

create or replace function app.loyalty_method_guard()
returns trigger language plpgsql as $$
begin
  if new.method = 'loyalty' and coalesce(current_setting('app.loyalty_rpc', true), '') <> 'on' then
    raise exception 'points are redeemed with their own button, not as a payment method' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_payments_loyalty_guard before insert on public.payments for each row execute function app.loyalty_method_guard();

create or replace function app.refund_method_guard()
returns trigger language plpgsql as $$
begin
  if new.method in ('advance', 'online', 'loyalty') then
    raise exception 'refunds are paid in cash, card, transfer or wallet, not into the advance balance' using errcode = '22023';
  end if;
  return new;
end $$;

-- Earning: every real payment (not points) earns points; a referred patient's first payment rewards the referrer once.
create or replace function app.loyalty_on_payment()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.loyalty_settings; v_pts int; v_ref uuid;
begin
  if new.status <> 'posted' or new.method = 'loyalty' then return null; end if;
  c := app.loyalty_cfg(new.branch_id);
  if c.organization_id is null then return null; end if;
  v_pts := floor(new.amount * c.points_per_egp)::int;
  if v_pts > 0 then
    insert into public.loyalty_entries (patient_id, branch_id, kind, points, payment_id, invoice_id) values (new.patient_id, new.branch_id, 'earn', v_pts, new.id, new.invoice_id)
    on conflict do nothing;
  end if;
  select referred_by into v_ref from public.patients where id = new.patient_id;
  if v_ref is not null and c.referral_bonus_points is not null then
    insert into public.loyalty_entries (patient_id, branch_id, kind, points, referred_patient_id, note)
    values (v_ref, new.branch_id, 'referral', c.referral_bonus_points, new.patient_id, 'referral bonus')
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger trg_payments_loyalty after insert on public.payments for each row execute function app.loyalty_on_payment();

-- A refund paid takes back the points the refunded money earned (never below zero).
create or replace function app.loyalty_on_refund()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.loyalty_settings; v_pts int; v_pat uuid;
begin
  if not (new.status = 'paid' and old.status is distinct from 'paid') then return null; end if;
  c := app.loyalty_cfg(new.branch_id);
  if c.organization_id is null then return null; end if;
  select patient_id into v_pat from public.invoices where id = new.invoice_id;
  v_pts := least(floor(new.amount * c.points_per_egp)::int, greatest(app.loyalty_balance(v_pat), 0));
  if v_pts > 0 then
    insert into public.loyalty_entries (patient_id, branch_id, kind, points, refund_id, invoice_id) values (v_pat, new.branch_id, 'refund_reversal', -v_pts, new.id, new.invoice_id)
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger trg_refunds_loyalty after update of status on public.refunds for each row execute function app.loyalty_on_refund();

-- Redemption at the desk: an ordinary payment with method 'loyalty' (Dr loyalty redemptions 4920 / Cr receivable).
create or replace function public.redeem_loyalty(p_invoice uuid, p_points int, p_idempotency_key text)
returns public.payments language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; c public.loyalty_settings; p public.payments; v_value numeric; v_bal int;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', i.branch_id);
  select * into p from public.payments where idempotency_key = 'loy:' || p_idempotency_key;
  if found then return p; end if;
  c := app.loyalty_cfg(i.branch_id);
  if c.organization_id is null then raise exception 'the loyalty programme is switched off' using errcode = '22023'; end if;
  perform 1 from public.patients where id = i.patient_id for update;
  v_bal := app.loyalty_balance(i.patient_id);
  if coalesce(p_points, 0) <= 0 then raise exception 'enter the points to redeem' using errcode = '22023'; end if;
  if p_points > v_bal then raise exception 'the patient has only % points', v_bal using errcode = '22023'; end if;
  if p_points < c.min_redeem_points then raise exception 'at least % points are needed to redeem', c.min_redeem_points using errcode = '22023'; end if;
  v_value := round(p_points * c.egp_per_point, 2);
  if v_value > i.balance then raise exception 'the points are worth more than the invoice balance (%)', i.balance using errcode = '22023'; end if;
  if v_value + coalesce((select sum(amount) from public.payments where invoice_id = i.id and method = 'loyalty' and status = 'posted'), 0) > round(i.total * c.max_redeem_percent / 100, 2) then
    raise exception 'points can pay at most % percent of an invoice', c.max_redeem_percent using errcode = '22023';
  end if;
  perform set_config('app.loyalty_rpc', 'on', true);
  p := public.record_payment(p_invoice, v_value, 'loyalty', 'loy:' || p_idempotency_key, null);
  perform set_config('app.loyalty_rpc', '', true);
  insert into public.loyalty_entries (patient_id, branch_id, kind, points, payment_id, invoice_id) values (i.patient_id, i.branch_id, 'redeem', -p_points, p.id, i.id);
  return p;
end $$;

-- Referral codes: generated on demand; the new patient's file records who referred them (before their first payment).
create or replace function public.patient_referral_code(p_patient uuid)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v text; pt public.patients;
begin
  select * into pt from public.patients where id = p_patient for update;
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('patient.read', pt.branch_id) or app.has_permission('patient.write', pt.branch_id)) then raise exception 'permission denied' using errcode = '42501'; end if;
  if pt.referral_code is not null then return pt.referral_code; end if;
  loop
    v := 'GC' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.patients where referral_code = v);
  end loop;
  update public.patients set referral_code = v where id = pt.id;
  return v;
end $$;

create or replace function public.set_referrer(p_patient uuid, p_code text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare pt public.patients; v_ref uuid;
begin
  select * into pt from public.patients where id = p_patient for update;
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  perform app.require_permission('patient.write', pt.branch_id);
  if pt.referred_by is not null then raise exception 'the referrer is already recorded' using errcode = '22023'; end if;
  select id into v_ref from public.patients where referral_code = upper(trim(p_code));
  if v_ref is null then raise exception 'referral code not found' using errcode = '22023'; end if;
  if v_ref = pt.id then raise exception 'a patient cannot refer themselves' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where patient_id = pt.id and status = 'posted') then raise exception 'a referral is recorded before the first payment' using errcode = '22023'; end if;
  update public.patients set referred_by = v_ref where id = pt.id;
  return v_ref;
end $$;

-- Read side for staff (branch-scoped) and the dispatcher's expiry run.
create or replace function public.patient_loyalty(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare pt public.patients; c public.loyalty_settings;
begin
  select * into pt from public.patients where id = p_patient;
  if not found or not (app.has_permission('billing.read', pt.branch_id) or app.has_permission('payment.collect', pt.branch_id) or app.has_permission('patient.read', pt.branch_id)) then return null; end if;
  c := app.loyalty_cfg(pt.branch_id);
  return jsonb_build_object('enabled', c.organization_id is not null, 'points', app.loyalty_balance(pt.id),
    'value', round(app.loyalty_balance(pt.id) * coalesce(c.egp_per_point, 0), 2), 'egp_per_point', c.egp_per_point, 'min_redeem', c.min_redeem_points,
    'referral_code', pt.referral_code, 'referred_by', (select mrn from public.patients where id = pt.referred_by),
    'referrals', (select count(*) from public.patients where referred_by = pt.id),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'points', e.points, 'at', e.created_at) order by e.created_at desc)
                         from (select * from public.loyalty_entries where patient_id = pt.id order by created_at desc limit 20) e), '[]'::jsonb));
end $$;

create or replace function app.loyalty_expire()
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    select e.patient_id, sum(e.points)::int bal, max(e.created_at) last_at, s.expiry_months
    from public.loyalty_entries e join public.patients p on p.id = e.patient_id
    join public.loyalty_settings s on s.organization_id = app.org_of_branch(p.branch_id) and s.enabled and s.expiry_months is not null
    group by e.patient_id, s.expiry_months
    having sum(e.points) > 0 and max(e.created_at) < now() - make_interval(months => s.expiry_months)
  loop
    insert into public.loyalty_entries (patient_id, kind, points, note) values (r.patient_id, 'expire', -r.bal, 'no activity for ' || r.expiry_months || ' months');
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function public.svc_loyalty_expire()
returns int language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.loyalty_expire() $$;

-- Portal: the patient sees their advance ("wallet") balance, points and referral code.
create or replace function public.portal_finance(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare c public.loyalty_settings; pt public.patients;
begin
  perform app.portal_require(p_patient, 'full');
  select * into pt from public.patients where id = p_patient;
  c := app.loyalty_cfg(pt.branch_id);
  return jsonb_build_object(
    'balance', coalesce((select sum(balance) from public.invoices where patient_id = p_patient and status in ('issued', 'partially_paid')), 0),
    'wallet', app.advance_available(p_patient),
    'loyalty', case when c.organization_id is null then null else jsonb_build_object('points', app.loyalty_balance(p_patient),
                 'value', round(app.loyalty_balance(p_patient) * c.egp_per_point, 2), 'referral_code', pt.referral_code,
                 'referral_bonus', c.referral_bonus_points) end,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'issued_at', i.issued_at, 'status', i.status,
                  'total', i.total, 'paid', i.amount_paid, 'balance', i.balance, 'discount', i.discount_total, 'refunded', i.refunded_total,
                  'lines', (select jsonb_agg(jsonb_build_object('service_ar', sv.name_ar, 'service_en', sv.name_en, 'qty', l.quantity, 'net', l.line_total))
                            from public.invoice_lines l join public.services sv on sv.id = l.service_id where l.invoice_id = i.id),
                  'receipts', (select jsonb_agg(jsonb_build_object('receipt_no', p.receipt_no, 'amount', p.amount, 'method', p.method, 'at', p.received_at))
                               from public.payments p where p.invoice_id = i.id and p.status = 'posted'),
                  'refunds', (select jsonb_agg(jsonb_build_object('ref', r.ref, 'amount', r.amount, 'method', r.method, 'at', r.paid_at))
                              from public.refunds r where r.invoice_id = i.id and r.status = 'paid')) order by i.issued_at desc)
              from public.invoices i where i.patient_id = p_patient and i.status <> 'draft'), '[]'::jsonb));
end $$;

-- The patient can create their own referral code from the portal.
create or replace function public.portal_referral_code(p_patient uuid)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v text;
begin
  perform app.portal_require(p_patient, 'full');
  select referral_code into v from public.patients where id = p_patient;
  if v is not null then return v; end if;
  loop
    v := 'GC' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.patients where referral_code = v);
  end loop;
  update public.patients set referral_code = v where id = p_patient and referral_code is null;
  return (select referral_code from public.patients where id = p_patient);
end $$;

alter table public.loyalty_settings enable row level security;
alter table public.loyalty_entries enable row level security;
create policy loyalty_settings_read on public.loyalty_settings for select to authenticated using (true);
create policy loyalty_entries_read on public.loyalty_entries for select to authenticated
  using (exists (select 1 from public.patients p where p.id = patient_id and (app.has_permission('billing.read', p.branch_id) or app.has_permission('payment.collect', p.branch_id))));
grant select on public.loyalty_settings, public.loyalty_entries to authenticated;

revoke execute on function app.account_balance(uuid, text, uuid), app.loyalty_balance(uuid), app.loyalty_cfg(uuid), app.loyalty_expire() from public, anon, authenticated;
revoke execute on function public.svc_loyalty_expire() from public, anon, authenticated;
grant execute on function public.svc_loyalty_expire() to service_role;
revoke execute on function public.clearing_balances(uuid), public.record_clearing_settlement(uuid, text, date, numeric, numeric, text),
  public.save_loyalty_settings(jsonb), public.redeem_loyalty(uuid, int, text), public.patient_referral_code(uuid), public.set_referrer(uuid, text),
  public.patient_loyalty(uuid), public.portal_referral_code(uuid) from public, anon;
grant execute on function public.clearing_balances(uuid), public.record_clearing_settlement(uuid, text, date, numeric, numeric, text),
  public.save_loyalty_settings(jsonb), public.redeem_loyalty(uuid, int, text), public.patient_referral_code(uuid), public.set_referrer(uuid, text),
  public.patient_loyalty(uuid), public.portal_referral_code(uuid) to authenticated;
