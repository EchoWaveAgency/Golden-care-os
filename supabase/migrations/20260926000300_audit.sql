-- Golden Care OS — 0003 Audit trail
-- Append-only. Written by database triggers so direct SQL changes are captured too.
-- Contains copies of sensitive data: readable only with 'audit.read'.

create table public.audit_events (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,                         -- auth.uid(), NULL for system/service
  actor_role  text,                         -- database role (authenticated/service_role/…)
  action      text not null,                -- INSERT / UPDATE / DELETE / or domain verb
  table_name  text not null,
  record_id   text,
  branch_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  changed     text[],                       -- columns changed on UPDATE
  reason      text,
  context     jsonb                         -- request id, ip, user agent when supplied
);
create index on public.audit_events (table_name, record_id);
create index on public.audit_events (actor_id, occurred_at desc);
create index on public.audit_events (occurred_at desc);

create or replace function app.block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;

create trigger trg_audit_immutable
  before update or delete on public.audit_events
  for each row execute function app.block_audit_mutation();

-- Optional per-request context set by the server:  select set_config('app.reason', '...', true)
create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changed text[];
  v_id text;
  v_branch uuid;
begin
  if tg_op = 'UPDATE' then
    select array_agg(k) into v_changed
    from jsonb_object_keys(v_new) k
    where k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k);
    if v_changed is null then return new; end if;   -- no-op update
  end if;

  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id');
  v_branch := nullif(coalesce(v_new ->> 'branch_id', v_old ->> 'branch_id'), '')::uuid;

  insert into public.audit_events (actor_id, actor_role, action, table_name, record_id, branch_id,
                                   old_data, new_data, changed, reason, context)
  values (auth.uid(), current_user, tg_op, tg_table_name, v_id, v_branch,
          v_old, v_new, v_changed,
          nullif(current_setting('app.reason', true), ''),
          nullif(current_setting('app.context', true), '')::jsonb);

  return coalesce(new, old);
end $$;

-- Domain-level audit entry (views, exports, prints, approvals) from RPCs.
create or replace function app.audit_event(p_action text, p_table text, p_record text,
                                           p_branch uuid default null, p_reason text default null,
                                           p_data jsonb default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_events (actor_id, actor_role, action, table_name, record_id, branch_id, new_data, reason)
  values (auth.uid(), current_user, p_action, p_table, p_record, p_branch, p_data, p_reason)
$$;

-- Attach audit triggers to identity tables now; later migrations attach to their own tables.
create trigger trg_audit_profiles after insert or update or delete on public.profiles
  for each row execute function app.audit_row();
create trigger trg_audit_staff after insert or update or delete on public.staff
  for each row execute function app.audit_row();
create trigger trg_audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function app.audit_row();
create trigger trg_audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row();
create trigger trg_audit_branches after insert or update or delete on public.branches
  for each row execute function app.audit_row();
