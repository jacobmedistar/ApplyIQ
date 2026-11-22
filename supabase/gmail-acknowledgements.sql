begin;
create table private.staff_gmail_connections (
  org_id uuid not null,
  staff_id uuid not null,
  email text not null,
  sealed_refresh_token text not null,
  connected_at timestamptz not null default now(),
  primary key (org_id,staff_id),
  foreign key (org_id,staff_id) references public.staff(org_id,user_id) on delete cascade
);
alter table private.staff_gmail_connections enable row level security;

grant update (assigned_to) on public.leads to authenticated;
create function private.check_lead_assignee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.staff s where s.org_id=new.org_id and s.user_id=new.assigned_to and s.active
  ) then
    raise exception 'Choose active staff in this organization' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_lead_assignee() from public;
create trigger check_lead_assignee before update of assigned_to on public.leads
for each row execute function private.check_lead_assignee();

create function private.lead_assignees(tenant uuid)
returns table(id uuid, email text, department text)
language sql security definer set search_path='' as $$
  select s.user_id,u.email::text,s.department
  from public.staff s join auth.users u on u.id=s.user_id
  where s.org_id=tenant and s.active and private.is_admin(tenant)
  order by lower(u.email),s.user_id;
$$;
revoke all on function private.lead_assignees(uuid) from public,anon;
grant execute on function private.lead_assignees(uuid) to authenticated;
create function public.lead_assignees(tenant uuid)
returns table(id uuid, email text, department text)
language sql security invoker set search_path='' as $$
  select * from private.lead_assignees(tenant);
$$;
revoke all on function public.lead_assignees(uuid) from public,anon;
grant execute on function public.lead_assignees(uuid) to authenticated;

create function public.staff_gmail_connection(tenant uuid, member uuid, operation text,
  mailbox text default null, sealed_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff where org_id=tenant and user_id=member and active) then
    raise exception 'Active staff account required' using errcode='42501';
  end if;
  if operation='connect' and mailbox is not null and sealed_token is not null then
    insert into private.staff_gmail_connections(org_id,staff_id,email,sealed_refresh_token)
      values (tenant,member,mailbox,sealed_token)
      on conflict (org_id,staff_id) do update set email=excluded.email,
        sealed_refresh_token=excluded.sealed_refresh_token,connected_at=now();
  elsif operation='disconnect' then
    delete from private.staff_gmail_connections where org_id=tenant and staff_id=member;
  elsif operation<>'status' then
    raise exception 'Invalid operation' using errcode='22023';
  end if;
  return coalesce((select jsonb_build_object('email',email) from private.staff_gmail_connections
    where org_id=tenant and staff_id=member),'{}'::jsonb);
end;
$$;

create function public.claim_gmail_acknowledgements(tenant uuid)
returns table(job_id uuid, lease uuid, staff_id uuid)
language sql security definer set search_path='' as $$
  with candidate as (
    select j.id,l.assigned_to from private.inquiry_acknowledgements j
    join public.inquiries i on i.id=j.inquiry_id
    join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
    where i.org_id=tenant and j.channel='email' and j.retry_at<=now()
      and (j.state='sending' and j.lease_until<=now() or j.state='pending' and (
        i.contacted_at is not null or l.archived_at is not null or l.stage in ('Closed','Enrolled')
        or now()>j.scheduled_at+interval '20 hours' or exists (
          select 1 from public.staff s join private.staff_gmail_connections c
            on c.org_id=s.org_id and c.staff_id=s.user_id
          where s.org_id=l.org_id and s.user_id=l.assigned_to and s.active)))
    order by j.retry_at,j.id limit 10 for update of j skip locked
  ), claimed as (
    update private.inquiry_acknowledgements j set state=case
      when j.state='sending' then 'uncertain'
      when i.contacted_at is not null or l.archived_at is not null or l.stage in ('Closed','Enrolled') then 'skipped'
      when now()>j.scheduled_at+interval '20 hours' then 'failed'
      else 'sending' end,
      attempts=j.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',
      browser_worker_id=c.assigned_to
    from candidate c,public.inquiries i,public.leads l
    where j.id=c.id and i.id=j.inquiry_id and l.org_id=i.org_id and l.id=i.lead_id
    returning j.id,j.lease_id,j.browser_worker_id,j.state
  )
  select id,lease_id,browser_worker_id from claimed where state='sending';
$$;

create function public.gmail_acknowledgement_payload(tenant uuid, member uuid, job uuid, lock_id uuid)
returns table(recipient text, sender text, sealed_token text)
language sql security definer set search_path='' as $$
  select i.email,c.email,c.sealed_refresh_token
  from private.inquiry_acknowledgements j
  join public.inquiries i on i.id=j.inquiry_id
  join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
  join public.staff s on s.org_id=l.org_id and s.user_id=l.assigned_to and s.active
  join private.staff_gmail_connections c on c.org_id=s.org_id and c.staff_id=s.user_id
  where l.org_id=tenant and s.user_id=member and j.browser_worker_id=member
    and j.channel='email' and j.id=job and j.lease_id=lock_id and j.state='sending' and j.lease_until>now()
    and i.contacted_at is null and l.archived_at is null and l.stage not in ('Closed','Enrolled');
$$;

create function public.finish_gmail_acknowledgement(tenant uuid, member uuid, job uuid, lock_id uuid,
  outcome text, external_id text, reason text)
returns boolean language sql security definer set search_path='' as $$
  with finished as (
    update private.inquiry_acknowledgements j
    set state=case when outcome='retry' and j.attempts<5 then 'pending'
      when outcome='retry' then 'failed' else outcome end,
      provider_id=external_id,detail=reason,retry_at=now()+interval '2 minutes',lease_id=null,lease_until=null
    from public.inquiries i
    where i.id=j.inquiry_id and i.org_id=tenant and j.id=job and j.lease_id=lock_id
      and j.channel='email' and j.browser_worker_id=member and j.state='sending'
      and outcome in ('accepted','failed','skipped','uncertain','retry')
    returning j.id
  )
  select exists(select 1 from finished);
$$;

revoke all on function public.staff_gmail_connection(uuid,uuid,text,text,text),
  public.finish_gmail_acknowledgement(uuid,uuid,uuid,uuid,text,text,text),
  public.claim_gmail_acknowledgements(uuid),public.gmail_acknowledgement_payload(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.staff_gmail_connection(uuid,uuid,text,text,text),
  public.finish_gmail_acknowledgement(uuid,uuid,uuid,uuid,text,text,text),
  public.claim_gmail_acknowledgements(uuid),public.gmail_acknowledgement_payload(uuid,uuid,uuid,uuid)
  to service_role;
commit;
