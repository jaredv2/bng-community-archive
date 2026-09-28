# Backend setup

Apply these three files as the database owner, in order:

1. `schema.sql` - tables, constraints, indexes, realtime
2. `functions.sql` - security definer helpers, each with a fixed search_path
3. `policies.sql` - grants, row level security, the two storage buckets

`policies.sql` creates both private buckets: `community-media` for the original
uploads and `community-posters` for the small stills generated in the browser.
Neither is public. A memory becomes readable only once it is approved.

Then:

- create an Auth user, and grant it admin rights:
  `insert into public.archive_admins values ('USER-UUID');`
- set function secrets from `.env.example` and deploy with `--no-verify-jwt`

`schema.sql` and `functions.sql` have no destructive statements, so they are
safe to re-apply to an existing project. `policies.sql` creates policies, so
drop the named policy first if you re-apply it.

The only configuration the browser receives is the project URL and the
publishable key, injected into `dist/` at build time from `.env`.
