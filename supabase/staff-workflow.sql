begin;
grant update (stage, department) on public.leads to authenticated;
create policy leads_admin_workflow on public.leads for update to authenticated
  using (private.is_admin(org_id) and archived_at is null)
  with check (private.is_admin(org_id) and archived_at is null);

grant insert (id, org_id, lead_id, title, due_at) on public.followups to authenticated;
grant update (completed_at) on public.followups to authenticated;
create policy followups_admin_schedule on public.followups for insert to authenticated
  with check (private.is_admin(org_id) and created_by = (select auth.uid())
    and not automatic and completed_at is null and exists (
      select 1 from public.leads l where l.org_id=followups.org_id
      and l.id=followups.lead_id and l.archived_at is null
    ));
create policy followups_admin_complete on public.followups for update to authenticated
  using (private.is_admin(org_id) and completed_at is null and exists (
    select 1 from public.leads l where l.org_id=followups.org_id
    and l.id=followups.lead_id and l.archived_at is null
  ))
  with check (private.is_admin(org_id) and completed_at is not null);
commit;
