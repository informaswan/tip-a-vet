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
