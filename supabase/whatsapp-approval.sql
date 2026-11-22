begin;
create function public.staff_whatsapp_batch(tenant uuid, member uuid, approved uuid[] default null)
returns table(job_id uuid, lease uuid, recipient text, student text, topic text)
language sql security definer set search_path='' as $$
  with eligible as (
    select j.id,i.phone,l.name,i.topic
    from private.inquiry_acknowledgements j
    join public.inquiries i on i.id=j.inquiry_id
    join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
    join public.staff s on s.org_id=l.org_id and s.user_id=l.assigned_to and s.active
    where l.org_id=tenant and s.user_id=member and j.channel='whatsapp'
      and j.state='pending' and j.retry_at<=now() and i.contacted_at is null
      and i.whatsapp_opt_in_at is not null and l.archived_at is null and l.stage not in ('Closed','Enrolled')
      and (approved is null or j.id=any(approved))
    order by j.retry_at,j.id limit 5
    for update of j skip locked
  ), claimed as (
    update private.inquiry_acknowledgements j
    set state='sending',lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes',
      browser_worker_id=member,attempts=j.attempts+1
    from eligible e where approved is not null and j.id=e.id and j.state='pending'
    returning j.id,j.lease_id
  )
  select e.id,c.lease_id,e.phone,e.name,e.topic from eligible e
  left join claimed c on c.id=e.id where approved is null or c.id is not null;
$$;

create function public.staff_whatsapp_can_send(tenant uuid, member uuid, job uuid, lock_id uuid)
returns boolean language sql security definer set search_path='' as $$
  select exists (
    select 1 from private.inquiry_acknowledgements j
    join public.inquiries i on i.id=j.inquiry_id
    join public.leads l on l.org_id=i.org_id and l.id=i.lead_id
    join public.staff s on s.org_id=l.org_id and s.user_id=l.assigned_to and s.active
    where l.org_id=tenant and s.user_id=member and j.browser_worker_id=member
      and j.channel='whatsapp' and j.id=job and j.lease_id=lock_id and j.state='sending' and j.lease_until>now()
      and i.contacted_at is null and i.whatsapp_opt_in_at is not null
      and l.archived_at is null and l.stage not in ('Closed','Enrolled')
  );
$$;

create function public.expire_staff_whatsapp_leases(tenant uuid, member uuid)
returns void language sql security definer set search_path='' as $$
  update private.inquiry_acknowledgements j set state='uncertain',detail='browser_confirmation_missing',
    lease_id=null,lease_until=null
  from public.inquiries i where i.id=j.inquiry_id and i.org_id=tenant and j.browser_worker_id=member
    and j.channel='whatsapp' and j.state='sending' and j.lease_until<=now();
$$;

revoke all on function public.staff_whatsapp_batch(uuid,uuid,uuid[]),public.staff_whatsapp_can_send(uuid,uuid,uuid,uuid),
  public.expire_staff_whatsapp_leases(uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_whatsapp_batch(uuid,uuid,uuid[]),public.staff_whatsapp_can_send(uuid,uuid,uuid,uuid),
  public.expire_staff_whatsapp_leases(uuid,uuid) to service_role;
commit;
