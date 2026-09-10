begin;
alter table public.posts drop constraint if exists posts_expected_size_check;
alter table public.posts add constraint posts_expected_size_check check(expected_size > 0 and expected_size <= case when mime like 'video/%' then 52428800 else 20971520 end);
update storage.buckets set file_size_limit=52428800 where id='community-media';
commit;
