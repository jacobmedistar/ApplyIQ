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

Apply `supabase/staff-workflow.sql` once after the foundation schema to enable stage and department updates and manual follow-up scheduling and completion for active super administrators. Open a lead to see its contact details, inquiry history and follow-ups. Read access follows the existing department rules. Workflow changes use the signed-in user's token and the existing audit triggers.

Apply `supabase/staff-setup.sql` after the foundation schema. This migration installs the function and permissions used by the form. Set `APPLYIQ_SETUP_KEY` to a new random secret of at least 32 characters in Vercel and deploy. Open `/setup.html`, enter the setup key, and choose the first administrator's email and password. The form creates the Auth account and links it to the existing organization. Once the first staff membership exists, further setup requests are rejected. Remove the setup key from Vercel and redeploy after signing in successfully.

Staff requests use an authenticated Supabase access token, so the existing row policies determine which leads are visible. Sign in again after reloading or after the token expires.

## Ten-minute inquiry acknowledgements

### Browser-based workflow

The staff workspace refreshes the waiting-for-contact list once a minute. For inquiries with no recorded contact after ten minutes, open the inquiry and use the prefilled Gmail draft or WhatsApp draft. WhatsApp is available when the inquiry has a recorded opt-in. Each draft opens in a separate tab and uses the account signed in there. Review the recipient, then send from that tab. Opening a draft does not mark the inquiry contacted.

This browser workflow uses no messaging provider credentials. Leave the automated provider scheduler disabled for a browser-only installation.

### Optional provider worker

Apply `supabase/inquiry-acknowledgements.sql` before the app deployment. New inquiries queue an email and a WhatsApp acknowledgement for ten minutes after receipt. Record successful contact on the inquiry in the staff workspace before the worker picks it up. Record the student's explicit WhatsApp opt-in before the deadline to enable phone delivery. Existing inquiries are excluded from this rollout.

In Vercel Production, configure `ACK_WORKER_SECRET` (a random secret of at least 32 characters), `RESEND_API_KEY`, `ACK_EMAIL_FROM` (a verified sending address), and `ACK_EMAIL_REPLY_TO` (a monitored mailbox). Optionally set `ACK_WORKING_HOURS` with hours and time zone. The email asks for the student's preferred callback time.

For WhatsApp, configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `ACK_WHATSAPP_FROM` (a registered sender in E.164 format, without the whatsapp prefix), and `ACK_WHATSAPP_CONTENT_SID` (an approved template with no variables). Set the approved template copy to acknowledge the inquiry and invite the student to reply with a preferred callback time. Inbound replies are handled in the provider inbox or reply mailbox at this stage.

Create Vault secrets named `applyiq_ack_worker_url` (the full stable Vercel production URL ending in `/api/acknowledgements`) and `applyiq_ack_worker_secret` (the exact worker secret configured in Vercel). Then apply `supabase/schedule-inquiry-acknowledgements.sql` to run the worker every minute. The first attempt can start on the next tick at or after the ten-minute deadline. Database delivery states distinguish provider acceptance, skips, failures and uncertain sends. Provider acceptance does not confirm delivery. Review uncertain WhatsApp sends in the provider first to avoid duplicates.

## Remaining production work

- Extend lead editing, branch- and assignment-level access, sensitive-field permissions and full audit views.
- Add source verification and webhook adapters for Meta Lead Ads, Instagram, WhatsApp, Messenger, email and the public site. Stage incomplete inquiries separately so source events are retained while mandatory contact data is collected. Provide an operator review queue for conflicting identities.
- Build the conversation inbox, provider delivery callbacks, consent and template rules, and an idempotent background worker for due reminders, retries and escalation. Add browser session integration for authorized university portals and supported provider flows with interactive login, isolated sessions and server-side activity tracking.
- Add separate applications per student, university and intake with admissions, visa, travel and enrollment checklists. Add private document storage, staff chat, accounts, activity reporting and AI orchestration.
