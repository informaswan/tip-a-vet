# Tip a Vet — Lean Vet of the Month Design

## Overview

Supersedes the backend architecture of `2026-09-14-real-payments-design.md`
and `2026-10-14-vet-of-the-month-design.md`. The product decisions in the
latter still hold — one veteran featured at a time, picked by a board of
five off-platform, past picks shown in a history — but the backend they'd
have run on (Supabase: Postgres, Auth, Storage, Edge Functions) was
overkill for how this actually runs: a human updates who's featured about
once a month, not something that needs a database or a login screen behind
it.

**Core idea:** keep the site a static, backend-free GitHub Pages site for
everything except the one thing that genuinely requires server-side code —
creating a Stripe Checkout session for the optional platform donation,
because that requires a secret key that can never reach the browser.

- **Who's featured, and the Past Vets history**, live in a hand-edited
  static JS data file in the repo. The board decides off-platform; a human
  edits the file and pushes; GitHub Pages redeploys. No database, no admin
  login, no review queue, no file-upload storage.
- **Vet submission/onboarding** happens entirely off-platform for now (the
  same channel the board already uses to decide). The public "Add a Vet"
  page is removed rather than wired to a dead end.
- **The Stripe donation** is created by a single Cloudflare Worker — the
  only server-side code in this system. No webhook, no database: there's
  nothing to reconcile against, since no tip or donation record is
  persisted anywhere.
- **Running tip totals are dropped** for this iteration — tracked as
  [informaswan/tip-a-vet#2](https://github.com/informaswan/tip-a-vet/issues/2).
  It's the one feature that would've forced a shared, write-able store
  across visitors; everything else here stays genuinely backend-free.
- The non-custodial hand-off model (tipper sends directly to the vet's own
  Venmo/PayPal/Cash App; Tip a Vet never touches that money) is unchanged
  from the original real-payments spec.

## Data Model

A new file, `vet-data.js`, replaces the mock arrays in `data.js`:

```js
// vet-data.js — hand-edited by whoever's tracking the board's decision.
const CURRENT_VET = {
  id: "current",
  name: "Replace with the featured vet's name",
  branch: "Army",
  era: "e.g. Vietnam",
  bio: "Their story.",
  avatarInitials: "XX",
  venmoHandle: null,    // at least one of these three required
  paypalHandle: null,
  cashappHandle: null,
};
// Set to null when no vet has been chosen yet (e.g. before the board's first pick).

const PAST_VETS = [
  // Most recently retired first. Move CURRENT_VET's info here (minus the
  // handles — past vets aren't tippable anymore) when the board picks someone new.
  // { id: "past-1", name: "...", branch: "...", era: "...", avatarInitials: "..." },
];
```

No `status`, no `featured_status`, no ids beyond a stable string for the
avatar seed — there is exactly one current vet (or none) and a plain list
of past ones, both literally just JS data.

## Components

1. **Homepage** — reads `CURRENT_VET` directly (synchronous, no network
   call). If it's `null`, shows a "we're choosing this period's vet — check
   back soon" state, same copy as the vet-of-the-month spec. Otherwise
   shows their story and a "Send $" link to `#/tip`, plus the same
   explanatory copy about the board's monthly pick.

2. **Past Vets (replaces "Vets We've Tipped")** — renders `PAST_VETS` as a
   simple list. No totals (dropped, see Overview), no individual profile
   pages.

3. **"Add a Vet" page and nav link** — removed. Nothing in this iteration
   collects public submissions.

4. **Payment flow (`#/tip`)** — unchanged amount-entry and 15%-of-tip
   donation-line UI from the vet-of-the-month spec's Components item 5,
   except it reads `CURRENT_VET` directly instead of awaiting a Supabase
   fetch, and the "I sent it" confirmation is now just a thank-you message
   (nothing to mark as sent, since nothing is persisted). On Send:
   - **Donation > 0:** POST to the Cloudflare Worker (below) with the tip
     amount, donation amount, and vet id; redirect to the returned Stripe
     Checkout URL. Encode the tip amount and note as query params on the
     Checkout session's `success_url` (e.g.
     `...#/tip/complete?amount=10&note=...`) so the hand-off screen can
     rebuild itself after the redirect without needing any stored record.
   - **Donation unchecked or $0:** skip Stripe, go straight to the
     Venmo/PayPal/Cash App hand-off screen immediately, exactly as before.

5. **Cloudflare Worker (`create-donation-session`)** — the only
   server-side code. Receives `{donationAmount}`, creates a Stripe Checkout
   Session for that amount only (the vet's own tip never passes through
   Stripe or this Worker), returns `{url}`. Holds `STRIPE_SECRET_KEY` as a
   Worker secret — never shipped to the browser. No webhook: there is no
   donation-status field anywhere to reconcile, so there's nothing for a
   webhook to update.

## Removed From Earlier Specs' Scope

- Supabase entirely: Postgres database, Auth, Storage buckets, RLS
  policies, both Edge Functions from the earlier plan.
- Vet onboarding form, admin review screen, verification-document upload —
  all deferred to whenever this needs to happen through the website
  instead of off-platform.
- `donation_status`/`self_reported_sent` tracking and the Stripe webhook
  that reconciled it — nothing is persisted, so there's nothing to
  reconcile.
- Running tip totals — [informaswan/tip-a-vet#2](https://github.com/informaswan/tip-a-vet/issues/2).

## Explicitly Out of Scope (this iteration)

- Everything in the "Removed From Earlier Specs' Scope" list above, should
  any of it come back as a future ticket rather than this plan.
- Automated identity verification of a featured vet — stays a fully
  off-platform, manual board decision.
- Any public visibility into "who's being considered" — there is no queue
  anywhere in this version, on-platform or off.

## Testing

Manual, consistent with the project's existing approach (no automated test
framework):

- With `CURRENT_VET = null`, load the homepage and `#/tip` — confirm both
  show the "check back soon" state, not an error.
- Hand-edit `CURRENT_VET` to a test vet with one handle; confirm the
  homepage shows their story and `#/tip` shows the amount-entry screen.
- Run the no-donation path: uncheck the donation box, send, confirm the
  correct Venmo/PayPal/Cash App link opens with the right amount.
- Run the donation path in Stripe test mode: leave the donation checked,
  send, complete Checkout with Stripe's test card, confirm the redirect
  back to `#/tip/complete` reconstructs the hand-off screen with the
  correct tip amount and note from the query params (not from any stored
  record, since none exists).
- Move a vet from `CURRENT_VET` into `PAST_VETS` by hand-editing the file;
  confirm they show up on the Past Vets page and are no longer tippable
  from the homepage.
- Call the Cloudflare Worker directly with `curl` and confirm it returns a
  real Stripe Checkout URL, and that `STRIPE_SECRET_KEY` never appears in
  any committed file or in the browser's network tab.
