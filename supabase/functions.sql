-- Security definer helpers. Every one pins search_path and is revoked from public
-- before a single narrow grant is applied.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.archive_admins a
    join auth.sessions s on s.user_id = a.user_id
    cross join public.archive_settings cfg
    where a.user_id = auth.uid()
      and s.id::text = auth.jwt() ->> 'session_id'
      and s.created_at > now() - make_interval(hours => cfg.admin_session_hours)
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.increment_post_likes(post_id uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare updated bigint;
begin
  update public.posts set likes = likes + 1
  where id = post_id and status = 'approved'
  returning likes into updated;
  if updated is null then raise exception 'Post unavailable'; end if;
  return updated;
end;
$$;
revoke all on function public.increment_post_likes(uuid) from public;
grant execute on function public.increment_post_likes(uuid) to anon, authenticated;

-- One hourly window per key. Shared by uploads, albums and reports.
create or replace function public.consume_limit(rate_key text, allowed integer, window_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if allowed < 1 or window_seconds < 1 then raise exception 'Bad limit'; end if;
  insert into public.rate_limits(key, attempts) values(rate_key, 1)
  on conflict(key) do update set
    attempts = case when public.rate_limits.started_at < now() - make_interval(secs => window_seconds)
                then 1 else public.rate_limits.attempts + 1 end,
    started_at = case when public.rate_limits.started_at < now() - make_interval(secs => window_seconds)
                  then now() else public.rate_limits.started_at end
  returning attempts into n;
  return n <= allowed;
end;
$$;
revoke all on function public.consume_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_limit(text, integer, integer) to service_role;

create or replace function public.storage_metadata(object_path text) returns jsonb
language sql security definer set search_path='' as $$
  select metadata from storage.objects
  where bucket_id = 'community-media' and name = object_path;
$$;
revoke all on function public.storage_metadata(text) from public, anon, authenticated;
grant execute on function public.storage_metadata(text) to service_role;

-- Only the poster bucket needs a separate lookup.
create or replace function public.poster_metadata(object_path text) returns jsonb
language sql security definer set search_path='' as $$
  select metadata from storage.objects
  where bucket_id = 'community-posters' and name = object_path;
$$;
revoke all on function public.poster_metadata(text) from public, anon, authenticated;
grant execute on function public.poster_metadata(text) to service_role;

-- Bytes held by everything that is not rejected. Stops the archive filling up.
create or replace function public.used_storage() returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(sum(expected_size), 0) from public.posts where status <> 'rejected';
$$;
revoke all on function public.used_storage() from public, anon, authenticated;
grant execute on function public.used_storage() to service_role;

-- Tags exist once, then get attached to a post.
create or replace function public.attach_tags(post_id uuid, tag_list text[]) returns void
language plpgsql security definer set search_path='' as $$
declare item text;
begin
  foreach item in array tag_list loop
    insert into public.tags(name) values(item) on conflict do nothing;
    insert into public.post_tags(post_id, tag) values(post_id, item)
    on conflict do nothing;
  end loop;
end;
$$;
revoke all on function public.attach_tags(uuid, text[]) from public, anon, authenticated;
grant execute on function public.attach_tags(uuid, text[]) to service_role;

create or replace function public.album_size(album_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.album_items where album_id = album_id;
$$;
revoke all on function public.album_size(uuid) from public, anon, authenticated;
grant execute on function public.album_size(uuid) to service_role;

create or replace function public.is_unique_slug(candidate text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.albums where slug = candidate);
$$;
revoke all on function public.is_unique_slug(text) from public, anon, authenticated;
grant execute on function public.is_unique_slug(text) to service_role;
