# CalTrack

Private meal, weight, energy and medication journal. The dashboard uses saved records, not sample values. Dates and daily boundaries use Asia/Tokyo.

## Run

Node 22 or later. `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.

Link the existing Vercel project `haaanco/caltrack-mvp`, then pull its development environment. Populate the required keys in `.env.example` before running `npm run dev`. Never copy production secrets into Git.

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported), and server-only `SUPABASE_SERVICE_ROLE_KEY`. Optional: OpenAI for text/photo estimation; Slack for input. Manual calorie entry works without OpenAI.

## Database and identity

Fresh databases: run `supabase/schema.sql`, then `supabase/upgrade-web.sql`. Existing databases: apply only the additive upgrade. The upgrade has already been applied to the existing project during this continuation. No test meals were retained.

The database remains server-only: RLS is enabled and `anon`/`authenticated` have no access to the record tables. The server verifies the Supabase token with `getUser()` on each request, then derives the profile from `auth_user_id`. The first login can claim only a pre-provisioned profile with a matching, verified email; request bodies never determine ownership. Provision the owner's profile through a trusted admin channel. Account provisioning data must not be committed to this public repository.

Enable email authentication in Supabase, set Site URL to the production app, and allow `<app-origin>/dashboard` as a redirect URL. Password login is the default. Existing email-only users choose "初回設定・パスワードを忘れた方", verify their email via the recovery link, and set a password. Signed-in users can also set or change it in Settings. The dashboard handles PASSWORD_RECOVERY before showing records, clears URL tokens, and persists/refreshes sessions on the same browser or installed app. Creating an Auth identity alone grants no record access.

## Behavior

- Today: meal entry, AI draft estimation, portion adjustment, confirmation, edit and soft delete; weight/body fat, total energy and medication logs.
- History: 30 days of records, weight chart, seven-day intake and meal CSV (with formula injection protection).
- Settings: daily intake target, medication definitions, and password setup/change.
- Total energy is the complete daily total (resting + active), never added to active calories again. Missing expenditure or targets remain unknown.
- Medicines are recorded only; they do not alter calculated calories.
- Select up to 12 meal photos together or add them in batches; preview and remove individual photos before estimation. Photos are compressed locally to fit a combined 3.5 MB base64 budget, sent together to OpenAI with `store:false`, and not retained by this app. The prompt treats them as one meal and asks the model to avoid counting repeated views of the same dish twice. Only confirmed totals and nutrition estimates are saved. The analysis API also accepts the previous single-photo request format.
- `/setup` reports real connection checks to authenticated users only.

## Slack

Configure `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_USER_ID` and `APP_OWNER_EMAIL`. `SLACK_WORKSPACE_ID` is optional; when absent the server verifies the workspace against the configured bot with Slack auth.test. This explicitly links the allowed Slack identity with the pre-provisioned web profile. Set Slack's event URL to `/api/slack/events`; `/api/slack/verify` remains a compatible alias. Both validate signatures. Existing scopes and events are in `slack/manifest.yaml`.

Photo messages are estimated and saved through the existing bot flow. Web text/photo estimates require confirmation before saving. Message retries and overlapping message/app-mention deliveries share a unique message key; database uniqueness prevents duplicate meals. No live Slack messages were sent during testing. Slack natural-language corrections and automatic posting schedules remain future work.

## Verification and deployment

Local tests cover Tokyo midnight, missing values, energy double counting, removed records, CSV escaping, Slack request signing and file host restrictions, plus unauthenticated and foreign-account access. Production build succeeds without credentials because the dashboard requests public configuration at runtime.

An actual database transaction verified meal insertion, correction, idempotency and soft deletion, then rolled back. Anonymous/authenticated direct table grants were checked to be absent. Security advisors returned only informational findings for intentional RLS-with-no-policy tables.

Vercel team access is authorized. The publishable Supabase key and owner profile configuration have been added to the deployment environments. Production API checks verified email-link authentication, rejection before profile provisioning, meal save/reload/correction/deletion, retry idempotency, and weight/energy/target persistence. Temporary profiles and Auth identities were removed after verification.

Email URL configuration is complete: Site URL is https://caltrack-mvp-haaanco.vercel.app and the allowed redirect is https://caltrack-mvp-haaanco.vercel.app/dashboard. A generated email-login link was verified against the live Auth service: it redirects to the production dashboard and issues a valid session. No real-user login email or live Slack message was sent during testing.

The OpenAI key was replaced and API credits activated. Live production text estimation, image-input estimation using a synthetic fixture, and saving/reloading the confirmed AI total passed. Real food-photo accuracy has not been evaluated. Slack bot credentials passed auth.test; actual Slack message delivery has not been tested.

Password verification against the live Auth service covered email-only account recovery, setting a first password, signing in with it, rejecting a wrong password, and refresh-token renewal without entering credentials again. Temporary Auth identities were removed. Type checking, all 14 existing tests, and the production build passed. Local browser automation could not run in this environment, so device-specific Home Screen persistence remains to be checked on the user's device.

## Oura Ring

Apply `supabase/oura.sql` and configure server-only `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, and `OURA_TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64). Register the exact OAuth redirect `https://caltrack-mvp-haaanco.vercel.app/api/oura/callback`. `CALTRACK_ORIGIN` can override the production origin for another installation. Never rotate the encryption key without reconnecting Oura accounts.

Open `/integrations/oura` while signed into CalTrack, then authorize Oura. The scope is `daily` only. Consent uses PKCE, state matching, a ten-minute authenticated encrypted browser cookie, and a profile binding derived from the verified app session. Tokens are encrypted with AES-256-GCM and stored in a server-only RLS table; the browser never receives Oura tokens. A database lease serializes refresh-token rotation.

The dashboard imports the previous 30 completed Oura calendar days on app open if the last sync was at least 12 hours ago. There is no scheduled background job. Only daily `total_calories` is imported as estimated daily total expenditure; today's incomplete data, zero placeholders, steps, sleep, readiness and heart rate are excluded. Daily upserts are idempotent. Manual daily totals take precedence, and activity calories are never added again. Disconnect removes stored credentials but keeps previously imported totals; Oura's grant can also be revoked in Oura settings.

Verification: unit tests cover token tampering, consent scope/PKCE, anonymous requests, invalid callback state, pagination, duplicate dates, completed-day filtering, and manual-total precedence. A live Oura consent and real-data sync require the owner's Oura login and client registration and must be verified before reporting the account connected.


## Withings weight and body-fat sync

- Apply `supabase/withings.sql` to the existing project. Connection tokens remain encrypted and are inaccessible to public/client database roles.
- Register CalTrack in the official Withings developer dashboard. Exact redirect URI: `https://caltrack-mvp-haaanco.vercel.app/api/withings/callback`. Request only `user.metrics`.
- Set production-only server variables `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`, and `WITHINGS_TOKEN_ENCRYPTION_KEY` (independent random 32-byte base64 secret), then redeploy. Do not prefix these with NEXT_PUBLIC or commit real values.
- Open `/integrations/withings` while logged in, connect and grant consent. The page states clearly that the provider's metrics scope is broader than the two measurements we fetch.
- First sync requests the provider's available history using `lastupdate=0`; subsequent syncs use a saved modified-time cursor with a one-second overlap. Preserve timestamps, convert `value * 10^unit`, save weight (type 1) and optional fat ratio (type 6) from the same group. Objectives, future/invalid/weightless groups are excluded.
- Measurement identity includes the app user, provider user and group ID. Retry-safe upserts do not modify manual entries. A server lease serializes refresh-token rotation; refreshed tokens are encrypted and persisted before data fetching. Pagination is bounded; an incomplete fetch never advances the sync cursor.
- App-open sync is cached for 12 hours. Manual sync bypasses that cache. This does not create a background scheduler: open CalTrack or press sync after a scale upload.
- The existing record API shows 30 days ending at the selected date. Change that date to inspect older imported history. Latest-per-day display uses measurement time. Disconnect deletes the connection, retaining imported history.
- Validation: `npm run typecheck`, `npm test`, `npm run build`; real-provider OAuth/data sync requires registration and the owner's consent.


## Google Health weight sync

- Google Health API v4 (not the retired Google Fit / Fitbit endpoints). Apply `supabase/google-health.sql`.
- Enable Google Health API in an isolated Google Cloud project. Configure a Web OAuth client, the owner as a test user, and only `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`.
- Exact redirect: `https://caltrack-mvp-haaanco.vercel.app/api/google-health/callback`. Set server-only `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`, `GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY` (independent random 32-byte base64 key), then redeploy.
- Google policy/terms acceptance and user consent are separate setup steps. Restricted scopes may require verification/security assessment for public use. External Testing health-scope refresh tokens normally expire in seven days; the connection screen discloses reauthorization.
- `/integrations/google-health`: connects with state-bound encrypted HttpOnly cookie, PKCE S256, offline access. Callback requires a refresh token; refresh responses may omit a replacement and preserve the existing refresh token.
- Fetch only weight and body-fat from the fixed health.googleapis.com endpoints with all-sources and bounded pagination. Preserve full provider resource names in deterministic per-app-user IDs. Convert grams to kg. Attach fat only with the same physical timestamp and data source; never attach unrelated same-day values. Manual entries remain separate.
- Full available history is re-read on sync to incorporate corrections; 12-hour cache for app-open sync, manual bypass. No unbounded polling or scheduler. Existing history screen shows a 30-day window ending on the selected date.
- Google Health must already contain the Withings measurements. Until Google Cloud setup and explicit consent finish, no real Google health data has been imported.
