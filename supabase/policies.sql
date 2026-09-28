alter table public.posts enable row level security;
alter table public.post_tags enable row level security;
alter table public.tags enable row level security;
alter table public.comments enable row level security;
alter table public.messages enable row level security;
alter table public.albums enable row level security;
alter table public.album_items enable row level security;
alter table public.reports enable row level security;
alter table public.archive_admins enable row level security;
alter table public.archive_settings enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Column grants. Anything not named here is invisible to the browser, which is
-- what keeps upload token hashes, sizes and poster paths off the client.
grant select(id,username,caption,storage_path,poster_path,media_type,status,likes,pinned,created_at,approved_at,width,height)
  on public.posts to anon, authenticated;
grant select(name) on public.tags to anon, authenticated;
grant select(post_id,tag) on public.post_tags to anon, authenticated;
grant select(id,slug,title,description,creator_name,created_at,hidden) on public.albums to anon, authenticated;
grant select(album_id,post_id,position) on public.album_items to anon, authenticated;
grant select on public.comments, public.messages to anon, authenticated;
grant insert(post_id,name,content) on public.comments to anon, authenticated;
grant insert(name,content) on public.messages to anon, authenticated;

create policy approved_posts on public.posts for select to anon, authenticated
  using(status = 'approved');
create policy public_tags on public.tags for select to anon, authenticated using(true);
create policy approved_post_tags on public.post_tags for select to anon, authenticated
  using(exists(select 1 from public.posts where id = post_id and status = 'approved'));
create policy visible_albums on public.albums for select to anon, authenticated
  using(hidden = false);
create policy visible_album_items on public.album_items for select to anon, authenticated
  using(exists(select 1 from public.albums where id = album_id and hidden = false));
create policy approved_comments on public.comments for select to anon, authenticated
  using(exists(select 1 from public.posts where id = post_id and status = 'approved'));
create policy new_comments on public.comments for insert to anon, authenticated
  with check(exists(select 1 from public.posts where id = post_id and status = 'approved'));
create policy public_messages on public.messages for select to anon, authenticated using(true);
create policy new_messages on public.messages for insert to anon, authenticated with check(true);

-- Two private buckets. Approving a post is what makes its file readable.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-media','community-media',false,52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-posters','community-posters',false,2097152, array['image/webp','image/jpeg','image/png']);

create policy approved_media on storage.objects for select to anon, authenticated
  using(bucket_id = 'community-media'
    and exists(select 1 from public.posts p where p.storage_path = name and p.status = 'approved'));
create policy approved_posters on storage.objects for select to anon, authenticated
  using(bucket_id = 'community-posters'
    and exists(select 1 from public.posts p where p.poster_path = name and p.status = 'approved'));

-- There is no client insert, update or delete on posts, albums or reports.
-- Uploads use short lived signed urls, everything else goes through the function.
