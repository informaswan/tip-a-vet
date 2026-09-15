# Tip a Vet — Real Payments & Vet Onboarding Design

## Overview

Prior specs (`2026-07-20`, `2026-07-23`, `2026-08-15`) explicitly scoped
this project as a front-end-only concept mockup: no backend, no
persistence, no real payment processing. This spec **supersedes that
scoping** — the goal now is to move real money from tippers to real
veterans, while keeping Tip a Vet itself out of the business of holding
funds or banking information.

**Core model:** Tip a Vet is a non-custodial directory + deep-link layer,
not a payment processor for the vet's tip itself.

- A vet links an existing Venmo / PayPal / Cash App handle they already
  control. Tippers are handed off to that service to send the tip
  directly — Tip a Vet never touches that money and never stores banking
  details.
- Tip a Vet's own revenue comes from a separate, optional "support Tip a
  Vet" donation (GoFundMe-style), charged via Stripe to Tip a Vet's own
  account, fully decoupled from the vet's tip.

This avoids money-transmitter licensing, PCI scope for bank data, and
KYC/AML obligations that a custodial model (collecting tips, holding vet
bank accounts, running payouts) would require.

## Architecture

- **Frontend**: stays the existing static site on GitHub Pages. No build
  step is introduced — continues as plain HTML/CSS/JS files, now also
  loading the Supabase JS client and Stripe.js via CDN `<script>` tags.
- **Backend**: [Supabase](https://supabase.com) — Postgres database, Auth
  (for the admin review screen), Storage (private bucket for veteran
  verification documents), and two Edge Functions for the only operations
  that need a secret key:
  - `create-donation-session` — creates a Stripe Checkout Session for the
    optional platform donation.
  - `stripe-webhook` — receives `checkout.session.completed` from Stripe
    and marks the corresponding donation as paid.
- Only Supabase's public anon key and Stripe's publishable key ship in
  the frontend bundle. The Stripe secret key and Supabase service-role
  key live only as Edge Function secrets.
- Row Level Security (RLS) policies are the actual security boundary:
  anonymous/public reads are limited to `veterans` rows with
  `status = 'approved'`; verification documents and pending/rejected
  profiles are readable only by rows in a small `admins` table matched to
  the authenticated Supabase user's email.

## Data Model

**`veterans`**
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| name, branch, era, bio | text | existing fields, unchanged shape |
| avatar_initials | text | existing, unchanged |
| venmo_handle, paypal_handle, cashapp_handle | text, nullable | at least one required at submission |
| verification_doc_path | text, nullable | path in private Storage bucket; admin-only read |
| status | enum: `pending`, `approved`, `rejected` | default `pending` |
| submitted_at, reviewed_at | timestamptz | |
| reviewed_by | text, nullable | admin email |

**`tips`**
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| veteran_id | uuid, fk → veterans | |
| amount | numeric | the vet's tip amount — never touched by Stripe |
| note | text, nullable | |
| donation_amount | numeric, nullable | the optional platform support amount |
| stripe_checkout_session_id | text, nullable | |
| donation_status | enum: `none`, `pending`, `paid` | set to `paid` by the webhook |
| self_reported_sent | boolean | true once the tipper confirms they completed the Venmo/PayPal/Cash App send |
| created_at | timestamptz | |

**`admins`** — `email text primary key`, checked by RLS policies gating
the admin review screen and verification-doc access.

This replaces the current in-memory `VETERANS`/`TIPS` arrays and
`sendTip()` in `data.js` — those become thin wrappers around Supabase
queries instead of local array mutation.

## Components

1. **Vet onboarding** (`view-submit.js`, reworked) — existing
   name/branch/era/bio fields, plus: at least one payment handle
   (Venmo/PayPal/Cash App — validated client-side for plausible format),
   and a verification-document upload (DD-214/VA ID/similar) saved to the
   private Storage bucket. Inserts a `veterans` row with
   `status = 'pending'`. Success copy changes from "Done — you're on the
   list" to "Submitted — we'll review and post your profile soon,"
   since it's no longer instant.

2. **Admin review** (new `#/admin` route, new `view-admin.js`) —
   Supabase Auth email/password login gate; lists `pending` veterans;
   shows the verification doc via a signed URL; Approve/Reject buttons
   update `status`, `reviewed_at`, `reviewed_by`.

3. **Public directory/profile** (`view-directory.js`, `view-profile.js`)
   — logic unchanged, but their data source becomes an async Supabase
   query for `status = 'approved'` rows instead of the hardcoded array.
   Pages show a brief loading state while that fetch resolves.

4. **Payment flow** (`view-payment.js`, reworked) — see below.

5. **Stripe webhook** (`stripe-webhook` Edge Function) — reconciles
   `donation_status` asynchronously; the UI does not block on it (see
   Error Handling).

## Payment Flow

```
  [avatar]  James "Jimmy" Doyle
            Army · WWII

         $ 10
  [$1] [$5] [$10] [$20]

  [x] Also chip in $1.50 (15%) to support Tip a Vet
      (editable amount; unchecking removes it entirely)

  [ Add a note (optional) ]

     [   Send $10   ]
```

1. Tipper picks a vet + amount. A pre-checked, editable donation line
   defaults to 15% of the tip amount and recomputes live as the tip
   amount changes — until the tipper manually edits the donation amount,
   at which point it stops auto-recomputing (standard "linked until
   overridden" pattern).
2. On Send:
   - **Donation checked and > 0**: call `create-donation-session` with
     the donation amount and vet id → redirect to Stripe Checkout for
     *only* that donation amount, charged to Tip a Vet's account. On
     return (`success_url`), proceed to step 3.
   - **Donation unchecked or $0**: skip Stripe entirely, go straight to
     step 3.
3. Reveal the vet's payout hand-off screen: one button per handle the vet
   has linked (e.g. "Open Venmo," "Open Cash App"), each a deep link
   prefilled with the tip amount and note where the target service's URL
   scheme supports it (Venmo `venmo://paycharge?...`, Cash App
   `https://cash.app/$<cashtag>/<amount>`, PayPal
   `https://paypal.me/<handle>/<amount>`), with a web-fallback URL for
   desktop. This is the vet's full, untouched tip amount — Tip a Vet is
   not in this money path at all.
4. Tipper completes the payment in the external app (outside our
   control/visibility), returns to Tip a Vet, and confirms "Did you send
   it?" — this inserts the `tips` row with `self_reported_sent = true`.

## Error Handling & Limitations

- **Self-reported totals**: there is no API access to confirm a Venmo/
  PayPal/Cash App payment actually completed. Publicly displayed "total
  tipped" figures are self-reported, not verified, and should be labeled
  as such in the UI (e.g. a small "self-reported" note near totals).
- **Vet impersonation**: mitigated by manual admin review of the
  uploaded verification document before a profile goes live; the
  reviewer should sanity-check that the linked handle name reasonably
  matches the claimed identity. No automated identity verification in
  this iteration.
- **Failed/declined donation charge**: Stripe Checkout surfaces its own
  error UI; a failure does not block the tip flow — the tipper proceeds
  straight to the vet hand-off (step 3) either way.
- **Abandoned flow**: if the tipper pays the donation but never confirms
  the vet-side send, the donation is still kept (it's a real, separate
  charge to Tip a Vet), but the vet's total is not incremented, since we
  have no signal that it happened.
- **Webhook vs. redirect race**: the UI proceeds on the Stripe success
  redirect without waiting for the webhook, since blocking the tip hand-
  off on webhook delivery would add latency for no benefit — the webhook
  exists purely to reconcile `donation_status` for reporting/auditing,
  not to gate the flow.

## Explicitly Out of Scope (this iteration)

- Ever custodying funds or storing bank account/routing numbers.
- Automated identity verification (e.g. ID.me) — manual review only.
- Verifying that a self-reported tip actually occurred.
- Vet-facing dashboards, payout batching, or tax forms — not applicable
  since Tip a Vet never pays a vet directly.
- Refund tooling beyond Stripe's own dashboard for the platform donation.

## Testing

Manual, since no automated test suite exists on this project yet:

- Submit a vet with each handle type, confirm `pending` status and no
  public visibility until approved.
- Log in to `#/admin`, confirm pending list + verification doc render,
  approve one and reject one, confirm directory reflects only the
  approved vet.
- Run the tip flow with donation checked (Stripe test mode), donation
  unchecked, and donation manually edited away from the 15% default;
  confirm the vet hand-off deep links open the correct app/URL with the
  right amount prefilled, on both a mobile device and desktop web
  fallback.
- Trigger `stripe trigger checkout.session.completed` via the Stripe CLI
  against the local Edge Function and confirm `donation_status` flips to
  `paid`.
- Directly query Supabase as both an anonymous and an admin-authenticated
  client to confirm RLS blocks anonymous reads of `pending`/`rejected`
  veterans and of verification document URLs.
