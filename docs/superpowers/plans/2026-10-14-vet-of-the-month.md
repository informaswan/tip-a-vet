# Vet of the Month Implementation Plan

> **Superseded — do not execute.** This plan's Supabase backend was
> reconsidered as overkill before any task was dispatched (Task 1 was
> blocked on manual Supabase login/project-creation and never completed).
> See `docs/superpowers/plans/2026-10-14-lean-vet-of-the-month.md` for the
> plan that replaced this one.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Tip a Vet from a static front-end mockup into a real product where one veteran at a time — picked by a board of five as whoever most critically needs help right now — receives all tipping traffic via a direct, non-custodial Venmo/PayPal/Cash App hand-off, with past picks shown in a "Past Vets" history. Tip a Vet earns revenue only through a separate, optional, Stripe-charged "support Tip a Vet" donation.

**Architecture:** The existing static site (plain HTML/CSS/JS, GitHub Pages, no build step) stays as-is and gains a Supabase backend (Postgres + Auth + Storage + two Edge Functions) reached directly from the browser via the Supabase JS client. Only two secrets — the Stripe secret key and the Supabase service-role key — ever leave the browser's reach, living solely in Edge Function environment variables. The browsable multi-vet directory and per-vet picker are removed entirely; the homepage always shows whoever is currently featured.

**Tech Stack:** Vanilla JS (no framework/build step, matching the existing codebase), Supabase (Postgres, Auth, Storage, Edge Functions in Deno/TypeScript), Stripe Checkout (server-side session creation only), Supabase CLI for local dev and deploys.

**Spec:** `docs/superpowers/specs/2026-09-14-real-payments-design.md` (base non-custodial architecture) as superseded by `docs/superpowers/specs/2026-10-14-vet-of-the-month-design.md` (vet-of-the-month model — this is the spec that governs Components/Payment Flow).

## Global Constraints

- Tip a Vet must never store bank account/routing numbers or custody tip funds — the vet's tip always goes directly to their own Venmo/PayPal/Cash App.
- No build step, no framework — new frontend files are plain `<script>`-tag JS matching the existing style (`function` declarations, string concatenation, `const`/`let`, no JSX/TS in the browser).
- Only the Supabase URL and anon/public key are safe to commit client-side (protected by Row Level Security). The Stripe secret key, Supabase service-role key, and Stripe webhook signing secret must only ever be set as Supabase Edge Function secrets, never in any committed file.
- Every table gets Row Level Security enabled before any policy or data touches it — RLS is the only access-control boundary in this system.
- This project has no automated test framework. Verification steps use direct SQL queries, `curl`, the Stripe CLI, and manual browser click-throughs in place of a test runner.
- The existing mock veterans in `data.js` (Jimmy Doyle, Eleanor Marsh, etc.) are pitch-mockup fiction and must **not** be seeded into the real `veterans` table.
- Only one veteran may hold `featured_status = 'current'` at a time — enforced by a database constraint, not just application code.
- The waiting queue (`featured_status = 'queued'`) is admin-only and must never be readable by anonymous/public requests (tracked for a future public-queue feature in [informaswan/tip-a-vet#1](https://github.com/informaswan/tip-a-vet/issues/1), out of scope here).

## Review Focus

- **No vet has ever been featured yet** (fresh database, before the board's first pick) — the homepage and tip entry point must show a "check back soon" state, not an error or a blank screen.
- **A `queued` vet must not leak through any public read** — `status = 'approved'` alone is not enough to show publicly once `featured_status` exists; a queued-but-approved vet must stay invisible to anonymous requests.
- **Attempting to mark a second vet `current` while one is already `current`** — the database must reject it, not silently create two current vets.
- **`numeric` columns returned by PostgREST as JSON strings** (e.g. `veteran_totals.total_tipped`) — `formatCurrency` must coerce input with `Number(...)` before `.toFixed(2)`, or rendering throws on a value like `"10.00"`.
- **The donation amount after the tipper manually edits it, then changes the tip amount again** — must stop auto-recomputing at 15% once manually edited (linked-until-overridden), not snap back silently.

---

## Task 1: Supabase project setup

**Files:**
- Modify (generated already, verify/complete): `supabase/config.toml`, `supabase/.gitignore`

**Interfaces:**
- Produces: a linked Supabase project (remote + local dev stack) that every later task's migrations and functions deploy against.

`supabase/config.toml` and `supabase/.gitignore` already exist in this worktree from an earlier `supabase init` run — do not re-run `init`.

- [ ] **Step 1: Create the hosted Supabase project**

In a browser, go to https://supabase.com/dashboard, create an account/org if needed, then **New Project** named `tip-a-vet`. Save the generated database password somewhere safe (not needed again in this plan — the CLI uses a login token instead). Note the **Project Reference ID** from Project Settings → General (looks like `abcdefghijklmnop`).

- [ ] **Step 2: Enable Docker for this environment**

The Supabase CLI needs Docker to run Postgres/Auth/Storage locally. This environment is WSL2; `docker ps` currently fails with "command not found" because Docker Desktop's WSL integration isn't enabled yet. In Docker Desktop (Windows): Settings → Resources → WSL Integration → enable it for this distro, then restart Docker Desktop. Verify from this WSL shell:

```bash
docker ps
```

Expected: runs without error (empty list is fine).

- [ ] **Step 3: Log in the CLI**

```bash
npx supabase login
```

Opens a browser to generate an access token — paste it back into the terminal when prompted.

- [ ] **Step 4: Link to the hosted project**

```bash
npx supabase link --project-ref <your-project-ref-from-step-1>
```

Expected: "Finished supabase link."

- [ ] **Step 5: Start the local dev stack**

```bash
npx supabase start
```

Expected: prints local URLs including an `API URL` (e.g. `http://127.0.0.1:54321`), `anon key`, and `service_role key`. Keep this output — the local anon key and API URL are needed in Task 5.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml supabase/.gitignore
git commit -m "$(cat <<'EOF'
Confirm Supabase project scaffolding

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If there's nothing new to commit because this was already committed, skip this step.)

---

## Task 2: Database schema

**Files:**
- Create: `supabase/migrations/20261014000001_schema.sql`

**Interfaces:**
- Produces: tables `public.veterans`, `public.tips`, `public.admins`, view `public.veteran_totals`, unique index `one_current_vet` — the exact column names every later task's SQL and JS code reads/writes.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261014000001_schema.sql

create extension if not exists pgcrypto;

create table public.veterans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch text not null,
  era text not null,
  bio text not null,
  avatar_initials text not null,
  venmo_handle text,
  paypal_handle text,
  cashapp_handle text,
  verification_doc_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  featured_status text check (featured_status in ('queued', 'current', 'completed')),
  featured_at timestamptz,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  constraint at_least_one_handle check (
    venmo_handle is not null or paypal_handle is not null or cashapp_handle is not null
  )
);

create unique index one_current_vet
  on public.veterans ((featured_status))
  where featured_status = 'current';

create table public.tips (
  id uuid primary key default gen_random_uuid(),
  veteran_id uuid not null references public.veterans(id),
  amount numeric not null check (amount > 0),
  note text,
  donation_amount numeric not null default 0,
  stripe_checkout_session_id text,
  donation_status text not null default 'none' check (donation_status in ('none', 'pending', 'paid')),
  self_reported_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.admins (
  email text primary key
);

create view public.veteran_totals as
  select veteran_id, sum(amount) as total_tipped
  from public.tips
  where self_reported_sent = true
  group by veteran_id;

alter table public.veterans enable row level security;
alter table public.tips enable row level security;
alter table public.admins enable row level security;

grant usage on schema public to anon, authenticated;

grant select, insert on public.veterans to anon, authenticated;
grant update (status, featured_status, featured_at, reviewed_at, reviewed_by) on public.veterans to authenticated;

grant select, insert on public.tips to anon, authenticated;
grant update (self_reported_sent) on public.tips to anon, authenticated;

grant select on public.veteran_totals to anon, authenticated;
```

- [ ] **Step 2: Apply it locally and verify**

```bash
npx supabase db reset
```

Expected: reapplies all migrations and prints "Finished supabase db reset." Then verify the tables and index exist:

```bash
npx supabase db execute --local --sql "select table_name from information_schema.tables where table_schema = 'public' order by table_name;"
```

Expected output includes `admins`, `tips`, `veteran_totals`, `veterans`.

```bash
npx supabase db execute --local --sql "select indexname from pg_indexes where tablename = 'veterans';"
```

Expected output includes `one_current_vet`.

- [ ] **Step 3: Verify the one-current-vet constraint**

```bash
npx supabase db execute --local --sql "
insert into public.veterans (name, branch, era, bio, avatar_initials, venmo_handle, status, featured_status)
values ('Test One', 'Army', 'Test', 'bio', 'T1', 'test-one', 'approved', 'current');
insert into public.veterans (name, branch, era, bio, avatar_initials, venmo_handle, status, featured_status)
values ('Test Two', 'Army', 'Test', 'bio', 'T2', 'test-two', 'approved', 'current');
"
```

Expected: the second insert fails with a unique constraint violation on `one_current_vet`. Clean up:

```bash
npx supabase db execute --local --sql "delete from public.veterans where name in ('Test One', 'Test Two');"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261014000001_schema.sql
git commit -m "$(cat <<'EOF'
Add veterans/tips/admins schema with featured_status for vet-of-the-month

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Row Level Security policies

**Files:**
- Create: `supabase/migrations/20261014000002_rls_policies.sql`

**Interfaces:**
- Consumes: tables from Task 2.
- Produces: `public.is_admin()` function, used again by Task 4's storage policy.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261014000002_rls_policies.sql

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where email = auth.jwt() ->> 'email'
  );
$$;

create policy "public can read current or past featured veterans"
on public.veterans for select
to anon, authenticated
using (status = 'approved' and featured_status in ('current', 'completed'));

create policy "admins can read all veterans"
on public.veterans for select
to authenticated
using (public.is_admin());

create policy "anyone can submit a pending veteran"
on public.veterans for insert
to anon, authenticated
with check (status = 'pending' and featured_status is null);

create policy "admins can update veterans"
on public.veterans for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "anyone can read tips"
on public.tips for select
to anon, authenticated
using (true);

create policy "anyone can create a tip"
on public.tips for insert
to anon, authenticated
with check (amount > 0);

create policy "anyone can mark a tip as sent"
on public.tips for update
to anon, authenticated
using (true)
with check (true);
```

- [ ] **Step 2: Apply and verify queued vets stay hidden from the public**

```bash
npx supabase db reset
```

With the local anon key from Task 1 Step 5 (`$ANON_KEY`) and local API URL (`$API_URL`, default `http://127.0.0.1:54321`):

```bash
curl -s "$API_URL/rest/v1/veterans" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

Expected: `[]` (no featured veterans exist yet).

```bash
curl -s "$API_URL/rest/v1/veterans" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"name":"Test Vet","branch":"Army","era":"Test","bio":"Test bio","avatar_initials":"TV","venmo_handle":"test-vet","status":"pending"}'
```

Expected: `201 Created`. Then, as a privileged step outside RLS (service role, not the test client), approve and queue it without yet making it current:

```bash
npx supabase db execute --local --sql "update public.veterans set status = 'approved', featured_status = 'queued' where name = 'Test Vet';"
```

Confirm it is still invisible to anonymous reads even though it's `approved`:

```bash
curl -s "$API_URL/rest/v1/veterans" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

Expected: still `[]` — `queued` must not leak through. Now feature it and confirm it becomes visible:

```bash
npx supabase db execute --local --sql "update public.veterans set featured_status = 'current', featured_at = now() where name = 'Test Vet';"
curl -s "$API_URL/rest/v1/veterans" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

Expected: includes the Test Vet row. Clean up:

```bash
npx supabase db execute --local --sql "delete from public.veterans where name = 'Test Vet';"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261014000002_rls_policies.sql
git commit -m "$(cat <<'EOF'
Add RLS policies restricting public reads to current/completed veterans

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Verification-doc storage + seeded admin

**Files:**
- Create: `supabase/migrations/20261014000003_storage_and_admin.sql`

**Interfaces:**
- Consumes: `public.is_admin()` from Task 3.
- Produces: private `verification-docs` storage bucket; one row in `public.admins`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261014000003_storage_and_admin.sql

insert into storage.buckets (id, name, public)
values ('verification-docs', 'verification-docs', false);

create policy "anyone can upload verification docs"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'verification-docs');

create policy "admins can read verification docs"
on storage.objects for select
to authenticated
using (bucket_id = 'verification-docs' and public.is_admin());

insert into public.admins (email) values ('33mswan@gmail.com');
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
npx supabase db execute --local --sql "select * from public.admins;"
```

Expected: one row, `33mswan@gmail.com`.

```bash
npx supabase db execute --local --sql "select id, public from storage.buckets where id = 'verification-docs';"
```

Expected: one row with `public = f`.

- [ ] **Step 3: Create the matching Supabase Auth user**

The `admins` table row alone doesn't let anyone log in — an Auth user with that email must exist too. In the Supabase dashboard (hosted project): **Authentication → Users → Add user**, email `33mswan@gmail.com`, set a password, check "Auto Confirm User". For local dev, create the same user against the local stack:

```bash
curl -s "$API_URL/auth/v1/signup" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"33mswan@gmail.com","password":"<a local dev password>"}'
```

Expected: `200 OK` with a user object.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261014000003_storage_and_admin.sql
git commit -m "$(cat <<'EOF'
Add verification-doc storage bucket and seed admin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend Supabase client + config

**Files:**
- Create: `config.js`
- Create: `supabase-client.js`
- Modify: `index.html:63` (add script tags before `data.js`)

**Interfaces:**
- Consumes: `public.veterans`, `public.veteran_totals` from Task 2.
- Produces: `fetchCurrentVeteran()`, `fetchPastVets()` — used by Task 8/9/10's homepage, past-vets page, and payment flow; `supabaseClient` — the singleton every later `supabase-client.js` function uses.

- [ ] **Step 1: Write the config file**

```js
// config.js
const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY";
```

Replace both values: for local dev, use the `API URL` and `anon key` printed by `supabase start` in Task 1 Step 5. For production (GitHub Pages), use the hosted project's values from Project Settings → API in the Supabase dashboard. Both are safe to commit — the anon key only grants what RLS policies allow.

- [ ] **Step 2: Write the Supabase client module**

```js
// supabase-client.js
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function attachTotal(vet, totalsByVetId) {
  return Object.assign({}, vet, {
    totalTipped: totalsByVetId[vet.id] || 0,
  });
}

async function fetchTotalsByVetId() {
  const { data: totals, error } = await supabaseClient
    .from("veteran_totals")
    .select("veteran_id, total_tipped");

  if (error) {
    throw error;
  }

  const totalsByVetId = {};
  totals.forEach(function (row) {
    totalsByVetId[row.veteran_id] = row.total_tipped;
  });
  return totalsByVetId;
}

async function fetchCurrentVeteran() {
  const { data: vet, error } = await supabaseClient
    .from("veterans")
    .select("*")
    .eq("status", "approved")
    .eq("featured_status", "current")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!vet) {
    return null;
  }

  const totalsByVetId = await fetchTotalsByVetId();
  return attachTotal(vet, totalsByVetId);
}

async function fetchPastVets() {
  const { data: vets, error } = await supabaseClient
    .from("veterans")
    .select("*")
    .eq("status", "approved")
    .eq("featured_status", "completed")
    .order("featured_at", { ascending: false });

  if (error) {
    throw error;
  }

  const totalsByVetId = await fetchTotalsByVetId();
  return vets.map(function (vet) {
    return attachTotal(vet, totalsByVetId);
  });
}
```

- [ ] **Step 3: Wire the script tags**

In `index.html`, replace line 63 (`<script src="data.js"></script>`) with:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="supabase-client.js"></script>
<script src="data.js"></script>
```

- [ ] **Step 4: Verify in a browser**

Serve the site locally (`npx http-server .` or `python3 -m http.server`) and open it. In devtools console:

```js
fetchCurrentVeteran().then(console.log)
```

Expected: resolves to `null` (nothing featured yet) with no thrown error.

```js
fetchPastVets().then(console.log)
```

Expected: resolves to `[]`.

- [ ] **Step 5: Commit**

```bash
git add config.js supabase-client.js index.html
git commit -m "$(cat <<'EOF'
Wire Supabase client into the frontend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Trim data.js and harden formatCurrency

**Files:**
- Modify: `data.js` (remove `VETERANS`, `TIPS`, `findVeteran`, `sendTip`, `SERVED_VETERANS`; keep `escapeHtml`; harden `formatCurrency`)

**Interfaces:**
- Produces: `formatCurrency(amount)` that coerces its input, `escapeHtml(str)` unchanged — both used by every view file from here on.

- [ ] **Step 1: Rewrite `data.js`**

```js
// data.js
function escapeHtml(str) {
  var map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return str.replace(/[&<>"']/g, function (char) {
    return map[char];
  });
}

function formatCurrency(amount) {
  return "$" + Number(amount).toFixed(2);
}
```

This matters starting with this task: `numeric` columns from Supabase (`total_tipped` from the `veteran_totals` view, `tips.amount` used later) can come back from PostgREST as JSON strings rather than numbers, and `"10.00".toFixed` doesn't exist. Coercing once here, at the single chokepoint every other file calls through, means no other call site needs to worry about it.

- [ ] **Step 2: Verify manually**

In the browser console (served per Task 5 Step 4):

```js
formatCurrency("10.00")
```

Expected: `"$10.00"` (no thrown error — confirms the string-coercion fix).

- [ ] **Step 3: Commit**

```bash
git add data.js
git commit -m "$(cat <<'EOF'
Trim data.js to shared helpers only; harden formatCurrency against numeric strings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Vet onboarding rework

**Files:**
- Modify: `view-submit.js`
- Modify: `supabase-client.js` (append)

**Interfaces:**
- Consumes: `supabaseClient` from Task 5.
- Produces: `submitVeteranForReview(fields)` — used only by `view-submit.js`.

- [ ] **Step 1: Add the submission function to `supabase-client.js`**

```js
async function submitVeteranForReview(fields) {
  let verificationDocPath = null;

  if (fields.verificationFile) {
    const filePath = crypto.randomUUID() + "-" + fields.verificationFile.name;
    const { error: uploadError } = await supabaseClient.storage
      .from("verification-docs")
      .upload(filePath, fields.verificationFile);

    if (uploadError) {
      throw uploadError;
    }
    verificationDocPath = filePath;
  }

  const { error } = await supabaseClient.from("veterans").insert({
    name: fields.name,
    branch: fields.branch,
    era: fields.era,
    bio: fields.bio,
    avatar_initials: fields.avatarInitials,
    venmo_handle: fields.venmoHandle || null,
    paypal_handle: fields.paypalHandle || null,
    cashapp_handle: fields.cashappHandle || null,
    verification_doc_path: verificationDocPath,
    status: "pending",
  });

  if (error) {
    throw error;
  }
}
```

- [ ] **Step 2: Rework the onboarding form**

Replace the full contents of `view-submit.js`:

```js
// view-submit.js
function initialsFromName(name) {
  return name
    .split(" ")
    .filter(function (part) { return part.length > 0; })
    .slice(0, 2)
    .map(function (part) { return part[0].toUpperCase(); })
    .join("");
}

function renderSubmitForm() {
  const container = document.getElementById("submit-content");
  container.innerHTML =
    '<form id="submit-vet-form" class="checkout-form">' +
      '<label for="submit-name">Veteran\'s name</label>' +
      '<input type="text" id="submit-name" required placeholder="Full name">' +
      '<label for="submit-branch">Branch</label>' +
      '<select id="submit-branch" required>' +
        '<option value="">Select a branch</option>' +
        '<option value="Army">Army</option>' +
        '<option value="Navy">Navy</option>' +
        '<option value="Air Force">Air Force</option>' +
        '<option value="Marines">Marines</option>' +
        '<option value="Coast Guard">Coast Guard</option>' +
      '</select>' +
      '<label for="submit-era">Era of service</label>' +
      '<input type="text" id="submit-era" required placeholder="e.g. Vietnam, Gulf War">' +
      '<label for="submit-bio">Short story</label>' +
      '<textarea id="submit-bio" required rows="4" placeholder="Tell us about them"></textarea>' +
      '<p class="form-hint">At least one payment handle is required &mdash; this is where tips get sent.</p>' +
      '<label for="submit-venmo">Venmo username (optional)</label>' +
      '<input type="text" id="submit-venmo" placeholder="@username">' +
      '<label for="submit-paypal">PayPal.me username (optional)</label>' +
      '<input type="text" id="submit-paypal" placeholder="paypal.me/username">' +
      '<label for="submit-cashapp">Cash App $cashtag (optional)</label>' +
      '<input type="text" id="submit-cashapp" placeholder="$cashtag">' +
      '<label for="submit-doc">Verification document (DD-214, VA ID, etc.)</label>' +
      '<input type="file" id="submit-doc" accept="image/*,.pdf" required>' +
      '<button type="submit" class="confirm-button">Submit for Review</button>' +
    '</form>' +
    '<div id="submit-success" class="submit-success" hidden></div>' +
    '<div id="submit-error" class="submit-error" hidden></div>';

  setUpSubmitForm();
}

function setUpSubmitForm() {
  const form = document.getElementById("submit-vet-form");

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const name = document.getElementById("submit-name").value.trim();
    const branch = document.getElementById("submit-branch").value;
    const era = document.getElementById("submit-era").value.trim();
    const bio = document.getElementById("submit-bio").value.trim();
    const venmoHandle = document.getElementById("submit-venmo").value.trim();
    const paypalHandle = document.getElementById("submit-paypal").value.trim();
    const cashappHandle = document.getElementById("submit-cashapp").value.trim();
    const verificationFile = document.getElementById("submit-doc").files[0];

    const errorBox = document.getElementById("submit-error");
    errorBox.hidden = true;

    if (!name || !branch || !era || !bio || !verificationFile) {
      errorBox.hidden = false;
      errorBox.textContent = "Please fill in every required field and attach a verification document.";
      return;
    }

    if (!venmoHandle && !paypalHandle && !cashappHandle) {
      errorBox.hidden = false;
      errorBox.textContent = "Add at least one payment handle (Venmo, PayPal, or Cash App).";
      return;
    }

    const submitButton = form.querySelector("button[type=submit]");
    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";

    submitVeteranForReview({
      name: name,
      branch: branch,
      era: era,
      bio: bio,
      avatarInitials: initialsFromName(name),
      venmoHandle: venmoHandle,
      paypalHandle: paypalHandle,
      cashappHandle: cashappHandle,
      verificationFile: verificationFile,
    }).then(function () {
      form.hidden = true;
      const success = document.getElementById("submit-success");
      success.hidden = false;
      success.innerHTML = "<p>Submitted — we'll review it and let you know.</p>";
    }).catch(function (error) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit for Review";
      errorBox.hidden = false;
      errorBox.textContent = "Something went wrong: " + error.message;
    });
  });
}
```

- [ ] **Step 3: Verify manually in the browser**

Fill out and submit the form at `#/submit` with a Venmo handle and a small test file attached. Expected: button shows "Submitting…", then the success message appears. Confirm the row landed correctly:

```bash
npx supabase db execute --local --sql "select name, status, featured_status, venmo_handle, verification_doc_path from public.veterans order by submitted_at desc limit 1;"
```

Expected: the submitted name, `status = pending`, `featured_status` is `null`, the Venmo handle, and a non-null `verification_doc_path`.

- [ ] **Step 4: Commit**

```bash
git add view-submit.js supabase-client.js
git commit -m "$(cat <<'EOF'
Rework vet onboarding to collect payment handles and verification doc

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Admin review screen with Feature action

**Files:**
- Create: `view-admin.js`
- Modify: `supabase-client.js` (append)
- Modify: `router.js` (add `#/admin` route, remove profile/directory routes — see Task 9)
- Modify: `index.html` (add admin view section + script tag)

**Interfaces:**
- Consumes: `supabaseClient` from Task 5.
- Produces: `signInAdmin`, `signOutAdmin`, `getAdminSession`, `fetchPendingVeterans`, `fetchQueuedVeterans`, `getVerificationDocSignedUrl`, `approveVeteran`, `rejectVeteran`, `featureVeteran` — used only by `view-admin.js`.

- [ ] **Step 1: Add admin functions to `supabase-client.js`**

```js
async function signInAdmin(email, password) {
  const { error } = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
  if (error) {
    throw error;
  }
}

async function signOutAdmin() {
  await supabaseClient.auth.signOut();
}

async function getAdminSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function fetchPendingVeterans() {
  const { data, error } = await supabaseClient
    .from("veterans")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    throw error;
  }
  return data;
}

async function fetchQueuedVeterans() {
  const { data, error } = await supabaseClient
    .from("veterans")
    .select("*")
    .eq("status", "approved")
    .eq("featured_status", "queued")
    .order("reviewed_at", { ascending: true });

  if (error) {
    throw error;
  }
  return data;
}

async function getVerificationDocSignedUrl(path) {
  const { data, error } = await supabaseClient.storage
    .from("verification-docs")
    .createSignedUrl(path, 300);

  if (error) {
    throw error;
  }
  return data.signedUrl;
}

async function approveVeteran(id) {
  const session = await getAdminSession();
  const { error } = await supabaseClient
    .from("veterans")
    .update({
      status: "approved",
      featured_status: "queued",
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.user.email,
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function rejectVeteran(id) {
  const session = await getAdminSession();
  const { error } = await supabaseClient
    .from("veterans")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.user.email,
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function featureVeteran(id) {
  const { data: currentVets, error: currentError } = await supabaseClient
    .from("veterans")
    .select("id")
    .eq("featured_status", "current");

  if (currentError) {
    throw currentError;
  }

  const now = new Date().toISOString();

  for (const vet of currentVets) {
    const { error } = await supabaseClient
      .from("veterans")
      .update({ featured_status: "completed" })
      .eq("id", vet.id);
    if (error) {
      throw error;
    }
  }

  const { error: featureError } = await supabaseClient
    .from("veterans")
    .update({ featured_status: "current", featured_at: now })
    .eq("id", id);

  if (featureError) {
    throw featureError;
  }
}
```

`featureVeteran` retires any existing `current` vet first, then promotes the target — the database's `one_current_vet` unique index (Task 2) is the real guarantee against two current vets; this ordering just avoids hitting it in the normal path.

- [ ] **Step 2: Write the admin view**

```js
// view-admin.js
function renderAdmin() {
  getAdminSession().then(function (session) {
    const container = document.getElementById("admin-content");
    if (!session) {
      renderAdminLogin(container);
    } else {
      renderAdminDashboard(container);
    }
  });
}

function renderAdminLogin(container) {
  container.innerHTML =
    '<form id="admin-login-form" class="checkout-form">' +
      '<label for="admin-email">Email</label>' +
      '<input type="email" id="admin-email" required>' +
      '<label for="admin-password">Password</label>' +
      '<input type="password" id="admin-password" required>' +
      '<button type="submit" class="confirm-button">Log In</button>' +
    '</form>' +
    '<div id="admin-login-error" class="submit-error" hidden></div>';

  document.getElementById("admin-login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const email = document.getElementById("admin-email").value.trim();
    const password = document.getElementById("admin-password").value;
    const errorBox = document.getElementById("admin-login-error");

    signInAdmin(email, password).then(function () {
      renderAdmin();
    }).catch(function (error) {
      errorBox.hidden = false;
      errorBox.textContent = "Login failed: " + error.message;
    });
  });
}

function buildPendingCard(vet, onDecided) {
  const card = document.createElement("div");
  card.className = "profile-content";
  card.innerHTML =
    '<h2 class="veteran-name">' + escapeHtml(vet.name) + '</h2>' +
    '<p class="veteran-meta">' + escapeHtml(vet.branch) + ' &middot; ' + escapeHtml(vet.era) + '</p>' +
    '<p class="veteran-bio">' + escapeHtml(vet.bio) + '</p>' +
    '<p>Venmo: ' + escapeHtml(vet.venmo_handle || '—') + ' | PayPal: ' + escapeHtml(vet.paypal_handle || '—') + ' | Cash App: ' + escapeHtml(vet.cashapp_handle || '—') + '</p>' +
    '<a href="#" class="confirm-button doc-link">View Verification Doc</a>' +
    '<button type="button" class="confirm-button approve-button">Approve</button>' +
    '<button type="button" class="confirm-button reject-button">Reject</button>';

  card.querySelector(".doc-link").addEventListener("click", function (event) {
    event.preventDefault();
    getVerificationDocSignedUrl(vet.verification_doc_path).then(function (url) {
      window.open(url, "_blank");
    });
  });

  card.querySelector(".approve-button").addEventListener("click", function () {
    approveVeteran(vet.id).then(onDecided);
  });

  card.querySelector(".reject-button").addEventListener("click", function () {
    rejectVeteran(vet.id).then(onDecided);
  });

  return card;
}

function buildQueuedCard(vet, onFeatured) {
  const card = document.createElement("div");
  card.className = "profile-content";
  card.innerHTML =
    '<h2 class="veteran-name">' + escapeHtml(vet.name) + '</h2>' +
    '<p class="veteran-meta">' + escapeHtml(vet.branch) + ' &middot; ' + escapeHtml(vet.era) + '</p>' +
    '<p class="veteran-bio">' + escapeHtml(vet.bio) + '</p>' +
    '<button type="button" class="confirm-button feature-button">Feature this vet</button>';

  card.querySelector(".feature-button").addEventListener("click", function () {
    if (!window.confirm("Make " + vet.name + " this period's featured vet? Any current vet will move to Past Vets.")) {
      return;
    }
    featureVeteran(vet.id).then(onFeatured);
  });

  return card;
}

function renderAdminDashboard(container) {
  container.innerHTML =
    '<button type="button" id="admin-logout-button" class="confirm-button">Log Out</button>' +
    '<h3>Pending Review</h3>' +
    '<div id="admin-pending-list"><p>Loading…</p></div>' +
    '<h3>Queued (approved, waiting to be featured)</h3>' +
    '<div id="admin-queued-list"><p>Loading…</p></div>';

  document.getElementById("admin-logout-button").addEventListener("click", function () {
    signOutAdmin().then(renderAdmin);
  });

  refreshPendingList();
  refreshQueuedList();
}

function refreshPendingList() {
  const list = document.getElementById("admin-pending-list");
  fetchPendingVeterans().then(function (veterans) {
    list.innerHTML = "";
    if (veterans.length === 0) {
      list.innerHTML = "<p>No pending veterans.</p>";
      return;
    }
    veterans.forEach(function (vet) {
      list.appendChild(buildPendingCard(vet, refreshPendingList));
    });
  });
}

function refreshQueuedList() {
  const list = document.getElementById("admin-queued-list");
  fetchQueuedVeterans().then(function (veterans) {
    list.innerHTML = "";
    if (veterans.length === 0) {
      list.innerHTML = "<p>No one queued yet.</p>";
      return;
    }
    veterans.forEach(function (vet) {
      list.appendChild(buildQueuedCard(vet, function () {
        refreshQueuedList();
      }));
    });
  });
}
```

- [ ] **Step 3: Wire the route and markup**

In `router.js`, add before the final `renderHome()` fallback:

```js
if (hash === "#/admin") {
  renderAdmin();
  showView("admin-view");
  return;
}
```

In `index.html`, add a new section alongside the other `<section class="view">` blocks:

```html
<section id="admin-view" class="view" hidden>
  <div class="page-heading">
    <h2>Admin Review</h2>
  </div>
  <div id="admin-content"></div>
</section>
```

Add `<script src="view-admin.js"></script>` next to the other view scripts in `index.html`, before `app.js`.

- [ ] **Step 4: Verify manually in the browser**

Navigate to `#/admin`. Expected: login form appears. Log in with the admin credentials from Task 4 Step 3. Expected: "Pending Review" shows the Task 7 test submission; "Queued" is empty. Click "View Verification Doc" — expected: the uploaded file opens in a new tab. Click "Approve" — expected: the card moves out of Pending and appears under Queued. Click "Feature this vet" on it, confirm the dialog — expected: it disappears from Queued. Confirm it's now the public current vet:

```js
fetchCurrentVeteran().then(console.log)
```

Expected: the featured vet's row, with `featured_status: "current"`. Click "Log Out" — expected: returns to the login form.

- [ ] **Step 5: Commit**

```bash
git add view-admin.js supabase-client.js router.js index.html
git commit -m "$(cat <<'EOF'
Add admin review screen with pending/queued lists and a Feature action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Homepage becomes the current-vet view; remove directory/profile browsing

**Files:**
- Delete: `view-directory.js`, `view-profile.js`
- Modify: `view-home.js`
- Modify: `router.js` (remove `#/vets` and `#/vets/:id` routes)
- Modify: `index.html` (remove directory/profile `<section>`s and the "Browse Vets" nav link, update hero copy's script tags)

**Interfaces:**
- Consumes: `fetchCurrentVeteran()` from Task 5.
- Produces: `renderHome()` (same name, now async internally, no public call signature change) — nothing else depends on this.

- [ ] **Step 1: Delete the directory and profile view files**

```bash
rm view-directory.js view-profile.js
```

- [ ] **Step 2: Rewrite `view-home.js`**

```js
// view-home.js
function renderHome() {
  const container = document.getElementById("home-content");
  container.innerHTML = "<p>Loading…</p>";

  fetchCurrentVeteran().then(function (vet) {
    if (!vet) {
      container.innerHTML =
        '<section class="hero">' +
          '<h2>Every veteran deserves to be seen.</h2>' +
          '<p class="hero-copy">' +
            'Each period, our board of five chooses one veteran we believe critically needs help right now &mdash; ' +
            '100% of your tip goes straight to them. We never touch the money.' +
          '</p>' +
          '<p class="hero-copy">We&rsquo;re choosing this period&rsquo;s vet &mdash; check back soon.</p>' +
        '</section>';
      return;
    }

    container.innerHTML =
      '<section class="hero">' +
        '<h2>Every veteran deserves to be seen.</h2>' +
        '<p class="hero-copy">' +
          'Each period, our board of five chooses one veteran we believe critically needs help right now &mdash; ' +
          '100% of your tip goes straight to them. We never touch the money.' +
        '</p>' +
        '<a href="#/tip" class="confirm-button hero-cta">Tip a Vet a Buck</a>' +
      '</section>' +
      '<section class="featured-vets">' +
        '<h3>This period&rsquo;s vet</h3>' +
        '<div class="profile-content" id="current-vet-content"></div>' +
      '</section>';

    document.getElementById("current-vet-content").innerHTML =
      '<div class="profile-header-row">' +
        avatarMarkup(vet.id, "avatar-large") +
        '<div>' +
          '<h2 class="veteran-name">' + escapeHtml(vet.name) + '</h2>' +
          '<p class="veteran-meta">' + escapeHtml(vet.branch) + ' &middot; ' + escapeHtml(vet.era) + '</p>' +
        '</div>' +
      '</div>' +
      '<p class="veteran-bio">' + escapeHtml(vet.bio) + '</p>' +
      '<p class="veteran-total">' + formatCurrency(vet.totalTipped) + ' tipped &middot; self-reported</p>' +
      '<a class="confirm-button" href="#/tip">Send $</a>';
  });
}
```

- [ ] **Step 3: Update the router**

In `router.js`, remove the `profileMatch` block and the `#/vets` block entirely (directory/profile browsing no longer exists). The `#/tip` and `paymentMatch` blocks are reworked in Task 10, so leave them for that task. Resulting file for this task's scope:

```js
function showView(viewId) {
  document.querySelectorAll(".view").forEach(function (view) {
    view.hidden = view.id !== viewId;
  });
}

function router() {
  const hash = window.location.hash;

  if (hash === "#/tip") {
    renderPayment();
    showView("payment-view");
    return;
  }

  if (hash === "#/submit") {
    renderSubmitForm();
    showView("submit-view");
    return;
  }

  if (hash === "#/served") {
    renderServedVets();
    showView("served-view");
    return;
  }

  if (hash === "#/admin") {
    renderAdmin();
    showView("admin-view");
    return;
  }

  renderHome();
  showView("home-view");
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
```

(`renderPayment()` losing its argument is Task 11's job, and `renderServedVets()` is reworked in Task 10 — this step only removes the dead directory/profile routes; the `#/tip` and `#/served` blocks above are left as-is for those tasks to pick up.)

- [ ] **Step 4: Update `index.html`**

Remove the `directory-view` and `profile-view` `<section>` blocks entirely. Remove the back-button's directory reference — in `app.js`, delete the `back-button` click handler block (lines 1-3) since there's no profile page to navigate back from. Remove `<a href="#/vets">Browse Vets</a>` from the nav. Remove `<script src="view-directory.js"></script>` and `<script src="view-profile.js"></script>` from the script tags.

- [ ] **Step 5: Verify manually in the browser**

With a vet featured (from Task 8's verification), reload the homepage. Expected: shows "This period's vet" with the featured vet's name/branch/era/bio/total and a "Send $" link to `#/tip`. Then, via SQL, clear the current vet (`update public.veterans set featured_status = 'completed' where featured_status = 'current';`) and reload. Expected: shows the "We're choosing this period's vet — check back soon" copy instead of an error.

- [ ] **Step 6: Commit**

```bash
git add -A view-directory.js view-profile.js view-home.js router.js index.html app.js
git commit -m "$(cat <<'EOF'
Replace browsable directory/profile with a single current-vet homepage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Past Vets page

**Files:**
- Modify: `view-served.js`
- Modify: `index.html` (update "Vets We've Tipped" copy/heading to "Past Vets")

**Interfaces:**
- Consumes: `fetchPastVets()` from Task 5.
- Produces: `renderServedVets()` (same name, now async internally) — called by `router.js` from Task 9.

- [ ] **Step 1: Rewrite `view-served.js`**

```js
// view-served.js
function renderServedVets() {
  const grid = document.getElementById("served-grid");
  grid.innerHTML = "<p>Loading…</p>";

  fetchPastVets().then(function (vets) {
    grid.innerHTML = "";
    if (vets.length === 0) {
      grid.innerHTML = "<p>No past vets yet &mdash; this period's vet is still active.</p>";
      return;
    }

    vets.forEach(function (vet) {
      const card = document.createElement("div");
      card.className = "veteran-card served-card";
      card.innerHTML =
        avatarMarkup(vet.id, "avatar") +
        '<h2 class="veteran-name">' + escapeHtml(vet.name) + '</h2>' +
        '<p class="veteran-meta">' + escapeHtml(vet.branch) + ' &middot; ' + escapeHtml(vet.era) + '</p>' +
        '<p class="veteran-total">' + formatCurrency(vet.totalTipped) + ' received &middot; self-reported</p>';
      grid.appendChild(card);
    });
  });
}
```

- [ ] **Step 2: Update `index.html` copy**

Change the `served-view` section's heading/subtext from "Vets We've Tipped" / "These vets have already gotten what they needed from people like you." to "Past Vets" / "Veterans our community has already helped." Update the nav link text from "Vets We've Tipped" to "Past Vets" (the `href="#/served"` stays the same).

- [ ] **Step 3: Verify manually in the browser**

With the `featured_status = 'completed'` vet from Task 9 Step 5's cleanup, navigate to `#/served`. Expected: shows that vet's card with their real self-reported total. With a fresh database (no completed vets), expected: shows "No past vets yet — this period's vet is still active."

- [ ] **Step 4: Commit**

```bash
git add view-served.js index.html
git commit -m "$(cat <<'EOF'
Load Past Vets page from real featured_status=completed data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Payment flow — amount entry and donation UI

**Files:**
- Modify: `view-payment.js`

**Interfaces:**
- Consumes: `fetchCurrentVeteran()` from Task 5.
- Produces: `renderPayment()` (signature change: takes **no argument** — there's only ever one possible target, the current vet). Donation math is purely client-side here; checkout wiring is Task 12.

- [ ] **Step 1: Replace the top of `view-payment.js`**

```js
// view-payment.js
const DONATION_RATE = 0.15;

function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

function renderPayment() {
  const content = document.getElementById("payment-content");
  content.innerHTML = "<p>Loading…</p>";

  fetchCurrentVeteran().then(function (targetVet) {
    if (!targetVet) {
      content.innerHTML = "<p>We're choosing this period's vet &mdash; check back soon.</p>";
      return;
    }

    content.innerHTML =
      '<div class="payment-vet-summary">' +
        avatarMarkup(targetVet.id, "avatar") +
        '<div>' +
          '<h2 class="veteran-name">' + escapeHtml(targetVet.name) + '</h2>' +
          '<p class="veteran-meta">' + escapeHtml(targetVet.branch) + ' &middot; ' + escapeHtml(targetVet.era) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="amount-entry">' +
        '<div class="amount-display">' +
          '<span class="amount-currency">$</span>' +
          '<input type="number" id="amount-input" class="amount-input" min="1" step="1" value="1" inputmode="decimal">' +
        '</div>' +
        '<div class="amount-chips">' +
          '<button type="button" class="amount-chip" data-amount="1">$1</button>' +
          '<button type="button" class="amount-chip" data-amount="5">$5</button>' +
          '<button type="button" class="amount-chip" data-amount="10">$10</button>' +
          '<button type="button" class="amount-chip" data-amount="20">$20</button>' +
        '</div>' +
        '<div class="donation-row">' +
          '<label>' +
            '<input type="checkbox" id="donation-checkbox" checked>' +
            ' Also chip in <span id="donation-amount-display"></span> to support Tip a Vet' +
          '</label>' +
          '<input type="number" id="donation-amount-input" min="0" step="0.01">' +
        '</div>' +
        '<div class="fee-breakdown">' +
          '<div class="fee-row"><span>Vet gets</span><span id="fee-amount"></span></div>' +
          '<div class="fee-row"><span>Support Tip a Vet</span><span id="fee-fee"></span></div>' +
          '<div class="fee-row fee-total"><span>Total</span><span id="fee-total"></span></div>' +
        '</div>' +
        '<div class="note-field">' +
          '<label for="tip-note">Add a note (optional)</label>' +
          '<input type="text" id="tip-note" placeholder="For your service 🇺🇸" maxlength="60">' +
        '</div>' +
      '</div>' +
      '<button type="button" id="send-button" class="confirm-button">Send</button>';

    setUpPaymentFlow(targetVet);
  });
}

function updateFeeBreakdown(amount, donationAmount, donationChecked) {
  const valid = amount && amount > 0;
  const effectiveDonation = donationChecked ? donationAmount : 0;
  const total = valid ? amount + effectiveDonation : 0;

  document.getElementById("fee-amount").textContent = valid ? formatCurrency(amount) : formatCurrency(0);
  document.getElementById("fee-fee").textContent = "+" + formatCurrency(effectiveDonation);
  document.getElementById("fee-total").textContent = valid ? formatCurrency(total) : formatCurrency(0);
  document.getElementById("donation-amount-display").textContent = formatCurrency(donationAmount);

  const sendButton = document.getElementById("send-button");
  sendButton.textContent = valid ? "Send " + formatCurrency(total) : "Send";
  sendButton.disabled = !valid;
}

function setUpPaymentFlow(vet) {
  const amountInput = document.getElementById("amount-input");
  const chips = document.querySelectorAll(".amount-chip");
  const donationCheckbox = document.getElementById("donation-checkbox");
  const donationInput = document.getElementById("donation-amount-input");
  const noteInput = document.getElementById("tip-note");
  const sendButton = document.getElementById("send-button");

  let donationManuallyEdited = false;

  function selectChipFor(amount) {
    chips.forEach(function (chip) {
      chip.classList.toggle("selected", Number(chip.dataset.amount) === amount);
    });
  }

  function currentDonationAmount(tipAmount) {
    if (donationManuallyEdited) {
      return roundToCents(Number(donationInput.value) || 0);
    }
    return roundToCents(tipAmount * DONATION_RATE);
  }

  function refresh() {
    const amount = roundToCents(Number(amountInput.value));
    const donationAmount = currentDonationAmount(amount);
    donationInput.value = donationAmount;
    selectChipFor(amount);
    updateFeeBreakdown(amount, donationAmount, donationCheckbox.checked);
  }

  refresh();

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      amountInput.value = Number(chip.dataset.amount);
      refresh();
    });
  });

  amountInput.addEventListener("input", refresh);

  donationInput.addEventListener("input", function () {
    donationManuallyEdited = true;
    refresh();
  });

  donationCheckbox.addEventListener("change", refresh);

  sendButton.addEventListener("click", function () {
    const amount = roundToCents(Number(amountInput.value));
    if (!amount || amount <= 0) {
      return;
    }
    // Checkout wiring added in Task 12.
  });
}
```

- [ ] **Step 2: Verify manually in the browser**

With a vet featured, navigate to `#/tip`. Expected: amount defaults to $1, donation line shows "$0.15" pre-checked, "Vet gets $1.00 / Support Tip a Vet +$0.15 / Total $1.15". Click the $10 chip — expected: donation auto-updates to $1.50. Manually type a donation amount, e.g. `0.50` — expected: total recalculates using that value, and clicking a different amount chip afterward keeps using your manual donation value instead of snapping back to 15%. Uncheck the box — expected: total drops to just the tip amount. With no vet featured, navigate to `#/tip` — expected: "We're choosing this period's vet — check back soon," no error.

- [ ] **Step 3: Commit**

```bash
git add view-payment.js
git commit -m "$(cat <<'EOF'
Rework payment amount screen to target the current vet with a donation line

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Payment flow — checkout, hand-off, and self-reported confirmation

**Files:**
- Modify: `view-payment.js`
- Modify: `supabase-client.js` (append)
- Modify: `router.js` (add `#/tip/complete` route)

**Interfaces:**
- Consumes: `startDonationCheckout`, `createPendingTip`, `markTipSent`, `fetchTipById` (all new, added in Step 1); `create-donation-session` Edge Function from Task 13.
- Produces: complete end-to-end tip flow. Nothing later in this plan depends on this task.

- [ ] **Step 1: Add the remaining tip functions to `supabase-client.js`**

```js
async function createPendingTip(fields) {
  const { data, error } = await supabaseClient
    .from("tips")
    .insert({
      veteran_id: fields.veteranId,
      amount: fields.amount,
      note: fields.note || null,
      donation_amount: 0,
      donation_status: "none",
      self_reported_sent: false,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

async function markTipSent(tipId) {
  const { error } = await supabaseClient
    .from("tips")
    .update({ self_reported_sent: true })
    .eq("id", tipId);

  if (error) {
    throw error;
  }
}

async function fetchTipById(tipId) {
  const { data, error } = await supabaseClient
    .from("tips")
    .select("*")
    .eq("id", tipId)
    .single();

  if (error) {
    throw error;
  }
  return data;
}

async function startDonationCheckout(fields) {
  const { data, error } = await supabaseClient.functions.invoke("create-donation-session", {
    body: {
      veteranId: fields.veteranId,
      tipAmount: fields.amount,
      donationAmount: fields.donationAmount,
      note: fields.note,
      returnUrl: fields.returnUrl,
    },
  });

  if (error) {
    throw error;
  }
  return data;
}
```

- [ ] **Step 2: Add the hand-off screen and wire the Send button**

Append to `view-payment.js`:

```js
function venmoWebLink(handle, amount, note) {
  return "https://venmo.com/" + encodeURIComponent(handle) +
    "?txn=pay&amount=" + encodeURIComponent(amount) +
    "&note=" + encodeURIComponent(note || "Tip a Vet");
}

function cashappWebLink(handle, amount) {
  return "https://cash.app/$" + encodeURIComponent(handle) + "/" + encodeURIComponent(amount);
}

function paypalWebLink(handle, amount) {
  return "https://paypal.me/" + encodeURIComponent(handle) + "/" + encodeURIComponent(amount);
}

function showHandoffScreen(vet, tipId, amount, note) {
  const content = document.getElementById("payment-content");
  let links = "";

  if (vet.venmo_handle) {
    links += '<a class="confirm-button payment-link" target="_blank" href="' + venmoWebLink(vet.venmo_handle, amount, note) + '">Open Venmo</a>';
  }
  if (vet.paypal_handle) {
    links += '<a class="confirm-button payment-link" target="_blank" href="' + paypalWebLink(vet.paypal_handle, amount) + '">Open PayPal</a>';
  }
  if (vet.cashapp_handle) {
    links += '<a class="confirm-button payment-link" target="_blank" href="' + cashappWebLink(vet.cashapp_handle, amount) + '">Open Cash App</a>';
  }

  content.innerHTML =
    '<div class="payment-success-panel">' +
      avatarMarkup(vet.id, "avatar-large") +
      '<h2>Almost there</h2>' +
      '<p>Send ' + formatCurrency(amount) + ' to ' + escapeHtml(vet.name) + ' using one of the links below.</p>' +
      links +
      '<button type="button" id="confirm-sent-button" class="confirm-button">I sent it</button>' +
    '</div>';

  document.getElementById("confirm-sent-button").addEventListener("click", function () {
    markTipSent(tipId).then(function () {
      content.innerHTML =
        '<div class="payment-success-panel">' +
          avatarMarkup(vet.id, "avatar-large") +
          '<h2>Sent! 🎉</h2>' +
          '<p>' + escapeHtml(vet.name) + ' just got ' + formatCurrency(amount) + ' from you' +
          (note ? ' &mdash; &ldquo;' + escapeHtml(note) + '&rdquo;' : '') + '.</p>' +
          '<a class="confirm-button payment-link" href="#/">Back home</a>' +
        '</div>';
    });
  });
}

function renderPaymentComplete(tipId) {
  const content = document.getElementById("payment-content");
  content.innerHTML = "<p>Loading…</p>";

  Promise.all([fetchCurrentVeteran(), fetchTipById(tipId)]).then(function (results) {
    const vet = results[0];
    const tip = results[1];
    if (!vet || !tip) {
      content.innerHTML = "<p>Something went wrong loading your tip.</p>";
      return;
    }
    showHandoffScreen(vet, tip.id, tip.amount, tip.note);
  });
}
```

Now wire the `sendButton` click handler added in Task 11 Step 1 (replace the `// Checkout wiring added in Task 12.` comment):

```js
  sendButton.addEventListener("click", function () {
    const amount = roundToCents(Number(amountInput.value));
    if (!amount || amount <= 0) {
      return;
    }

    const donationAmount = donationCheckbox.checked ? currentDonationAmount(amount) : 0;
    const note = noteInput.value.trim();

    sendButton.disabled = true;

    if (donationAmount > 0) {
      sendButton.textContent = "Redirecting to checkout…";
      const returnUrl = window.location.origin + window.location.pathname + "#/tip/complete";
      startDonationCheckout({
        veteranId: vet.id,
        amount: amount,
        donationAmount: donationAmount,
        note: note,
        returnUrl: returnUrl,
      }).then(function (result) {
        window.location.href = result.url;
      }).catch(function (error) {
        sendButton.disabled = false;
        sendButton.textContent = "Send";
        alert("Checkout failed: " + error.message);
      });
    } else {
      createPendingTip({ veteranId: vet.id, amount: amount, note: note }).then(function (tip) {
        showHandoffScreen(vet, tip.id, amount, note);
      });
    }
  });
```

- [ ] **Step 3: Wire the `#/tip/complete` route**

In `router.js`, replace the `#/tip` block with (checked before any other `#/tip`-prefixed route):

```js
const paymentCompleteMatch = hash.match(/^#\/tip\/complete\?tip_id=(.+)$/);

if (paymentCompleteMatch) {
  renderPaymentComplete(paymentCompleteMatch[1]);
  showView("payment-view");
  return;
}

if (hash === "#/tip") {
  renderPayment();
  showView("payment-view");
  return;
}
```

- [ ] **Step 4: Verify the no-donation path manually**

Navigate to `#/tip`, uncheck the donation box, click Send. Expected: hand-off screen appears immediately (no redirect) showing an "Open Venmo" (or PayPal/Cash App) button and "I sent it". Click "Open Venmo" — expected: opens `venmo.com/<handle>?txn=pay&amount=...` in a new tab with the right amount. Back on the original tab, click "I sent it" — expected: success panel appears. Confirm:

```bash
npx supabase db execute --local --sql "select amount, donation_amount, self_reported_sent from public.tips order by created_at desc limit 1;"
```

Expected: `self_reported_sent = t`, `donation_amount = 0`.

- [ ] **Step 5: Verify the donation path manually (Stripe test mode, after Task 13)**

Navigate to `#/tip` again, leave the donation checkbox checked, click Send. Expected: redirects to a Stripe-hosted Checkout page. Use Stripe's test card `4242 4242 4242 4242`, any future expiry/CVC. Expected: redirects back to `#/tip/complete?tip_id=...`, which shows the hand-off screen with the correct tip amount. Complete "I sent it" as before. Confirm the webhook reconciled the donation (requires `stripe listen` running per Task 14, forwarding to your local or deployed function):

```bash
npx supabase db execute --local --sql "select donation_amount, donation_status, self_reported_sent from public.tips order by created_at desc limit 1;"
```

Expected: `donation_status = paid`, `self_reported_sent = t`.

- [ ] **Step 6: Commit**

```bash
git add view-payment.js supabase-client.js router.js
git commit -m "$(cat <<'EOF'
Wire donation checkout, vet hand-off links, and self-reported tip confirmation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Stripe donation Checkout Edge Function

**Files:**
- Create: `supabase/functions/create-donation-session/index.ts`

**Interfaces:**
- Consumes: `public.tips` table from Task 2.
- Produces: HTTP endpoint `POST /functions/v1/create-donation-session` — request body `{veteranId, tipAmount, donationAmount, note, returnUrl}`, response `{url, tipId}`. Consumed by Task 12's `startDonationCheckout`.

- [ ] **Step 1: Create a Stripe account and get test keys**

At https://dashboard.stripe.com, create an account (or use an existing one), stay in **Test mode**, and copy the test **Secret key** (starts `sk_test_`) from Developers → API keys.

- [ ] **Step 2: Set Edge Function secrets**

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to every Edge Function.)

- [ ] **Step 3: Write the function**

```ts
// supabase/functions/create-donation-session/index.ts
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { veteranId, tipAmount, donationAmount, note, returnUrl } = await req.json();

    if (!veteranId || !tipAmount || !(donationAmount > 0) || !returnUrl) {
      return new Response(
        JSON.stringify({ error: "veteranId, tipAmount, donationAmount, and returnUrl are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: tipRow, error: insertError } = await supabaseAdmin
      .from("tips")
      .insert({
        veteran_id: veteranId,
        amount: tipAmount,
        note: note || null,
        donation_amount: donationAmount,
        donation_status: "pending",
        self_reported_sent: false,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: tipRow.id,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Support Tip a Vet" },
            unit_amount: Math.round(donationAmount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: returnUrl + "?tip_id=" + tipRow.id,
      cancel_url: returnUrl + "?tip_id=" + tipRow.id,
    });

    await supabaseAdmin
      .from("tips")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", tipRow.id);

    return new Response(JSON.stringify({ url: session.url, tipId: tipRow.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 4: Serve locally and verify**

```bash
npx supabase functions serve create-donation-session
```

In another terminal (using the real featured veteran's id from Task 8's verification):

```bash
curl -s -X POST "http://127.0.0.1:54321/functions/v1/create-donation-session" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"veteranId":"<the current veteran id>","tipAmount":10,"donationAmount":1.5,"note":"test","returnUrl":"http://localhost:8080/#/tip/complete"}'
```

Expected: `200 OK` with `{"url":"https://checkout.stripe.com/...","tipId":"..."}`. Confirm the tip row exists:

```bash
npx supabase db execute --local --sql "select amount, donation_amount, donation_status, stripe_checkout_session_id from public.tips order by created_at desc limit 1;"
```

Expected: `amount=10`, `donation_amount=1.5`, `donation_status=pending`, and a non-null session id.

- [ ] **Step 5: Deploy and commit**

```bash
npx supabase functions deploy create-donation-session
git add supabase/functions/create-donation-session/index.ts
git commit -m "$(cat <<'EOF'
Add Stripe Checkout Edge Function for the optional platform donation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Stripe webhook Edge Function

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`

**Interfaces:**
- Consumes: `public.tips` table, `client_reference_id` set by Task 13.
- Produces: HTTP endpoint `POST /functions/v1/stripe-webhook`, called by Stripe. Flips `tips.donation_status` to `paid`.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/stripe-webhook/index.ts
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    return new Response("Webhook signature verification failed: " + err.message, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const tipId = session.client_reference_id;

    if (tipId) {
      await supabaseAdmin
        .from("tips")
        .update({ donation_status: "paid" })
        .eq("id", tipId);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Deploy and register the webhook**

```bash
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

In the Stripe dashboard, Developers → Webhooks → **Add endpoint**, URL `https://<your-project-ref>.functions.supabase.co/stripe-webhook`, event `checkout.session.completed`. Copy the generated **Signing secret** (`whsec_...`) and set it:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

- [ ] **Step 3: Verify with the Stripe CLI**

```bash
stripe login
stripe listen --forward-to https://<your-project-ref>.functions.supabase.co/stripe-webhook
```

In another terminal:

```bash
stripe trigger checkout.session.completed
```

Expected: the `stripe listen` terminal shows a `200` response. Since the triggered test event won't carry a real `client_reference_id`, this confirms signature verification and delivery work; full end-to-end reconciliation was verified in Task 12 Step 5 using a real Checkout session.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "$(cat <<'EOF'
Add Stripe webhook to reconcile donation payment status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
