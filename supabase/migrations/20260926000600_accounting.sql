-- Golden Care OS — 0006 Double-entry accounting core
-- Every posted entry balances (enforced by a deferred constraint trigger), lives in an
-- open fiscal period, references its operational source, and is never edited or deleted:
-- corrections are reversals.

create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');

create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            text not null,
  name_ar         text not null,
  name_en         text not null,
  type            public.account_type not null,
  parent_id       uuid references public.accounts(id),
  is_postable     boolean not null default true,     -- header accounts are not postable
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.cost_centers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            text not null,
  name_ar         text not null,
  name_en         text not null,
  kind            text not null check (kind in ('branch', 'specialty', 'department', 'doctor', 'service', 'device', 'other')),
  ref_id          uuid,          -- id of the branch/specialty/doctor/... it represents
  is_active       boolean not null default true,
  unique (organization_id, code)
);

create table public.fiscal_periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name            text not null,
  period          daterange not null,
  status          text not null default 'open' check (status in ('open', 'locked')),
  locked_by       uuid,
  locked_at       timestamptz,
  constraint no_period_overlap exclude using gist (organization_id with =, period with &&)
);

-- Semantic account keys used by the posting engine (configurable by Finance).
create table public.account_settings (
  organization_id uuid not null references public.organizations(id),
  key             text not null,
  account_id      uuid not null references public.accounts(id),
  primary key (organization_id, key)
);

create type public.journal_status as enum ('posted', 'reversed');

create table public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default app.next_ref('JE'),
  organization_id uuid not null references public.organizations(id),
  branch_id       uuid references public.branches(id),
  entry_date      date not null,
  description     text not null,
  source_type     text not null,          -- invoice_issue, payment, invoice_void, reversal, manual…
  source_id       uuid,
  status          public.journal_status not null default 'posted',
  reversal_of     uuid references public.journal_entries(id),
  reversed_by     uuid references public.journal_entries(id),
  created_by      uuid default auth.uid(),
  approved_by     uuid,
  created_at      timestamptz not null default now()
);
create index on public.journal_entries (organization_id, entry_date);
create index on public.journal_entries (source_type, source_id);

create table public.journal_lines (
  id             bigint generated always as identity primary key,
  entry_id       uuid not null references public.journal_entries(id),
  account_id     uuid not null references public.accounts(id),
  debit          numeric(14,2) not null default 0 check (debit >= 0),
  credit         numeric(14,2) not null default 0 check (credit >= 0),
  cost_center_id uuid references public.cost_centers(id),
  patient_id     uuid references public.patients(id),
  doctor_id      uuid references public.staff(id),
  memo           text,
  constraint one_sided check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index on public.journal_lines (entry_id);
create index on public.journal_lines (account_id);

-- Balance check at commit time for every touched entry.
-- SECURITY DEFINER: deferred triggers fire at commit as the calling role, which cannot
-- read the ledger under RLS; the check itself must always see every line.
create or replace function app.check_entry_balanced()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_entry uuid := coalesce(new.entry_id, old.entry_id);
        d numeric; c numeric; n int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into d, c, n from public.journal_lines where entry_id = v_entry;
  if n < 2 or d <> c then
    raise exception 'journal entry % is not balanced (debit %, credit %, lines %)', v_entry, d, c, n
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger trg_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function app.check_entry_balanced();

-- An entry must have lines by commit time.
create or replace function app.check_entry_has_lines()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not exists (select 1 from public.journal_lines where entry_id = new.id) then
    raise exception 'journal entry % has no lines', new.id using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger trg_entry_has_lines
  after insert on public.journal_entries
  deferrable initially deferred
  for each row execute function app.check_entry_has_lines();

-- Period must be open; only the reversal linkage may change later.
create or replace function app.journal_entries_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.fiscal_periods fp
                   where fp.organization_id = new.organization_id
                     and fp.period @> new.entry_date and fp.status = 'open') then
      raise exception 'no open fiscal period for %', new.entry_date using errcode = '22023';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'journal entries cannot be deleted; reverse instead' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'reversed_by') <> (to_jsonb(old) - 'status' - 'reversed_by')
     or not (old.status = 'posted' and new.status = 'reversed' and new.reversed_by is not null) then
    raise exception 'posted journal entries are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_journal_entries_guard before insert or update or delete on public.journal_entries
  for each row execute function app.journal_entries_guard();

create or replace function app.journal_lines_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_postable boolean; v_active boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'journal lines are immutable' using errcode = '42501';
  end if;
  select is_postable, is_active into v_postable, v_active from public.accounts where id = new.account_id;
  if not coalesce(v_postable and v_active, false) then
    raise exception 'account % is not postable', new.account_id using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_journal_lines_guard before insert or update or delete on public.journal_lines
  for each row execute function app.journal_lines_guard();

create trigger trg_audit_journal_entries after insert or update on public.journal_entries
  for each row execute function app.audit_row();
create trigger trg_audit_accounts after insert or update or delete on public.accounts
  for each row execute function app.audit_row();
create trigger trg_audit_fiscal_periods after insert or update or delete on public.fiscal_periods
  for each row execute function app.audit_row();
create trigger trg_audit_account_settings after insert or update or delete on public.account_settings
  for each row execute function app.audit_row();

create or replace function app.account_for(p_org uuid, p_key text)
returns uuid language plpgsql stable set search_path = public, pg_temp as $$
declare v uuid;
begin
  select account_id into v from public.account_settings where organization_id = p_org and key = p_key;
  if v is null then
    raise exception 'accounting setting "%" is not configured', p_key using errcode = '22023';
  end if;
  return v;
end $$;

-- Internal posting primitive. p_lines: [{account_id, debit, credit, cost_center_id, patient_id, doctor_id, memo}]
create or replace function app.post_journal(
  p_org uuid, p_branch uuid, p_date date, p_description text,
  p_source_type text, p_source_id uuid, p_lines jsonb, p_reversal_of uuid default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; l jsonb;
begin
  insert into public.journal_entries (organization_id, branch_id, entry_date, description, source_type, source_id, reversal_of)
  values (p_org, p_branch, p_date, p_description, p_source_type, p_source_id, p_reversal_of)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'debit')::numeric, 0) = 0 and coalesce((l->>'credit')::numeric, 0) = 0 then
      continue;   -- skip zero lines
    end if;
    insert into public.journal_lines (entry_id, account_id, debit, credit, cost_center_id, patient_id, doctor_id, memo)
    values (v_id, (l->>'account_id')::uuid,
            round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
            nullif(l->>'cost_center_id', '')::uuid, nullif(l->>'patient_id', '')::uuid,
            nullif(l->>'doctor_id', '')::uuid, l->>'memo');
  end loop;
  return v_id;
end $$;

-- Mirror an entry into a new reversing entry dated today and mark the original reversed.
create or replace function app.reverse_journal(p_entry uuid, p_reason text, p_source_type text default 'reversal', p_source_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.journal_entries; v_new uuid;
begin
  select * into e from public.journal_entries where id = p_entry for update;
  if not found then raise exception 'journal entry not found' using errcode = 'P0002'; end if;
  if e.status <> 'posted' then raise exception 'journal entry already reversed' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reversal reason is required' using errcode = '22023'; end if;

  select app.post_journal(e.organization_id, e.branch_id, (now() at time zone 'Africa/Cairo')::date,
           'Reversal of ' || e.ref || ': ' || p_reason, p_source_type, coalesce(p_source_id, e.source_id),
           (select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit, 'credit', debit,
                     'cost_center_id', cost_center_id, 'patient_id', patient_id, 'doctor_id', doctor_id,
                     'memo', memo)) from public.journal_lines where entry_id = e.id),
           e.id)
    into v_new;
  update public.journal_entries set status = 'reversed', reversed_by = v_new where id = e.id;
  return v_new;
end $$;

-- Public: manual reversal by an authorized accountant.
create or replace function public.reverse_journal_entry(p_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_branch uuid; v_src text;
begin
  select branch_id, source_type into v_branch, v_src from public.journal_entries where id = p_entry;
  perform app.require_permission('accounting.post', v_branch);
  if v_src in ('invoice_issue', 'payment') then
    raise exception 'operational entries are reversed through their source document (void invoice / refund)' using errcode = '22023';
  end if;
  return app.reverse_journal(p_entry, p_reason);
end $$;

create or replace function public.trial_balance(p_org uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name_ar text, name_en text, type public.account_type,
               debit numeric, credit numeric, balance numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('accounting.read');
  return query
  select a.id, a.code, a.name_ar, a.name_en, a.type,
         coalesce(sum(l.debit) filter (where e.entry_date between p_from and p_to), 0)::numeric,
         coalesce(sum(l.credit) filter (where e.entry_date between p_from and p_to), 0)::numeric,
         (coalesce(sum(l.debit) filter (where e.entry_date between p_from and p_to), 0)
          - coalesce(sum(l.credit) filter (where e.entry_date between p_from and p_to), 0))::numeric
  from public.accounts a
  left join public.journal_lines l on l.account_id = a.id
  left join public.journal_entries e on e.id = l.entry_id
  where a.organization_id = p_org and a.is_postable
  group by a.id
  order by a.code;
end $$;

-- Period close: lock prevents any further posting inside the period.
create or replace function public.lock_fiscal_period(p_period uuid)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('accounting.close');
  update public.fiscal_periods set status = 'locked', locked_by = auth.uid(), locked_at = now()
  where id = p_period and status = 'open';
  if not found then raise exception 'period not found or already locked' using errcode = '22023'; end if;
end $$;
