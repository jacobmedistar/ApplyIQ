begin;
alter table private.inquiry_acknowledgements add column browser_worker_id uuid;

create function public.claim_browser_acknowledgement(tenant uuid, staff_id uuid, delivery_channel text)
returns table(job_id uuid, lease uuid, recipient text)
language sql security invoker set search_path='' as $$
  with candidate as (
    select j.id from private.inquiry_acknowledgements j
    join public.inquiries i on i.id=j.inquiry_id
    join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
    join public.staff s on s.org_id=i.org_id and s.user_id=staff_id and s.active
    where i.org_id=tenant and j.channel=delivery_channel and j.retry_at<=now()
      and (l.assigned_to=staff_id or (l.assigned_to is null and s.role='super_admin'))
      and (j.state='pending' or (j.state='sending' and j.lease_until<=now()))
    order by j.retry_at,j.id limit 1 for update of j skip locked
  ), claimed as (
    update private.inquiry_acknowledgements j
    set state=case when j.state='sending' then 'uncertain'
      when i.contacted_at is not null or l.archived_at is not null or l.stage in ('Closed','Enrolled')
        or (j.channel='whatsapp' and i.whatsapp_opt_in_at is null) then 'skipped'
      when now()>j.scheduled_at+interval '20 hours' then 'failed'
      else 'sending' end,
      lease_id=gen_random_uuid(), lease_until=now()+interval '2 minutes',
      attempts=j.attempts+1, browser_worker_id=staff_id
    from candidate c, public.inquiries i, public.leads l
    where j.id=c.id and i.id=j.inquiry_id and l.org_id=i.org_id and l.id=i.lead_id
    returning j.id,j.lease_id,j.state,case when j.channel='email' then i.email else i.phone end as recipient
  )
  select id,lease_id,recipient from claimed where state='sending';
$$;

create function public.browser_acknowledgement_can_send(tenant uuid, staff_id uuid, job uuid, lock_id uuid)
returns boolean language sql security invoker set search_path='' as $$
  select exists (
    select 1 from private.inquiry_acknowledgements j
    join public.inquiries i on i.id=j.inquiry_id
    join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
    join public.staff s on s.org_id=i.org_id and s.user_id=staff_id and s.active
    where i.org_id=tenant and j.id=job and j.lease_id=lock_id and j.browser_worker_id=staff_id
      and (l.assigned_to=staff_id or (l.assigned_to is null and s.role='super_admin'))
      and j.state='sending' and j.lease_until>now() and i.contacted_at is null
      and l.archived_at is null and l.stage not in ('Closed','Enrolled')
      and (j.channel='email' or i.whatsapp_opt_in_at is not null)
  );
$$;

create function public.finish_browser_acknowledgement(tenant uuid, staff_id uuid, job uuid, lock_id uuid, outcome text)
returns boolean language sql security invoker set search_path='' as $$
  with finished as (
    update private.inquiry_acknowledgements j
    set state=case when outcome='retry' and j.attempts<5 then 'pending'
      when outcome='retry' then 'failed' else outcome end,
      detail='browser_'||outcome, retry_at=now()+interval '5 minutes', lease_id=null, lease_until=null
    from public.inquiries i
    where i.id=j.inquiry_id and i.org_id=tenant and j.id=job and j.lease_id=lock_id
      and j.browser_worker_id=staff_id and j.state='sending'
      and outcome in ('accepted','retry','failed','skipped','uncertain')
    returning j.id
  )
  select exists(select 1 from finished);
$$;

revoke all on function public.claim_browser_acknowledgement(uuid,uuid,text),
  public.browser_acknowledgement_can_send(uuid,uuid,uuid,uuid),
  public.finish_browser_acknowledgement(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_browser_acknowledgement(uuid,uuid,text),
  public.browser_acknowledgement_can_send(uuid,uuid,uuid,uuid),
  public.finish_browser_acknowledgement(uuid,uuid,uuid,uuid,text) to service_role;
grant select on public.staff to service_role;
commit;
