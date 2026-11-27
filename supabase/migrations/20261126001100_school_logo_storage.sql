-- =============================================================================
-- Klasora · 1100 · School logo storage
--
-- A public bucket for school logos. Files live under `<school_id>/...`, and
-- only people who may edit the school's settings can add, replace or remove
-- them. Logos are public so they can appear on report cards and invitations.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-logos', 'school-logos', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the first folder of an object path is a school the caller may configure.
create or replace function app.can_manage_school_file(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(coalesce(p_object_name, ''), '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app.can_write(v_folder::uuid, 'settings.edit');
end;
$$;

revoke all on function app.can_manage_school_file(text) from public;
grant execute on function app.can_manage_school_file(text) to authenticated;

-- Public URLs serve the images; this policy only lets managers list and
-- overwrite their own school's files through the API.
create policy school_logos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'school-logos' and app.can_manage_school_file(name));

create policy school_logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'school-logos' and app.can_manage_school_file(name));

create policy school_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'school-logos' and app.can_manage_school_file(name))
  with check (bucket_id = 'school-logos' and app.can_manage_school_file(name));

create policy school_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'school-logos' and app.can_manage_school_file(name));
