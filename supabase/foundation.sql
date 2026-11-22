begin;
create schema if not exists private;
create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null
);
create table public.staff (
  org_id uuid references public.organizations not null, user_id uuid references auth.users not null,
  department text not null, role text not null check (role in ('super_admin','executive','branch_manager','manager','staff')),
  active boolean not null default true, primary key (org_id,user_id)
);
create table public.department_shares (
  org_id uuid references public.organizations not null, owner_department text not null, reader_department text not null,
  primary key (org_id,owner_department,reader_department)
);
create table public.leads (
  org_id uuid references public.organizations not null, id uuid not null default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  topic text not null check (length(btrim(topic)) > 0),
  department text not null default 'Front office', assigned_to uuid,
  stage text not null default 'New inquiry' check (stage in ('New inquiry','Counselling','Document collection','Application preparation','Application submitted','Offer received','Visa preparation','Visa submitted','Visa granted','Travel booked','Enrolled','Closed')),
  profile jsonb not null default '{}',
  created_at timestamptz not null default now(), archived_at timestamptz,
  primary key (org_id,id), unique (org_id,phone), unique (org_id,email),
  foreign key (org_id,assigned_to) references public.staff (org_id,user_id)
);
create table public.inquiries (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, lead_id uuid not null,
  source text not null, external_id text, name text not null, phone text not null, email text not null,
  topic text not null, received_at timestamptz not null default now(), created_by uuid default auth.uid(),
  foreign key (org_id,lead_id) references public.leads (org_id,id), unique (org_id,source,external_id)
);
create table public.followups (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, lead_id uuid not null,
  title text not null, due_at timestamptz not null, automatic boolean not null default false,
  completed_at timestamptz, created_by uuid default auth.uid(),
  foreign key (org_id,lead_id) references public.leads (org_id,id)
);
create index followups_due on public.followups(due_at) where completed_at is null;
create table public.lead_audit (
  id bigint generated always as identity primary key, org_id uuid not null,
  lead_id uuid not null, table_name text not null, action text not null,
  actor uuid, actor_role text not null, at timestamptz not null default now(), prior jsonb, next jsonb
);
create function private.can_read_department(target_org uuid, target_department text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s where s.org_id=target_org and s.user_id=auth.uid() and s.active
    and (s.role in ('super_admin','executive') or s.department=target_department or exists (
      select 1 from public.department_shares ds where ds.org_id=s.org_id
      and ds.owner_department=target_department and ds.reader_department=s.department
    ))
  );
$$;
create function private.is_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff s where s.org_id=target_org and s.user_id=auth.uid()
    and s.active and s.role='super_admin');
$$;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public;
grant execute on function private.can_read_department(uuid,text), private.is_admin(uuid) to authenticated;
alter table public.organizations enable row level security;
alter table public.staff enable row level security;
alter table public.department_shares enable row level security;
alter table public.leads enable row level security;
alter table public.inquiries enable row level security;
alter table public.followups enable row level security;
alter table public.lead_audit enable row level security;
revoke all on public.organizations,public.staff,public.department_shares,public.leads,public.inquiries,public.followups,public.lead_audit from anon,authenticated;
grant select on public.staff,public.department_shares,public.leads,public.inquiries,public.followups,public.lead_audit to authenticated;
grant insert,update,delete on public.department_shares to authenticated;
create policy staff_read on public.staff for select to authenticated using ((user_id=(select auth.uid()) and active) or private.is_admin(org_id));
create policy shares_manage on public.department_shares for all to authenticated using (private.is_admin(org_id)) with check (private.is_admin(org_id));
create policy leads_read on public.leads for select to authenticated using (private.can_read_department(org_id,department));
create policy inquiries_read on public.inquiries for select to authenticated using (exists (
  select 1 from public.leads l where l.org_id=inquiries.org_id and l.id=inquiries.lead_id));
create policy followups_read on public.followups for select to authenticated using (exists (
  select 1 from public.leads l where l.org_id=followups.org_id and l.id=followups.lead_id));
create policy audit_read on public.lead_audit for select to authenticated using (private.is_admin(org_id));
create function private.record_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;
begin
  row_data := case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.lead_audit(org_id,lead_id,table_name,action,actor,actor_role,prior,next)
  values ((row_data->>'org_id')::uuid,coalesce(row_data->>'lead_id',row_data->>'id')::uuid,
    TG_TABLE_NAME,TG_OP,auth.uid(),coalesce(auth.role(),session_user::text),
    case when TG_OP<>'INSERT' then to_jsonb(old) end,
    case when TG_OP<>'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;
revoke execute on function private.record_audit() from public;
create trigger lead_audit after insert or update or delete on public.leads for each row execute function private.record_audit();
create trigger inquiry_audit after insert or update or delete on public.inquiries for each row execute function private.record_audit();
create trigger followup_audit after insert or update or delete on public.followups for each row execute function private.record_audit();

-- Executed only by a trusted backend. A per-organization transaction lock
-- serializes identity resolution across the phone and email unique indexes.
create function public.record_inquiry(
  tenant uuid, student_name text, canonical_phone text, student_email text,
  inquiry_topic text, inquiry_source text, source_id text default null,
  happened_at timestamptz default now()
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  resolved uuid;
  matches uuid[];
  normalized_email text := lower(btrim(student_email));
begin
  if nullif(btrim(student_name),'') is null or nullif(btrim(inquiry_topic),'') is null
    or nullif(btrim(inquiry_source),'') is null or canonical_phone is null
    or canonical_phone !~ '^\+[1-9][0-9]{7,14}$' or normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Name, phone, email, topic and source are required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(tenant::text,0));
  if source_id is not null then
    select i.lead_id into resolved from public.inquiries i
      where i.org_id=tenant and i.source=inquiry_source and i.external_id=source_id;
    if resolved is not null then return resolved; end if;
  end if;
  select array_agg(l.id) into matches from public.leads l
    where l.org_id=tenant and (l.phone=canonical_phone or l.email=normalized_email);
  if cardinality(matches)>1 then
    raise exception 'Identity conflict requires review' using errcode='23505';
  end if;
  resolved := matches[1];
  if resolved is null then
    insert into public.leads(org_id,name,phone,email,topic)
      values (tenant,btrim(student_name),canonical_phone,normalized_email,btrim(inquiry_topic))
      returning id into resolved;
    insert into public.followups(org_id,lead_id,title,due_at,automatic)
      values (tenant,resolved,'First follow-up',now()+interval '24 hours',true);
  end if;
  insert into public.inquiries(org_id,lead_id,source,external_id,name,phone,email,topic,received_at)
    values (tenant,resolved,inquiry_source,source_id,btrim(student_name),canonical_phone,normalized_email,btrim(inquiry_topic),happened_at);
  return resolved;
end;
$$;
revoke execute on function public.record_inquiry(uuid,text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_inquiry(uuid,text,text,text,text,text,text,timestamptz) to service_role;
grant select,insert,update on public.leads,public.inquiries,public.followups to service_role;
commit;
