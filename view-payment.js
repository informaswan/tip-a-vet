// view-payment.js
const MIN_TIP_CENTS = 100;
const AID_RATE = 0.03;

function stripeFeeCents(totalCents) {
  return Math.round(totalCents * STRIPE_RATE) + STRIPE_FIXED_CENTS;
}

// Extra that pays Stripe's fee on the whole payment (tip + aid + this extra),
// so neither the tip nor the aid amount is reduced by it.
function coverCents(tipCents, aidCents) {
  let cover = stripeFeeCents(tipCents + aidCents);
  while (cover < stripeFeeCents(tipCents + aidCents + cover)) {
    cover += 1;
  }
  return cover;
}

function defaultAidCents(tipCents) {
  return Math.round(tipCents * AID_RATE);
}

// Where every cent of a payment goes. Stripe's fee comes out of the support
// amount first; only a shortfall comes out of the vet's tip.
function splitCents(tipCents, supportCents) {
  const total = tipCents + supportCents;
  const fee = stripeFeeCents(total);
  if (supportCents >= fee) {
    return { total: total, fee: fee, vet: tipCents, us: supportCents - fee };
  }
  return { total: total, fee: fee, vet: tipCents - (fee - supportCents), us: 0 };
}

function centsToDollars(cents) {
  return formatCurrency(cents / 100);
}

function feeLabel() {
  return (STRIPE_RATE * 100).toFixed(1).replace(/\.0$/, "") + "% + " + STRIPE_FIXED_CENTS + "¢";
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
      '<label class="field-label" for="amount-input">Your tip</label>' +
      '<div class="money-box amount-box">' +
        '<span class="money-prefix">$</span>' +
        '<input type="number" id="amount-input" class="amount-input" min="1" step="1" value="1" inputmode="decimal">' +
      '</div>' +
      '<div class="amount-chips">' +
        '<button type="button" class="amount-chip" data-amount="1">$1</button>' +
        '<button type="button" class="amount-chip" data-amount="5">$5</button>' +
        '<button type="button" class="amount-chip" data-amount="10">$10</button>' +
        '<button type="button" class="amount-chip" data-amount="20">$20</button>' +
        '<button type="button" class="amount-chip" id="custom-chip">Custom</button>' +
      '</div>' +
      '<div class="donation-row">' +
        '<label>' +
          '<input type="checkbox" id="donation-checkbox" checked>' +
          '<span>Cover the fees (<span id="donation-amount-display"></span> extra) so your whole tip reaches ' + escapeHtml(CURRENT_VET.name) + '</span>' +
        '</label>' +
      '</div>' +
      '<div class="donation-row aid-row">' +
        '<label>' +
          '<input type="checkbox" id="aid-checkbox" checked>' +
          '<span>Help keep Tip a Vet going.</span>' +
        '</label>' +
        '<div class="money-box aid-box">' +
          '<span class="money-prefix">$</span>' +
          '<input type="number" id="aid-input" class="aid-input" min="0" step="0.01" inputmode="decimal" aria-label="Amount to help Tip a Vet, in dollars">' +
        '</div>' +
        '<p class="field-hint">Starts at 3% of your tip. Change it to any amount.</p>' +
      '</div>' +
      '<div class="fee-breakdown" aria-live="polite">' +
        '<div class="fee-row fee-total"><span>You pay</span><span id="fee-total"></span></div>' +
        '<div class="fee-row"><span>To ' + escapeHtml(CURRENT_VET.name) + '</span><span id="fee-vet"></span></div>' +
        '<div class="fee-row"><span>Fees (' + feeLabel() + ')</span><span id="fee-stripe"></span></div>' +
        '<div class="fee-row"><span>To Tip a Vet</span><span id="fee-us"></span></div>' +
        '<p class="fee-explain" id="fee-explain"></p>' +
      '</div>' +
      '<div class="note-field">' +
        '<label for="tip-note">Note to ' + escapeHtml(CURRENT_VET.name) + ' (optional)</label>' +
        '<input type="text" id="tip-note" placeholder="Thank you for your service" maxlength="60">' +
      '</div>' +
    '</div>' +
    '<p class="payment-error" id="payment-error" role="alert" hidden></p>' +
    '<button type="button" id="send-button" class="confirm-button">Send</button>' +
    '<p class="payment-fineprint">Tip a Vet collects every tip and pays the total to ' +
      escapeHtml(CURRENT_VET.name) + ' when the period ends.</p>';

  setUpPaymentFlow(CURRENT_VET);
}

function updateFeeBreakdown(vet, tipCents, aidCents, coverOn) {
  const valid = tipCents >= MIN_TIP_CENTS;
  const cover = valid && coverOn ? coverCents(tipCents, aidCents) : 0;
  const supportCents = valid ? aidCents + cover : 0;
  const split = splitCents(valid ? tipCents : 0, supportCents);

  document.getElementById("fee-total").textContent = centsToDollars(split.total);
  document.getElementById("fee-vet").textContent = centsToDollars(split.vet);
  document.getElementById("fee-stripe").textContent = centsToDollars(split.fee);
  document.getElementById("fee-us").textContent = centsToDollars(split.us);
  document.getElementById("donation-amount-display").textContent =
    centsToDollars(coverCents(valid ? tipCents : MIN_TIP_CENTS, valid ? aidCents : 0));

  let explain;
  if (!valid) {
    explain = "The smallest tip is $1.";
  } else if (split.vet === tipCents && split.us > 0) {
    explain = escapeHtml(vet.name) + " gets your full " + centsToDollars(tipCents) +
      ". The fees are paid from the extra, and Tip a Vet keeps " + centsToDollars(split.us) + ".";
  } else if (split.vet === tipCents) {
    explain = escapeHtml(vet.name) + " gets your full " + centsToDollars(tipCents) +
      ". The extra pays the fees exactly, and Tip a Vet keeps nothing.";
  } else {
    explain = "The fees come out of the tip, so " + escapeHtml(vet.name) + " gets " + centsToDollars(split.vet) +
      " of your " + centsToDollars(tipCents) + ". Tip a Vet keeps nothing.";
  }
  document.getElementById("fee-explain").innerHTML = explain;

  const sendButton = document.getElementById("send-button");
  sendButton.textContent = valid ? "Pay " + centsToDollars(split.total) : "Send";
  sendButton.disabled = !valid;
  return supportCents;
}

function setUpPaymentFlow(vet) {
  const amountInput = document.getElementById("amount-input");
  const chips = document.querySelectorAll(".amount-chip");
  const donationCheckbox = document.getElementById("donation-checkbox");
  const aidInput = document.getElementById("aid-input");
  const aidCheckbox = document.getElementById("aid-checkbox");
  const customChip = document.getElementById("custom-chip");
  const noteInput = document.getElementById("tip-note");
  const sendButton = document.getElementById("send-button");
  const errorBox = document.getElementById("payment-error");

  let aidManuallyEdited = false;

  function selectChipFor(tipCents) {
    let presetMatched = false;
    chips.forEach(function (chip) {
      const matches = chip !== customChip && Number(chip.dataset.amount) * 100 === tipCents;
      presetMatched = presetMatched || matches;
      chip.classList.toggle("selected", matches);
    });
    customChip.classList.toggle("selected", !presetMatched);
  }

  function currentAidCents(tipCents) {
    if (!aidCheckbox.checked) {
      return 0;
    }
    if (aidManuallyEdited) {
      return Math.max(0, Math.round((Number(aidInput.value) || 0) * 100));
    }
    return defaultAidCents(tipCents);
  }

  function currentSupportCents() {
    const tipCents = Math.round((Number(amountInput.value) || 0) * 100);
    const aidCents = currentAidCents(tipCents);
    return aidCents + (donationCheckbox.checked && tipCents >= MIN_TIP_CENTS ? coverCents(tipCents, aidCents) : 0);
  }

  function refresh() {
    const tipCents = Math.round((Number(amountInput.value) || 0) * 100);
    if (!aidManuallyEdited) {
      aidInput.value = (defaultAidCents(tipCents) / 100).toFixed(2);
    }
    selectChipFor(tipCents);
    updateFeeBreakdown(vet, tipCents, currentAidCents(tipCents), donationCheckbox.checked);
  }

  refresh();

  chips.forEach(function (chip) {
    if (chip === customChip) {
      return;
    }
    chip.addEventListener("click", function () {
      amountInput.value = Number(chip.dataset.amount);
      refresh();
    });
  });

  customChip.addEventListener("click", function () {
    amountInput.focus();
    amountInput.select();
  });

  amountInput.addEventListener("input", refresh);

  aidInput.addEventListener("input", function () {
    aidManuallyEdited = true;
    aidCheckbox.checked = true;
    refresh();
  });

  aidCheckbox.addEventListener("change", refresh);

  donationCheckbox.addEventListener("change", refresh);

  sendButton.addEventListener("click", function () {
    const tipCents = Math.round((Number(amountInput.value) || 0) * 100);
    if (tipCents < MIN_TIP_CENTS) {
      return;
    }

    const supportCents = currentSupportCents();
    errorBox.hidden = true;
    sendButton.disabled = true;
    sendButton.textContent = "Redirecting to checkout…";

    fetch(WORKER_BASE_URL + "/create-donation-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipCents: tipCents,
        supportCents: supportCents,
        note: noteInput.value.trim(),
        vetId: vet.id,
        vetName: vet.name,
        returnUrl: window.location.origin + window.location.pathname,
      }),
    })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (result.error) {
          throw new Error(result.error);
        }
        window.location.href = result.url;
      })
      .catch(function () {
        errorBox.textContent = "Checkout is unavailable right now, and you haven't been charged. Please try again in a minute.";
        errorBox.hidden = false;
        refresh();
      });
  });
}

function renderPaymentComplete(queryString) {
  const sessionId = new URLSearchParams(queryString).get("session_id") || "";
  const content = document.getElementById("payment-content");

  content.innerHTML = '<p>Checking your payment&hellip;</p>';

  fetch(WORKER_BASE_URL + "/session-status?id=" + encodeURIComponent(sessionId))
    .then(function (response) { return response.json(); })
    .then(function (result) {
      if (result.error || !result.paid) {
        throw new Error("not paid");
      }
      const split = splitCents(result.tipCents, result.supportCents);
      const vetName = result.vetName || "this period's vet";
      content.innerHTML =
        '<div class="payment-success-panel">' +
          (CURRENT_VET ? avatarMarkup(CURRENT_VET.id, "avatar-large") : '') +
          '<h2>Thank you!</h2>' +
          '<p>You paid ' + centsToDollars(split.total) + '. About ' + centsToDollars(split.vet) + ' of it goes to ' +
            escapeHtml(vetName) + ' when the period ends' +
            (result.note ? ', with your note &ldquo;' + escapeHtml(result.note) + '&rdquo;' : '') + '.</p>' +
          '<p class="payment-fineprint">Fees (' + feeLabel() + ') were about ' + centsToDollars(split.fee) +
            '. Tip a Vet kept ' + centsToDollars(split.us) + '. You&rsquo;ll get a receipt by email.</p>' +
          '<a class="confirm-button payment-link" href="#/">Back home</a>' +
        '</div>';
    })
    .catch(function () {
      content.innerHTML =
        '<div class="payment-success-panel">' +
          '<h2>We couldn&rsquo;t confirm a payment</h2>' +
          '<p>You haven&rsquo;t been charged for this visit. If you think you were, check your email for a receipt.</p>' +
          '<a class="confirm-button payment-link" href="#/tip">Try again</a>' +
        '</div>';
    });
}
