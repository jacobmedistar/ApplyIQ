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

## Remaining production work

- Connect the dashboard to Supabase Auth and implement authenticated mutations, branch- and assignment-level access, sensitive-field permissions and full audit views.
- Add source verification and webhook adapters for Meta Lead Ads, Instagram, WhatsApp, Messenger, email and the public site. Stage incomplete inquiries separately so source events are retained while mandatory contact data is collected. Provide an operator review queue for conflicting identities.
- Build the conversation inbox, provider delivery callbacks, consent and template rules, and an idempotent background worker for due reminders, retries and escalation. Add browser session integration for authorized university portals and supported provider flows with interactive login, isolated sessions and server-side activity tracking.
- Add separate applications per student, university and intake with admissions, visa, travel and enrollment checklists. Add private document storage, staff chat, accounts, activity reporting and AI orchestration.
