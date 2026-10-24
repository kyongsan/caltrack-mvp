# CalTrack

Private meal, weight, energy and medication journal. The dashboard uses saved records, not sample values. Dates and daily boundaries use Asia/Tokyo.

## Run

Node 22 or later. `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.

Link the existing Vercel project `haaanco/caltrack-mvp`, then pull its development environment. Populate the required keys in `.env.example` before running `npm run dev`. Never copy production secrets into Git.

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported), and server-only `SUPABASE_SERVICE_ROLE_KEY`. Optional: OpenAI for text/photo estimation; Slack for input. Manual calorie entry works without OpenAI.

## Database and identity

Fresh databases: run `supabase/schema.sql`, then `supabase/upgrade-web.sql`. Existing databases: apply only the additive upgrade. The upgrade has already been applied to the existing project during this continuation. No test meals were retained.

The database remains server-only: RLS is enabled and `anon`/`authenticated` have no access to the record tables. The server verifies the Supabase token with `getUser()` on each request, then derives the profile from `auth_user_id`. The first login can claim only a pre-provisioned profile with a matching, verified email; request bodies never determine ownership. Provision the owner's profile through a trusted admin channel. Account provisioning data must not be committed to this public repository.

Enable email authentication in Supabase, set Site URL to the production app, and allow `<app-origin>/dashboard` as a redirect URL. First-time users can use the login email; existing users can also use a password. Creating an Auth identity alone grants no record access.

## Behavior

- Today: meal entry, AI draft estimation, portion adjustment, confirmation, edit and soft delete; weight/body fat, total energy and medication logs.
- History: 30 days of records, weight chart, seven-day intake and meal CSV (with formula injection protection).
- Settings: daily intake target and medication definitions.
- Total energy is the complete daily total (resting + active), never added to active calories again. Missing expenditure or targets remain unknown.
- Medicines are recorded only; they do not alter calculated calories.
- Photos are resized locally, sent to OpenAI for estimation with `store:false`, and not retained by this app. Only confirmed totals and nutrition estimates are saved.
- `/setup` reports real connection checks to authenticated users only.

## Slack

Configure `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_USER_ID` and `APP_OWNER_EMAIL`. `SLACK_WORKSPACE_ID` is optional; when absent the server verifies the workspace against the configured bot with Slack auth.test. This explicitly links the allowed Slack identity with the pre-provisioned web profile. Set Slack's event URL to `/api/slack/events`; `/api/slack/verify` remains a compatible alias. Both validate signatures. Existing scopes and events are in `slack/manifest.yaml`.

Photo messages are estimated and saved through the existing bot flow. Web text/photo estimates require confirmation before saving. Message retries and overlapping message/app-mention deliveries share a unique message key; database uniqueness prevents duplicate meals. No live Slack messages were sent during testing. Slack natural-language corrections and automatic posting schedules remain future work.

## Verification and remaining deployment work

Local tests cover Tokyo midnight, missing values, energy double counting, removed records, CSV escaping, Slack request signing and file host restrictions, plus unauthenticated and foreign-account access. Production build succeeds without credentials because the dashboard requests public configuration at runtime.

An actual database transaction verified meal insertion, correction, idempotency and soft deletion, then rolled back. Anonymous/authenticated direct table grants were checked to be absent. Security advisors returned only informational findings for intentional RLS-with-no-policy tables.

Vercel team access is authorized. The publishable Supabase key and owner profile configuration have been added to the deployment environments. A real temporary Auth identity verified sign-in, rejection before profile provisioning, and an authenticated initial read; test identities were removed.

Email login is still blocked by the existing Supabase URL configuration: redirects currently fall back to localhost:3000. Set Site URL to https://caltrack-mvp-haaanco.vercel.app and allow https://caltrack-mvp-haaanco.vercel.app/dashboard in Authentication > URL Configuration. This change requires access to the Supabase dashboard. Complete browser-to-database verification after correcting it. No live Slack messages were sent.
