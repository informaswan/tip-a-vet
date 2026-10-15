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
