# Lean Vet of the Month Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Tip a Vet into a real, backend-free product where one hand-picked veteran at a time receives all tipping traffic via a direct, non-custodial Venmo/PayPal/Cash App hand-off, with past picks shown in a Past Vets history — and the only server-side code anywhere is a single Cloudflare Worker that creates a Stripe Checkout session for the optional "support Tip a Vet" donation.

**Architecture:** The existing static site (plain HTML/CSS/JS, GitHub Pages, no build step) stays exactly as deployed today. Who's currently featured and who's been featured before live in a hand-edited static JS data file committed to the repo — no database, no auth, no file storage, nothing async to fetch. The one exception is the Stripe donation: creating a Checkout Session needs a secret key that can never reach the browser, so that one operation is a tiny Cloudflare Worker, called cross-origin from the static site.

**Tech Stack:** Vanilla JS (no framework/build step, matching the existing codebase), a single Cloudflare Worker (no framework — raw `fetch` to Stripe's REST API, no SDK dependency), Wrangler CLI for the Worker's local dev and deploy.

**Spec:** `docs/superpowers/specs/2026-10-14-lean-vet-of-the-month-design.md`

## Global Constraints

- `STRIPE_SECRET_KEY` must never appear in any committed file or reach the browser — it lives only as a Cloudflare Worker secret (`wrangler secret put`).
- No build step, no framework — all new frontend files are plain `<script>`-tag JS matching the existing style (`function` declarations, string concatenation, `const`/`let`, no JSX/TS in the browser).
- Tip a Vet never custodies the featured vet's own tip — only the optional donation passes through Stripe/the Worker; the tip itself always goes straight to the vet's own Venmo/PayPal/Cash App.
- No database and no persistence of tips or donations anywhere in this iteration — that's intentional (see spec Overview), not a gap to work around.
- `vet-data.js` is edited by hand, directly in git, by whoever is tracking the board's decision — no code in this plan writes to it.
- The Worker's CORS headers must allow the deployed site's actual origins (the `github.io` domain and the custom domain `tip-a-vet.com`), not just `*` by accident of testing from `localhost`.

## Review Focus

- **`CURRENT_VET` is `null`** (before the board's first pick, or between picks) — the homepage and `#/tip` must show a "check back soon" state, not throw trying to read a property off `null`.
- **Query-param round-trip through Stripe Checkout** — the tip amount and note must survive being URL-encoded into `success_url`, sent to Stripe, and read back on return, including a note containing `&`, `=`, or emoji.
- **`formatCurrency` given a string** — amounts arriving via `URLSearchParams` (e.g. `"10"`) are strings, not numbers; `formatCurrency` must coerce with `Number(...)` before `.toFixed(2)` or rendering throws.
- **The Worker's CORS headers from a real cross-origin request** — a same-machine `curl` test can pass while the deployed site still fails silently in the browser console; this needs verifying from the actual site origin (or an equivalent cross-origin page), not just `curl`.
- **The donation checkbox's "manually edited, then amount changed again" behavior** — carried over from the earlier design; must still hold now that `renderPayment` reads `CURRENT_VET` synchronously instead of via a promise.

---

## Task 1: Static vet data file and `data.js` cleanup

**Files:**
- Create: `vet-data.js`
- Modify: `data.js` (remove `VETERANS`, `TIPS`, `findVeteran`, `sendTip`, `SERVED_VETERANS`; keep `escapeHtml`; harden `formatCurrency`)
- Modify: `index.html` (add `<script src="vet-data.js">` before `data.js`)

**Interfaces:**
- Produces: `CURRENT_VET` (object or `null`), `PAST_VETS` (array) — read directly by Tasks 2-4; `formatCurrency(amount)` and `escapeHtml(str)` — used by every view file from here on.

- [ ] **Step 1: Write `vet-data.js`**

```js
// vet-data.js — hand-edited by whoever is tracking the board's decision.
// Set CURRENT_VET to null when no vet has been chosen yet.
const CURRENT_VET = null;

// Most recently retired first.
const PAST_VETS = [];
```

- [ ] **Step 2: Rewrite `data.js`**

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

This matters starting with this task: amounts round-tripped through a URL query string (Task 5) arrive as strings (e.g. `"10"`), and `"10".toFixed` doesn't exist. Coercing once here, at the single chokepoint every other file calls through, means no other call site needs to worry about it.

- [ ] **Step 3: Wire the script tag**

In `index.html`, add `<script src="vet-data.js"></script>` immediately before `<script src="data.js"></script>`.

- [ ] **Step 4: Verify manually in the browser**

Serve the site locally (`npx http-server .` or `python3 -m http.server`) and open devtools console:

```js
formatCurrency("10")
```

Expected: `"$10.00"` (no thrown error). Then:

```js
CURRENT_VET
PAST_VETS
```

Expected: `null` and `[]`.

- [ ] **Step 5: Commit**

```bash
git add vet-data.js data.js index.html
git commit -m "$(cat <<'EOF'
Add hand-edited vet-data.js; trim data.js to shared helpers only

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Homepage becomes the current-vet view; remove directory/profile/submit pages

**Files:**
- Delete: `view-directory.js`, `view-profile.js`, `view-submit.js`
- Modify: `view-home.js`
- Modify: `router.js` (remove `#/vets`, `#/vets/:id`, `#/submit` routes)
- Modify: `index.html` (remove `directory-view`, `profile-view`, `submit-view` sections and their nav links; remove the now-deleted files' script tags)
- Modify: `app.js` (remove the `back-button` click handler, since `profile-view`'s back button no longer exists)

**Interfaces:**
- Consumes: `CURRENT_VET` from Task 1.
- Produces: `renderHome()` (same name, now reads `CURRENT_VET` directly) — nothing else depends on this.

- [ ] **Step 1: Delete the directory, profile, and submit view files**

```bash
rm view-directory.js view-profile.js view-submit.js
```

- [ ] **Step 2: Rewrite `view-home.js`**

```js
// view-home.js
function renderHome() {
  const container = document.getElementById("home-content");

  if (!CURRENT_VET) {
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
      avatarMarkup(CURRENT_VET.id, "avatar-large") +
      '<div>' +
        '<h2 class="veteran-name">' + escapeHtml(CURRENT_VET.name) + '</h2>' +
        '<p class="veteran-meta">' + escapeHtml(CURRENT_VET.branch) + ' &middot; ' + escapeHtml(CURRENT_VET.era) + '</p>' +
      '</div>' +
    '</div>' +
    '<p class="veteran-bio">' + escapeHtml(CURRENT_VET.bio) + '</p>' +
    '<a class="confirm-button" href="#/tip">Send $</a>';
}
```

- [ ] **Step 3: Update the router**

Rewrite `router.js` to remove the `profileMatch`/`#/vets`/`#/submit` blocks. The `#/tip`-related blocks are reworked in Task 4, so leave `renderPayment`'s call signature alone for now — just delete the dead routes:

```js
function showView(viewId) {
  document.querySelectorAll(".view").forEach(function (view) {
    view.hidden = view.id !== viewId;
  });
}

function router() {
  const hash = window.location.hash;

  if (hash === "#/tip") {
    renderPayment(null);
    showView("payment-view");
    return;
  }

  if (hash === "#/served") {
    renderServedVets();
    showView("served-view");
    return;
  }

  renderHome();
  showView("home-view");
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
```

There is no more `#/tip/:id`-style route — nothing in the new design ever links to a specific vet's tip page, since there's only ever one possible target. `renderPayment(null)` here is temporary (Task 4 drops the argument entirely).

- [ ] **Step 4: Update `index.html`**

Remove the `directory-view`, `profile-view`, and `submit-view` `<section>` blocks entirely. Remove `<a href="#/vets">Browse Vets</a>` and `<a href="#/submit">Add a Vet</a>` from the nav. Remove `<script src="view-directory.js"></script>`, `<script src="view-profile.js"></script>`, and `<script src="view-submit.js"></script>` from the script tags.

- [ ] **Step 5: Update `app.js`**

Delete the first block (lines 1-3 of the current file):

```js
document.getElementById("back-button").addEventListener("click", function () {
  window.location.hash = "#/vets";
});
```

Leave the rest of `app.js` (payment-back-button, nav-toggle, site-nav click-to-close) unchanged.

- [ ] **Step 6: Verify manually in the browser**

With `CURRENT_VET` still `null` (from Task 1), load the homepage — expected: "We're choosing this period's vet — check back soon," no error. Hand-edit `vet-data.js` to a test vet:

```js
const CURRENT_VET = {
  id: "test-1",
  name: "Test Vet",
  branch: "Army",
  era: "Test Era",
  bio: "A test bio.",
  avatarInitials: "TV",
  venmoHandle: "test-venmo",
  paypalHandle: null,
  cashappHandle: null,
};
```

Reload — expected: "This period's vet" shows Test Vet's name/branch/era/bio and a working "Send $" link to `#/tip`.

- [ ] **Step 7: Commit**

```bash
git add -A view-directory.js view-profile.js view-submit.js view-home.js router.js index.html app.js
git commit -m "$(cat <<'EOF'
Replace browsable directory/profile/submit pages with a single current-vet homepage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Past Vets page

**Files:**
- Modify: `view-served.js`
- Modify: `index.html` (update "Vets We've Tipped" heading/copy and nav link text to "Past Vets")

**Interfaces:**
- Consumes: `PAST_VETS` from Task 1.
- Produces: `renderServedVets()` (same name, now synchronous) — called by `router.js`.

- [ ] **Step 1: Rewrite `view-served.js`**

```js
// view-served.js
function renderServedVets() {
  const grid = document.getElementById("served-grid");
  grid.innerHTML = "";

  if (PAST_VETS.length === 0) {
    grid.innerHTML = "<p>No past vets yet &mdash; this period's vet is still active.</p>";
    return;
  }

  PAST_VETS.forEach(function (vet) {
    const card = document.createElement("div");
    card.className = "veteran-card served-card";
    card.innerHTML =
      avatarMarkup(vet.id, "avatar") +
      '<h2 class="veteran-name">' + escapeHtml(vet.name) + '</h2>' +
      '<p class="veteran-meta">' + escapeHtml(vet.branch) + ' &middot; ' + escapeHtml(vet.era) + '</p>';
    grid.appendChild(card);
  });
}
```

- [ ] **Step 2: Update `index.html` copy**

Change the `served-view` section's heading/subtext from "Vets We've Tipped" / "These vets have already gotten what they needed from people like you." to "Past Vets" / "Veterans our community has already helped." Update the nav link text from "Vets We've Tipped" to "Past Vets" (the `href="#/served"` stays the same).

- [ ] **Step 3: Verify manually in the browser**

With `PAST_VETS = []`, navigate to `#/served` — expected: "No past vets yet — this period's vet is still active." Hand-edit `vet-data.js` to add one entry to `PAST_VETS` (e.g. `{ id: "past-1", name: "Past Vet", branch: "Navy", era: "Test Era", avatarInitials: "PV" }`), reload — expected: their card renders with name/branch/era.

- [ ] **Step 4: Commit**

```bash
git add view-served.js index.html
git commit -m "$(cat <<'EOF'
Rename Vets We've Tipped to Past Vets, reading from static PAST_VETS data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Payment flow — amount entry and donation UI

**Files:**
- Modify: `view-payment.js`

**Interfaces:**
- Consumes: `CURRENT_VET` from Task 1.
- Produces: `renderPayment()` (signature change: takes **no argument** — there's only ever one possible target). Donation math is purely client-side here; checkout wiring is Task 5.

- [ ] **Step 1: Replace the top of `view-payment.js`**

```js
// view-payment.js
const DONATION_RATE = 0.15;

function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

function renderPayment() {
  const content = document.getElementById("payment-content");

  if (!CURRENT_VET) {
    content.innerHTML = "<p>We're choosing this period's vet &mdash; check back soon.</p>";
    return;
  }

  content.innerHTML =
    '<div class="payment-vet-summary">' +
      avatarMarkup(CURRENT_VET.id, "avatar") +
      '<div>' +
        '<h2 class="veteran-name">' + escapeHtml(CURRENT_VET.name) + '</h2>' +
        '<p class="veteran-meta">' + escapeHtml(CURRENT_VET.branch) + ' &middot; ' + escapeHtml(CURRENT_VET.era) + '</p>' +
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

  setUpPaymentFlow(CURRENT_VET);
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
    // Checkout wiring added in Task 5.
  });
}
```

- [ ] **Step 2: Update the router's `renderPayment` call**

In `router.js`, change the `renderPayment(null)` call from Task 2 Step 3 to `renderPayment()` (no argument):

```js
  if (hash === "#/tip") {
    renderPayment();
    showView("payment-view");
    return;
  }
```

- [ ] **Step 3: Verify manually in the browser**

With the Task 2 Step 6 test vet still in `CURRENT_VET`, navigate to `#/tip`. Expected: amount defaults to $1, donation line shows "$0.15" pre-checked, "Vet gets $1.00 / Support Tip a Vet +$0.15 / Total $1.15". Click the $10 chip — expected: donation auto-updates to $1.50. Manually type a donation amount, e.g. `0.50` — expected: total recalculates using that value, and clicking a different amount chip afterward keeps using your manual donation value instead of snapping back to 15%. Uncheck the box — expected: total drops to just the tip amount. Set `CURRENT_VET` back to `null` and reload `#/tip` — expected: "We're choosing this period's vet — check back soon," no error.

- [ ] **Step 4: Commit**

```bash
git add view-payment.js router.js
git commit -m "$(cat <<'EOF'
Rework payment amount screen to read the current vet synchronously

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Payment flow — checkout, hand-off, and query-param return

**Files:**
- Modify: `view-payment.js`
- Modify: `router.js` (add `#/tip/complete` route)
- Modify: `config.js` (new file — Worker URL)

**Interfaces:**
- Consumes: the Cloudflare Worker from Task 6, at `WORKER_URL`.
- Produces: complete end-to-end tip flow. Nothing later in this plan depends on this task.

- [ ] **Step 1: Write `config.js`**

```js
// config.js
const WORKER_URL = "http://127.0.0.1:8787/create-donation-session";
```

For local dev this points at `wrangler dev`'s default local address (set up in Task 6). For production, replace with the deployed Worker's URL (e.g. `https://tip-a-vet-donations.<your-subdomain>.workers.dev/create-donation-session`) once Task 6 is deployed.

In `index.html`, add `<script src="config.js"></script>` immediately before `<script src="vet-data.js"></script>`.

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

function showHandoffScreen(vet, amount, note) {
  const content = document.getElementById("payment-content");
  let links = "";

  if (vet.venmoHandle) {
    links += '<a class="confirm-button payment-link" target="_blank" href="' + venmoWebLink(vet.venmoHandle, amount, note) + '">Open Venmo</a>';
  }
  if (vet.paypalHandle) {
    links += '<a class="confirm-button payment-link" target="_blank" href="' + paypalWebLink(vet.paypalHandle, amount) + '">Open PayPal</a>';
  }
  if (vet.cashappHandle) {
    links += '<a class="confirm-button payment-link" target="_blank" href="' + cashappWebLink(vet.cashappHandle, amount) + '">Open Cash App</a>';
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
    content.innerHTML =
      '<div class="payment-success-panel">' +
        avatarMarkup(vet.id, "avatar-large") +
        '<h2>Sent! 🎉</h2>' +
        '<p>' + escapeHtml(vet.name) + ' just got ' + formatCurrency(amount) + ' from you' +
        (note ? ' &mdash; &ldquo;' + escapeHtml(note) + '&rdquo;' : '') + '.</p>' +
        '<a class="confirm-button payment-link" href="#/">Back home</a>' +
      '</div>';
  });
}

function renderPaymentComplete(queryString) {
  const params = new URLSearchParams(queryString);
  const amount = roundToCents(Number(params.get("amount")));
  const note = params.get("note") || "";

  const content = document.getElementById("payment-content");

  if (!CURRENT_VET || !amount || amount <= 0) {
    content.innerHTML = "<p>Something went wrong loading your tip.</p>";
    return;
  }

  showHandoffScreen(CURRENT_VET, amount, note);
}
```

Now wire the `sendButton` click handler added in Task 4 Step 1 (replace the `// Checkout wiring added in Task 5.` comment):

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
      const returnUrl = window.location.origin + window.location.pathname +
        "#/tip/complete?amount=" + encodeURIComponent(amount) + "&note=" + encodeURIComponent(note);

      fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationAmount: donationAmount, returnUrl: returnUrl }),
      })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          if (result.error) {
            throw new Error(result.error);
          }
          window.location.href = result.url;
        })
        .catch(function (error) {
          sendButton.disabled = false;
          sendButton.textContent = "Send";
          alert("Checkout failed: " + error.message);
        });
    } else {
      showHandoffScreen(vet, amount, note);
    }
  });
```

- [ ] **Step 3: Wire the `#/tip/complete` route**

In `router.js`, add a new match checked before the plain `#/tip` block (the hash includes a `?` query string, so `#/tip` alone won't match it, but order defensively):

```js
const paymentCompleteMatch = hash.match(/^#\/tip\/complete\?(.*)$/);

if (paymentCompleteMatch) {
  renderPaymentComplete(paymentCompleteMatch[1]);
  showView("payment-view");
  return;
}
```

Place this block before the existing `if (hash === "#/tip")` block.

- [ ] **Step 4: Verify the no-donation path manually**

With a test `CURRENT_VET` (Task 2 Step 6), navigate to `#/tip`, uncheck the donation box, click Send. Expected: hand-off screen appears immediately (no redirect) showing an "Open Venmo" (or PayPal/Cash App) button and "I sent it". Click "Open Venmo" — expected: opens `venmo.com/<handle>?txn=pay&amount=...` in a new tab with the right amount. Click "I sent it" — expected: "Sent! 🎉" success panel appears.

- [ ] **Step 5: Verify the donation path manually (requires Task 6's Worker running)**

With `wrangler dev` running (Task 6) and `WORKER_URL` pointed at it, navigate to `#/tip`, leave the donation checkbox checked, click Send. Expected: redirects to a Stripe-hosted Checkout page for just the donation amount. Use Stripe's test card `4242 4242 4242 4242`, any future expiry/CVC. Expected: redirects back to `#/tip/complete?amount=...&note=...`, which reconstructs the hand-off screen with the correct tip amount and note — purely from the URL, no stored record anywhere. Test a note containing an `&` and an emoji — expected: it survives the round-trip and displays correctly after clicking "I sent it".

- [ ] **Step 6: Commit**

```bash
git add view-payment.js router.js config.js index.html
git commit -m "$(cat <<'EOF'
Wire Stripe donation checkout and vet hand-off via query-param return state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Cloudflare Worker for the Stripe donation Checkout session

**Files:**
- Create: `donation-worker/wrangler.toml`
- Create: `donation-worker/src/index.js`

**Interfaces:**
- Produces: HTTP endpoint `POST /create-donation-session` — request body `{donationAmount, returnUrl}`, response `{url}`. Consumed by Task 5's Send button.

This lives in its own `donation-worker/` directory — it's a separate deployable unit from the static site, not something GitHub Pages serves.

- [ ] **Step 1: Create a Stripe account and get test keys**

At https://dashboard.stripe.com, create an account (or use an existing one), stay in **Test mode**, and copy the test **Secret key** (starts `sk_test_`) from Developers → API keys.

- [ ] **Step 2: Scaffold the Worker**

```bash
mkdir -p donation-worker/src
```

```toml
# donation-worker/wrangler.toml
name = "tip-a-vet-donations"
main = "src/index.js"
compatibility_date = "2024-01-01"
```

- [ ] **Step 3: Write the Worker**

```js
// donation-worker/src/index.js
const ALLOWED_ORIGINS = [
  "https://tip-a-vet.com",
  "https://informaswan.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
    }

    const donationAmount = Number(body.donationAmount);
    const returnUrl = body.returnUrl;

    if (!(donationAmount > 0) || !returnUrl) {
      return jsonResponse({ error: "donationAmount and returnUrl are required" }, 400, origin);
    }

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][product_data][name]", "Support Tip a Vet");
    params.set("line_items[0][price_data][unit_amount]", String(Math.round(donationAmount * 100)));
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", returnUrl);
    params.set("cancel_url", returnUrl);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return jsonResponse({ error: session.error ? session.error.message : "Stripe error" }, 500, origin);
    }

    return jsonResponse({ url: session.url }, 200, origin);
  },
};
```

Replace `https://informaswan.github.io` above with the actual GitHub Pages origin for this repo if different, and confirm `https://tip-a-vet.com` matches the CNAME already in this repo.

- [ ] **Step 4: Run it locally and set the test secret**

```bash
cd donation-worker
npx wrangler secret put STRIPE_SECRET_KEY --local
```

Paste the `sk_test_...` key from Step 1 when prompted.

```bash
npx wrangler dev
```

Expected: prints a local URL, typically `http://127.0.0.1:8787`.

- [ ] **Step 5: Verify with curl, then verify CORS from a real cross-origin page**

In another terminal:

```bash
curl -s -X POST "http://127.0.0.1:8787/create-donation-session" \
  -H "Content-Type: application/json" \
  -d '{"donationAmount":1.5,"returnUrl":"http://localhost:8080/#/tip/complete?amount=10&note=test"}'
```

Expected: `200 OK` with `{"url":"https://checkout.stripe.com/..."}`. This alone does not prove CORS works — `curl` has no origin to block. Serve the static site locally per Task 1 Step 4 and, from its devtools console (running on `http://localhost:8080`, already in `ALLOWED_ORIGINS`), run:

```js
fetch("http://127.0.0.1:8787/create-donation-session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ donationAmount: 1.5, returnUrl: "http://localhost:8080/#/tip/complete?amount=10&note=test" }),
}).then(function (r) { return r.json(); }).then(console.log);
```

Expected: resolves with `{url: "https://checkout.stripe.com/..."}`, no CORS error in the console. Then temporarily change `window.location` to simulate a disallowed origin is impractical locally — instead, confirm the deployed Worker (Step 7) rejects a request with no matching `Origin` header by checking the response falls back to the first allowed origin rather than echoing an arbitrary one (re-read `corsHeaders` — it never reflects an arbitrary origin back, which is the actual security property to confirm, not just "it works from localhost").

- [ ] **Step 6: Deploy**

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

Paste the same (or production) key when prompted — this sets it on the deployed Worker, separately from the `--local` secret in Step 4.

```bash
npx wrangler deploy
```

Expected: prints the deployed Worker's `workers.dev` URL. Update `config.js` (Task 5 Step 1) with this URL plus `/create-donation-session` for the production build.

- [ ] **Step 7: Commit**

```bash
git add donation-worker/wrangler.toml donation-worker/src/index.js
git commit -m "$(cat <<'EOF'
Add Cloudflare Worker to create Stripe Checkout sessions for platform donations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
