// view-payment.js
const DONATION_RATE = 0.15;
const MIN_DONATION = 0.5;

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
    if (!donationManuallyEdited) {
      donationInput.value = donationAmount;
    }
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

    const rawDonationAmount = donationCheckbox.checked ? currentDonationAmount(amount) : 0;
    const donationAmount = rawDonationAmount >= MIN_DONATION ? rawDonationAmount : 0;
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
          if (confirm("Donation checkout is unavailable right now. Continue and send your tip to " + vet.name + " without it?")) {
            showHandoffScreen(vet, amount, note);
          } else {
            sendButton.disabled = false;
            sendButton.textContent = "Send";
          }
        });
    } else {
      showHandoffScreen(vet, amount, note);
    }
  });
}

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
