-- Permit authenticated owners to verify and manage only their own private APK objects.
drop policy if exists "GRIXDroid users read their own APKs" on storage.objects;
create policy "GRIXDroid users read their own APKs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'grixdroid-apks'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
