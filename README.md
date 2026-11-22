# ApplyIQ CRM

This first build provides a responsive local operator demo and a separate Supabase intake foundation. Use sample contact data in the browser demo. It stores records in localStorage and has no staff authentication or cross-device synchronization.

## Run

Use Node.js 22 or later. Run `npm run dev` and open http://127.0.0.1:4173. Run `npm test` to check identity normalization, inquiry history, replay handling and follow-up scheduling.

## Supabase and Vercel

- Review and test `supabase/foundation.sql` in a dedicated Supabase project. It defines organizations, staff membership, department sharing, leads, inquiry history, follow-ups, and trigger-based audit history.
- Provision the organization and staff membership in Supabase. The intake function is executable by the service role only.
- Set the variables in `.env.example` as Vercel server-side values. The Vercel function at `POST /api/intake` requires the intake secret as a Bearer token. Pass JSON with `name`, `phone`, `email`, `topic`, `source` and `externalId`. Use a stable, account-qualified ID per source event. Call it from a trusted server adapter only.
- This function stores inquiries in Supabase. The demo dashboard displays its browser-local dataset.
- Configure a private repository and connect it to Vercel after validating the environment. No secrets belong in Git.

## Staff sign-in and shared leads

Open `/staff.html` for the authenticated staff workspace. Set `SUPABASE_PUBLISHABLE_KEY` in Vercel using the publishable key from the same Supabase project. This route also requires `SUPABASE_URL` and `SUPABASE_ORG_ID`. For local development with an environment file, run `node --env-file=.env.local server.js`.

Apply `supabase/staff-intake.sql` after the foundation schema to enable the New inquiry form for active super administrators. The database verifies the role and records the signed-in actor in audit history. The form uses the shared intake logic for repeat inquiries and identifies submissions so retries do not create duplicate inquiry events.

Apply `supabase/staff-setup.sql` after the foundation schema. This migration installs the function and permissions used by the form. Set `APPLYIQ_SETUP_KEY` to a new random secret of at least 32 characters in Vercel and deploy. Open `/setup.html`, enter the setup key, and choose the first administrator's email and password. The form creates the Auth account and links it to the existing organization. Once the first staff membership exists, further setup requests are rejected. Remove the setup key from Vercel and redeploy after signing in successfully.

Staff requests use an authenticated Supabase access token, so the existing row policies determine which leads are visible. Sign in again after reloading or after the token expires.

## Remaining production work

- Extend the authenticated staff workspace with lead detail, mutations, branch- and assignment-level access, sensitive-field permissions and full audit views.
- Add source verification and webhook adapters for Meta Lead Ads, Instagram, WhatsApp, Messenger, email and the public site. Stage incomplete inquiries separately so source events are retained while mandatory contact data is collected. Provide an operator review queue for conflicting identities.
- Build the conversation inbox, provider delivery callbacks, consent and template rules, and an idempotent background worker for due reminders, retries and escalation. Add browser session integration for authorized university portals and supported provider flows with interactive login, isolated sessions and server-side activity tracking.
- Add separate applications per student, university and intake with admissions, visa, travel and enrollment checklists. Add private document storage, staff chat, accounts, activity reporting and AI orchestration.
