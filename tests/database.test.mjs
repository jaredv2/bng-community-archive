import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("database enforces anonymous permissions, moderation, storage and atomic likes", async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.user',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt',true),''),'{}')::jsonb$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated;grant select on storage.objects to anon,authenticated;`);
  for (const file of ["schema", "functions", "policies"]) {
    let sql = await readFile(`supabase/${file}.sql`, "utf8");
    sql = sql
      .replace("create extension if not exists pgcrypto;", "")
      .replace(
        "alter publication supabase_realtime add table public.messages;",
        "",
      );
    await db.exec(sql);
  }
  const pending = "00000000-0000-4000-8000-000000000001",
    approved = "00000000-0000-4000-8000-000000000002";
  await db.query(
    `insert into posts(id,username,caption,storage_path,media_type,mime,expected_size,upload_token_hash,uploaded,status) values($1,'A','Pending','pending.jpg','image','image/jpeg',100,'hash',true,'pending'),($2,'B','Approved','approved.jpg','image','image/jpeg',100,'hash',true,'approved')`,
    [pending, approved],
  );
  await db.exec(
    `insert into storage.objects(bucket_id,name) values('community-media','pending.jpg'),('community-media','approved.jpg');set role anon;`,
  );
  assert.equal((await db.query("select id from posts")).rows.length, 1);
  assert.equal(
    (await db.query("select name from storage.objects")).rows[0].name,
    "approved.jpg",
  );
  for (const sql of [
    `update posts set status='approved'`,
    `update posts set likes=999`,
    `delete from posts`,
    `select upload_token_hash from posts`,
    `select * from archive_admins`,
    `update messages set content='tampered'`,
    `insert into storage.objects(bucket_id,name) values('community-media','bad.jpg')`,
  ])
    await assert.rejects(db.exec(sql));
  await assert.rejects(db.query("select increment_post_likes($1)", [pending]));
  await assert.rejects(
    db.query(
      "insert into comments(post_id,name,content) values($1,'A','hidden')",
      [pending],
    ),
  );
  await db.query(
    "insert into comments(post_id,name,content) values($1,'A','hello')",
    [approved],
  );
  await db.exec(
    "insert into messages(name,content) values('A','<script>alert(1)</script>')",
  );
  await Promise.all(
    Array.from({ length: 20 }, () =>
      db.query("select increment_post_likes($1)", [approved]),
    ),
  );
  assert.equal(
    Number((await db.query("select likes from posts")).rows[0].likes),
    20,
  );
  await db.exec("reset role");
  const user = "00000000-0000-4000-8000-000000000003",
    session = "00000000-0000-4000-8000-000000000004";
  await db.query("insert into auth.users values($1)", [user]);
  await db.query("insert into archive_admins values($1)", [user]);
  await db.query("insert into auth.sessions values($1,$2,now())", [
    session,
    user,
  ]);
  await db.query(
    "select set_config('request.user',$1,false),set_config('request.jwt',$2,false)",
    [user, JSON.stringify({ session_id: session })],
  );
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select is_admin() as allowed")).rows[0].allowed,
    true,
  );
  await db.exec(
    "reset role;update auth.sessions set created_at=now()-interval '13 hours';set role authenticated",
  );
  assert.equal(
    (await db.query("select is_admin() as allowed")).rows[0].allowed,
    false,
  );
  await db.exec("reset role;delete from auth.sessions;set role authenticated");
  assert.equal(
    (await db.query("select is_admin() as allowed")).rows[0].allowed,
    false,
  );
  await db.close();
});
