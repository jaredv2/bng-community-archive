-- Apply schema.sql, functions.sql, then policies.sql as the database owner.
create extension if not exists pgcrypto;
create table public.archive_settings (id boolean primary key default true check(id), admin_session_hours integer not null default 12 check(admin_session_hours between 1 and 168));
insert into public.archive_settings default values;
create table public.archive_admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.posts (
 id uuid primary key default gen_random_uuid(),
 username text not null check(char_length(btrim(username)) between 1 and 60),
 caption text not null check(char_length(btrim(caption)) between 1 and 1000),
 storage_path text not null unique,
 media_type text not null check(media_type in ('image','gif','video')),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm')),
 expected_size bigint not null check(expected_size > 0 and expected_size <= case when mime like 'video/%' then 52428800 else 20971520 end),
 upload_token_hash text not null,
 uploaded boolean not null default false,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 likes bigint not null default 0 check(likes>=0),
 pinned boolean not null default false,
 created_at timestamptz not null default now(), approved_at timestamptz,
 check(status != 'approved' or uploaded)
);
create table public.comments (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 60), content text not null check(char_length(btrim(content)) between 1 and 2000), created_at timestamptz not null default now()
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(btrim(name)) between 1 and 60), content text not null check(char_length(btrim(content)) between 1 and 2000), created_at timestamptz not null default now()
);
create table public.upload_rate_limits (key text primary key, attempts integer not null, started_at timestamptz not null default now());
create index posts_gallery on public.posts(pinned desc,approved_at desc,id) where status='approved';
create index posts_moderation on public.posts(status,uploaded,created_at desc);
create index comments_post_date on public.comments(post_id,created_at,id);
create index messages_date on public.messages(created_at desc,id);
alter publication supabase_realtime add table public.messages;

