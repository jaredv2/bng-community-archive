alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.messages enable row level security;
alter table public.archive_admins enable row level security;
alter table public.archive_settings enable row level security;
alter table public.upload_rate_limits enable row level security;
revoke all on public.posts,public.comments,public.messages,public.archive_admins,public.archive_settings,public.upload_rate_limits from anon,authenticated;
-- Explicit server grants also work when automatic table exposure is disabled.
grant usage on schema public to anon,authenticated,service_role;
grant all on public.posts,public.comments,public.messages,public.archive_admins,public.archive_settings,public.upload_rate_limits to service_role;
-- Do not expose upload capability hashes or reservation details through the API.
grant select(id,username,caption,storage_path,media_type,status,likes,pinned,created_at,approved_at) on public.posts to anon,authenticated;
grant select on public.comments,public.messages to anon,authenticated;
grant insert(post_id,name,content) on public.comments to anon,authenticated;
grant insert(name,content) on public.messages to anon,authenticated;
create policy approved_posts on public.posts for select to anon,authenticated using(status='approved');
create policy approved_comments on public.comments for select to anon,authenticated using(exists(select 1 from public.posts where id=post_id and status='approved'));
create policy new_comments on public.comments for insert to anon,authenticated with check(exists(select 1 from public.posts where id=post_id and status='approved'));
create policy public_messages on public.messages for select to anon,authenticated using(true);
create policy new_messages on public.messages for insert to anon,authenticated with check(true);
-- One PRIVATE bucket: approved objects can be signed through RLS; pending cannot.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-media','community-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']);
create policy approved_media on storage.objects for select to anon,authenticated using(bucket_id='community-media' and exists(select 1 from public.posts p where p.storage_path=name and p.status='approved'));
-- No client INSERT, UPDATE or DELETE policy: uploads use narrowly scoped signed URLs.
-- Admins also use the verified Edge Function; there is no direct browser mutation grant.

