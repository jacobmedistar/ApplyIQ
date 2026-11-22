begin;
create or replace function public.bootstrap_staff(target_org uuid, target_user uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform 1 from public.organizations where id = target_org for update;
  if not found then raise exception 'Organization is missing'; end if;
  if exists (select 1 from public.staff where org_id = target_org) then
    return exists (select 1 from public.staff where org_id = target_org
      and user_id = target_user and active and role = 'super_admin');
  end if;
  if not exists (select 1 from auth.users where id = target_user
    and raw_app_meta_data->>'applyiq_setup_org' = target_org::text) then
    raise exception 'Account was not created by ApplyIQ setup';
  end if;
  insert into public.staff(org_id,user_id,department,role)
    values (target_org,target_user,'Executive','super_admin');
  return true;
end;
$$;
-- Owner access is required for the row lock and the Auth membership check.
alter function public.bootstrap_staff(uuid,uuid) security definer;
revoke all on function public.bootstrap_staff(uuid,uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_staff(uuid,uuid) to service_role;
grant select on public.staff to service_role;
commit;
