-- Golden Care OS — 0027 Treatment plans in the portal (acceptance, online installments, reminders);
-- HR: annual salary increments and end-of-service settlements.
-- Policy stays with the clinic: how many installments a patient may choose online is set per plan by staff (default 1 =
-- pay in full); end-of-service gratuity, tax and other items are entered by HR — only leave encashment and outstanding
-- loans are calculated, from the employee's own records.

-- ---------------------------------------------------------------------------
-- Plans in the portal
-- ---------------------------------------------------------------------------
alter table public.treatment_plans add column if not exists portal_max_installments int not null default 1 check (portal_max_installments between 1 and 36);

create or replace function public.set_plan_portal_options(p_plan uuid, p_max_installments int)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  perform app.require_permission('plan.accept', tp.branch_id);
  if coalesce(p_max_installments, 0) not between 1 and 36 then raise exception 'installment schedule must have 1 to 36 rows' using errcode = '22023'; end if;
  perform set_config('app.plan_rpc', 'on', true);
  update public.treatment_plans set portal_max_installments = p_max_installments where id = tp.id returning * into tp;
  return tp;
end $$;

-- Acceptance (as in 0018) — also callable from the patient's own portal session through portal_accept_plan.
create or replace function public.accept_plan(p_plan uuid, p_method text, p_installments jsonb, p_note text default null)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans; i jsonb; v_seq int := 0; v_prev date; v_sum numeric := 0; v_amt numeric; v_due date;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  if coalesce(current_setting('app.portal_accept', true), '') <> 'on' then
    perform app.require_permission('plan.accept', tp.branch_id);
  end if;
  if tp.status <> 'proposed' then raise exception 'only a proposed plan can be accepted' using errcode = '22023'; end if;
  if tp.valid_until < app.cairo_today() then raise exception 'the quotation expired on %; revise and propose it again', tp.valid_until using errcode = '22023'; end if;
  if p_method not in ('signed_paper', 'in_person', 'portal') then raise exception 'record how the patient accepted' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) > 36 then
    raise exception 'installment schedule must have 1 to 36 rows' using errcode = '22023';
  end if;
  if tp.total > 0 and jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) = 0 then
    raise exception 'installment schedule must have 1 to 36 rows' using errcode = '22023';
  end if;
  perform set_config('app.plan_rpc', 'on', true);
  for i in select * from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) loop
    v_amt := (i->>'amount')::numeric; v_due := (i->>'due_on')::date;
    if v_amt is null or v_amt <= 0 or v_amt <> round(v_amt, 2) then raise exception 'each installment needs a positive amount' using errcode = '22023'; end if;
    if v_due is null or v_due < app.cairo_today() or (v_prev is not null and v_due < v_prev) then
      raise exception 'installment dates must start today or later and run in order' using errcode = '22023';
    end if;
    v_seq := v_seq + 1; v_prev := v_due; v_sum := v_sum + v_amt;
    insert into public.plan_installments (plan_id, seq, due_on, amount) values (tp.id, v_seq, v_due, v_amt);
  end loop;
  if v_sum <> tp.total then raise exception 'installments add up to % but the plan total is %', v_sum, tp.total using errcode = '22023'; end if;
  update public.treatment_plans set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), acceptance_method = p_method,
    acceptance_note = nullif(trim(p_note), '')
  where id = tp.id returning * into tp;
  return tp;
end $$;

create or replace function public.portal_plans(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'full');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', tp.id, 'ref', tp.ref, 'title', tp.title, 'status', tp.status, 'total', tp.total, 'valid_until', tp.valid_until,
      'max_installments', tp.portal_max_installments, 'accepted_at', tp.accepted_at,
      'doctor_ar', s.full_name_ar, 'doctor_en', coalesce(s.full_name_en, s.full_name_ar),
      'items', (select jsonb_agg(jsonb_build_object('service_ar', sv.name_ar, 'service_en', sv.name_en, 'tooth', it.tooth, 'qty', it.quantity,
                 'total', it.line_total, 'status', it.status) order by it.seq)
                from public.treatment_plan_items it join public.services sv on sv.id = it.service_id where it.plan_id = tp.id and it.status <> 'cancelled'),
      'installments', (select jsonb_agg(jsonb_build_object('seq', ins.seq, 'due_on', ins.due_on, 'amount', ins.amount, 'paid', ins.paid_amount) order by ins.seq)
                       from public.plan_installments ins where ins.plan_id = tp.id and ins.amount > 0),
      'due_now', app.plan_due_now(tp.id)) order by tp.created_at desc)
    from public.treatment_plans tp join public.staff s on s.id = tp.doctor_id
    where tp.patient_id = p_patient and tp.status in ('proposed', 'accepted', 'in_progress', 'completed')), '[]'::jsonb);
end $$;

-- What the patient can pay now: everything overdue, or else the next installment.
create or replace function app.plan_due_now(p_plan uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif((select sum(amount - paid_amount) from public.plan_installments where plan_id = p_plan and paid_amount < amount and due_on <= app.cairo_today()), 0),
                  (select amount - paid_amount from public.plan_installments where plan_id = p_plan and paid_amount < amount order by seq limit 1), 0)
$$;

create or replace function public.portal_accept_plan(p_plan uuid, p_installments int)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans; v_rows jsonb := '[]'::jsonb; v_each numeric; v_k int;
begin
  select * into tp from public.treatment_plans where id = p_plan;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(tp.patient_id, 'full');
  if coalesce(p_installments, 0) not between 1 and tp.portal_max_installments then
    raise exception 'choose between 1 and % installments', tp.portal_max_installments using errcode = '22023';
  end if;
  v_each := floor(tp.total * 100 / p_installments) / 100;
  for v_k in 1..p_installments loop
    v_rows := v_rows || jsonb_build_object('due_on', (app.cairo_today() + make_interval(months => v_k - 1))::date,
      'amount', case when v_k = p_installments then tp.total - v_each * (p_installments - 1) else v_each end);
  end loop;
  perform set_config('app.portal_accept', 'on', true);
  tp := public.accept_plan(p_plan, 'portal', case when tp.total > 0 then v_rows else '[]'::jsonb end, 'accepted by the patient in the portal');
  perform set_config('app.portal_accept', '', true);
  return tp;
end $$;

-- Online installment payments: an intent for a plan instead of an invoice; the gateway result becomes an advance
-- deposit allocated to the plan's installments in date order.
alter table public.payment_intents alter column invoice_id drop not null;
alter table public.payment_intents add column if not exists plan_id uuid references public.treatment_plans(id);
alter table public.payment_intents add column if not exists deposit_id uuid references public.patient_deposits(id);
alter table public.payment_intents add constraint intent_for_one_thing check ((invoice_id is null) <> (plan_id is null));

create or replace function public.portal_pay_installment(p_plan uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans; pi public.payment_intents; v_due numeric;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(tp.patient_id, 'full');
  if tp.status not in ('accepted', 'in_progress', 'completed') then raise exception 'payments are taken only on accepted plans' using errcode = '22023'; end if;
  v_due := app.plan_due_now(tp.id);
  if v_due <= 0 then raise exception 'nothing to pay' using errcode = '22023'; end if;
  if (select count(*) from public.payment_intents where plan_id = tp.id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too many requests' using errcode = '54000';
  end if;
  update public.payment_intents set status = 'expired', updated_at = now()
   where plan_id = tp.id and status = 'created' and (expires_at <= now() or amount <> v_due);
  select * into pi from public.payment_intents where plan_id = tp.id and status = 'created' and expires_at > now() order by created_at desc limit 1;
  if not found then
    insert into public.payment_intents (plan_id, branch_id, patient_id, amount) values (tp.id, tp.branch_id, tp.patient_id, v_due) returning * into pi;
  end if;
  return jsonb_build_object('intent_id', pi.id, 'ref', pi.ref, 'amount', pi.amount, 'currency', pi.currency, 'invoice_no', tp.ref);
end $$;

create or replace function app.plan_payment_confirm(pi public.payment_intents, p_provider text, p_txn_id text, p_amount numeric)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := app.org_of_branch(pi.branch_id); v_je uuid; d public.patient_deposits; ins record; v_left numeric; v_pay numeric;
begin
  perform 1 from public.patients where id = pi.patient_id for update;
  v_je := app.post_journal(v_org, pi.branch_id, app.cairo_today(), 'Online installment ' || pi.ref || ' (' || p_provider || ')', 'patient_deposit', pi.patient_id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'gateway_clearing'), 'debit', p_amount, 'patient_id', pi.patient_id, 'memo', p_txn_id),
      jsonb_build_object('account_id', app.account_for(v_org, 'patient_advances'), 'credit', p_amount, 'patient_id', pi.patient_id)));
  insert into public.patient_deposits (patient_id, branch_id, kind, amount, method, reference, plan_id, idempotency_key, journal_entry_id, created_by)
  values (pi.patient_id, pi.branch_id, 'deposit', p_amount, 'online', p_provider || ':' || p_txn_id, pi.plan_id, 'gw-' || p_provider || '-' || p_txn_id, v_je, null)
  returning * into d;
  perform set_config('app.plan_rpc', 'on', true);
  v_left := p_amount;
  for ins in select * from public.plan_installments where plan_id = pi.plan_id and paid_amount < amount order by seq for update loop
    exit when v_left <= 0;
    v_pay := least(v_left, ins.amount - ins.paid_amount);
    update public.plan_installments set paid_amount = paid_amount + v_pay where id = ins.id;
    v_left := v_left - v_pay;
  end loop;
  update public.payment_intents set status = 'paid', provider_txn_id = p_txn_id, deposit_id = d.id, last_error = null, updated_at = now() where id = pi.id;
  return 'paid';
end $$;

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
  if pi.plan_id is not null then
    return app.plan_payment_confirm(pi, p_provider, p_txn_id, v_amount);
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

create or replace function public.svc_payment_intent(p_intent uuid)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object('id', pi.id, 'ref', pi.ref, 'amount', pi.amount, 'currency', pi.currency, 'status', pi.status,
    'expires_at', pi.expires_at, 'provider_order_id', pi.provider_order_id, 'invoice_no', coalesce(i.invoice_no, tp.ref),
    'first_name', coalesce(p.first_name_en, p.first_name_ar), 'last_name', coalesce(p.last_name_en, p.last_name_ar),
    'phone', p.phone, 'email', p.email)
  from public.payment_intents pi left join public.invoices i on i.id = pi.invoice_id left join public.treatment_plans tp on tp.id = pi.plan_id
  join public.patients p on p.id = pi.patient_id
  where pi.id = p_intent
$$;

create or replace function public.portal_payment_status(p_intent uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare pi public.payment_intents;
begin
  select * into pi from public.payment_intents where id = p_intent;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(pi.patient_id, 'full');
  return jsonb_build_object('ref', pi.ref, 'status', pi.status, 'amount', pi.amount, 'kind', case when pi.plan_id is null then 'invoice' else 'plan' end,
    'receipt_no', coalesce((select receipt_no from public.payments where id = pi.payment_id), (select ref from public.patient_deposits where id = pi.deposit_id)));
end $$;

-- Installment reminders (3 days before and on the due date), through the normal message outbox.
insert into public.message_templates (code, lang, provider_template, body) values
  ('installment_due', 'ar', 'gc_installment_due', 'أهلًا {{name}} 🌿 تذكير من عيادات جولدن كير: قسط خطة العلاج {{plan}} بقيمة {{amount}} ج.م مستحق يوم {{due}}. تقدر تدفعه من حسابك على موقعنا أو في الاستقبال.'),
  ('installment_due', 'en', 'gc_installment_due', 'Hello {{name}} 🌿 a reminder from Golden Care Clinics: the installment of {{amount}} EGP for treatment plan {{plan}} is due on {{due}}. You can pay it from your online account or at reception.')
on conflict do nothing;

create or replace function app.enqueue_installment_reminders()
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare n int := 0; r record;
begin
  for r in select ins.id, ins.due_on, ins.amount - ins.paid_amount left_amt, tp.ref, tp.patient_id
           from public.plan_installments ins join public.treatment_plans tp on tp.id = ins.plan_id
           where tp.status in ('accepted', 'in_progress', 'completed') and ins.paid_amount < ins.amount
             and ins.due_on in (app.cairo_today(), app.cairo_today() + 3) loop
    if app.enqueue_message('installment_due', r.patient_id, null,
         jsonb_build_object('plan', r.ref, 'amount', to_char(r.left_amt, 'FM999,999,990.00'), 'due', to_char(r.due_on, 'YYYY-MM-DD')),
         'inst-' || r.id || '-' || (r.due_on - app.cairo_today())) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function app.enqueue_due_reminders()
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare n int := 0; r record;
begin
  for r in select id, patient_id, branch_id from public.appointments
           where status in ('booked', 'confirmed') and lower(slot) between now() + interval '20 hours' and now() + interval '28 hours' loop
    continue when app.care_on(r.branch_id, 'pre_visit') and not app.care_refused(r.patient_id);   -- the assistant reminds
    if app.enqueue_message('appointment_reminder', r.patient_id, r.id, '{}'::jsonb, 'apt-reminder-' || r.id) is not null then n := n + 1; end if;
  end loop;
  n := n + app.enqueue_installment_reminders();
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- HR: annual increments
-- ---------------------------------------------------------------------------
create or replace function public.apply_salary_increment(p_branch uuid, p_effective date, p_percent numeric, p_component text default 'BASIC',
                                                         p_employees uuid[] default null, p_note text default null)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  perform app.require_permission('hr.manage', p_branch);
  if p_effective is null or extract(day from p_effective) <> 1 then raise exception 'increments start on the first day of a month' using errcode = '22023'; end if;
  if coalesce(p_percent, 0) <= 0 or p_percent > 100 then raise exception 'increment must be above 0 and at most 100 percent' using errcode = '22023'; end if;
  if not exists (select 1 from public.payroll_components where code = p_component and kind = 'earning' and calc = 'fixed') then
    raise exception 'choose a fixed earning (for example the basic salary)' using errcode = '22023';
  end if;
  for r in select e.id, pi.amount from public.employees e
           join public.employee_pay_items pi on pi.employee_id = e.id and pi.component_code = p_component and pi.effective @> p_effective
           where e.branch_id = p_branch and e.status = 'active' and (p_employees is null or e.id = any(p_employees)) order by e.employee_no loop
    perform app.set_pay_item(r.id, p_component, round(r.amount * (1 + p_percent / 100), 2), p_effective,
      coalesce(nullif(trim(p_note), ''), 'annual increment ' || p_percent || '%'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- HR: end-of-service settlement (prepared → approved → paid by three people)
-- ---------------------------------------------------------------------------
create table public.eos_settlements (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique default app.next_ref('EOS'),
  employee_id       uuid not null references public.employees(id),
  branch_id         uuid not null references public.branches(id),
  end_date          date not null,
  daily_rate        numeric(12,4) not null,
  leave_days        numeric(6,2) not null default 0,
  leave_amount      numeric(12,2) not null default 0,
  gratuity          numeric(12,2) not null default 0 check (gratuity >= 0),
  other_earnings    numeric(12,2) not null default 0 check (other_earnings >= 0),
  loan_deduction    numeric(12,2) not null default 0,
  tax_deduction     numeric(12,2) not null default 0 check (tax_deduction >= 0),
  other_deductions  numeric(12,2) not null default 0 check (other_deductions >= 0),
  net               numeric(12,2) not null,
  note              text,
  status            text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'cancelled')),
  prepared_by       uuid not null default auth.uid(),
  prepared_at       timestamptz not null default now(),
  approved_by       uuid,
  approved_at       timestamptz,
  journal_entry_id  uuid references public.journal_entries(id),
  paid_by           uuid,
  paid_at           timestamptz,
  pay_method        text check (pay_method in ('bank_transfer', 'cash')),
  pay_reference     text,
  pay_journal_entry_id uuid references public.journal_entries(id),
  cancel_reason     text,
  check (net >= 0)
);
create unique index eos_one_active on public.eos_settlements (employee_id) where status <> 'cancelled';
create trigger trg_audit_eos after insert or update on public.eos_settlements for each row execute function app.audit_row();
create trigger trg_eos_immutable before delete on public.eos_settlements for each row execute function app.block_delete();

create or replace function public.prepare_eos(p_employee uuid, p_encash_leave boolean, p_gratuity numeric, p_other_earnings numeric,
                                              p_tax numeric, p_other_deductions numeric, p_note text)
returns public.eos_settlements language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.employees; s public.eos_settlements; v_basic numeric; v_div numeric := app.payroll_setting('day_divisor');
        v_days numeric := 0; v_leave numeric := 0; v_loan numeric; v_gross numeric;
begin
  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payroll.prepare', e.branch_id);
  if e.end_date is null then raise exception 'end the employment first (date and reason)' using errcode = '22023'; end if;
  select amount into v_basic from public.employee_pay_items where employee_id = e.id and component_code = 'BASIC' and effective @> e.end_date;
  if v_basic is null then raise exception 'the employee has no basic salary on the end date' using errcode = '22023'; end if;
  if coalesce(v_div, 0) <= 0 then raise exception 'day_divisor must be above zero' using errcode = '22023'; end if;
  if coalesce(p_encash_leave, false) then
    v_days := greatest(app.leave_entitlement(e.id, 'ANNUAL') - app.leave_used(e.id, 'ANNUAL', extract(year from e.end_date)::int), 0);
    v_leave := round(v_days * v_basic / v_div, 2);
  end if;
  v_gross := v_leave + round(coalesce(p_gratuity, 0), 2) + round(coalesce(p_other_earnings, 0), 2);
  select coalesce(sum(amount - repaid), 0) into v_loan from public.employee_loans where employee_id = e.id and status = 'disbursed';
  v_loan := least(v_loan, greatest(v_gross - round(coalesce(p_tax, 0), 2) - round(coalesce(p_other_deductions, 0), 2), 0));
  if v_gross - v_loan - round(coalesce(p_tax, 0), 2) - round(coalesce(p_other_deductions, 0), 2) < 0 then
    raise exception 'deductions are more than the settlement' using errcode = '22023';
  end if;
  insert into public.eos_settlements (employee_id, branch_id, end_date, daily_rate, leave_days, leave_amount, gratuity, other_earnings,
    loan_deduction, tax_deduction, other_deductions, net, note)
  values (e.id, e.branch_id, e.end_date, round(v_basic / v_div, 4), v_days, v_leave, round(coalesce(p_gratuity, 0), 2), round(coalesce(p_other_earnings, 0), 2),
    v_loan, round(coalesce(p_tax, 0), 2), round(coalesce(p_other_deductions, 0), 2),
    v_gross - v_loan - round(coalesce(p_tax, 0), 2) - round(coalesce(p_other_deductions, 0), 2), nullif(trim(p_note), ''))
  returning * into s;
  return s;
exception when unique_violation then
  raise exception 'an end-of-service settlement already exists for this employee; cancel it first' using errcode = '22023';
end $$;

create or replace function public.decide_eos(p_id uuid, p_approve boolean, p_reason text default null)
returns public.eos_settlements language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s public.eos_settlements; v_org uuid; e public.employees; v_gross numeric; l record; v_left numeric; v_take numeric;
begin
  select * into s from public.eos_settlements where id = p_id for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  if not p_approve then
    if not (app.has_permission('payroll.prepare', s.branch_id) or app.has_permission('payroll.approve', s.branch_id)) then raise exception 'permission denied' using errcode = '42501'; end if;
    if s.status <> 'draft' then raise exception 'only a draft can be cancelled' using errcode = '22023'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
    update public.eos_settlements set status = 'cancelled', cancel_reason = trim(p_reason) where id = s.id returning * into s;
    return s;
  end if;
  perform app.require_permission('payroll.approve', s.branch_id);
  if s.status <> 'draft' then raise exception 'settlement already %', s.status using errcode = '22023'; end if;
  if s.prepared_by = auth.uid() then raise exception 'separation of duties: you cannot approve a settlement you prepared' using errcode = '42501'; end if;
  select * into e from public.employees where id = s.employee_id;
  v_org := app.org_of_branch(s.branch_id);
  v_gross := s.leave_amount + s.gratuity + s.other_earnings;
  -- Outstanding loans are settled from the payout, oldest first.
  v_left := s.loan_deduction;
  for l in select * from public.employee_loans where employee_id = s.employee_id and status = 'disbursed' order by disbursed_at for update loop
    exit when v_left <= 0;
    v_take := least(v_left, l.amount - l.repaid);
    update public.employee_loans set repaid = repaid + v_take, status = case when repaid + v_take >= amount then 'settled' else status end where id = l.id;
    v_left := v_left - v_take;
  end loop;
  update public.eos_settlements set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    journal_entry_id = case when v_gross > 0 then app.post_journal(v_org, s.branch_id, app.cairo_today(), 'End of service ' || s.ref || ' ' || e.employee_no, 'eos', s.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'salaries_expense'), 'debit', v_gross, 'memo', e.employee_no),
        jsonb_build_object('account_id', app.account_for(v_org, 'salaries_payable'), 'credit', s.net, 'memo', e.employee_no))
      || case when s.loan_deduction > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'employee_advances'), 'credit', s.loan_deduction, 'memo', e.employee_no)) else '[]'::jsonb end
      || case when s.tax_deduction > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'payroll_tax_payable'), 'credit', s.tax_deduction, 'memo', e.employee_no)) else '[]'::jsonb end
      || case when s.other_deductions > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'salaries_expense'), 'credit', s.other_deductions, 'memo', 'deductions ' || e.employee_no)) else '[]'::jsonb end)
    end
  where id = s.id returning * into s;
  return s;
end $$;

create or replace function public.pay_eos(p_id uuid, p_method text, p_reference text)
returns public.eos_settlements language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s public.eos_settlements; v_org uuid;
begin
  select * into s from public.eos_settlements where id = p_id for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payroll.pay', s.branch_id);
  if s.status = 'paid' then return s; end if;
  if s.status <> 'approved' then raise exception 'the settlement must be approved before payment' using errcode = '22023'; end if;
  if s.approved_by = auth.uid() then raise exception 'separation of duties: the approver cannot also record the payment' using errcode = '42501'; end if;
  if p_method not in ('bank_transfer', 'cash') then raise exception 'method must be bank transfer or cash' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment reference is required' using errcode = '22023'; end if;
  v_org := app.org_of_branch(s.branch_id);
  update public.eos_settlements set status = 'paid', paid_by = auth.uid(), paid_at = now(), pay_method = p_method, pay_reference = trim(p_reference),
    pay_journal_entry_id = case when s.net > 0 then app.post_journal(v_org, s.branch_id, app.cairo_today(), 'End of service payment ' || s.ref, 'eos_payment', s.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'salaries_payable'), 'debit', s.net),
        jsonb_build_object('account_id', app.account_for(v_org, case when p_method = 'cash' then 'cash_on_hand' else 'bank_main' end), 'credit', s.net, 'memo', trim(p_reference)))) end
  where id = s.id returning * into s;
  return s;
end $$;

alter table public.eos_settlements enable row level security;
create policy eos_read on public.eos_settlements for select to authenticated
  using (app.has_permission('payroll.read', branch_id) or employee_id = app.my_employee_id());
grant select on public.eos_settlements to authenticated;

revoke execute on function app.plan_due_now(uuid), app.plan_payment_confirm(public.payment_intents, text, text, numeric), app.enqueue_installment_reminders() from public, anon, authenticated;
revoke execute on function public.set_plan_portal_options(uuid, int), public.portal_plans(uuid), public.portal_accept_plan(uuid, int), public.portal_pay_installment(uuid),
  public.apply_salary_increment(uuid, date, numeric, text, uuid[], text), public.prepare_eos(uuid, boolean, numeric, numeric, numeric, numeric, text),
  public.decide_eos(uuid, boolean, text), public.pay_eos(uuid, text, text) from public, anon;
grant execute on function public.set_plan_portal_options(uuid, int), public.portal_plans(uuid), public.portal_accept_plan(uuid, int), public.portal_pay_installment(uuid),
  public.apply_salary_increment(uuid, date, numeric, text, uuid[], text), public.prepare_eos(uuid, boolean, numeric, numeric, numeric, numeric, text),
  public.decide_eos(uuid, boolean, text), public.pay_eos(uuid, text, text) to authenticated;
