# Supabase setup

Follow the complete [project setup guide](../README.md).

Apply SQL in order: `schema.sql` → `functions.sql` → `policies.sql`. The policies file creates the private Storage bucket and its RLS policy. Create an Auth user, add its UUID to `archive_admins`, configure allowed origins, and deploy `archive` with the CLI commands in the guide.

No admin password or service-role key belongs in frontend configuration. The only browser configuration is `assets/js/config.js` with the project URL and public anon key.
