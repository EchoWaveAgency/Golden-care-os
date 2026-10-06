-- Golden Care OS — 0021 HR: employees, shifts, attendance (biometric import / device push), leave, loans, payroll
-- Policy values (social insurance rates and caps, income tax brackets and exemption, overtime and lateness rules,
-- leave entitlements) are NOT set here: the payroll refuses to run until the chief accountant configures them or
-- switches the component off. See OPEN_QUESTIONS (HR and payroll).

-- ---------------------------------------------------------------------------
-- Accounts, roles, permissions
-- ---------------------------------------------------------------------------
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, v.code, v.ar, v.en, v.t::public.account_type, true from public.organizations o
cross join (values ('1160', 'سلف وقروض الموظفين', 'Employee advances & loans', 'asset'),
                   ('2410', 'التأمينات الاجتماعية المستحقة', 'Social insurance payable', 'liability'),
                   ('2420', 'ضريبة كسب العمل المستحقة', 'Payroll tax payable', 'liability'),
                   ('5210', 'حصة صاحب العمل في التأمينات', 'Employer social insurance', 'expense')) v(code, ar, en, t)
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a
join (values ('employee_advances', '1160'), ('social_insurance_payable', '2410'), ('payroll_tax_payable', '2420'),
             ('employer_insurance_expense', '5210'), ('salaries_expense', '5200'), ('salaries_payable', '2400')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.roles (code, name_ar, name_en, is_privileged) values ('payroll_officer', 'مسؤول الرواتب', 'Payroll Officer', true)
on conflict (code) do nothing;

insert into public.permissions (code, module, description) values
  ('hr.read',            'hr', 'View employees, shifts, attendance and leave of the branch'),
  ('hr.manage',          'hr', 'Add and update employees, salaries, shifts and rosters'),
  ('attendance.manage',  'hr', 'Import attendance, add manual punches, recompute days'),
  ('attendance.approve', 'hr', 'Approve manual punches and overtime (not your own entries)'),
  ('leave.approve',      'hr', 'Approve or reject leave requests (not your own)'),
  ('payroll.read',       'hr', 'View payroll runs, payslips and loans'),
  ('payroll.settings',   'hr', 'Payroll components, rates, tax brackets'),
  ('payroll.prepare',    'hr', 'Prepare payroll runs and enter bonuses / penalties; request employee loans'),
  ('payroll.approve',    'hr', 'Approve payroll runs and loans (never ones you prepared)'),
  ('payroll.pay',        'hr', 'Pay approved payroll, disburse loans, pay insurance and tax (never ones you approved)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('hr_manager', 'hr.read'), ('hr_manager', 'hr.manage'), ('hr_manager', 'attendance.manage'), ('hr_manager', 'attendance.approve'),
  ('hr_manager', 'leave.approve'), ('hr_manager', 'payroll.read'), ('hr_manager', 'payroll.prepare'),
  ('payroll_officer', 'hr.read'), ('payroll_officer', 'attendance.manage'), ('payroll_officer', 'payroll.read'), ('payroll_officer', 'payroll.prepare'),
  ('payroll_officer', 'staff.read'),
  ('chief_accountant', 'payroll.read'), ('chief_accountant', 'payroll.settings'), ('chief_accountant', 'payroll.approve'), ('chief_accountant', 'payroll.pay'),
  ('center_director', 'hr.read'), ('center_director', 'payroll.read'), ('center_director', 'payroll.approve'), ('center_director', 'payroll.pay'),
  ('center_director', 'leave.approve'),
  ('owner', 'payroll.read'), ('financial_auditor', 'payroll.read'),
  ('operations_manager', 'hr.read'), ('operations_manager', 'leave.approve')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Payroll configuration
-- ---------------------------------------------------------------------------
create table public.payroll_components (
  code        text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  name_ar     text not null,
  name_en     text not null,
  kind        text not null check (kind in ('earning', 'deduction', 'employer')),
  calc        text not null check (calc in ('fixed', 'manual', 'attendance_absence', 'attendance_late', 'attendance_overtime',
                                             'unpaid_leave', 'loan', 'insurance_employee', 'insurance_employer', 'income_tax')),
  rate        numeric(9,4) check (rate is null or rate >= 0),   -- % for insurance; multiplier for overtime / lateness
  taxable     boolean not null default true,                    -- earnings: part of the taxable base
  account_key text not null,
  sort        int not null default 100,
  is_active   boolean not null default true,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
create trigger trg_audit_payroll_components after insert or update on public.payroll_components for each row execute function app.audit_row();
insert into public.payroll_components (code, name_ar, name_en, kind, calc, rate, taxable, account_key, sort) values
  ('BASIC',        'الأجر الأساسي',              'Basic salary',               'earning',   'fixed',               null, true,  'salaries_expense', 10),
  ('HOUSING',      'بدل سكن',                    'Housing allowance',          'earning',   'fixed',               null, true,  'salaries_expense', 20),
  ('TRANSPORT',    'بدل انتقال',                 'Transport allowance',        'earning',   'fixed',               null, true,  'salaries_expense', 30),
  ('OVERTIME',     'أجر إضافي',                  'Overtime',                   'earning',   'attendance_overtime', null, true,  'salaries_expense', 40),
  ('BONUS',        'مكافأة',                     'Bonus',                      'earning',   'manual',              null, true,  'salaries_expense', 50),
  ('ABSENCE',      'خصم غياب',                   'Absence deduction',          'deduction', 'attendance_absence',  null, true,  'salaries_expense', 110),
  ('LATE',         'خصم تأخير',                  'Lateness deduction',         'deduction', 'attendance_late',     null, true,  'salaries_expense', 120),
  ('UNPAID_LEAVE', 'إجازة بدون أجر',              'Unpaid leave',               'deduction', 'unpaid_leave',        null, true,  'salaries_expense', 130),
  ('PENALTY',      'جزاء',                       'Penalty',                    'deduction', 'manual',              null, true,  'salaries_expense', 140),
  ('SI_EMPLOYEE',  'تأمينات اجتماعية (حصة العامل)', 'Social insurance (employee)', 'deduction', 'insurance_employee',  null, false, 'social_insurance_payable', 150),
  ('INCOME_TAX',   'ضريبة كسب العمل',            'Payroll income tax',         'deduction', 'income_tax',          null, false, 'payroll_tax_payable', 160),
  ('LOAN',         'قسط سلفة',                    'Loan installment',           'deduction', 'loan',                null, false, 'employee_advances', 170),
  ('SI_EMPLOYER',  'تأمينات اجتماعية (حصة صاحب العمل)', 'Social insurance (employer)', 'employer', 'insurance_employer', null, false, 'social_insurance_payable', 200)
on conflict (code) do nothing;

create table public.payroll_settings (
  key        text primary key check (key in ('day_divisor', 'hours_per_day', 'insured_wage_min', 'insured_wage_max', 'tax_personal_exemption')),
  value      numeric(14,2),
  note       text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger trg_audit_payroll_settings after insert or update on public.payroll_settings for each row execute function app.audit_row();
insert into public.payroll_settings (key, value, note) values
  ('day_divisor', 30, 'Daily rate = monthly basic ÷ this number (to be confirmed by the chief accountant)'),
  ('hours_per_day', 8, 'Hourly rate = daily rate ÷ this number (to be confirmed)'),
  ('insured_wage_min', null, 'Minimum insurable wage (social insurance law)'),
  ('insured_wage_max', null, 'Maximum insurable wage (social insurance law)'),
  ('tax_personal_exemption', null, 'Annual personal exemption (income tax law)')
on conflict (key) do nothing;

create table public.payroll_tax_brackets (
  id             uuid primary key default gen_random_uuid(),
  effective_from date not null,
  from_amount    numeric(14,2) not null check (from_amount >= 0),   -- annual taxable income
  to_amount      numeric(14,2) check (to_amount is null or to_amount > from_amount),
  rate           numeric(6,3) not null check (rate between 0 and 100),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (effective_from, from_amount)
);
create trigger trg_audit_tax_brackets after insert or update or delete on public.payroll_tax_brackets for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Shifts, employees, pay items, roster
-- ---------------------------------------------------------------------------
create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id),
  code          text not null check (length(trim(code)) between 1 and 20),
  name_ar       text not null,
  name_en       text,
  start_time    time not null,
  end_time      time not null,                         -- end ≤ start means the shift ends the next day
  break_minutes int not null default 0 check (break_minutes between 0 and 240),
  grace_minutes int not null default 0 check (grace_minutes between 0 and 120),
  weekdays      int[] not null default '{0,1,2,3,4,6}', -- 0 = Sunday … 6 = Saturday (Friday off by default)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (branch_id, code),
  check (weekdays <@ array[0,1,2,3,4,5,6] and cardinality(weekdays) between 1 and 7)
);
create trigger trg_audit_shifts after insert or update on public.shifts for each row execute function app.audit_row();

create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  employee_no      text not null unique default app.next_ref('EMP', false),
  staff_id         uuid not null unique references public.staff(id),
  branch_id        uuid not null references public.branches(id),
  job_title_ar     text,
  job_title_en     text,
  department       text,
  employment_type  text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract', 'intern')),
  hire_date        date not null,
  end_date         date check (end_date is null or end_date >= hire_date),
  end_reason       text,
  status           text not null default 'active' check (status in ('active', 'suspended', 'terminated')),
  national_id      text check (national_id is null or national_id ~ '^[0-9]{14}$'),
  insurance_no     text,
  insured_wage     numeric(12,2) check (insured_wage is null or insured_wage >= 0),
  payment_method   text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'cash', 'wallet')),
  bank_name        text,
  bank_account     text,
  biometric_id     text,
  shift_id         uuid references public.shifts(id),
  payroll_eligible boolean not null default true,       -- doctors paid through settlements usually are not
  annual_leave_days numeric(5,1) check (annual_leave_days is null or annual_leave_days between 0 and 60),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (branch_id, biometric_id),
  check (status <> 'terminated' or end_date is not null)
);
create trigger trg_audit_employees after insert or update on public.employees for each row execute function app.audit_row();

create table public.employee_pay_items (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  component_code text not null references public.payroll_components(code),
  amount         numeric(12,2) not null check (amount >= 0),
  effective      daterange not null,
  note           text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  exclude using gist (employee_id with =, component_code with =, effective with &&)
);
create trigger trg_audit_pay_items after insert or update on public.employee_pay_items for each row execute function app.audit_row();

create table public.shift_roster (
  employee_id uuid not null references public.employees(id),
  day         date not null,
  shift_id    uuid references public.shifts(id),   -- null = day off
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (employee_id, day)
);
create trigger trg_audit_roster after insert or update or delete on public.shift_roster for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create table public.attendance_devices (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id),
  serial_no    text not null unique,
  name         text not null,
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);
create trigger trg_audit_att_devices after insert or update on public.attendance_devices for each row execute function app.audit_row();

create table public.attendance_punches (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id),
  employee_id  uuid references public.employees(id),     -- null until the biometric id is matched
  biometric_id text not null,
  punched_at   timestamptz not null,
  source       text not null check (source in ('device', 'import', 'manual')),
  device_id    uuid references public.attendance_devices(id),
  import_batch text,
  status       text not null default 'valid' check (status in ('valid', 'pending', 'rejected')),
  reason       text,
  created_by   uuid default auth.uid(),
  decided_by   uuid references auth.users(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (branch_id, biometric_id, punched_at),
  check (source <> 'manual' or coalesce(trim(reason), '') <> '')
);
create index on public.attendance_punches (employee_id, punched_at);
create trigger trg_audit_punches after insert or update on public.attendance_punches for each row execute function app.audit_row();

create table public.attendance_days (
  employee_id      uuid not null references public.employees(id),
  day              date not null,
  shift_id         uuid references public.shifts(id),
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  first_in         timestamptz,
  last_out         timestamptz,
  punches          int not null default 0,
  worked_minutes   int not null default 0,
  late_minutes     int not null default 0,
  early_minutes    int not null default 0,
  overtime_minutes int not null default 0,
  overtime_approved_minutes int not null default 0,
  status           text not null check (status in ('present', 'late', 'absent', 'incomplete', 'leave', 'unpaid_leave', 'holiday', 'off')),
  leave_request_id uuid,
  computed_at      timestamptz not null default now(),
  primary key (employee_id, day),
  check (overtime_approved_minutes <= overtime_minutes)
);

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------
create table public.leave_types (
  code         text primary key,
  name_ar      text not null,
  name_en      text not null,
  paid         boolean not null,
  annual_days  numeric(5,1) check (annual_days is null or annual_days between 0 and 365),  -- null: set by policy / per employee
  requires_note boolean not null default false,
  is_active    boolean not null default true
);
insert into public.leave_types (code, name_ar, name_en, paid, annual_days, requires_note) values
  ('ANNUAL', 'إجازة اعتيادية', 'Annual leave', true, null, false),
  ('CASUAL', 'إجازة عارضة', 'Casual leave', true, null, false),
  ('SICK', 'إجازة مرضية', 'Sick leave', true, null, true),
  ('UNPAID', 'إجازة بدون أجر', 'Unpaid leave', false, null, true)
on conflict (code) do nothing;

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default app.next_ref('LV'),
  employee_id   uuid not null references public.employees(id),
  leave_type    text not null references public.leave_types(code),
  from_date     date not null,
  to_date       date not null,
  days          numeric(5,1) not null check (days > 0),
  reason        text check (reason is null or length(reason) <= 500),
  status        text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  requested_by  uuid not null default auth.uid(),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 120)
);
create index on public.leave_requests (employee_id, from_date);
create trigger trg_audit_leave after insert or update on public.leave_requests for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Loans / salary advances
-- ---------------------------------------------------------------------------
create table public.employee_loans (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('LN'),
  employee_id      uuid not null references public.employees(id),
  amount           numeric(12,2) not null check (amount > 0),
  installments     int not null check (installments between 1 and 60),
  start_period     date not null check (extract(day from start_period) = 1),
  reason           text not null check (length(trim(reason)) >= 3),
  status           text not null default 'requested' check (status in ('requested', 'approved', 'disbursed', 'settled', 'rejected', 'cancelled')),
  repaid           numeric(12,2) not null default 0 check (repaid >= 0),
  requested_by     uuid not null default auth.uid(),
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  disbursed_by     uuid references auth.users(id),
  disbursed_at     timestamptz,
  method           text check (method in ('bank_transfer', 'cash')),
  reference        text,
  journal_entry_id uuid references public.journal_entries(id),
  created_at       timestamptz not null default now(),
  check (repaid <= amount)
);
create trigger trg_audit_loans after insert or update on public.employee_loans for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Payroll runs
-- ---------------------------------------------------------------------------
create table public.payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique default app.next_ref('PR'),
  branch_id         uuid not null references public.branches(id),
  period            date not null check (extract(day from period) = 1),
  status            text not null default 'prepared' check (status in ('prepared', 'approved', 'paid', 'cancelled')),
  employees         int not null default 0,
  total_earnings    numeric(14,2) not null default 0,
  total_deductions  numeric(14,2) not null default 0,
  total_net         numeric(14,2) not null default 0,
  total_employer    numeric(14,2) not null default 0,
  warnings          jsonb not null default '[]'::jsonb,
  prepared_by       uuid not null default auth.uid(),
  prepared_at       timestamptz not null default now(),
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  paid_by           uuid references auth.users(id),
  paid_at           timestamptz,
  payment_method    text check (payment_method in ('bank_transfer', 'cash')),
  payment_reference text,
  accrual_entry_id  uuid references public.journal_entries(id),
  payment_entry_id  uuid references public.journal_entries(id),
  cancel_reason     text,
  cancelled_by      uuid references auth.users(id),
  cancelled_at      timestamptz
);
create unique index payroll_runs_period_uq on public.payroll_runs (branch_id, period) where status <> 'cancelled';
create trigger trg_audit_payroll_runs after insert or update on public.payroll_runs for each row execute function app.audit_row();

create table public.payroll_slips (
  run_id            uuid not null references public.payroll_runs(id),
  employee_id       uuid not null references public.employees(id),
  employed_days     int not null,
  worked_days       int not null default 0,
  absent_days       int not null default 0,
  unpaid_leave_days numeric(5,1) not null default 0,
  late_minutes      int not null default 0,
  overtime_minutes  int not null default 0,
  earnings          numeric(12,2) not null default 0,
  deductions        numeric(12,2) not null default 0,
  net               numeric(12,2) not null default 0,
  employer          numeric(12,2) not null default 0,
  primary key (run_id, employee_id)
);
create table public.payroll_lines (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.payroll_runs(id),
  employee_id    uuid not null references public.employees(id),
  component_code text not null references public.payroll_components(code),
  kind           text not null check (kind in ('earning', 'deduction', 'employer')),
  quantity       numeric(12,2),
  rate           numeric(14,4),
  amount         numeric(12,2) not null check (amount >= 0),
  loan_id        uuid references public.employee_loans(id),
  note           text
);
create index on public.payroll_lines (run_id, employee_id);

create table public.payroll_adjustments (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  period         date not null check (extract(day from period) = 1),
  component_code text not null references public.payroll_components(code),
  amount         numeric(12,2) not null check (amount > 0),
  reason         text not null check (length(trim(reason)) >= 3),
  status         text not null default 'active' check (status in ('active', 'cancelled')),
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now()
);
create trigger trg_audit_adjustments after insert or update on public.payroll_adjustments for each row execute function app.audit_row();

create table public.payroll_liability_payments (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('PL'),
  branch_id        uuid not null references public.branches(id),
  kind             text not null check (kind in ('social_insurance', 'payroll_tax')),
  period           date not null check (extract(day from period) = 1),
  amount           numeric(14,2) not null check (amount > 0),
  reference        text not null,
  paid_by          uuid not null default auth.uid(),
  journal_entry_id uuid references public.journal_entries(id),
  created_at       timestamptz not null default now()
);
create trigger trg_audit_liability_pay after insert on public.payroll_liability_payments for each row execute function app.audit_row();

-- Payroll results never change after preparation (corrections: cancel and prepare again before approval,
-- or adjustments in the next month after it).
create or replace function app.payroll_rows_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.payroll_rpc', true), '') <> 'on' then
    raise exception 'payroll results change only through the payroll screen' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_payroll_lines_guard before insert or update or delete on public.payroll_lines for each row execute function app.payroll_rows_guard();
create trigger trg_payroll_slips_guard before insert or update or delete on public.payroll_slips for each row execute function app.payroll_rows_guard();
create trigger trg_attendance_days_guard before insert or update or delete on public.attendance_days for each row execute function app.payroll_rows_guard();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.my_employee_id()
returns uuid language sql stable security definer set search_path = public, app, pg_temp as $$
  select e.id from public.employees e join public.staff s on s.id = e.staff_id where s.user_id = auth.uid()
$$;

create or replace function app.payroll_setting(p_key text)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select value from public.payroll_settings where key = p_key
$$;

-- Shift that applies to an employee on a day (roster override first; weekly pattern otherwise). Null = day off.
create or replace function app.shift_for(p_employee uuid, p_day date)
returns uuid language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare r public.shift_roster; s public.shifts; e public.employees;
begin
  select * into r from public.shift_roster where employee_id = p_employee and day = p_day;
  if found then return r.shift_id; end if;
  select * into e from public.employees where id = p_employee;
  select * into s from public.shifts where id = e.shift_id and is_active;
  if not found then return null; end if;
  if extract(dow from p_day)::int = any(s.weekdays) then return s.id; end if;
  return null;
end $$;

create or replace function app.is_branch_holiday(p_branch uuid, p_day date)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.schedule_exceptions x where x.branch_id = p_branch and x.doctor_id is null and x.kind = 'holiday'
                 and x.period && tstzrange((p_day::timestamp at time zone 'Africa/Cairo'), ((p_day + 1)::timestamp at time zone 'Africa/Cairo')))
$$;

-- Working days (scheduled, not holidays) in a range — used to count leave days.
create or replace function app.working_days(p_employee uuid, p_from date, p_to date)
returns int language sql stable security definer set search_path = public, app, pg_temp as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') g(d)
  join public.employees e on e.id = p_employee
  where app.shift_for(p_employee, g.d::date) is not null and not app.is_branch_holiday(e.branch_id, g.d::date)
$$;

-- One attendance day from shift, holidays, approved leave and valid punches. Idempotent.
create or replace function app.compute_attendance_day(p_employee uuid, p_day date)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.employees; s public.shifts; v_shift uuid; v_start timestamptz; v_end timestamptz; v_first timestamptz; v_last timestamptz;
        v_n int; v_status text; v_late int := 0; v_early int := 0; v_worked int := 0; v_ot int := 0; lr record; v_keep int;
begin
  perform set_config('app.payroll_rpc', 'on', true);
  select * into e from public.employees where id = p_employee;
  if not found or p_day < e.hire_date or (e.end_date is not null and p_day > e.end_date) or p_day > app.cairo_today() then
    delete from public.attendance_days where employee_id = p_employee and day = p_day;
    return;
  end if;
  v_shift := app.shift_for(p_employee, p_day);
  select * into s from public.shifts where id = v_shift;
  if v_shift is not null then
    v_start := (p_day + s.start_time) at time zone 'Africa/Cairo';
    v_end := ((p_day + case when s.end_time <= s.start_time then 1 else 0 end) + s.end_time) at time zone 'Africa/Cairo';
  else
    v_start := p_day::timestamp at time zone 'Africa/Cairo';
    v_end := (p_day + 1)::timestamp at time zone 'Africa/Cairo';
  end if;
  select min(punched_at), max(punched_at), count(*) into v_first, v_last, v_n from public.attendance_punches
  where employee_id = p_employee and status = 'valid'
    and punched_at >= v_start - interval '4 hours' and punched_at < v_end + interval '6 hours'
    and (v_shift is not null or punched_at < v_end);
  select lr2.id, lt.paid into lr from public.leave_requests lr2 join public.leave_types lt on lt.code = lr2.leave_type
  where lr2.employee_id = p_employee and lr2.status = 'approved' and p_day between lr2.from_date and lr2.to_date limit 1;

  if lr.id is not null and v_shift is not null then
    v_status := case when lr.paid then 'leave' else 'unpaid_leave' end;
  elsif app.is_branch_holiday(e.branch_id, p_day) then
    v_status := 'holiday';
  elsif v_shift is null then
    v_status := 'off';
    if v_n >= 2 then v_worked := greatest(0, extract(epoch from v_last - v_first)::int / 60); v_ot := v_worked; end if;
  elsif v_n = 0 then
    v_status := case when p_day = app.cairo_today() then null else 'absent' end;
  elsif v_n = 1 then
    v_status := 'incomplete';
  else
    v_late := greatest(0, extract(epoch from v_first - (v_start + make_interval(mins => s.grace_minutes)))::int / 60);
    v_early := greatest(0, extract(epoch from v_end - v_last)::int / 60);
    v_worked := greatest(0, extract(epoch from v_last - v_first)::int / 60 - s.break_minutes);
    v_ot := greatest(0, extract(epoch from v_last - v_end)::int / 60);
    v_status := case when v_late > 0 then 'late' else 'present' end;
  end if;
  if v_status is null then   -- today, nothing yet
    delete from public.attendance_days where employee_id = p_employee and day = p_day;
    return;
  end if;
  select overtime_approved_minutes into v_keep from public.attendance_days where employee_id = p_employee and day = p_day;
  insert into public.attendance_days (employee_id, day, shift_id, scheduled_start, scheduled_end, first_in, last_out, punches, worked_minutes,
                                      late_minutes, early_minutes, overtime_minutes, overtime_approved_minutes, status, leave_request_id, computed_at)
  values (p_employee, p_day, v_shift, case when v_shift is null then null else v_start end, case when v_shift is null then null else v_end end,
          v_first, case when v_n >= 2 then v_last end, coalesce(v_n, 0), v_worked, v_late, v_early, v_ot, least(coalesce(v_keep, 0), v_ot), v_status, lr.id, now())
  on conflict (employee_id, day) do update set shift_id = excluded.shift_id, scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
    first_in = excluded.first_in, last_out = excluded.last_out, punches = excluded.punches, worked_minutes = excluded.worked_minutes,
    late_minutes = excluded.late_minutes, early_minutes = excluded.early_minutes, overtime_minutes = excluded.overtime_minutes,
    overtime_approved_minutes = excluded.overtime_approved_minutes, status = excluded.status, leave_request_id = excluded.leave_request_id, computed_at = now();
end $$;

create or replace function app.compute_attendance_range(p_employee uuid, p_from date, p_to date)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d date; n int := 0;
begin
  for d in select g::date from generate_series(p_from, least(p_to, app.cairo_today()), interval '1 day') g loop
    perform app.compute_attendance_day(p_employee, d); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.payroll_locked(p_employee uuid, p_day date)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.payroll_runs r join public.employees e on e.branch_id = r.branch_id
                 where e.id = p_employee and r.period = date_trunc('month', p_day)::date and r.status in ('approved', 'paid'))
$$;

-- ---------------------------------------------------------------------------
-- HR RPCs
-- ---------------------------------------------------------------------------
create or replace function public.save_employee(p jsonb)
returns public.employees language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees; st public.staff; v_id uuid := nullif(p->>'id', '')::uuid; v_basic numeric; v_from date;
begin
  if v_id is null then
    select * into st from public.staff where id = (p->>'staff_id')::uuid;
    if not found then raise exception 'staff member not found' using errcode = 'P0002'; end if;
    perform app.require_permission('hr.manage', st.branch_id);
    if exists (select 1 from public.employees where staff_id = st.id) then raise exception 'this staff member already has an employee file' using errcode = '23505'; end if;
    insert into public.employees (staff_id, branch_id, hire_date) values (st.id, st.branch_id, coalesce(nullif(p->>'hire_date', '')::date, app.cairo_today()))
    returning * into e;
  else
    select * into e from public.employees where id = v_id for update;
    if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
    perform app.require_permission('hr.manage', e.branch_id);
  end if;
  if p ? 'shift_id' and nullif(p->>'shift_id', '') is not null
     and not exists (select 1 from public.shifts where id = (p->>'shift_id')::uuid and branch_id = e.branch_id) then
    raise exception 'shift belongs to another branch' using errcode = '22023';
  end if;
  update public.employees set
    job_title_ar = case when p ? 'job_title_ar' then nullif(trim(p->>'job_title_ar'), '') else job_title_ar end,
    job_title_en = case when p ? 'job_title_en' then nullif(trim(p->>'job_title_en'), '') else job_title_en end,
    department = case when p ? 'department' then nullif(trim(p->>'department'), '') else department end,
    employment_type = coalesce(nullif(p->>'employment_type', ''), employment_type),
    hire_date = coalesce(nullif(p->>'hire_date', '')::date, hire_date),
    national_id = case when p ? 'national_id' then nullif(trim(p->>'national_id'), '') else national_id end,
    insurance_no = case when p ? 'insurance_no' then nullif(trim(p->>'insurance_no'), '') else insurance_no end,
    insured_wage = case when p ? 'insured_wage' then nullif(p->>'insured_wage', '')::numeric else insured_wage end,
    payment_method = coalesce(nullif(p->>'payment_method', ''), payment_method),
    bank_name = case when p ? 'bank_name' then nullif(trim(p->>'bank_name'), '') else bank_name end,
    bank_account = case when p ? 'bank_account' then nullif(trim(p->>'bank_account'), '') else bank_account end,
    biometric_id = case when p ? 'biometric_id' then nullif(trim(p->>'biometric_id'), '') else biometric_id end,
    shift_id = case when p ? 'shift_id' then nullif(p->>'shift_id', '')::uuid else shift_id end,
    payroll_eligible = coalesce((p->>'payroll_eligible')::boolean, payroll_eligible),
    annual_leave_days = case when p ? 'annual_leave_days' then nullif(p->>'annual_leave_days', '')::numeric else annual_leave_days end,
    updated_at = now()
  where id = e.id returning * into e;
  -- Salary: a new basic salary from a date closes the previous one the day before.
  v_basic := nullif(p->>'basic_salary', '')::numeric;
  if v_basic is not null then
    v_from := coalesce(nullif(p->>'salary_from', '')::date, e.hire_date);
    perform app.set_pay_item(e.id, 'BASIC', v_basic, v_from, nullif(p->>'salary_note', ''));
  end if;
  if nullif(p->>'housing', '') is not null then perform app.set_pay_item(e.id, 'HOUSING', (p->>'housing')::numeric, coalesce(nullif(p->>'salary_from', '')::date, e.hire_date), null); end if;
  if nullif(p->>'transport', '') is not null then perform app.set_pay_item(e.id, 'TRANSPORT', (p->>'transport')::numeric, coalesce(nullif(p->>'salary_from', '')::date, e.hire_date), null); end if;
  return e;
end $$;

create or replace function app.set_pay_item(p_employee uuid, p_code text, p_amount numeric, p_from date, p_note text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if p_amount < 0 then raise exception 'amount cannot be negative' using errcode = '22023'; end if;
  if exists (select 1 from public.payroll_runs r join public.employees e on e.branch_id = r.branch_id
             where e.id = p_employee and r.status in ('approved', 'paid') and r.period >= date_trunc('month', p_from)::date) then
    raise exception 'a salary change cannot start inside a payroll month that is already approved' using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_pay_items where employee_id = p_employee and component_code = p_code and lower(effective) >= p_from) then
    raise exception 'a newer % amount already exists; change it from a later date', p_code using errcode = '22023';
  end if;
  update public.employee_pay_items set effective = daterange(lower(effective), p_from)
  where employee_id = p_employee and component_code = p_code and effective @> p_from;
  insert into public.employee_pay_items (employee_id, component_code, amount, effective, note)
  values (p_employee, p_code, round(p_amount, 2), daterange(p_from, null), p_note);
end $$;

create or replace function public.end_employment(p_employee uuid, p_end date, p_reason text)
returns public.employees language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees;
begin
  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('hr.manage', e.branch_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if p_end < e.hire_date then raise exception 'end date is before the hire date' using errcode = '22023'; end if;
  update public.employees set end_date = p_end, end_reason = trim(p_reason), status = 'terminated', updated_at = now() where id = e.id returning * into e;
  perform app.compute_attendance_range(e.id, p_end + 1, app.cairo_today());
  return e;
end $$;

create or replace function public.save_shift(p jsonb)
returns public.shifts language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.shifts; v_id uuid := nullif(p->>'id', '')::uuid; v_branch uuid;
begin
  v_branch := coalesce((select branch_id from public.shifts where id = v_id), (p->>'branch_id')::uuid);
  perform app.require_permission('hr.manage', v_branch);
  if nullif(p->>'start_time', '') is null or nullif(p->>'end_time', '') is null then raise exception 'start and end times are required' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.shifts (branch_id, code, name_ar, name_en, start_time, end_time, break_minutes, grace_minutes, weekdays)
    values (v_branch, trim(p->>'code'), trim(p->>'name_ar'), nullif(trim(p->>'name_en'), ''), (p->>'start_time')::time, (p->>'end_time')::time,
            coalesce(nullif(p->>'break_minutes', '')::int, 0), coalesce(nullif(p->>'grace_minutes', '')::int, 0),
            coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), '{0,1,2,3,4,6}'))
    returning * into s;
  else
    update public.shifts set name_ar = coalesce(nullif(trim(p->>'name_ar'), ''), name_ar), name_en = coalesce(nullif(trim(p->>'name_en'), ''), name_en),
      start_time = (p->>'start_time')::time, end_time = (p->>'end_time')::time,
      break_minutes = coalesce(nullif(p->>'break_minutes', '')::int, break_minutes), grace_minutes = coalesce(nullif(p->>'grace_minutes', '')::int, grace_minutes),
      weekdays = coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), weekdays),
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id returning * into s;
  end if;
  return s;
end $$;

create or replace function public.set_roster(p_employee uuid, p_day date, p_shift uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees;
begin
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('hr.manage', e.branch_id);
  if app.payroll_locked(p_employee, p_day) then raise exception 'that month''s payroll is already approved' using errcode = '22023'; end if;
  if p_shift is not null and not exists (select 1 from public.shifts where id = p_shift and branch_id = e.branch_id) then
    raise exception 'shift belongs to another branch' using errcode = '22023';
  end if;
  insert into public.shift_roster (employee_id, day, shift_id, note) values (p_employee, p_day, p_shift, nullif(trim(p_note), ''))
  on conflict (employee_id, day) do update set shift_id = excluded.shift_id, note = excluded.note;
  perform app.compute_attendance_day(p_employee, p_day);
end $$;

-- ---------------------------------------------------------------------------
-- Attendance RPCs
-- ---------------------------------------------------------------------------
-- Punches from a biometric export file or a device push. Duplicates ignored; unknown ids kept for matching later.
create or replace function app.import_punches(p_branch uuid, p_rows jsonb, p_source text, p_batch text, p_device uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_at timestamptz; v_bio text; v_emp uuid; v_ins int := 0; v_dup int := 0; v_unmatched int := 0; v_bad int := 0; n int; x record;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then raise exception 'send 1 to 20,000 punches at a time' using errcode = '22023'; end if;
  create temp table if not exists tmp_touched (employee_id uuid, day date) on commit drop;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_bio := nullif(trim(r->>'biometric_id'), '');
    begin
      v_at := case when (r->>'at') ~ '(Z|[+-]\d\d(:?\d\d)?)$' then (r->>'at')::timestamptz else ((r->>'at')::timestamp at time zone 'Africa/Cairo') end;
    exception when others then v_at := null;
    end;
    if v_bio is null or v_at is null or v_at > now() + interval '10 minutes' or v_at < now() - interval '400 days' then v_bad := v_bad + 1; continue; end if;
    select id into v_emp from public.employees where branch_id = p_branch and biometric_id = v_bio;
    insert into public.attendance_punches (branch_id, employee_id, biometric_id, punched_at, source, device_id, import_batch)
    values (p_branch, v_emp, v_bio, v_at, p_source, p_device, p_batch)
    on conflict (branch_id, biometric_id, punched_at) do nothing;
    get diagnostics n = row_count;
    if n = 0 then v_dup := v_dup + 1; continue; end if;
    v_ins := v_ins + 1;
    if v_emp is null then v_unmatched := v_unmatched + 1;
    else insert into tmp_touched values (v_emp, (v_at at time zone 'Africa/Cairo')::date), (v_emp, (v_at at time zone 'Africa/Cairo')::date - 1);
    end if;
  end loop;
  for x in select distinct employee_id, day from tmp_touched loop
    if not app.payroll_locked(x.employee_id, x.day) then perform app.compute_attendance_day(x.employee_id, x.day); end if;
  end loop;
  delete from tmp_touched;
  return jsonb_build_object('inserted', v_ins, 'duplicates', v_dup, 'unmatched', v_unmatched, 'rejected', v_bad);
end $$;

create or replace function public.import_attendance(p_branch uuid, p_rows jsonb, p_batch text)
returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('attendance.manage', p_branch);
  return app.import_punches(p_branch, p_rows, 'import', left(coalesce(nullif(trim(p_batch), ''), 'import'), 80), null);
end $$;

-- Device push (ZKTeco-style "ADMS"): only registered, active devices; the branch comes from the device.
create or replace function app.device_punches(p_serial text, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.attendance_devices;
begin
  select * into d from public.attendance_devices where serial_no = p_serial and is_active for update;
  if not found then raise exception 'unknown attendance device' using errcode = '42501'; end if;
  update public.attendance_devices set last_seen_at = now() where id = d.id;
  return app.import_punches(d.branch_id, p_rows, 'device', 'device:' || d.serial_no, d.id);
end $$;

create or replace function public.save_attendance_device(p_branch uuid, p_serial text, p_name text, p_active boolean default true)
returns public.attendance_devices language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.attendance_devices;
begin
  perform app.require_permission('hr.manage', p_branch);
  if coalesce(trim(p_serial), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'serial number and name are required' using errcode = '22023'; end if;
  insert into public.attendance_devices (branch_id, serial_no, name, is_active) values (p_branch, trim(p_serial), trim(p_name), coalesce(p_active, true))
  on conflict (serial_no) do update set name = excluded.name, is_active = excluded.is_active
  where public.attendance_devices.branch_id = p_branch
  returning * into d;
  if d.id is null then raise exception 'this device is registered to another branch' using errcode = '23505'; end if;
  return d;
end $$;

create or replace function public.add_manual_punch(p_employee uuid, p_at timestamptz, p_reason text)
returns public.attendance_punches language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees; r public.attendance_punches;
begin
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('attendance.manage', e.branch_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if p_at > now() then raise exception 'a punch cannot be in the future' using errcode = '22023'; end if;
  if app.payroll_locked(p_employee, (p_at at time zone 'Africa/Cairo')::date) then raise exception 'that month''s payroll is already approved' using errcode = '22023'; end if;
  insert into public.attendance_punches (branch_id, employee_id, biometric_id, punched_at, source, status, reason)
  values (e.branch_id, e.id, coalesce(e.biometric_id, e.employee_no), p_at, 'manual', 'pending', trim(p_reason))
  returning * into r;
  return r;
end $$;

create or replace function public.decide_manual_punch(p_punch uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.attendance_punches;
begin
  select * into r from public.attendance_punches where id = p_punch for update;
  if not found or r.source <> 'manual' then raise exception 'punch not found' using errcode = 'P0002'; end if;
  perform app.require_permission('attendance.approve', r.branch_id);
  if r.status <> 'pending' then raise exception 'punch already decided' using errcode = '22023'; end if;
  if r.created_by = auth.uid() then raise exception 'separation of duties: you cannot approve a punch you entered' using errcode = '42501'; end if;
  if r.employee_id = app.my_employee_id() then raise exception 'separation of duties: you cannot approve your own attendance' using errcode = '42501'; end if;
  update public.attendance_punches set status = case when p_approve then 'valid' else 'rejected' end, decided_by = auth.uid(), decided_at = now() where id = r.id;
  perform app.compute_attendance_day(r.employee_id, (r.punched_at at time zone 'Africa/Cairo')::date);
  perform app.compute_attendance_day(r.employee_id, (r.punched_at at time zone 'Africa/Cairo')::date - 1);
end $$;

create or replace function public.approve_overtime(p_employee uuid, p_day date, p_minutes int)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees; a public.attendance_days;
begin
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('attendance.approve', e.branch_id);
  if p_employee = app.my_employee_id() then raise exception 'separation of duties: you cannot approve your own attendance' using errcode = '42501'; end if;
  if app.payroll_locked(p_employee, p_day) then raise exception 'that month''s payroll is already approved' using errcode = '22023'; end if;
  select * into a from public.attendance_days where employee_id = p_employee and day = p_day;
  if not found then raise exception 'no attendance on that day' using errcode = 'P0002'; end if;
  if p_minutes < 0 or p_minutes > a.overtime_minutes then raise exception 'approved overtime must be between 0 and % minutes', a.overtime_minutes using errcode = '22023'; end if;
  perform set_config('app.payroll_rpc', 'on', true);
  update public.attendance_days set overtime_approved_minutes = p_minutes where employee_id = p_employee and day = p_day;
end $$;

create or replace function public.recompute_attendance(p_branch uuid, p_from date, p_to date)
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e record; n int := 0;
begin
  perform app.require_permission('attendance.manage', p_branch);
  if p_to < p_from or p_to - p_from > 62 then raise exception 'choose up to two months' using errcode = '22023'; end if;
  for e in select id from public.employees where branch_id = p_branch loop
    n := n + (select count(*) from generate_series(p_from, least(p_to, app.cairo_today()), interval '1 day') g
              where not app.payroll_locked(e.id, g::date) and app.compute_attendance_day(e.id, g::date) is null);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------
create or replace function app.leave_entitlement(p_employee uuid, p_type text)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when p_type = 'ANNUAL' then coalesce(e.annual_leave_days, t.annual_days) else t.annual_days end
  from public.employees e, public.leave_types t where e.id = p_employee and t.code = p_type
$$;

create or replace function app.leave_used(p_employee uuid, p_type text, p_year int)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(sum(days), 0) from public.leave_requests
  where employee_id = p_employee and leave_type = p_type and status in ('approved', 'requested') and extract(year from from_date) = p_year
$$;

create or replace function public.request_leave(p_type text, p_from date, p_to date, p_reason text default null, p_employee uuid default null)
returns public.leave_requests language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees; t public.leave_types; v_days numeric; v_ent numeric; r public.leave_requests;
begin
  select * into e from public.employees where id = coalesce(p_employee, app.my_employee_id());
  if not found then raise exception 'no employee file for this account' using errcode = 'P0002'; end if;
  if e.id <> coalesce(app.my_employee_id(), '00000000-0000-0000-0000-000000000000'::uuid) then perform app.require_permission('hr.manage', e.branch_id); end if;
  if e.status <> 'active' then raise exception 'employee is not active' using errcode = '22023'; end if;
  select * into t from public.leave_types where code = p_type and is_active;
  if not found then raise exception 'unknown leave type' using errcode = '22023'; end if;
  if p_to < p_from then raise exception 'the end date is before the start date' using errcode = '22023'; end if;
  if extract(year from p_from) <> extract(year from p_to) then raise exception 'split leave that crosses the new year into two requests' using errcode = '22023'; end if;
  if t.requires_note and coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if exists (select 1 from public.leave_requests where employee_id = e.id and status in ('requested', 'approved') and daterange(from_date, to_date, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'overlaps another leave request' using errcode = '22023';
  end if;
  v_days := app.working_days(e.id, p_from, p_to);
  if v_days = 0 then raise exception 'no working days in that range' using errcode = '22023'; end if;
  v_ent := app.leave_entitlement(e.id, p_type);
  if v_ent is not null and app.leave_used(e.id, p_type, extract(year from p_from)::int) + v_days > v_ent then
    raise exception 'not enough % balance (% days left)', lower(p_type), v_ent - app.leave_used(e.id, p_type, extract(year from p_from)::int) using errcode = '22023';
  end if;
  insert into public.leave_requests (employee_id, leave_type, from_date, to_date, days, reason)
  values (e.id, p_type, p_from, p_to, v_days, nullif(trim(p_reason), '')) returning * into r;
  return r;
end $$;

create or replace function public.decide_leave(p_request uuid, p_approve boolean, p_note text default null)
returns public.leave_requests language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.leave_requests; e public.employees;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if not found then raise exception 'leave request not found' using errcode = 'P0002'; end if;
  select * into e from public.employees where id = r.employee_id;
  perform app.require_permission('leave.approve', e.branch_id);
  if r.status <> 'requested' then raise exception 'leave request already %', r.status using errcode = '22023'; end if;
  if r.employee_id = app.my_employee_id() or r.requested_by = auth.uid() then
    raise exception 'separation of duties: you cannot decide your own leave request' using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
  if p_approve and exists (select 1 from generate_series(r.from_date, r.to_date, interval '1 day') g where app.payroll_locked(r.employee_id, g::date)) then
    raise exception 'that month''s payroll is already approved' using errcode = '22023';
  end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(trim(p_note), '') where id = r.id returning * into r;
  if p_approve then perform app.compute_attendance_range(r.employee_id, r.from_date, r.to_date); end if;
  return r;
end $$;

create or replace function public.cancel_leave(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.leave_requests; e public.employees;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if not found then raise exception 'leave request not found' using errcode = 'P0002'; end if;
  select * into e from public.employees where id = r.employee_id;
  if r.status = 'requested' and (r.employee_id = app.my_employee_id() or r.requested_by = auth.uid()) then
    null;
  else
    perform app.require_permission('hr.manage', e.branch_id);
    if r.status not in ('requested', 'approved') then raise exception 'leave request already %', r.status using errcode = '22023'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from generate_series(r.from_date, r.to_date, interval '1 day') g where app.payroll_locked(r.employee_id, g::date)) then
    raise exception 'that month''s payroll is already approved' using errcode = '22023';
  end if;
  update public.leave_requests set status = 'cancelled', decision_note = coalesce(nullif(trim(p_reason), ''), decision_note), decided_at = now(),
    decided_by = auth.uid() where id = r.id;
  perform app.compute_attendance_range(r.employee_id, r.from_date, r.to_date);
end $$;

create or replace function public.my_leave_balances(p_employee uuid default null)
returns table (leave_type text, name_ar text, name_en text, paid boolean, entitled numeric, used numeric, remaining numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_emp uuid := coalesce(p_employee, app.my_employee_id()); e public.employees;
begin
  select * into e from public.employees where id = v_emp;
  if not found then return; end if;
  if v_emp is distinct from app.my_employee_id() and not app.has_permission('hr.read', e.branch_id) then
    raise exception 'permission denied: hr.read' using errcode = '42501';
  end if;
  return query select t.code, t.name_ar, t.name_en, t.paid, app.leave_entitlement(v_emp, t.code),
    app.leave_used(v_emp, t.code, extract(year from app.cairo_today())::int),
    app.leave_entitlement(v_emp, t.code) - app.leave_used(v_emp, t.code, extract(year from app.cairo_today())::int)
  from public.leave_types t where t.is_active order by t.code;
end $$;

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------
create or replace function public.request_loan(p_employee uuid, p_amount numeric, p_installments int, p_start date, p_reason text)
returns public.employee_loans language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees; l public.employee_loans;
begin
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payroll.prepare', e.branch_id);
  if e.status <> 'active' then raise exception 'employee is not active' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  insert into public.employee_loans (employee_id, amount, installments, start_period, reason)
  values (e.id, round(p_amount, 2), p_installments, date_trunc('month', p_start)::date, trim(p_reason)) returning * into l;
  return l;
end $$;

create or replace function public.decide_loan(p_loan uuid, p_approve boolean, p_note text default null)
returns public.employee_loans language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.employee_loans; e public.employees;
begin
  select * into l from public.employee_loans where id = p_loan for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  select * into e from public.employees where id = l.employee_id;
  perform app.require_permission('payroll.approve', e.branch_id);
  if l.status <> 'requested' then raise exception 'loan already %', l.status using errcode = '22023'; end if;
  if l.requested_by = auth.uid() or l.employee_id = app.my_employee_id() then raise exception 'separation of duties: you cannot approve a loan you requested or your own' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
  update public.employee_loans set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now()
  where id = l.id returning * into l;
  return l;
end $$;

create or replace function public.disburse_loan(p_loan uuid, p_method text, p_reference text)
returns public.employee_loans language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.employee_loans; e public.employees; v_org uuid; v_je uuid;
begin
  select * into l from public.employee_loans where id = p_loan for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  select * into e from public.employees where id = l.employee_id;
  perform app.require_permission('payroll.pay', e.branch_id);
  if l.status <> 'approved' then raise exception 'only an approved loan can be paid out' using errcode = '22023'; end if;
  if l.approved_by = auth.uid() then raise exception 'separation of duties: you cannot pay out a loan you approved' using errcode = '42501'; end if;
  if p_method not in ('bank_transfer', 'cash') then raise exception 'method must be bank transfer or cash' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment reference is required' using errcode = '22023'; end if;
  select organization_id into v_org from public.branches where id = e.branch_id;
  v_je := app.post_journal(v_org, e.branch_id, app.cairo_today(), 'Employee loan ' || l.ref, 'employee_loan', l.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'employee_advances'), 'debit', l.amount, 'memo', e.employee_no),
      jsonb_build_object('account_id', app.account_for(v_org, case when p_method = 'cash' then 'cash_on_hand' else 'bank_main' end), 'credit', l.amount, 'memo', trim(p_reference))));
  update public.employee_loans set status = 'disbursed', disbursed_by = auth.uid(), disbursed_at = now(), method = p_method, reference = trim(p_reference),
    journal_entry_id = v_je where id = l.id returning * into l;
  return l;
end $$;

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
create or replace function public.save_payroll_component(p_code text, p jsonb)
returns public.payroll_components language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.payroll_components;
begin
  perform app.require_permission('payroll.settings');
  update public.payroll_components set
    rate = case when p ? 'rate' then nullif(p->>'rate', '')::numeric else rate end,
    is_active = coalesce((p->>'is_active')::boolean, is_active),
    name_ar = coalesce(nullif(trim(p->>'name_ar'), ''), name_ar), name_en = coalesce(nullif(trim(p->>'name_en'), ''), name_en),
    updated_by = auth.uid(), updated_at = now()
  where code = p_code returning * into c;
  if not found then raise exception 'payroll component not found' using errcode = 'P0002'; end if;
  if c.code = 'BASIC' and not c.is_active then raise exception 'the basic salary cannot be switched off' using errcode = '22023'; end if;
  return c;
end $$;

create or replace function public.save_payroll_setting(p_key text, p_value numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('payroll.settings');
  if p_value is not null and p_value < 0 then raise exception 'value cannot be negative' using errcode = '22023'; end if;
  if p_key in ('day_divisor', 'hours_per_day') and (p_value is null or p_value = 0) then raise exception '% must be above zero', p_key using errcode = '22023'; end if;
  update public.payroll_settings set value = p_value, note = coalesce(nullif(trim(p_note), ''), note), updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'unknown payroll setting' using errcode = 'P0002'; end if;
end $$;

-- Replaces the income-tax table from a date. p_rows: [{from, to, rate}] contiguous from 0.
create or replace function public.save_tax_brackets(p_effective date, p_rows jsonb)
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_prev numeric := 0; n int := 0;
begin
  perform app.require_permission('payroll.settings');
  if exists (select 1 from public.payroll_runs where status in ('approved', 'paid') and period >= date_trunc('month', p_effective)::date) then
    raise exception 'tax brackets cannot change inside a payroll month that is already approved' using errcode = '22023';
  end if;
  delete from public.payroll_tax_brackets where effective_from = p_effective;
  for r in select * from jsonb_array_elements(p_rows) order by (value->>'from')::numeric loop
    if (r->>'from')::numeric <> v_prev then raise exception 'brackets must start at 0 and follow each other without gaps' using errcode = '22023'; end if;
    insert into public.payroll_tax_brackets (effective_from, from_amount, to_amount, rate)
    values (p_effective, (r->>'from')::numeric, nullif(r->>'to', '')::numeric, (r->>'rate')::numeric);
    v_prev := coalesce(nullif(r->>'to', '')::numeric, -1); n := n + 1;
  end loop;
  if n > 0 and v_prev <> -1 then raise exception 'the last bracket must be open-ended' using errcode = '22023'; end if;
  return n;
end $$;

create or replace function public.save_payroll_adjustment(p_employee uuid, p_period date, p_code text, p_amount numeric, p_reason text)
returns public.payroll_adjustments language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.employees; a public.payroll_adjustments;
begin
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payroll.prepare', e.branch_id);
  if not exists (select 1 from public.payroll_components where code = p_code and calc = 'manual' and is_active) then
    raise exception 'choose a bonus or penalty component' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_runs where branch_id = e.branch_id and period = date_trunc('month', p_period)::date and status <> 'cancelled') then
    raise exception 'that month''s payroll is already prepared; cancel it first or use next month' using errcode = '22023';
  end if;
  insert into public.payroll_adjustments (employee_id, period, component_code, amount, reason)
  values (e.id, date_trunc('month', p_period)::date, p_code, round(p_amount, 2), trim(p_reason)) returning * into a;
  return a;
end $$;

-- Progressive monthly tax on an annualised base (brackets in force at the period).
create or replace function app.monthly_income_tax(p_monthly_base numeric, p_period date)
returns numeric language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_eff date; v_annual numeric; v_tax numeric := 0; b record;
begin
  select max(effective_from) into v_eff from public.payroll_tax_brackets where effective_from <= p_period + interval '1 month - 1 day';
  if v_eff is null then return null; end if;
  v_annual := greatest(0, p_monthly_base * 12 - coalesce(app.payroll_setting('tax_personal_exemption'), 0));
  for b in select * from public.payroll_tax_brackets where effective_from = v_eff order by from_amount loop
    exit when v_annual <= b.from_amount;
    v_tax := v_tax + (least(v_annual, coalesce(b.to_amount, v_annual)) - b.from_amount) * b.rate / 100;
  end loop;
  return round(v_tax / 12, 2);
end $$;

create or replace function public.prepare_payroll(p_branch uuid, p_period date)
returns public.payroll_runs language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_period date := date_trunc('month', p_period)::date; v_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
        v_days int; run public.payroll_runs; e record; c record; v_missing text[] := '{}'; v_warn jsonb := '[]'::jsonb;
        v_div numeric := app.payroll_setting('day_divisor'); v_hours numeric := app.payroll_setting('hours_per_day');
        v_imin numeric := app.payroll_setting('insured_wage_min'); v_imax numeric := app.payroll_setting('insured_wage_max');
        v_from date; v_to date; v_emp_days int; v_factor numeric; v_basic_full numeric; v_daily numeric; v_minute numeric; v_amt numeric;
        v_earn numeric; v_ded numeric; v_taxbase numeric; v_si numeric; v_insured numeric; v_net numeric; v_emp numeric; l record; v_rem numeric;
        v_abs int; v_unpaid numeric; v_late int; v_ot int; v_worked int; v_tax numeric; v_n int := 0;
        r_si_e numeric; r_si_r numeric; r_ot numeric; r_late numeric;
begin
  perform app.require_permission('payroll.prepare', p_branch);
  if v_period > date_trunc('month', app.cairo_today())::date then raise exception 'cannot prepare a future month' using errcode = '22023'; end if;
  if exists (select 1 from public.payroll_runs where branch_id = p_branch and period = v_period and status <> 'cancelled') then
    raise exception 'payroll for this month is already prepared' using errcode = '23505';
  end if;
  -- Setup checks: every active component that needs a rate has one.
  select rate into r_si_e from public.payroll_components where code = 'SI_EMPLOYEE' and is_active;
  select rate into r_si_r from public.payroll_components where code = 'SI_EMPLOYER' and is_active;
  select rate into r_ot from public.payroll_components where code = 'OVERTIME' and is_active;
  select rate into r_late from public.payroll_components where code = 'LATE' and is_active;
  for c in select * from public.payroll_components where is_active and calc in ('insurance_employee', 'insurance_employer', 'attendance_overtime', 'attendance_late') and rate is null loop
    v_missing := v_missing || (c.code || ' rate');
  end loop;
  if exists (select 1 from public.payroll_components where code = 'INCOME_TAX' and is_active)
     and not exists (select 1 from public.payroll_tax_brackets where effective_from <= v_end) then v_missing := v_missing || 'income tax brackets'::text; end if;
  if v_div is null or v_hours is null then v_missing := v_missing || 'day divisor / hours per day'::text; end if;
  if exists (select 1 from public.payroll_components where is_active and calc like 'insurance%') then
    select v_missing || coalesce(array_agg('insured wage of ' || x.employee_no), '{}') into v_missing from public.employees x
    where x.branch_id = p_branch and x.payroll_eligible and x.hire_date <= v_end and (x.end_date is null or x.end_date >= v_period) and x.insured_wage is null;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'payroll setup incomplete: %', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;

  perform set_config('app.payroll_rpc', 'on', true);
  v_days := extract(day from v_end)::int;
  insert into public.payroll_runs (branch_id, period) values (p_branch, v_period) returning * into run;

  for e in select * from public.employees x where x.branch_id = p_branch and x.payroll_eligible and x.hire_date <= v_end
             and (x.end_date is null or x.end_date >= v_period) order by x.employee_no loop
    v_from := greatest(v_period, e.hire_date); v_to := least(v_end, coalesce(e.end_date, v_end));
    perform app.compute_attendance_range(e.id, v_from, v_to);
    v_emp_days := v_to - v_from + 1;
    v_factor := v_emp_days::numeric / v_days;
    v_earn := 0; v_ded := 0; v_taxbase := 0; v_emp := 0;
    select amount into v_basic_full from public.employee_pay_items where employee_id = e.id and component_code = 'BASIC' and effective @> v_to;
    if v_basic_full is null then
      v_warn := v_warn || jsonb_build_object('employee', e.employee_no, 'issue', 'no basic salary');
      continue;
    end if;
    v_daily := v_basic_full / v_div; v_minute := v_daily / v_hours / 60;

    -- Fixed earnings (pro-rated for a partial month)
    for c in select pc.*, pi.amount from public.payroll_components pc join public.employee_pay_items pi on pi.component_code = pc.code
             where pc.is_active and pc.calc = 'fixed' and pi.employee_id = e.id and pi.effective @> v_to order by pc.sort loop
      v_amt := round(c.amount * v_factor, 2);
      if v_amt > 0 then
        insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount, note)
        values (run.id, e.id, c.code, 'earning', v_emp_days, c.amount, v_amt, case when v_emp_days < v_days then v_emp_days || '/' || v_days || ' days' end);
        v_earn := v_earn + v_amt; if c.taxable then v_taxbase := v_taxbase + v_amt; end if;
      end if;
    end loop;

    select count(*) filter (where status = 'absent'), coalesce(sum(1) filter (where status = 'unpaid_leave'), 0),
           coalesce(sum(late_minutes) filter (where status = 'late'), 0), coalesce(sum(overtime_approved_minutes), 0),
           count(*) filter (where status in ('present', 'late', 'incomplete'))
      into v_abs, v_unpaid, v_late, v_ot, v_worked
    from public.attendance_days where employee_id = e.id and day between v_from and v_to;
    if exists (select 1 from public.attendance_days where employee_id = e.id and day between v_from and v_to and status = 'incomplete') then
      v_warn := v_warn || jsonb_build_object('employee', e.employee_no, 'issue', 'days with a single punch');
    end if;

    if r_ot is not null and v_ot > 0 then
      v_amt := round(v_ot * v_minute * r_ot, 2);
      insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount) values (run.id, e.id, 'OVERTIME', 'earning', v_ot, round(v_minute * r_ot, 4), v_amt);
      v_earn := v_earn + v_amt; v_taxbase := v_taxbase + v_amt;
    end if;
    for c in select a.*, pc.kind, pc.taxable from public.payroll_adjustments a join public.payroll_components pc on pc.code = a.component_code
             where a.employee_id = e.id and a.period = v_period and a.status = 'active' and pc.is_active loop
      insert into public.payroll_lines (run_id, employee_id, component_code, kind, amount, note) values (run.id, e.id, c.component_code, c.kind, c.amount, c.reason);
      if c.kind = 'earning' then v_earn := v_earn + c.amount; if c.taxable then v_taxbase := v_taxbase + c.amount; end if;
      else v_ded := v_ded + c.amount; v_taxbase := v_taxbase - c.amount; end if;
    end loop;
    if v_abs > 0 and exists (select 1 from public.payroll_components where code = 'ABSENCE' and is_active) then
      v_amt := round(v_abs * v_daily, 2);
      insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount) values (run.id, e.id, 'ABSENCE', 'deduction', v_abs, round(v_daily, 4), v_amt);
      v_ded := v_ded + v_amt; v_taxbase := v_taxbase - v_amt;
    end if;
    if v_unpaid > 0 and exists (select 1 from public.payroll_components where code = 'UNPAID_LEAVE' and is_active) then
      v_amt := round(v_unpaid * v_daily, 2);
      insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount) values (run.id, e.id, 'UNPAID_LEAVE', 'deduction', v_unpaid, round(v_daily, 4), v_amt);
      v_ded := v_ded + v_amt; v_taxbase := v_taxbase - v_amt;
    end if;
    if r_late is not null and v_late > 0 then
      v_amt := round(v_late * v_minute * r_late, 2);
      if v_amt > 0 then
        insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount) values (run.id, e.id, 'LATE', 'deduction', v_late, round(v_minute * r_late, 4), v_amt);
        v_ded := v_ded + v_amt; v_taxbase := v_taxbase - v_amt;
      end if;
    end if;
    -- Social insurance on the declared insured wage (within the legal minimum / maximum when set)
    v_insured := e.insured_wage;
    if v_insured is not null then
      if v_imin is not null then v_insured := greatest(v_insured, v_imin); end if;
      if v_imax is not null then v_insured := least(v_insured, v_imax); end if;
    end if;
    if r_si_e is not null and v_insured > 0 then
      v_si := round(v_insured * r_si_e / 100, 2);
      insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount) values (run.id, e.id, 'SI_EMPLOYEE', 'deduction', v_insured, r_si_e, v_si);
      v_ded := v_ded + v_si; v_taxbase := v_taxbase - v_si;
    end if;
    if exists (select 1 from public.payroll_components where code = 'INCOME_TAX' and is_active) then
      v_tax := app.monthly_income_tax(greatest(v_taxbase, 0), v_period);
      if v_tax > 0 then
        insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, amount) values (run.id, e.id, 'INCOME_TAX', 'deduction', round(greatest(v_taxbase, 0), 2), v_tax);
        v_ded := v_ded + v_tax;
      end if;
    end if;
    -- Loan installments last, never more than what is left of the salary
    for l in select * from public.employee_loans where employee_id = e.id and status = 'disbursed' and start_period <= v_period order by created_at loop
      v_rem := l.amount - l.repaid;
      v_amt := least(round(l.amount / l.installments, 2), v_rem, greatest(v_earn - v_ded, 0));
      if v_rem - v_amt < 0.05 then v_amt := least(v_rem, greatest(v_earn - v_ded, 0)); end if;
      if v_amt > 0 then
        insert into public.payroll_lines (run_id, employee_id, component_code, kind, amount, loan_id, note) values (run.id, e.id, 'LOAN', 'deduction', v_amt, l.id, l.ref);
        v_ded := v_ded + v_amt;
      end if;
    end loop;
    if r_si_r is not null and v_insured > 0 then
      v_amt := round(v_insured * r_si_r / 100, 2);
      insert into public.payroll_lines (run_id, employee_id, component_code, kind, quantity, rate, amount) values (run.id, e.id, 'SI_EMPLOYER', 'employer', v_insured, r_si_r, v_amt);
      v_emp := v_emp + v_amt;
    end if;
    v_net := v_earn - v_ded;
    if v_net < 0 then v_warn := v_warn || jsonb_build_object('employee', e.employee_no, 'issue', 'net pay is negative'); end if;
    insert into public.payroll_slips (run_id, employee_id, employed_days, worked_days, absent_days, unpaid_leave_days, late_minutes, overtime_minutes,
                                      earnings, deductions, net, employer)
    values (run.id, e.id, v_emp_days, v_worked, v_abs, v_unpaid, v_late, v_ot, v_earn, v_ded, v_net, v_emp);
    v_n := v_n + 1;
  end loop;

  if exists (select 1 from public.attendance_punches p join public.employees x on x.id = p.employee_id
             where x.branch_id = p_branch and p.status = 'pending' and p.punched_at < (v_end + 1)::timestamp at time zone 'Africa/Cairo') then
    v_warn := v_warn || jsonb_build_object('issue', 'manual punches waiting for approval');
  end if;
  if exists (select 1 from public.attendance_punches where branch_id = p_branch and employee_id is null
             and punched_at between (v_period::timestamp at time zone 'Africa/Cairo') and ((v_end + 1)::timestamp at time zone 'Africa/Cairo')) then
    v_warn := v_warn || jsonb_build_object('issue', 'punches from unknown biometric ids');
  end if;
  update public.payroll_runs set employees = v_n,
    total_earnings = coalesce((select sum(earnings) from public.payroll_slips where run_id = run.id), 0),
    total_deductions = coalesce((select sum(deductions) from public.payroll_slips where run_id = run.id), 0),
    total_net = coalesce((select sum(net) from public.payroll_slips where run_id = run.id), 0),
    total_employer = coalesce((select sum(employer) from public.payroll_slips where run_id = run.id), 0),
    warnings = v_warn
  where id = run.id returning * into run;
  return run;
end $$;

create or replace function public.approve_payroll(p_run uuid)
returns public.payroll_runs language plpgsql security definer set search_path = public, app, pg_temp as $$
declare run public.payroll_runs; v_org uuid; v_lines jsonb := '[]'::jsonb; c record; l record;
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payroll.approve', run.branch_id);
  if run.status <> 'prepared' then raise exception 'payroll run already %', run.status using errcode = '22023'; end if;
  if run.prepared_by = auth.uid() then raise exception 'separation of duties: you cannot approve a payroll you prepared' using errcode = '42501'; end if;
  if exists (select 1 from public.payroll_slips where run_id = run.id and net < 0) then raise exception 'a payslip has a negative net pay; fix and prepare again' using errcode = '22023'; end if;
  if exists (select 1 from public.payroll_slips s join public.employees e on e.id = s.employee_id where s.run_id = run.id and e.id = app.my_employee_id()) then
    raise exception 'separation of duties: you cannot approve a payroll that includes your own salary' using errcode = '42501';
  end if;
  select organization_id into v_org from public.branches where id = run.branch_id;
  -- One line per component and account: earnings debit, deductions credit, employer contributions both sides.
  for c in select pl.kind, pc.account_key, pl.component_code, sum(pl.amount) amt from public.payroll_lines pl
           join public.payroll_components pc on pc.code = pl.component_code where pl.run_id = run.id group by 1, 2, 3 order by 1, 3 loop
    if c.kind = 'earning' then
      v_lines := v_lines || jsonb_build_object('account_id', app.account_for(v_org, c.account_key), 'debit', c.amt, 'memo', c.component_code);
    elsif c.kind = 'deduction' then
      v_lines := v_lines || jsonb_build_object('account_id', app.account_for(v_org, c.account_key), 'credit', c.amt, 'memo', c.component_code);
    else
      v_lines := v_lines || jsonb_build_object('account_id', app.account_for(v_org, 'employer_insurance_expense'), 'debit', c.amt, 'memo', c.component_code)
                         || jsonb_build_object('account_id', app.account_for(v_org, c.account_key), 'credit', c.amt, 'memo', c.component_code);
    end if;
  end loop;
  v_lines := v_lines || jsonb_build_object('account_id', app.account_for(v_org, 'salaries_payable'), 'credit', run.total_net, 'memo', run.ref);
  perform set_config('app.payroll_rpc', 'on', true);
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    accrual_entry_id = app.post_journal(v_org, run.branch_id, (run.period + interval '1 month - 1 day')::date, 'Payroll ' || run.ref || ' ' || to_char(run.period, 'YYYY-MM'),
                                        'payroll_run', run.id, v_lines)
  where id = run.id returning * into run;
  for l in select loan_id, sum(amount) amt from public.payroll_lines where run_id = run.id and loan_id is not null group by loan_id loop
    update public.employee_loans set repaid = repaid + l.amt, status = case when repaid + l.amt >= amount then 'settled' else status end where id = l.loan_id;
  end loop;
  return run;
end $$;

create or replace function public.pay_payroll(p_run uuid, p_method text, p_reference text)
returns public.payroll_runs language plpgsql security definer set search_path = public, app, pg_temp as $$
declare run public.payroll_runs; v_org uuid;
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payroll.pay', run.branch_id);
  if run.status <> 'approved' then raise exception 'only an approved payroll can be paid' using errcode = '22023'; end if;
  if run.approved_by = auth.uid() or run.prepared_by = auth.uid() then
    raise exception 'separation of duties: the payer must be different from who prepared and approved' using errcode = '42501';
  end if;
  if p_method not in ('bank_transfer', 'cash') then raise exception 'method must be bank transfer or cash' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment reference is required' using errcode = '22023'; end if;
  select organization_id into v_org from public.branches where id = run.branch_id;
  update public.payroll_runs set status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_method = p_method, payment_reference = trim(p_reference),
    payment_entry_id = app.post_journal(v_org, run.branch_id, app.cairo_today(), 'Payroll payment ' || run.ref, 'payroll_payment', run.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'salaries_payable'), 'debit', run.total_net, 'memo', run.ref),
        jsonb_build_object('account_id', app.account_for(v_org, case when p_method = 'cash' then 'cash_on_hand' else 'bank_main' end), 'credit', run.total_net, 'memo', trim(p_reference))))
  where id = run.id returning * into run;
  return run;
end $$;

-- Before payment: a prepared run is simply cancelled; an approved one is reversed (journal and loan repayments).
create or replace function public.cancel_payroll(p_run uuid, p_reason text)
returns public.payroll_runs language plpgsql security definer set search_path = public, app, pg_temp as $$
declare run public.payroll_runs; l record;
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'payroll run not found' using errcode = 'P0002'; end if;
  if run.status = 'prepared' then perform app.require_permission('payroll.prepare', run.branch_id);
  elsif run.status = 'approved' then perform app.require_permission('payroll.approve', run.branch_id);
  else raise exception 'payroll run already %', run.status using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if run.status = 'approved' then
    perform app.reverse_journal(run.accrual_entry_id, 'Payroll cancelled: ' || trim(p_reason), 'payroll_cancel', run.id);
    for l in select loan_id, sum(amount) amt from public.payroll_lines where run_id = run.id and loan_id is not null group by loan_id loop
      update public.employee_loans set repaid = repaid - l.amt, status = 'disbursed' where id = l.loan_id;
    end loop;
  end if;
  update public.payroll_runs set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
  where id = run.id returning * into run;
  return run;
end $$;

create or replace function public.pay_payroll_liability(p_branch uuid, p_kind text, p_period date, p_amount numeric, p_reference text)
returns public.payroll_liability_payments language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_org uuid; r public.payroll_liability_payments; v_key text;
begin
  perform app.require_permission('payroll.pay', p_branch);
  if p_kind not in ('social_insurance', 'payroll_tax') then raise exception 'unknown liability' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment reference is required' using errcode = '22023'; end if;
  v_key := case p_kind when 'social_insurance' then 'social_insurance_payable' else 'payroll_tax_payable' end;
  select organization_id into v_org from public.branches where id = p_branch;
  insert into public.payroll_liability_payments (branch_id, kind, period, amount, reference)
  values (p_branch, p_kind, date_trunc('month', p_period)::date, round(p_amount, 2), trim(p_reference)) returning * into r;
  update public.payroll_liability_payments set journal_entry_id = app.post_journal(v_org, p_branch, app.cairo_today(),
    case p_kind when 'social_insurance' then 'Social insurance payment ' else 'Payroll tax payment ' end || to_char(r.period, 'YYYY-MM'), 'payroll_liability', r.id,
    jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, v_key), 'debit', r.amount, 'memo', r.reference),
                      jsonb_build_object('account_id', app.account_for(v_org, 'bank_main'), 'credit', r.amount, 'memo', r.reference)))
  where id = r.id returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.payroll_components enable row level security;
alter table public.payroll_settings enable row level security;
alter table public.payroll_tax_brackets enable row level security;
alter table public.shifts enable row level security;
alter table public.employees enable row level security;
alter table public.employee_pay_items enable row level security;
alter table public.shift_roster enable row level security;
alter table public.attendance_devices enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.attendance_days enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.employee_loans enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_slips enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_liability_payments enable row level security;

create or replace function app.can_read_employee(p_employee uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select p_employee = app.my_employee_id() or app.has_permission('hr.read', p_branch) or app.has_permission('payroll.read', p_branch)
$$;

create policy payroll_components_read on public.payroll_components for select to authenticated
  using (app.has_permission('payroll.read') or app.has_permission('payroll.settings') or app.has_permission('payroll.prepare') or app.my_employee_id() is not null);
create policy payroll_settings_read on public.payroll_settings for select to authenticated using (app.has_permission('payroll.read') or app.has_permission('payroll.settings'));
create policy tax_brackets_read on public.payroll_tax_brackets for select to authenticated using (app.has_permission('payroll.read') or app.has_permission('payroll.settings'));
create policy shifts_read on public.shifts for select to authenticated
  using (app.has_permission('hr.read', branch_id) or app.has_permission('attendance.manage', branch_id)
         or id = (select shift_id from public.employees where id = app.my_employee_id()));
create policy employees_read on public.employees for select to authenticated using (app.can_read_employee(id, branch_id));
create policy pay_items_read on public.employee_pay_items for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and app.can_read_employee(e.id, e.branch_id)));
create policy roster_read on public.shift_roster for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and app.can_read_employee(e.id, e.branch_id)));
create policy att_devices_read on public.attendance_devices for select to authenticated using (app.has_permission('hr.read', branch_id));
create policy punches_read on public.attendance_punches for select to authenticated
  using (app.has_permission('hr.read', branch_id) or app.has_permission('attendance.manage', branch_id) or employee_id = app.my_employee_id());
create policy att_days_read on public.attendance_days for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and (app.can_read_employee(e.id, e.branch_id) or app.has_permission('attendance.manage', e.branch_id))));
create policy leave_types_read on public.leave_types for select to authenticated using (true);
create policy leave_read on public.leave_requests for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and (app.can_read_employee(e.id, e.branch_id) or app.has_permission('leave.approve', e.branch_id))));
create policy loans_read on public.employee_loans for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and (e.id = app.my_employee_id() or app.has_permission('payroll.read', e.branch_id))));
create policy runs_read on public.payroll_runs for select to authenticated
  using (app.has_permission('payroll.read', branch_id)
         or (status in ('approved', 'paid') and exists (select 1 from public.payroll_slips s where s.run_id = id and s.employee_id = app.my_employee_id())));
-- Payroll staff see every slip; an employee sees their own once the run is approved.
create or replace function app.can_read_slip(p_run uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.payroll_runs r where r.id = p_run and (app.has_permission('payroll.read', r.branch_id)
                 or (p_employee = app.my_employee_id() and r.status in ('approved', 'paid'))))
$$;
create policy slips_read on public.payroll_slips for select to authenticated using (app.can_read_slip(run_id, employee_id));
create policy lines_read on public.payroll_lines for select to authenticated using (app.can_read_slip(run_id, employee_id));
create policy adjustments_read on public.payroll_adjustments for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and app.has_permission('payroll.read', e.branch_id)));
create policy liability_read on public.payroll_liability_payments for select to authenticated using (app.has_permission('payroll.read', branch_id));

grant select on public.payroll_components, public.payroll_settings, public.payroll_tax_brackets, public.shifts, public.employees,
  public.employee_pay_items, public.shift_roster, public.attendance_devices, public.attendance_punches, public.attendance_days, public.leave_types,
  public.leave_requests, public.employee_loans, public.payroll_runs, public.payroll_slips, public.payroll_lines, public.payroll_adjustments,
  public.payroll_liability_payments to authenticated;
grant execute on function app.can_read_employee(uuid, uuid), app.my_employee_id(), app.can_read_slip(uuid, uuid) to authenticated;

create or replace function public.svc_device_punches(p_serial text, p_rows jsonb)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.device_punches(p_serial, p_rows) $$;
revoke execute on function public.svc_device_punches(text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_device_punches(text, jsonb) to service_role;

revoke execute on function app.payroll_setting(text), app.shift_for(uuid, date), app.is_branch_holiday(uuid, date), app.working_days(uuid, date, date),
  app.compute_attendance_day(uuid, date), app.compute_attendance_range(uuid, date, date), app.payroll_locked(uuid, date),
  app.set_pay_item(uuid, text, numeric, date, text), app.import_punches(uuid, jsonb, text, text, uuid), app.device_punches(text, jsonb),
  app.leave_entitlement(uuid, text), app.leave_used(uuid, text, int), app.monthly_income_tax(numeric, date)
  from public, anon, authenticated;

revoke execute on function public.save_attendance_device(uuid, text, text, boolean) from public, anon;
grant execute on function public.save_attendance_device(uuid, text, text, boolean) to authenticated;
revoke execute on function public.save_employee(jsonb), public.end_employment(uuid, date, text), public.save_shift(jsonb),
  public.set_roster(uuid, date, uuid, text), public.import_attendance(uuid, jsonb, text), public.add_manual_punch(uuid, timestamptz, text),
  public.decide_manual_punch(uuid, boolean), public.approve_overtime(uuid, date, int), public.recompute_attendance(uuid, date, date),
  public.request_leave(text, date, date, text, uuid), public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid, text),
  public.my_leave_balances(uuid), public.request_loan(uuid, numeric, int, date, text), public.decide_loan(uuid, boolean, text),
  public.disburse_loan(uuid, text, text), public.save_payroll_component(text, jsonb), public.save_payroll_setting(text, numeric, text),
  public.save_tax_brackets(date, jsonb), public.save_payroll_adjustment(uuid, date, text, numeric, text), public.prepare_payroll(uuid, date),
  public.approve_payroll(uuid), public.pay_payroll(uuid, text, text), public.cancel_payroll(uuid, text),
  public.pay_payroll_liability(uuid, text, date, numeric, text)
  from public, anon;
grant execute on function public.save_employee(jsonb), public.end_employment(uuid, date, text), public.save_shift(jsonb),
  public.set_roster(uuid, date, uuid, text), public.import_attendance(uuid, jsonb, text), public.add_manual_punch(uuid, timestamptz, text),
  public.decide_manual_punch(uuid, boolean), public.approve_overtime(uuid, date, int), public.recompute_attendance(uuid, date, date),
  public.request_leave(text, date, date, text, uuid), public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid, text),
  public.my_leave_balances(uuid), public.request_loan(uuid, numeric, int, date, text), public.decide_loan(uuid, boolean, text),
  public.disburse_loan(uuid, text, text), public.save_payroll_component(text, jsonb), public.save_payroll_setting(text, numeric, text),
  public.save_tax_brackets(date, jsonb), public.save_payroll_adjustment(uuid, date, text, numeric, text), public.prepare_payroll(uuid, date),
  public.approve_payroll(uuid), public.pay_payroll(uuid, text, text), public.cancel_payroll(uuid, text),
  public.pay_payroll_liability(uuid, text, date, numeric, text)
  to authenticated;
