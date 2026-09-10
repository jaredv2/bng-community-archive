# Community Archive

A dark, responsive community gallery built with HTML, CSS and JavaScript. The frontend is static and supports GitHub project Pages such as `https://USERNAME.github.io/community-archive/`. Supabase provides PostgreSQL, Storage, Auth and one Edge Function; no custom Node server is needed in production.

## What is included

- Home, gallery, upload and realtime public message wall.
- Photo, GIF and HTML5 video viewing; paginated posts and comments.
- Anonymous comments and repeatable, atomic likes.
- Upload previews, drag-and-drop, real upload progress, and pending moderation.
- Hidden `adminpanel/` with Supabase Auth, pending/approved tabs, approval, rejection and pinning.
- Database permissions, private storage, upload signature checks, server-checked 12-hour admin sessions, and setup/tests.

The project starts with no invented posts. Until configured, it displays a connection message and cannot accept submissions. Your project URL and **public anon key** are the only values to insert into the frontend.

## 1. Create and configure Supabase

1. Create a Supabase project and save its database password privately.
2. Open its SQL Editor. Run the complete files in this order, once on a new project:
   - `supabase/schema.sql`
   - `supabase/functions.sql`
   - `supabase/policies.sql`
3. The last file creates the **private** `community-media` bucket, its allowed MIME types, 50 MB ceiling and read policy. Do not make it public and do not add anonymous upload/update/delete policies.
4. Ensure the project's Storage maximum permits 50 MB files. If your project limit is lower, lower the video limit consistently as described below.
5. Realtime is enabled for `messages` by the schema. Keep replication enabled for this table.

The schema files are ordered initial migrations, not scripts to rerun against existing tables. Back up data and write a new migration for later schema changes.

## 2. Set up administrator sign-in

This implementation uses **Supabase Auth email and password**, the secure Auth option in the brief. The password is the administrator credential; there is no shared access code or custom `ADMIN_CODE_HASH` to manage. Supabase stores and verifies the password and applies its Auth rate limits.

1. Disable public sign-ups in Supabase Auth settings; visitors do not need Auth accounts.
2. In Authentication → Users, create your administrator with an email and strong password and confirm the email as appropriate.
3. Copy that user's UUID and run this in the SQL Editor:

   ```sql
   insert into public.archive_admins(user_id)
   values ('YOUR-ADMIN-USER-UUID');
   ```

4. Open `https://USERNAME.github.io/community-archive/adminpanel/` manually after publishing. Enter the email and password and click **Unlock**.

Membership is held in a table with no browser read/write grants. Creating a normal Auth account does not make someone an administrator. There are no public links to the admin panel.

### Change the administrator password without rebuilding

Use Supabase Authentication → Users to update the administrator password. Alternatively, use the Supabase Auth Admin API from a trusted server or private administrative environment; never put a service-role key in the site. Revoke the user's existing sessions when rotating a compromised credential. To revoke administration immediately:

```sql
delete from public.archive_admins where user_id = 'YOUR-ADMIN-USER-UUID';
```

### Session lifetime

Admin authorization checks the JWT's session ID against the live `auth.sessions` row and its original creation time, so token refresh cannot extend administrator access indefinitely. Logout or removal of that session also removes access. The default is 12 hours. Change it server-side:

```sql
update public.archive_settings set admin_session_hours = 24 where id = true;
```

The frontend preserves the Supabase session across page refreshes, checks expiry periodically, and requires a new sign-in when authorization expires. Each privileged Edge Function request verifies the user and server-side session independently. See [Supabase session documentation](https://supabase.com/docs/guides/auth/sessions).

## 3. Deploy the Edge Function

Run these commands from this project directory. Substitute your Supabase project reference (the identifier in its URL):

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Copy `supabase/.env.example` to a private file named `.env.supabase`, then edit it:

```dotenv
ALLOWED_ORIGINS=https://USERNAME.github.io
MAX_IMAGE_SIZE=20971520
MAX_VIDEO_SIZE=52428800
```

An origin contains the scheme and hostname only, **not** `/community-archive/` and no trailing slash. For local testing, use comma-separated origins:

```dotenv
ALLOWED_ORIGINS=https://USERNAME.github.io,http://127.0.0.1:4173
```

Then deploy:

```sh
npx supabase secrets set --env-file .env.supabase
npx supabase functions deploy archive --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

`--no-verify-jwt` allows anonymous upload reservation/finalization. It does **not** bypass administrator authorization: privileged actions explicitly call Auth `getUser()` and the server-side `is_admin()` function. Supabase injects its server-side URL and keys into the function; do not add them to browser files. CORS restricts browser origins but is not an authentication boundary.

After changing allowed origins or limits, rerun `secrets set`. Deploy again when changing function source.

## 4. Insert the two public frontend values

Edit **`assets/js/config.js`**:

```js
SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
SUPABASE_ANON_KEY: 'YOUR_PUBLIC_ANON_KEY',
```

Get these from Supabase's project API settings. Use the public publishable key or legacy `anon` key. Never use a `service_role` or `sb_secret_...` key, database password or JWT signing secret.

Other configuration in this file:

| Value            | Default                 |
| ---------------- | ----------------------- |
| `SITE_NAME`      | Community Archive       |
| `MAX_IMAGE_SIZE` | 20 × 1024 × 1024 bytes  |
| `MAX_VIDEO_SIZE` | 50 × 1024 × 1024 bytes |
| `POSTS_PER_PAGE` | 20                      |

When changing size limits, update frontend config, Edge Function secrets, the `posts.expected_size` database check constraint, the Storage bucket limit and the project's Storage maximum together. The backend and database remain authoritative. MP4 and WebM are accepted; MOV is deliberately excluded because browser playback is inconsistent. Convert MOV files before submitting.

## 5. Publish on GitHub Pages

### Option A: GitHub Actions (recommended)

1. Create an empty GitHub repository named `community-archive`.
2. From this directory:

   ```sh
   git add .
   git commit -m "Build Community Archive"
   git branch -M main
   git remote add origin https://github.com/USERNAME/community-archive.git
   git push -u origin main
   ```

   If you already have an origin, use your existing repository instead of adding a second one.

3. In repository Settings → Pages, choose **GitHub Actions** as the source.
4. The included `.github/workflows/pages.yml` installs pinned dependencies, runs tests, builds the static files and deploys `dist/` on pushes to `main`. You can also run it manually from Actions.
5. Open `https://USERNAME.github.io/community-archive/` when the deployment completes.

### Option B: Publish directly from the main branch

The root contains generated HTML and a bundled Supabase browser client. You can upload the complete project, then select **Deploy from a branch → main → /(root)** in Settings → Pages. `.nojekyll` preserves normal static files.

No frontend build is required after editing only `assets/js/config.js` for branch publishing. If changing the page templates in `scripts/build.mjs`, rebuild and commit the generated HTML too. If using Actions, rebuilds happen automatically.

All route/asset URLs resolve relative to this project. Both domain-root hosting and a repository subpath work without changing a base path.

## Local development

```sh
npm ci
npm run build
npm run dev
```

Open `http://127.0.0.1:4173`. The local server serves `dist/`, so run `npm run build` and refresh after changing source. Add this origin to the function's allowed origins to test uploads and admin operations locally. This server is for development only.

- Page HTML source: `scripts/build.mjs` (generates all five route files).
- Styles: `assets/css/global.css`.
- Reusable UI and separate feature modules: `assets/js/`.
- Browser Supabase library: `assets/vendor/supabase.js`, built from the lockfile.
- Database and permissions: `supabase/*.sql`.
- Upload and moderation service: `supabase/functions/archive/`.

## Security and storage behavior

1. A reservation validates text, extension, MIME, size and a database-backed upload limit (10 reservations/hour per observed IP). It creates a pending record and random object path.
2. The browser receives a write-only, object-specific signed upload URL with overwrite disabled, and uploads directly to Storage with progress. Supabase limits the signed URL's lifetime; see [signed upload URLs](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
3. Finalization requires a separate random capability token. Only its SHA-256 hash is stored in PostgreSQL. The service verifies actual Storage metadata and file magic bytes before marking the upload ready for moderation.
4. Pending files cannot be read by public users. Admin previews require verified authorization.
5. Approval changes database status atomically. The private bucket's RLS then permits the public to obtain one-hour signed read URLs for that approved object. No copy into a public bucket is required. URLs already issued remain valid until their expiry. Opening a post renews its URL; refresh an old gallery tab if a preview has expired.
6. Rejection makes the record nonpublic and removes the object. Competing approve/reject requests are guarded by the current pending status, so one review wins.
7. Pinning only affects approved records. Likes use a single SQL increment, restricted to approved posts. Every completed click may count; there is no one-like-per-user rule.
8. Database column grants prevent callers from choosing timestamps, like counts, statuses or IDs on public inserts. All user text is rendered using `textContent`; the only HTML template inserted by JavaScript is a fixed, developer-authored comment form.

Magic-byte validation catches common MIME spoofing; it is not a full media decoder or malware scanner. The pending bucket permits up to the video ceiling at upload time. Finalization checks the actual image/video-specific size and type before the admin queue can accept it.

### Routine maintenance

Abandoned uploads can leave unfinalized pending records and private objects. Periodically inspect this query in the SQL Editor:

```sql
select id, storage_path, created_at
from public.posts
where (status = 'pending' and not uploaded and created_at < now() - interval '1 day')
   or status = 'rejected';
```

Delete selected objects through Supabase Storage's dashboard/API, **not** by deleting rows directly from `storage.objects`. Then delete the corresponding obsolete `posts` rows. A day is safely beyond a signed upload URL's validity. Keep finalized pending submissions for review. Old rate-limit rows can be pruned with:

```sql
delete from public.upload_rate_limits where started_at < now() - interval '2 days';
```

Monitor public-message/comment abuse and storage usage after launch. These intentionally account-free features are open to the public; remove abusive content through your trusted Supabase dashboard. Auth's login throttling and upload reservation throttling are separate from the intentionally repeatable likes.

## Tests and launch checklist

```sh
npm test
npx --yes deno check supabase/functions/archive/index.ts
npx --yes deno test supabase/functions/archive/media_test.ts
npm run build
```

Automated tests execute the SQL against embedded PostgreSQL with simulated Supabase Auth/Storage schemas. They cover RLS, private pending files, denied mutations, comment restrictions, atomic increments, session expiry, file validation and project-relative routes. Deno verifies the function and media signatures. These tests do not replace a live Supabase integration test.

Before inviting visitors:

- [ ] Open every route under the GitHub repository subpath; confirm CSS/JavaScript load.
- [ ] Test narrow mobile layouts, keyboard navigation, menu, visible focus, dialog Escape and reduced motion.
- [ ] Submit a photo, GIF and supported video; see preview and upload progress.
- [ ] Confirm pending uploads do not appear publicly and an anonymous signed-read request for them fails.
- [ ] Reject unsupported, oversized and spoofed media; check friendly errors.
- [ ] Sign in at `adminpanel/`, refresh and remain signed in; test wrong credentials and non-admin users.
- [ ] Approve one submission and see it in the gallery with its original name/caption/time.
- [ ] Reject another and verify it stays hidden and its file is removed.
- [ ] Pin/unpin approved posts and verify ordering.
- [ ] Click like repeatedly; verify each completed click increments it. Test from two browsers.
- [ ] Post a comment, including literal HTML text; confirm it is displayed as text and comments are oldest first.
- [ ] Post a message with two browsers open; see realtime updates without refreshing.
- [ ] Logout, then confirm privileged requests fail. Test expiry by temporarily lowering the server-side limit.
- [ ] Check the browser console/network for errors and test a disconnected network/retry.

**Delivery validation:** static build, SQL permission tests, input tests, media signature tests and Edge Function type checks were run locally. Live uploads, Auth, Realtime and GitHub publication require your Supabase project configuration and GitHub repository and have not been claimed as tested.

