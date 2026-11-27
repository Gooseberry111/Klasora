-- =============================================================================
-- Klasora · 1400 · Student photos and documents
--
-- A PRIVATE bucket: files are only reachable through short lived signed URLs.
-- Paths are `<school_id>/<student_id>/photo/<file>` or
-- `<school_id>/<student_id>/documents/<file>`.
--   * Photos: anyone who may see the student (staff, their teachers, their
--     guardians, the student).
--   * Documents: student administrators and the child's guardians only.
--   * Uploading, replacing and removing: students.edit in that school.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-files', 'student-files', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.student_file_owner(p_object_name text, out school_id uuid, out student_id uuid, out area text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_object_name, ''), '/');
  v_uuid  text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if array_length(v_parts, 1) < 4 or v_parts[1] !~ v_uuid or v_parts[2] !~ v_uuid
     or v_parts[3] not in ('photo', 'documents') then
    return;
  end if;
  select s.school_id, s.id into school_id, student_id
  from public.students s
  where s.id = v_parts[2]::uuid and s.school_id = v_parts[1]::uuid;
  if student_id is not null then
    area := v_parts[3];
  end if;
end;
$$;

create or replace function app.can_read_student_file(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from app.student_file_owner(p_object_name);
  if v.student_id is null then
    return false;
  end if;
  if v.area = 'photo' then
    return app.can_view_student(v.student_id, v.school_id);
  end if;
  return app.has_permission(v.school_id, 'students.view') or app.is_guardian_of(v.student_id);
end;
$$;

create or replace function app.can_write_student_file(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from app.student_file_owner(p_object_name);
  return v.student_id is not null and app.can_write(v.school_id, 'students.edit');
end;
$$;

revoke all on function app.student_file_owner(text), app.can_read_student_file(text), app.can_write_student_file(text) from public;
grant execute on function app.can_read_student_file(text), app.can_write_student_file(text) to authenticated;

create policy student_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'student-files' and app.can_read_student_file(name));

create policy student_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'student-files' and app.can_write_student_file(name));

create policy student_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'student-files' and app.can_write_student_file(name))
  with check (bucket_id = 'student-files' and app.can_write_student_file(name));

create policy student_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-files' and app.can_write_student_file(name));
