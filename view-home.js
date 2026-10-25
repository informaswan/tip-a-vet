// view-home.js
function renderHome() {
  const container = document.getElementById("home-content");

  if (!CURRENT_VET) {
    container.innerHTML =
      '<section class="hero">' +
        '<img class="hero-logo" src="logo.png" alt="Tip a Vet">' +
        '<h2>Every veteran deserves to be seen.</h2>' +
        '<p class="hero-copy">' +
          'Each period, our board of five chooses one veteran we believe critically needs help right now &mdash; ' +
          'We collect every tip and pay the full total to them when the period ends. ' +
          'Card fees are the only thing taken out, and you can add a little to cover them so your whole tip reaches the veteran.' +
        '</p>' +
        '<p class="hero-copy">We&rsquo;re choosing this period&rsquo;s vet &mdash; check back soon.</p>' +
      '</section>';
    return;
  }

  container.innerHTML =
    '<section class="hero">' +
        '<img class="hero-logo" src="logo.png" alt="Tip a Vet">' +
      '<h2>Every veteran deserves to be seen.</h2>' +
      '<p class="hero-copy">' +
        'Each period, our board of five chooses one veteran we believe critically needs help right now &mdash; ' +
        'We collect every tip and pay the full total to them when the period ends. ' +
          'Card fees are the only thing taken out, and you can add a little to cover them so your whole tip reaches the veteran.' +
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
