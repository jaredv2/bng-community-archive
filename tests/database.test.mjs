import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const BOOTSTRAP = `
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create table auth.sessions(id uuid primary key, user_id uuid, created_at timestamptz);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.user',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt',true),''),'{}')::jsonb $$;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated;
grant select on storage.objects to anon, authenticated;
`;

const IDS = {
  pending: "00000000-0000-4000-8000-000000000001",
  approved: "00000000-0000-4000-8000-000000000002",
  album: "00000000-0000-4000-8000-000000000010",
};

async function boot() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const file of ["schema", "functions", "policies"]) {
    let sql = await readFile(`supabase/${file}.sql`, "utf8");
    sql = sql
      .replace("create extension if not exists pgcrypto;", "")
      .replace("alter publication supabase_realtime add table public.messages;", "");
    await db.exec(sql);
  }
  return db;
}

async function seed(db) {
  await db.query(
    `insert into posts(id,username,caption,storage_path,poster_path,media_type,mime,expected_size,upload_token_hash,uploaded,status,width,height) values
     ($1,'Anon','Waiting room #beach','00000000-0000-4000-8000-000000000001_1700000000000.jpg','00000000-0000-4000-8000-000000000001_poster.webp','image','image/jpeg',100,'hash',true,'pending',800,600),
     ($2,'Guest','Sunset over the pier #sunset','00000000-0000-4000-8000-000000000002_1700000000001.jpg','00000000-0000-4000-8000-000000000002_poster.webp','image','image/jpeg',100,'hash',true,'approved',1200,900)`,
    [IDS.pending, IDS.approved],
  );
  await db.query(`insert into albums(id,slug,title,description,creator_name) values($1,'beach-days','Beach days','Photos from the shore.','Anon')`, [IDS.album]);
  await db.query(`insert into tags(name) values('beach'),('sunset')`);
  await db.query(`insert into post_tags(post_id,tag) values($1,'beach'),($2,'sunset')`, [IDS.pending, IDS.approved]);
  await db.query(`insert into album_items(album_id,post_id) values($1,$2)`, [IDS.album, IDS.approved]);
  await db.exec(
    `insert into storage.objects(bucket_id,name) values
     ('community-media','00000000-0000-4000-8000-000000000001_1700000000000.jpg'),
     ('community-media','00000000-0000-4000-8000-000000000002_1700000000001.jpg'),
     ('community-posters','00000000-0000-4000-8000-000000000002_poster.webp'),
     ('community-media','secret.jpg')`,
  );
}

test("anonymous visitors only see approved memories, albums and their media", async () => {
  const db = await boot();
  await seed(db);
  await db.exec("set role anon");

  const posts = await db.query("select id, caption from posts");
  assert.equal(posts.rows.length, 1);
  assert.equal(posts.rows[0].id, IDS.approved);

  // Hidden columns are not readable even though the row passes the policy.
  await assert.rejects(db.query("select upload_token_hash from posts"));
  await assert.rejects(db.query("select expected_size from posts"));
  await assert.rejects(db.query("select mime from posts"));
  await assert.rejects(db.query("select * from archive_admins"));
  await assert.rejects(db.query("select * from rate_limits"));
  await assert.rejects(db.query("select * from reports"));

  // A pending memory is not readable, and neither is its file.
  const objects = await db.query("select name from storage.objects order by name");
  assert.deepEqual(
    objects.rows.map((row) => row.name),
    ["00000000-0000-4000-8000-000000000002_1700000000001.jpg","00000000-0000-4000-8000-000000000002_poster.webp"],
  );

  // Tags only come through for approved memories.
  const tags = await db.query("select tag from post_tags");
  assert.deepEqual(tags.rows.map((row) => row.tag), ["sunset"]);

  // Albums and their contents are public.
  assert.equal((await db.query("select title from albums")).rows.length, 1);
  assert.equal((await db.query("select post_id from album_items")).rows.length, 1);

  await db.close();
});

test("anonymous visitors cannot change the archive or plant content", async () => {
  const db = await boot();
  await seed(db);
  await db.exec("set role anon");

  for (const sql of [
    `update posts set status='approved'`,
    `update posts set likes=999`,
    `update posts set pinned=true`,
    `delete from posts`,
    `insert into posts(username,caption,storage_path,media_type,mime,expected_size,upload_token_hash) values('X','X','00000000-0000-4000-8000-000000000050_1700000000005.jpg','image','image/jpeg',1,'h')`,
    `insert into albums(title,description,creator_name) values('Spam','Spam','Spam')`,
    `update albums set title='Changed'`,
    `delete from albums`,
    `insert into album_items(album_id,post_id) values('${IDS.album}','${IDS.pending}')`,
    `insert into reports(target_type,target_id,reason) values('post','${IDS.approved}','x')`,
    `update messages set content='tampered'`,
    `delete from messages`,
    `insert into tags(name) values('planted')`,
    `insert into storage.objects(bucket_id,name) values('community-media','bad.jpg')`,
    `select consume_limit('k',1,60)`,
    `select attach_tags('${IDS.approved}',array['x'])`,
    `select used_storage()`,
  ])
    await assert.rejects(db.exec(sql), undefined, `should have been refused: ${sql}`);

  // A comment on an approved memory is fine, on a pending one is not.
  await db.query(`insert into comments(post_id,name,content) values($1,'A','hello')`, [IDS.approved]);
  await assert.rejects(
    db.query(`insert into comments(post_id,name,content) values($1,'A','hidden')`, [IDS.pending]),
  );

  // Script tags are stored as plain text and read back untouched.
  await db.exec(`insert into messages(name,content) values('A','<script>alert(1)</script>')`);
  const stored = (await db.query("select content from messages")).rows[0].content;
  assert.equal(stored, "<script>alert(1)</script>");

  await db.close();
});

test("likes are atomic and only count on approved memories", async () => {
  const db = await boot();
  await seed(db);
  await db.exec("set role anon");
  await assert.rejects(db.query("select increment_post_likes($1)", [IDS.pending]));
  await Promise.all(
    Array.from({ length: 20 }, () => db.query("select increment_post_likes($1)", [IDS.approved])),
  );
  assert.equal(
    Number((await db.query("select likes from posts where id=$1", [IDS.approved])).rows[0].likes),
    20,
  );
  await db.close();
});

test("rate limits count inside a window and reset after it", async () => {
  const db = await boot();
  await db.exec("set role service_role");
  for (let attempt = 0; attempt < 3; attempt++)
    assert.equal(
      (await db.query("select consume_limit('k',3,3600) as ok")).rows[0].ok,
      true,
    );
  assert.equal((await db.query("select consume_limit('k',3,3600) as ok")).rows[0].ok, false);
  await db.exec(`update rate_limits set started_at = now() - interval '2 hours'`);
  assert.equal((await db.query("select consume_limit('k',3,3600) as ok")).rows[0].ok, true);
  await db.close();
});

test("storage budget ignores rejected memories", async () => {
  const db = await boot();
  await seed(db);
  await db.exec("set role service_role");
  assert.equal(Number((await db.query("select used_storage() as used")).rows[0].used), 200);
  await db.query(`update posts set status='rejected' where id=$1`, [IDS.approved]);
  assert.equal(Number((await db.query("select used_storage() as used")).rows[0].used), 100);
  await db.close();
});

test("tags are attached once and tags table stays clean", async () => {
  const db = await boot();
  await db.exec("set role service_role");
  await db.query("insert into posts(id,username,caption,storage_path,media_type,mime,expected_size,upload_token_hash) values('00000000-0000-4000-8000-000000000020','A','C','00000000-0000-4000-8000-000000000020_1700000000004.jpg','image','image/jpeg',1,'h')");
  const post = "00000000-0000-4000-8000-000000000020";
  await db.query("select attach_tags($1,array['beach','sunset','new']) ", [post]);
  await db.query("select attach_tags($1,array['beach']) ", [post]);
  assert.equal((await db.query("select count(*)::int as n from tags")).rows[0].n, 3);
  assert.equal((await db.query("select count(*)::int as n from post_tags where post_id=$1", [post])).rows[0].n, 3);
  // Deleting the memory takes its tag links with it, the tag words stay.
  await db.query("delete from posts where id=$1", [post]);
  assert.equal((await db.query("select count(*)::int as n from post_tags")).rows[0].n, 0);
  await db.close();
});

test("memories publish on arrival, but only after the file is verified", async () => {
  const db = await boot();
  // This is what the function does at the end of a successful finalize: it
  // flips uploaded and approved together, which is the only way past the
  // table constraint.
  const id = "00000000-0000-4000-8000-000000000050";
  const path = "00000000-0000-4000-8000-000000000050_1700000000009.jpg";
  await db.query(
    "insert into posts(id,username,caption,storage_path,media_type,mime,expected_size,upload_token_hash,uploaded,status) values($1,'Anon','Straight to the shelf',$2,'image','image/jpeg',10,'h',false,'pending')",
    [id, path],
  );
  await db.exec("set role anon");
  // While it is only reserved, nobody can see it.
  assert.equal((await db.query("select id from posts where id=$1", [id])).rows.length, 0);
  await db.exec("set role service_role");
  // Approving before the upload lands is refused by the constraint.
  await assert.rejects(
    db.query("update posts set status='approved' where id=$1", [id]),
    undefined,
    "approved before upload",
  );
  // The verified finalize sets both in one statement.
  await db.query(
    "update posts set uploaded=true, status='approved', approved_at=now() where id=$1 and status='pending'",
    [id],
  );
  await db.exec("set role anon");
  const visible = await db.query("select id from posts where id=$1", [id]);
  assert.equal(visible.rows.length, 1, "a verified memory did not become visible");
  await db.close();
});

test("unpublishing takes a live memory back out and frees the row", async () => {
  const db = await boot();
  await seed(db);
  await db.exec("set role service_role");
  const rows = await db.query(
    "update posts set status='rejected' where id=$1 and status='approved' returning id",
    [IDS.approved],
  );
  assert.equal(rows.rows.length, 1, "unpublish found nothing to take down");
  await db.exec("set role anon");
  assert.equal(
    (await db.query("select id from posts where id=$1", [IDS.approved])).rows.length,
    0,
    "an unpublished memory is still readable",
  );
  // Its file goes with it, because the storage policy keys off the same status.
  const objects = await db.query("select name from storage.objects order by name");
  assert.deepEqual(objects.rows, [], "the file stayed reachable after unpublishing");
  // A second attempt finds nothing, so it cannot be replayed.
  await db.exec("set role service_role");
  assert.equal(
    (await db.query(
      "update posts set status='rejected' where id=$1 and status='approved' returning id",
      [IDS.approved],
    )).rows.length,
    0,
  );
  await db.close();
});

test("admin access follows live session age, not token age", async () => {
  const db = await boot();
  const user = "00000000-0000-4000-8000-000000000003";
  const session = "00000000-0000-4000-8000-000000000004";
  await db.query("insert into auth.users values($1)", [user]);
  await db.query("insert into archive_admins values($1)", [user]);
  await db.query("insert into auth.sessions values($1,$2,now())", [session, user]);
  const signIn = `select set_config('request.user',$1,false), set_config('request.jwt',$2,false)`;

  await db.query(signIn, [user, JSON.stringify({ session_id: session })]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select is_admin() as allowed")).rows[0].allowed, true);

  await db.exec(`reset role; update auth.sessions set created_at = now() - interval '13 hours'; set role authenticated`);
  assert.equal((await db.query("select is_admin() as allowed")).rows[0].allowed, false);

  await db.exec(`reset role; delete from auth.sessions; set role authenticated`);
  assert.equal((await db.query("select is_admin() as allowed")).rows[0].allowed, false);
  await db.close();
});

test("table shapes reject bad values before any code runs", async () => {
  const db = await boot();
  const insert = (values) =>
    db.query(
      `insert into posts(username,caption,storage_path,media_type,mime,expected_size,upload_token_hash,poster_path) values($1,$2,'00000000-0000-4000-8000-000000000040_1700000000002.jpg','image','image/jpeg',10,'h',$3)`,
      values,
    );
  await assert.rejects(insert(["", "caption", null]), undefined, "empty name");
  await assert.rejects(insert(["A".repeat(61), "caption", null]), undefined, "name too long");
  await assert.rejects(insert(["A", "", null]), undefined, "empty caption");
  await assert.rejects(insert(["A", "c".repeat(1001), null]), undefined, "caption too long");
  await assert.rejects(insert(["A", "caption", "../../escape.webp"]), undefined, "path traversal in poster path");
  await assert.rejects(
    db.query(
      `insert into posts(username,caption,storage_path,media_type,mime,expected_size,upload_token_hash) values('A','c','../../etc/passwd','image','image/jpeg',10,'h')`,
    ),
    undefined,
    "path traversal in storage path",
  );

  // An approved memory always has to have been uploaded.
  const id = "00000000-0000-4000-8000-000000000030";
  await db.query(
    "insert into posts(id,username,caption,storage_path,media_type,mime,expected_size,upload_token_hash,uploaded,status) values($1,'A','c','00000000-0000-4000-8000-000000000030_1700000000003.jpg','image','image/jpeg',10,'h',false,'pending')",
    [id],
  );
  await assert.rejects(
    db.query("update posts set status='approved' where id=$1", [id]),
    undefined,
    "approving something that was never uploaded",
  );
  // One byte over the still image ceiling is refused.
  await assert.rejects(
    db.query(
      "insert into posts(username,caption,storage_path,media_type,mime,expected_size,upload_token_hash) values('A','c','00000000-0000-4000-8000-000000000031_1700000000004.jpg','image','image/jpeg',26214401,'h')",
    ),
    undefined,
    "oversized image",
  );
  // A video may go up to 50 MB, so the same size is fine there.
  await db.query(
    "insert into posts(username,caption,storage_path,media_type,mime,expected_size,upload_token_hash) values('A','c','00000000-0000-4000-8000-000000000032_1700000000005.mp4','video','video/mp4',52428800,'h')",
  );
  await db.close();
});
