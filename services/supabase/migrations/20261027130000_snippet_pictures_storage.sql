-- ── Pictures in snippets (v3.94.0) ───────────────────────────────────────────
-- The storage the snippet editor's Add a picture uploads to. A picture goes
-- into emails, and the person reading the email loads it from its address, so
-- the bucket is public: anyone holding an address can see that one picture.
-- Addresses are a person's id and a random name, never listed for anyone else.
--
-- Pictures are kept when they leave a snippet: an email already sent still
-- shows them. The owner may delete their own, and delete-account empties the
-- person's folder.
--
-- No public SELECT policy on purpose: a public bucket serves a file by its
-- address without one, and a policy for everyone would let anyone list every
-- person's pictures. The owner's own SELECT lets the upload read back its row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'snippet-pictures',
  'snippet-pictures',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists snippet_pictures_owner_read on storage.objects;
create policy snippet_pictures_owner_read on storage.objects
  for select to authenticated using (
    bucket_id = 'snippet-pictures'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists snippet_pictures_owner_insert on storage.objects;
create policy snippet_pictures_owner_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'snippet-pictures'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists snippet_pictures_owner_delete on storage.objects;
create policy snippet_pictures_owner_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'snippet-pictures'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
