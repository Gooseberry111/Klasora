-- =============================================================================
-- Klasora · Phase 4d · Assignment attachments and submitted work
--
-- PRIVATE bucket, signed URLs only. Paths:
--   <school_id>/assignments/<assignment_id>/<file>
--       read: anyone who can see the assignment; write: its teachers.
--   <school_id>/submissions/<assignment_id>/<student_id>/<file>
--       read: the student, their guardians and the class's teachers;
--       write: the student, before the work is graded.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academic-files', 'academic-files', false, 20971520,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'text/plain'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.academic_file_access(p_object_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts      text[] := string_to_array(coalesce(p_object_name, ''), '/');
  v_uuid       text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_assignment public.assignments;
  v_student    uuid;
begin
  if array_length(v_parts, 1) < 4 or v_parts[1] !~ v_uuid or v_parts[3] !~ v_uuid then
    return false;
  end if;
  select * into v_assignment from public.assignments
  where id = v_parts[3]::uuid and school_id = v_parts[1]::uuid;
  if not found then
    return false;
  end if;

  if v_parts[2] = 'assignments' and array_length(v_parts, 1) = 4 then
    if p_write then
      return app.can_manage_class_work(v_assignment.school_id, v_assignment.class_id, 'assignments.edit')
          or app.can_manage_class_work(v_assignment.school_id, v_assignment.class_id, 'assignments.create');
    end if;
    return app.staff_can_see_class(v_assignment.school_id, v_assignment.class_id, 'assignments.view')
        or (v_assignment.status <> 'draft' and app.is_family_of_class(v_assignment.class_id));
  end if;

  if v_parts[2] = 'submissions' and array_length(v_parts, 1) = 5 and v_parts[4] ~ v_uuid then
    v_student := v_parts[4]::uuid;
    if not exists (select 1 from public.students s where s.id = v_student and s.school_id = v_assignment.school_id) then
      return false;
    end if;
    if p_write then
      return app.is_student_self(v_student)
         and app.school_is_writable(v_assignment.school_id)
         and v_assignment.status = 'published'
         and not exists (
           select 1 from public.assignment_submissions sub
           where sub.assignment_id = v_assignment.id and sub.student_id = v_student and sub.status = 'graded'
         );
    end if;
    return app.is_student_self(v_student) or app.is_guardian_of(v_student)
        or app.staff_can_see_class(v_assignment.school_id, v_assignment.class_id, 'assignments.view');
  end if;
  return false;
end;
$$;

revoke all on function app.academic_file_access(text, boolean) from public;
grant execute on function app.academic_file_access(text, boolean) to authenticated;

create policy academic_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'academic-files' and app.academic_file_access(name, false));

create policy academic_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'academic-files' and app.academic_file_access(name, true));

create policy academic_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'academic-files' and app.academic_file_access(name, true))
  with check (bucket_id = 'academic-files' and app.academic_file_access(name, true));

create policy academic_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'academic-files' and app.academic_file_access(name, true));
