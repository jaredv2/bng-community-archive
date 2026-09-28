-- Run schema.sql, then functions.sql, then policies.sql.
create extension if not exists pgcrypto;

create table public.archive_settings (
  id boolean primary key default true check(id),
  admin_session_hours integer not null default 12 check(admin_session_hours between 1 and 168)
);
insert into public.archive_settings default values;

create table public.archive_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  username text not null check(char_length(btrim(username)) between 1 and 60),
  caption text not null check(char_length(btrim(caption)) between 1 and 1000),
  storage_path text not null unique check(storage_path ~ '^[0-9a-f-]{36}_[0-9]{13}\.[a-z0-9]{2,5}$'),
  poster_path text check(poster_path is null or poster_path ~ '^[0-9a-f-]{36}_poster\.webp$'),
  media_type text not null check(media_type in ('image','gif','video')),
  mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm')),
  width integer check(width is null or width between 1 and 20000),
  height integer check(height is null or height between 1 and 20000),
  expected_size bigint not null check(expected_size > 0 and expected_size <= case when mime like 'video/%' then 52428800 else 26214400 end),
  upload_token_hash text not null,
  uploaded boolean not null default false,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  likes bigint not null default 0 check(likes>=0),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  check(status != 'approved' or uploaded)
);

create table public.tags (
  name text primary key check(name ~ '^[a-z0-9][a-z0-9_-]{0,31}$')
);

create table public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag text not null references public.tags(name) on delete cascade,
  primary key(post_id, tag)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 60),
  content text not null check(char_length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 1 and 60),
  content text not null check(char_length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check(char_length(slug) between 1 and 60),
  title text not null check(char_length(btrim(title)) between 1 and 80),
  description text not null check(char_length(btrim(description)) between 1 and 400),
  creator_name text not null check(char_length(btrim(creator_name)) between 1 and 60),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.album_items (
  album_id uuid not null references public.albums(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key(album_id, post_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check(target_type in ('post','album','comment')),
  target_id uuid not null,
  reason text not null check(char_length(btrim(reason)) between 1 and 300),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text primary key,
  attempts integer not null,
  started_at timestamptz not null default now()
);

create index posts_gallery on public.posts(pinned desc, approved_at desc, id) where status='approved';
create index posts_moderation on public.posts(status, uploaded, created_at desc);
create index comments_post_date on public.comments(post_id, created_at, id);
create index messages_date on public.messages(created_at desc, id);
create index post_tags_tag on public.post_tags(tag, post_id);
create index album_items_post on public.album_items(post_id);
create index albums_recent on public.albums(hidden, created_at desc);
create index reports_open on public.reports(resolved, created_at desc);

alter publication supabase_realtime add table public.messages;
