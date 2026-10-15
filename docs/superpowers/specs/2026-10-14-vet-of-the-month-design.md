# Tip a Vet — Vet of the Month Design

> **Superseded:** the backend architecture here (Supabase: Postgres, Auth,
> Storage, Edge Functions) was reconsidered as overkill for how this project
> actually runs — see
> `docs/superpowers/specs/2026-10-14-lean-vet-of-the-month-design.md`. The
> product decisions below (one featured vet at a time, board decides
> off-platform, Past Vets history) still hold; only the backend changed.

## Overview

This supersedes **Components items 3–4** (public directory/profile, payment
flow) of `docs/superpowers/specs/2026-09-14-real-payments-design.md`.
Everything else in that spec stands unchanged: the non-custodial hand-off
model, the Supabase backend, Stripe for the optional platform donation only,
vet onboarding/review, and the RLS security boundary.

**Core change:** tippers no longer browse a directory and pick who to tip.
The site features one veteran at a time — picked by a board of five as the
one who most critically needs help right now — and all tipping traffic
routes to that one vet. When a new vet is picked, the previous one moves
into a "Past Vets" history.

This stays strictly non-custodial. Tip a Vet still never collects or
redistributes funds; the only change from the original spec is *who* a tip
is routed to (whoever is currently featured, instead of a tipper's own
pick). Actually pooling and redistributing money was considered and
rejected — it would make Tip a Vet a money transmitter (state licensing,
KYC/AML, charitable-solicitation registration, 1099s). See
[informaswan/tip-a-vet#1](https://github.com/informaswan/tip-a-vet/issues/1)
for the deferred follow-up (making the waiting queue public).

## Data Model

Add one column to `veterans` (schema otherwise unchanged from the parent spec):

| column | type | notes |
|---|---|---|
| featured_status | text, nullable | `queued`, `current`, or `completed`. Null until the vet is approved. |

- On admin **approval**, `featured_status` is set to `queued` in the same
  update (a vet enters the waiting pool automatically once verified).
- Only one row may hold `featured_status = 'current'` at a time — enforced
  by a partial unique index, not just application logic.
- `completed` is terminal for this iteration: a vet who has had their turn
  is not re-queued or re-featured automatically.

```sql
alter table public.veterans
  add column featured_status text check (featured_status in ('queued', 'current', 'completed'));

create unique index one_current_vet
  on public.veterans ((featured_status))
  where featured_status = 'current';
```

`veteran_totals` (the self-reported tip-total view) is unchanged — it still
sums all tips ever sent to a given vet, regardless of their featured period.

## Components

1. **Vet onboarding** — unchanged from the parent spec. The only change is
   downstream of approval (see Admin review below).

2. **Admin review** — approve/reject unchanged, except approving now also
   sets `featured_status = 'queued'`. One new action is added: **"Feature
   this vet,"** available on `queued` vets. It performs, in one transaction:
   - set this vet's `featured_status = 'current'`
   - set whichever vet currently holds `featured_status = 'current'` (if
     any) to `completed`

   The board's actual decision-making happens outside the app (meeting/
   call/text) — this action just records the outcome. No voting/tally UI.

3. **Homepage (replaces the public directory)** — fetches the single vet
   with `featured_status = 'current'` and shows their story inline (name,
   branch, era, bio, avatar, self-reported total tipped), with the tip CTA.
   Includes explanatory copy along these lines: *"Each month, our board
   chooses one veteran we believe critically needs help right now — 100% of
   your tip goes straight to them. We never touch the money."* If no vet is
   currently featured (e.g. before the first pick), show a "we're choosing
   this month's vet — check back soon" state instead of an empty/broken
   page.

4. **Past Vets (replaces "Vets We've Helped" / `view-served.js`)** — lists
   vets with `featured_status = 'completed'`, most recently retired first;
   each shows name/branch/era/avatar/total tipped (self-reported, as
   today). A simple list — no individual deep-dive profile pages for now.

5. **Payment flow** — mechanically unchanged from the parent spec's
   non-custodial Venmo/PayPal/Cash App hand-off. The only change:
   `renderPayment()` no longer takes a vet id; it always resolves the
   current vet via a new `fetchCurrentVeteran()`. If there is no current
   vet, the tip entry point is disabled with the same "check back soon"
   messaging as the homepage, rather than erroring.

## Removed From the Parent Spec's Scope

- The browsable multi-vet directory (`view-directory.js`, `#/vets` grid) —
  there is nothing to pick anymore.
- Per-vet profile pages (`view-profile.js`, `#/vets/:id`) as a separate
  browsable set of pages — the current vet's story now lives on the
  homepage, and past vets get a simple list entry, not a dedicated page.

## Explicitly Out of Scope (this iteration)

- Public visibility of `queued` vets — admin-only for now. Deferred to
  [informaswan/tip-a-vet#1](https://github.com/informaswan/tip-a-vet/issues/1).
- Any in-app voting/tallying for the board — decided outside the app.
- Automated "need" scoring or ranking — purely the board's manual call.
- Re-featuring a `completed` vet, multiple simultaneous `current` vets, or
  calendar-based automation — the admin triggers the switch whenever the
  board decides; no scheduled job.
- Everything already out of scope in the parent spec (custodying funds,
  automated identity verification, verifying self-reported tips, vet-facing
  dashboards, refund tooling) still applies, unchanged.

## Testing

Manual, consistent with the parent spec's approach (no automated test
framework exists on this project):

- Approve a vet; confirm `featured_status` defaults to `queued` and is not
  visible via any public query.
- Feature that vet from admin; confirm the homepage now shows them as
  current, and (if a different vet was previously current) that vet now
  appears in Past Vets with `completed` status.
- Confirm the partial unique index rejects a second `current` row if
  attempted directly via SQL.
- Load the homepage/tip flow with no vet id anywhere in the URL; confirm it
  resolves to the current vet and the hand-off works exactly as in the
  parent spec.
- With a fresh database (no vet ever featured), confirm the homepage and
  tip entry point show the "check back soon" state instead of erroring.
