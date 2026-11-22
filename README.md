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

### Offline Gmail delivery

1. Apply `supabase/gmail-acknowledgements.sql` after the staff workflow, inquiry acknowledgements and browser acknowledgement migrations.
2. Enable the Gmail API in Google Cloud. Create an OAuth **Web application** client, configure the consent screen and add the production callback `https://applyiq-opal.vercel.app/api/gmail` as an authorized redirect URI. Use Google OAuth testing for the pilot and follow Google's verification and publishing requirements for production.
3. In Vercel Production set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_CALLBACK_ORIGIN` (the stable production origin), and `GMAIL_TOKEN_KEY` (64 hexadecimal characters representing a randomly generated 32-byte encryption key). Keep the encryption key stable while mailboxes are connected. Set `ACK_WORKER_SECRET` (at least 32 random characters) and optionally `ACK_WORKING_HOURS`. Deploy.
4. In ApplyIQ, each staff member signs in and selects **Connect Gmail**, then chooses the mailbox that should send their acknowledgements. Under **Open lead**, a super admin selects **Assigned staff** and saves the assignment. Unassigned leads and staff without a connected mailbox do not send email.
5. Set the two Supabase Vault secrets documented in `supabase/schedule-inquiry-acknowledgements.sql`. Use the stable production URL ending in `/api/acknowledgements` and the same `ACK_WORKER_SECRET` in both services. Apply the scheduler SQL after testing with a designated inbox. The job runs every minute and does not depend on a staff computer.
6. If a Gmail request may have succeeded but ApplyIQ could not confirm it, the job is marked uncertain. Check Gmail Sent before following up manually.

### WhatsApp batch approval

Apply `supabase/whatsapp-approval.sql` and deploy. In Chrome, open `chrome://extensions`, enable Developer mode, and load the repository's `whatsapp-extension` folder unpacked on each computer used for sending. Link WhatsApp Web in that Chrome profile. In ApplyIQ, review the batch of assigned, opted-in inquiries, enter the linked WhatsApp number, and select **Approve and send batch**.

The extension uses the signed-in WhatsApp Web session without a WhatsApp API. It stops if it cannot verify either phone number on the page. Test with an opted-in test number before enabling operational use. Only Gmail runs when the user's computer is offline. The older workstation sender is disabled.

## Remaining production work

- Extend lead editing, branch- and assignment-level access, sensitive-field permissions and full audit views.
- Add source verification and webhook adapters for Meta Lead Ads, Instagram, WhatsApp, Messenger, email and the public site. Stage incomplete inquiries separately so source events are retained while mandatory contact data is collected. Provide an operator review queue for conflicting identities.
- Build the conversation inbox, provider delivery callbacks, consent and template rules, and an idempotent background worker for due reminders, retries and escalation. Add browser session integration for authorized university portals and supported provider flows with interactive login, isolated sessions and server-side activity tracking.
- Add separate applications per student, university and intake with admissions, visa, travel and enrollment checklists. Add private document storage, staff chat, accounts, activity reporting and AI orchestration.
