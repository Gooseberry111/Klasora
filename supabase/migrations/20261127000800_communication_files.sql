-- =============================================================================
-- Klasora · Phase 5d · Announcement and message attachments
--
-- PRIVATE bucket. Paths:
--   <school_id>/announcements/<announcement_id>/<file>
--       read: the author, approvers and recipients; write: the author while drafting.
--   <school_id>/messages/<conversation_id>/<file>
--       read and write: the conversation's participants.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('communication-files', 'communication-files', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.communication_file_access(p_object_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_object_name, ''), '/');
  v_uuid  text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_a     public.announcements;
  v_c     public.conversations;
begin
  if array_length(v_parts, 1) <> 4 or v_parts[1] !~ v_uuid or v_parts[3] !~ v_uuid then
    return false;
  end if;

  if v_parts[2] = 'announcements' then
    select * into v_a from public.announcements where id = v_parts[3]::uuid and school_id = v_parts[1]::uuid;
    if not found then
      return false;
    end if;
    if p_write then
      return v_a.author_id = auth.uid() and v_a.status = 'draft' and app.can_write(v_a.school_id, 'communication.create');
    end if;
    return v_a.author_id = auth.uid()
        or app.has_permission(v_a.school_id, 'communication.approve')
        or (v_a.status = 'published' and exists (
              select 1 from public.announcement_recipients r where r.announcement_id = v_a.id and r.user_id = auth.uid()));
  end if;

  if v_parts[2] = 'messages' then
    select * into v_c from public.conversations where id = v_parts[3]::uuid and school_id = v_parts[1]::uuid;
    if not found or not app.is_participant(v_c.id) then
      return false;
    end if;
    return not p_write or (not v_c.is_locked and app.school_is_writable(v_c.school_id));
  end if;
  return false;
end;
$$;

revoke all on function app.communication_file_access(text, boolean) from public;
grant execute on function app.communication_file_access(text, boolean) to authenticated;

create policy communication_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'communication-files' and app.communication_file_access(name, false));
create policy communication_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'communication-files' and app.communication_file_access(name, true));
create policy communication_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'communication-files' and app.communication_file_access(name, true));
