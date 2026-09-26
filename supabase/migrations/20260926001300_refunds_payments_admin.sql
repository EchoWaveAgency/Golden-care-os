-- Golden Care OS — 0013 Refunds (maker-checker), online payments (gateway intents), user administration
-- Money never moves without a balanced journal; refunds need a second person to approve;
-- gateway confirmations are idempotent and only reachable by trusted server code.

-- ---------------------------------------------------------------------------
-- Accounts used by this module (created for every organization that lacks them)
-- ---------------------------------------------------------------------------
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, v.code, v.ar, v.en, v.t::public.account_type, true
from public.organizations o, (values
  ('1150', 'تحصيلات بوابة الدفع الإلكتروني تحت التسوية', 'Online payment gateway clearing', 'asset'),
  ('4910', 'مردودات ومبالغ مستردة للمرضى',              'Patient refunds (contra revenue)', 'revenue')
) v(code, ar, en, t)
on conflict (organization_id, code) do nothing;

insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a
join (values ('gateway_clearing', '1150'), ('refunds', '4910')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.payment_methods (code, name_ar, name_en, account_key, requires_reference, requires_cash_session)
values ('online', 'دفع إلكتروني من حساب المريض', 'Online (patient portal)', 'gateway_clearing', true, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('refund.request', 'billing', 'Request a refund on a paid invoice'),
  ('refund.approve', 'billing', 'Approve or reject refund requests (never your own)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('front_desk', 'refund.request'), ('cashier', 'refund.request'), ('patient_relations', 'refund.request'),
  ('chief_accountant', 'refund.approve'), ('center_director', 'refund.approve')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
alter table public.invoices add column refunded_total numeric(14,2) not null default 0;
alter table public.invoices add constraint refunds_within_paid check (refunded_total >= 0 and refunded_total <= amount_paid);

create type public.refund_status as enum ('requested', 'approved', 'rejected', 'paid');

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique default app.next_ref('RF'),
  invoice_id         uuid not null references public.invoices(id),
  branch_id          uuid not null references public.branches(id),
  patient_id         uuid not null references public.patients(id),
  amount             numeric(14,2) not null check (amount > 0),
  method             text not null references public.payment_methods(code),
  reason             text not null check (length(trim(reason)) >= 3),
  status             public.refund_status not null default 'requested',
  requested_by       uuid not null default auth.uid(),
  requested_at       timestamptz not null default now(),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  paid_by            uuid,
  paid_at            timestamptz,
  reference          text,
  cashier_session_id uuid references public.cashier_sessions(id),
  journal_entry_id   uuid references public.journal_entries(id)
);
create index on public.refunds (status, requested_at);
create index on public.refunds (invoice_id);
create index on public.refunds (cashier_session_id);
create trigger trg_audit_refunds after insert or update on public.refunds for each row execute function app.audit_row();
create trigger trg_refunds_immutable before delete on public.refunds for each row execute function app.block_delete();

create or replace function public.request_refund(p_invoice uuid, p_amount numeric, p_method text, p_reason text)
returns public.refunds language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; r public.refunds; v_open numeric;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('refund.request', i.branch_id);
  if coalesce(trim(p_reason), '') = '' or length(trim(p_reason)) < 3 then raise exception 'refund reason is required' using errcode = '22023'; end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if not exists (select 1 from public.payment_methods where code = p_method and is_active) then
    raise exception 'unknown payment method %', p_method using errcode = '22023';
  end if;
  select coalesce(sum(amount), 0) into v_open from public.refunds where invoice_id = i.id and status in ('requested', 'approved');
  if round(p_amount, 2) > i.amount_paid - i.refunded_total - v_open then
    raise exception 'refund exceeds the refundable amount (%)', i.amount_paid - i.refunded_total - v_open using errcode = '22023';
  end if;
  insert into public.refunds (invoice_id, branch_id, patient_id, amount, method, reason)
  values (i.id, i.branch_id, i.patient_id, round(p_amount, 2), p_method, trim(p_reason)) returning * into r;
  return r;
end $$;

-- Maker-checker: the approver can never be the requester.
create or replace function public.decide_refund(p_refund uuid, p_approve boolean, p_note text default null)
returns public.refunds language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.refunds;
begin
  select * into r from public.refunds where id = p_refund for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  perform app.require_permission('refund.approve', r.branch_id);
  if r.status <> 'requested' then raise exception 'refund already %', r.status using errcode = '22023'; end if;
  if r.requested_by = auth.uid() then
    raise exception 'separation of duties: you cannot approve your own refund request' using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
  update public.refunds set status = case when p_approve then 'approved'::public.refund_status else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
  where id = r.id returning * into r;
  return r;
end $$;

-- Pay out an approved refund: Dr Refunds (contra revenue) / Cr cash or the method's account.
create or replace function public.pay_refund(p_refund uuid, p_reference text default null)
returns public.refunds language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.refunds; i public.invoices; m public.payment_methods; v_org uuid; v_je uuid; v_session uuid;
begin
  select * into r from public.refunds where id = p_refund for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', r.branch_id);
  if r.status = 'paid' then return r; end if;                        -- safe retry
  if r.status <> 'approved' then raise exception 'refund must be approved before payment' using errcode = '22023'; end if;
  select * into i from public.invoices where id = r.invoice_id for update;
  if i.refunded_total + r.amount > i.amount_paid then
    raise exception 'refund exceeds the refundable amount (%)', i.amount_paid - i.refunded_total using errcode = '22023';
  end if;
  select * into m from public.payment_methods where code = r.method;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'payment method % requires a reference number', r.method using errcode = '22023';
  end if;
  if m.requires_cash_session then
    select id into v_session from public.cashier_sessions where cashier_id = auth.uid() and branch_id = r.branch_id and status = 'open' for update;
    if v_session is null then raise exception 'open a cashier session before paying cash' using errcode = '22023'; end if;
  end if;

  perform set_config('app.billing_rpc', 'on', true);
  v_org := app.org_of_branch(r.branch_id);
  v_je := app.post_journal(v_org, r.branch_id, (now() at time zone 'Africa/Cairo')::date,
            'Patient refund ' || r.ref || ' (' || r.method || ')', 'refund', r.id,
            jsonb_build_array(
              jsonb_build_object('account_id', app.account_for(v_org, 'refunds'), 'debit', r.amount, 'patient_id', r.patient_id, 'memo', r.reason),
              jsonb_build_object('account_id', app.account_for(v_org, m.account_key), 'credit', r.amount, 'patient_id', r.patient_id,
                                 'memo', coalesce(p_reference, r.method))));
  update public.invoices set refunded_total = refunded_total + r.amount where id = i.id;
  update public.refunds set status = 'paid', paid_by = auth.uid(), paid_at = now(), reference = nullif(trim(p_reference), ''),
         cashier_session_id = v_session, journal_entry_id = v_je
  where id = r.id returning * into r;
  return r;
end $$;


-- record_payment redefined only to lock the open cashier session row (a concurrent close
-- can no longer miss a payment). Behaviour is otherwise identical to 0007.
create or replace function public.record_payment(p_invoice uuid, p_amount numeric, p_method text,
                                                 p_idempotency_key text, p_reference text default null)
returns public.payments
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; m public.payment_methods; p public.payments; v_org uuid; v_je uuid; v_session uuid;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', i.branch_id);
  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if p.invoice_id <> p_invoice or p.amount <> round(p_amount, 2) or p.method <> p_method then
      raise exception 'idempotency key reused with different payment details' using errcode = '22023';
    end if;
    return p;
  end if;
  if i.status not in ('issued', 'partially_paid') then
    raise exception 'invoice in status % cannot receive payments', i.status using errcode = '22023';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if round(p_amount, 2) > i.balance then
    raise exception 'amount % exceeds outstanding balance %', round(p_amount, 2), i.balance using errcode = '22023';
  end if;
  if p_method = 'online' then
    raise exception 'online payments are confirmed by the payment gateway only' using errcode = '42501';
  end if;
  select * into m from public.payment_methods where code = p_method and is_active;
  if not found then raise exception 'unknown payment method %', p_method using errcode = '22023'; end if;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'payment method % requires a reference number', p_method using errcode = '22023';
  end if;
  if m.requires_cash_session then
    select id into v_session from public.cashier_sessions
     where cashier_id = auth.uid() and branch_id = i.branch_id and status = 'open' for update;
    if v_session is null then
      raise exception 'open a cashier session before receiving cash' using errcode = '22023';
    end if;
  end if;
  perform set_config('app.billing_rpc', 'on', true);
  v_org := app.org_of_branch(i.branch_id);
  v_je := app.post_journal(v_org, i.branch_id, (now() at time zone 'Africa/Cairo')::date,
            'Patient payment (' || p_method || ')', 'payment', i.id,
            jsonb_build_array(
              jsonb_build_object('account_id', app.account_for(v_org, m.account_key), 'debit', round(p_amount, 2),
                                 'patient_id', i.patient_id, 'memo', coalesce(p_reference, p_method)),
              jsonb_build_object('account_id', app.account_for(v_org, 'ar_patients'), 'credit', round(p_amount, 2),
                                 'patient_id', i.patient_id)));
  insert into public.payments (invoice_id, branch_id, patient_id, method, amount, currency, reference,
                               cashier_session_id, idempotency_key, journal_entry_id)
  values (i.id, i.branch_id, i.patient_id, p_method, round(p_amount, 2), i.currency, p_reference,
          v_session, p_idempotency_key, v_je)
  returning * into p;
  update public.invoices set
    amount_paid = amount_paid + p.amount,
    status = case when amount_paid + p.amount >= total then 'paid'::public.invoice_status else 'partially_paid' end
  where id = i.id;
  return p;
end $$;

-- Cash closing now subtracts cash refunds paid out in the session.
create or replace function public.close_cashier_session(p_session uuid, p_counted numeric, p_note text default null)
returns public.cashier_sessions
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.cashier_sessions; v_expected numeric;
begin
  select * into s from public.cashier_sessions where id = p_session for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if s.cashier_id <> auth.uid() and not app.has_permission('cash.supervise', s.branch_id) then
    raise exception 'permission denied: close another cashier''s session' using errcode = '42501';
  end if;
  if s.status <> 'open' then raise exception 'session already closed' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'counted cash is required' using errcode = '22023'; end if;

  v_expected := s.opening_float
    + coalesce((select sum(amount) from public.payments where cashier_session_id = s.id and status = 'posted'), 0)
    - coalesce((select sum(amount) from public.refunds where cashier_session_id = s.id and status = 'paid'), 0);

  if round(p_counted, 2) <> v_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required when counted cash differs from expected (%)', v_expected using errcode = '22023';
  end if;
  update public.cashier_sessions set status = 'closed', closed_at = now(), expected_cash = v_expected,
         counted_cash = round(p_counted, 2), difference = round(p_counted, 2) - v_expected, close_note = p_note
  where id = s.id returning * into s;
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Online payments: intents created by the patient, confirmed only by the server
-- after the gateway's signed callback.
-- ---------------------------------------------------------------------------
alter table public.payments alter column received_by drop not null;   -- NULL = confirmed by the payment gateway
alter table public.payments add column payment_intent_id uuid;

create table public.payment_intents (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique default app.next_ref('PI'),
  invoice_id        uuid not null references public.invoices(id),
  branch_id         uuid not null references public.branches(id),
  patient_id        uuid not null references public.patients(id),
  amount            numeric(14,2) not null check (amount > 0),
  currency          char(3) not null default 'EGP',
  provider          text,
  provider_order_id text unique,
  provider_txn_id   text unique,
  status            text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'expired', 'review')),
  last_error        text,
  payment_id        uuid references public.payments(id),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 minutes',
  updated_at        timestamptz not null default now()
);
create index on public.payment_intents (invoice_id, status);

-- Money the gateway captured that could not be matched to an open intent (second charge on a
-- paid intent, unknown order, ...). Someone in finance must refund or allocate each one.
create table public.payment_exceptions (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  order_id    text,
  txn_id      text not null,
  amount      numeric(14,2) not null,
  intent_id   uuid references public.payment_intents(id),
  reason      text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution  text,
  unique (provider, txn_id)
);
create trigger trg_audit_payment_exceptions after insert or update on public.payment_exceptions for each row execute function app.audit_row();
create trigger trg_audit_payment_intents after insert or update on public.payment_intents for each row execute function app.audit_row();

-- Patient starts paying an invoice balance (own file, or family grant with full access).
create or replace function public.portal_pay_invoice(p_invoice uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; pi public.payment_intents;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(i.patient_id, 'full');
  if i.status not in ('issued', 'partially_paid') or i.balance <= 0 then
    raise exception 'this invoice has nothing to pay' using errcode = '22023';
  end if;
  if (select count(*) from public.payment_intents where invoice_id = i.id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too many requests' using errcode = '54000';
  end if;
  -- Only never-started intents are reused; one that already has a gateway order keeps it
  -- (a second checkout gets a fresh intent, so each gateway order maps to exactly one intent).
  update public.payment_intents set status = 'expired', updated_at = now()
   where invoice_id = i.id and status = 'created' and (expires_at <= now() or amount <> i.balance);
  select * into pi from public.payment_intents
   where invoice_id = i.id and status = 'created' and expires_at > now() order by created_at desc limit 1;
  if not found then
    insert into public.payment_intents (invoice_id, branch_id, patient_id, amount, currency)
    values (i.id, i.branch_id, i.patient_id, i.balance, i.currency) returning * into pi;
  end if;
  return jsonb_build_object('intent_id', pi.id, 'ref', pi.ref, 'amount', pi.amount, 'currency', pi.currency, 'invoice_no', i.invoice_no);
end $$;

-- Patient-facing status of one of their intents (return page after checkout).
create or replace function public.portal_payment_status(p_intent uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare pi public.payment_intents;
begin
  select * into pi from public.payment_intents where id = p_intent;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(pi.patient_id, 'full');
  return jsonb_build_object('ref', pi.ref, 'status', pi.status, 'amount', pi.amount,
    'receipt_no', (select receipt_no from public.payments where id = pi.payment_id));
end $$;

-- Internal: confirm a gateway result. Idempotent on the provider transaction id.
create or replace function app.payment_confirm(p_provider text, p_order_id text, p_txn_id text, p_amount_cents bigint,
                                               p_success boolean, p_error text default null)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare pi public.payment_intents; i public.invoices; p public.payments; v_org uuid; v_je uuid; v_amount numeric := round(p_amount_cents / 100.0, 2);
begin
  select * into pi from public.payment_intents where provider = p_provider and provider_order_id = p_order_id for update;
  if not found then
    if coalesce(p_success, false) then
      insert into public.payment_exceptions (provider, order_id, txn_id, amount, reason)
      values (p_provider, p_order_id, coalesce(p_txn_id, 'unknown-' || gen_random_uuid()), v_amount, 'captured payment for an unknown order')
      on conflict (provider, txn_id) do nothing;
    end if;
    return 'unknown';
  end if;
  if pi.status in ('paid', 'review') then
    if coalesce(p_success, false) and p_txn_id is distinct from pi.provider_txn_id then
      -- A different successful transaction on an intent that is already settled: a second charge.
      insert into public.payment_exceptions (provider, order_id, txn_id, amount, intent_id, reason)
      values (p_provider, p_order_id, p_txn_id, v_amount, pi.id, 'second successful charge on the same order')
      on conflict (provider, txn_id) do nothing;
      return 'exception';
    end if;
    return pi.status;                                                  -- duplicate callback
  end if;
  if not coalesce(p_success, false) then
    update public.payment_intents set status = 'failed', provider_txn_id = coalesce(p_txn_id, provider_txn_id),
           last_error = left(coalesce(p_error, 'declined'), 300), updated_at = now() where id = pi.id;
    return 'failed';
  end if;
  if v_amount <> pi.amount then
    update public.payment_intents set status = 'review', provider_txn_id = p_txn_id,
           last_error = format('amount mismatch: gateway %s, expected %s', v_amount, pi.amount), updated_at = now() where id = pi.id;
    return 'review';
  end if;
  select * into i from public.invoices where id = pi.invoice_id for update;
  if i.status not in ('issued', 'partially_paid') or i.balance < v_amount then
    -- Paid at the desk meanwhile: money was captured, a person must refund or allocate it.
    update public.payment_intents set status = 'review', provider_txn_id = p_txn_id,
           last_error = 'invoice balance changed before confirmation', updated_at = now() where id = pi.id;
    return 'review';
  end if;

  perform set_config('app.billing_rpc', 'on', true);
  v_org := app.org_of_branch(i.branch_id);
  v_je := app.post_journal(v_org, i.branch_id, (now() at time zone 'Africa/Cairo')::date,
            'Online payment ' || pi.ref || ' (' || p_provider || ')', 'payment', i.id,
            jsonb_build_array(
              jsonb_build_object('account_id', app.account_for(v_org, 'gateway_clearing'), 'debit', v_amount, 'patient_id', i.patient_id, 'memo', p_txn_id),
              jsonb_build_object('account_id', app.account_for(v_org, 'ar_patients'), 'credit', v_amount, 'patient_id', i.patient_id)));
  insert into public.payments (invoice_id, branch_id, patient_id, method, amount, currency, reference, idempotency_key,
                               journal_entry_id, received_by, payment_intent_id)
  values (i.id, i.branch_id, i.patient_id, 'online', v_amount, i.currency, p_provider || ':' || p_txn_id, 'gw-' || p_provider || '-' || p_txn_id,
          v_je, null, pi.id)
  returning * into p;
  update public.invoices set amount_paid = amount_paid + v_amount,
    status = case when amount_paid + v_amount >= total then 'paid'::public.invoice_status else 'partially_paid' end
  where id = i.id;
  update public.payment_intents set status = 'paid', provider_txn_id = p_txn_id, payment_id = p.id, last_error = null, updated_at = now()
  where id = pi.id;
  return 'paid';
end $$;

-- Service-role wrappers (trusted server code only).
create or replace function public.svc_payment_intent(p_intent uuid)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object('id', pi.id, 'ref', pi.ref, 'amount', pi.amount, 'currency', pi.currency, 'status', pi.status,
    'expires_at', pi.expires_at, 'provider_order_id', pi.provider_order_id, 'invoice_no', i.invoice_no,
    'first_name', coalesce(p.first_name_en, p.first_name_ar), 'last_name', coalesce(p.last_name_en, p.last_name_ar),
    'phone', p.phone, 'email', p.email)
  from public.payment_intents pi join public.invoices i on i.id = pi.invoice_id join public.patients p on p.id = pi.patient_id
  where pi.id = p_intent
$$;
-- Attach the gateway order to a never-started intent. Returns false if it was already started
-- or settled (the caller must then abort instead of sending the patient to checkout).
create or replace function public.svc_payment_intent_attach(p_intent uuid, p_provider text, p_order_id text)
returns boolean language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  update public.payment_intents set provider = p_provider, provider_order_id = p_order_id, status = 'pending', updated_at = now()
  where id = p_intent and status = 'created';
  return found;
end $$;
create or replace function public.svc_payment_confirm(p_provider text, p_order_id text, p_txn_id text, p_amount_cents bigint,
                                                      p_success boolean, p_error text default null)
returns text language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.payment_confirm(p_provider, p_order_id, p_txn_id, p_amount_cents, p_success, p_error)
$$;

-- Portal finance now also shows refunds paid back to the patient.
create or replace function public.portal_finance(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'full');
  return jsonb_build_object(
    'balance', coalesce((select sum(balance) from public.invoices where patient_id = p_patient and status in ('issued', 'partially_paid')), 0),
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

-- ---------------------------------------------------------------------------
-- User administration (no deletes: grants end, accounts deactivate)
-- ---------------------------------------------------------------------------
alter table public.profiles add column must_change_password boolean not null default false;

-- users.manage granted for ALL branches (branch_id is null). Branch-scoped administrators can
-- only manage non-privileged roles in their own branch.
create or replace function app.has_global_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                 join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
                 where ur.user_id = auth.uid() and rp.permission_code = p_permission and ur.branch_id is null
                   and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to))
$$;

create or replace function public.admin_users()
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('users.manage');
  return coalesce((select jsonb_agg(jsonb_build_object(
    'user_id', pr.user_id, 'email', u.email, 'name_ar', pr.full_name_ar, 'name_en', pr.full_name_en, 'is_active', pr.is_active,
    'must_change_password', pr.must_change_password, 'mfa_required', pr.mfa_required,
    'staff', (select jsonb_build_object('kind', s.kind, 'branch_id', s.branch_id) from public.staff s where s.user_id = pr.user_id),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', ur.id, 'role', ur.role_code, 'branch_id', ur.branch_id,
                'valid_from', ur.valid_from, 'valid_to', ur.valid_to, 'reason', ur.reason) order by ur.valid_from desc)
              from public.user_roles ur where ur.user_id = pr.user_id and (ur.valid_to is null or ur.valid_to > now())), '[]'::jsonb)
  ) order by pr.full_name_ar) from public.profiles pr join auth.users u on u.id = pr.user_id), '[]'::jsonb);
end $$;

create or replace function public.admin_grant_role(p_user uuid, p_role text, p_branch uuid, p_valid_to timestamptz, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  perform app.require_permission('users.manage', p_branch);
  if p_user = auth.uid() then raise exception 'you cannot change your own roles' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.roles where code = p_role) then raise exception 'unknown role %', p_role using errcode = '22023'; end if;
  if (p_branch is null or (select is_privileged from public.roles where code = p_role)) and not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can grant all-branch or privileged roles' using errcode = '42501';
  end if;
  if p_valid_to is not null and p_valid_to <= now() then raise exception 'end date must be in the future' using errcode = '22023'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role_code = p_role and branch_id is not distinct from p_branch
             and (valid_to is null or valid_to > now())) then
    raise exception 'this role is already active for the user' using errcode = '22023';
  end if;
  insert into public.user_roles (user_id, role_code, branch_id, valid_to, granted_by, reason)
  values (p_user, p_role, p_branch, p_valid_to, auth.uid(), trim(p_reason)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_end_role(p_grant uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare g public.user_roles;
begin
  select * into g from public.user_roles where id = p_grant for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.require_permission('users.manage', g.branch_id);
  if (g.branch_id is null or (select is_privileged from public.roles where code = g.role_code)) and not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can end this role' using errcode = '42501';
  end if;
  if g.user_id = auth.uid() then raise exception 'you cannot change your own roles' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.user_roles set valid_to = greatest(now(), valid_from + interval '1 microsecond'),
         reason = coalesce(reason || ' | ', '') || 'ended: ' || trim(p_reason)
  where id = g.id and (valid_to is null or valid_to > now());
end $$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can activate or deactivate accounts' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot deactivate your own account' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.profiles set is_active = p_active where user_id = p_user;
  update public.staff set is_active = p_active where user_id = p_user;
  perform app.audit_event(case when p_active then 'USER_REACTIVATED' else 'USER_DEACTIVATED' end, 'profiles', p_user::text, null, trim(p_reason));
end $$;

-- Service role only: called by the server right after Auth accepted the user's new password,
-- so the flag cannot be cleared while the administrator-known password is still valid.
create or replace function public.svc_password_changed(p_user uuid)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.profiles set must_change_password = false where user_id = p_user
$$;

-- Service role: profile for an account just created by an administrator (via the Auth admin API).
create or replace function public.svc_admin_profile(p_actor uuid, p_user uuid, p_name_ar text, p_name_en text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  -- The actor is re-checked here: the server passes the signed-in administrator's id.
  if not exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                 join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
                 where ur.user_id = p_actor and rp.permission_code = 'users.manage' and ur.branch_id is null
                   and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)) then
    raise exception 'permission denied: users.manage' using errcode = '42501';
  end if;
  insert into public.profiles (user_id, full_name_ar, full_name_en, must_change_password)
  values (p_user, trim(p_name_ar), nullif(trim(p_name_en), ''), true)
  on conflict (user_id) do nothing;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);   -- audit attributes the creation to the administrator
  perform app.audit_event('USER_CREATED', 'profiles', p_user::text, null, 'account created by administrator');
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.refunds enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_exceptions enable row level security;
grant select on public.payment_exceptions to authenticated;
create policy exceptions_read on public.payment_exceptions for select to authenticated using (app.has_permission('billing.read'));
grant all on public.payment_exceptions to service_role;
grant select on public.refunds, public.payment_intents to authenticated;
create policy refunds_read on public.refunds for select to authenticated
  using (app.has_permission('billing.read', branch_id) or app.has_permission('refund.approve', branch_id) or app.has_permission('refund.request', branch_id));
create policy intents_read on public.payment_intents for select to authenticated
  using (app.has_permission('billing.read', branch_id));
grant all on public.refunds, public.payment_intents to service_role;

revoke execute on all functions in schema public from public;
grant execute on function public.request_refund(uuid, numeric, text, text), public.decide_refund(uuid, boolean, text),
  public.pay_refund(uuid, text), public.close_cashier_session(uuid, numeric, text),
  public.portal_pay_invoice(uuid), public.portal_payment_status(uuid),
  public.admin_users(), public.admin_grant_role(uuid, text, uuid, timestamptz, text), public.admin_end_role(uuid, text),
  public.admin_set_active(uuid, boolean, text)
  to authenticated;
revoke execute on function public.svc_payment_intent(uuid), public.svc_payment_intent_attach(uuid, text, text), public.svc_password_changed(uuid),
  public.svc_payment_confirm(text, text, text, bigint, boolean, text), public.svc_admin_profile(uuid, uuid, text, text)
  from authenticated, anon;
grant execute on function public.svc_payment_intent(uuid), public.svc_payment_intent_attach(uuid, text, text), public.svc_password_changed(uuid),
  public.svc_payment_confirm(text, text, text, bigint, boolean, text), public.svc_admin_profile(uuid, uuid, text, text)
  to service_role;
revoke execute on function app.payment_confirm(text, text, text, bigint, boolean, text) from public, authenticated, anon;
