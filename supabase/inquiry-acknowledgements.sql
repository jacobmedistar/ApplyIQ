begin;

alter table public.inquiries
  add column contacted_at timestamptz,
  add column contacted_by uuid references auth.users(id),
  add column whatsapp_opt_in_at timestamptz;

grant update (contacted_at, contacted_by, whatsapp_opt_in_at) on public.inquiries to authenticated;
create policy inquiries_staff_contact on public.inquiries for update to authenticated
  using (exists (
    select 1 from public.leads l join public.staff s on s.org_id=l.org_id and s.user_id=(select auth.uid())
    where l.org_id=inquiries.org_id and l.id=inquiries.lead_id and l.archived_at is null and s.active
      and (s.role='super_admin' or l.assigned_to=s.user_id or l.department=s.department)
  ))
  with check (true);

create function private.protect_inquiry_contact()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.contacted_at,new.contacted_by) is distinct from (old.contacted_at,old.contacted_by) then
    if old.contacted_at is not null or auth.uid() is null or new.contacted_by is distinct from auth.uid()
      or new.contacted_at is null then
      raise exception 'Contact can only be recorded once by the signed-in staff member' using errcode='42501';
    end if;
    new.contacted_at:=now();
  end if;
  return new;
end;
$$;
revoke all on function private.protect_inquiry_contact() from public;
create trigger protect_inquiry_contact before update of contacted_at,contacted_by on public.inquiries
for each row execute function private.protect_inquiry_contact();

create table private.inquiry_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp')),
  scheduled_at timestamptz not null,
  retry_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','sending','accepted','failed','skipped','uncertain')),
  attempts int not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  provider_id text,
  detail text,
  unique (inquiry_id,channel)
);
alter table private.inquiry_acknowledgements enable row level security;
create index inquiry_ack_due on private.inquiry_acknowledgements(channel,retry_at)
  where state in ('pending','sending');

create function private.queue_inquiry_acknowledgement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.inquiry_acknowledgements(inquiry_id,channel,scheduled_at,retry_at)
  select new.id, channel, new.received_at+interval '10 minutes', new.received_at+interval '10 minutes'
  from unnest(array['email','whatsapp']) as channels(channel);
  return new;
end;
$$;
revoke all on function private.queue_inquiry_acknowledgement() from public;
create trigger queue_acknowledgement after insert on public.inquiries
for each row execute function private.queue_inquiry_acknowledgement();

create function public.claim_inquiry_acknowledgements(tenant uuid, delivery_channel text)
returns table(job_id uuid, lease uuid, recipient text)
language sql security invoker set search_path='' as $$
  with candidates as (
    select j.id from private.inquiry_acknowledgements j
    join public.inquiries i on i.id=j.inquiry_id
    join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
    where i.org_id=tenant and j.channel=delivery_channel and j.retry_at<=now()
      and (j.state='pending' or (j.state='sending' and j.lease_until<=now()))
    order by j.retry_at
    limit 5 for update of j skip locked
  ), claimed as (
    update private.inquiry_acknowledgements j
    set state=case
      when j.state='sending' and (j.channel='whatsapp' or now()>j.scheduled_at+interval '20 hours') then 'uncertain'
      when i.contacted_at is not null or l.archived_at is not null or l.stage in ('Closed','Enrolled')
        or (j.channel='whatsapp' and i.whatsapp_opt_in_at is null) then 'skipped'
      when now()>j.scheduled_at+interval '20 hours' then 'failed'
      else 'sending' end,
      lease_id=gen_random_uuid(), lease_until=now()+interval '2 minutes', attempts=j.attempts+1
    from candidates c, public.inquiries i, public.leads l
    where j.id=c.id and i.id=j.inquiry_id and l.org_id=i.org_id and l.id=i.lead_id
    returning j.id,j.lease_id,j.state,case when j.channel='email' then i.email else i.phone end as recipient
  )
  select id,lease_id,recipient from claimed where state='sending';
$$;

create function public.finish_inquiry_acknowledgement(job uuid, lock_id uuid, outcome text, external_id text, reason text)
returns void language sql security invoker set search_path='' as $$
  update private.inquiry_acknowledgements j
  set state=case when outcome='retry' and j.attempts<5 then 'pending'
    when outcome='retry' then 'failed' else outcome end,
    provider_id=external_id, detail=reason,
    retry_at=now()+make_interval(mins => least(j.attempts,5)*2), lease_until=null, lease_id=null
  where j.id=job and j.lease_id=lock_id and j.state='sending'
    and outcome in ('accepted','retry','failed','uncertain');
$$;
grant usage on schema private to service_role;
grant select,update on private.inquiry_acknowledgements to service_role;
revoke all on function public.claim_inquiry_acknowledgements(uuid,text),
  public.finish_inquiry_acknowledgement(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_inquiry_acknowledgements(uuid,text),
  public.finish_inquiry_acknowledgement(uuid,uuid,text,text,text) to service_role;
commit;
