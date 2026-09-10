-- These security-definer functions use a fixed search_path and explicit grants.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.archive_admins a join auth.sessions s on s.user_id=a.user_id cross join public.archive_settings cfg
 where a.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
 and s.created_at > now()-make_interval(hours=>cfg.admin_session_hours));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
create or replace function public.increment_post_likes(post_id uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare updated bigint;
begin
 update public.posts set likes=likes+1 where id=post_id and status='approved' returning likes into updated;
 if updated is null then raise exception 'Post unavailable'; end if;
 return updated;
end; $$;
revoke all on function public.increment_post_likes(uuid) from public;
grant execute on function public.increment_post_likes(uuid) to anon,authenticated;
create or replace function public.consume_upload_limit(rate_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.upload_rate_limits(key,attempts) values(rate_key,1)
 on conflict(key) do update set attempts=case when public.upload_rate_limits.started_at < now()-interval '1 hour' then 1 else public.upload_rate_limits.attempts+1 end,
 started_at=case when public.upload_rate_limits.started_at < now()-interval '1 hour' then now() else public.upload_rate_limits.started_at end returning attempts into n;
 return n<=10;
end; $$;
revoke all on function public.consume_upload_limit(text) from public,anon,authenticated;
grant execute on function public.consume_upload_limit(text) to service_role;
create or replace function public.upload_metadata(object_path text) returns jsonb language sql security definer set search_path='' as $$
 select metadata from storage.objects where bucket_id='community-media' and name=object_path;
$$;
revoke all on function public.upload_metadata(text) from public,anon,authenticated;
grant execute on function public.upload_metadata(text) to service_role;
