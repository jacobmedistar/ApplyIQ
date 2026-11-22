begin;
create or replace function private.record_staff_inquiry(
  tenant uuid, student_name text, canonical_phone text, student_email text,
  inquiry_topic text, inquiry_source text, source_id text
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(tenant) then
    raise exception 'Only an active super administrator can create a staff inquiry' using errcode='42501';
  end if;
  if source_id is null or length(source_id) <> 36 then
    raise exception 'Invalid submission reference' using errcode='22023';
  end if;
  return public.record_inquiry(tenant,student_name,canonical_phone,student_email,
    inquiry_topic,inquiry_source,'staff:' || auth.uid()::text || ':' || source_id);
end;
$$;
revoke all on function private.record_staff_inquiry(uuid,text,text,text,text,text,text) from public,anon;
grant execute on function private.record_staff_inquiry(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.record_staff_inquiry(
  tenant uuid, student_name text, canonical_phone text, student_email text,
  inquiry_topic text, inquiry_source text, source_id text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.record_staff_inquiry(tenant,student_name,canonical_phone,student_email,
    inquiry_topic,inquiry_source,source_id);
$$;
revoke all on function public.record_staff_inquiry(uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.record_staff_inquiry(uuid,text,text,text,text,text,text) to authenticated;
commit;
