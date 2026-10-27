-- UNDO for 20261027130000_snippet_pictures_storage.sql
--
-- Takes away the storage for pictures in snippets. Run it only while Add a
-- picture is switched off (snippetPictures in app/src/lib/proFeatures.ts).
--
-- The bucket goes only when it is empty. Pictures already uploaded must be
-- removed through the Storage API first (the dashboard's Storage page, or
-- storage.from('snippet-pictures').remove()), and once removed, every email
-- that showed one shows a broken picture. Free plan, no restore: that is final.

drop policy if exists snippet_pictures_owner_read on storage.objects;
drop policy if exists snippet_pictures_owner_insert on storage.objects;
drop policy if exists snippet_pictures_owner_delete on storage.objects;

delete from storage.buckets
where id = 'snippet-pictures'
  and not exists (select 1 from storage.objects where bucket_id = 'snippet-pictures');
