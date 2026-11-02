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

  if (CURRENT_VET.isOrg) {
    container.innerHTML =
      '<section class="hero">' +
        '<img class="hero-logo" src="logo.png" alt="Tip a Vet">' +
        '<h2>Help us help veterans in need.</h2>' +
        '<p class="hero-copy">' +
          'Tip a Vet is a small effort to get help to veterans who need it. ' +
          'We&rsquo;re just getting started, and right now every donation goes to Tip a Vet to support that work.' +
        '</p>' +
        '<a href="#/tip" class="confirm-button hero-cta">Donate to Tip a Vet</a>' +
      '</section>' +
      '<section class="featured-vets">' +
        '<h3>Who we are</h3>' +
        '<div class="profile-content">' +
          '<p class="veteran-bio">Tip a Vet was founded by <strong>Ronald Hammock</strong>, a veteran who served in the U.S. Navy.</p>' +
          '<p class="veteran-bio"><strong>Michael Swanson</strong> and <strong>Samual Swanson</strong> helped build the website and set everything up. ' +
          'Michael served in the U.S. Air Force, and Sam served in the U.S. Coast Guard.</p>' +
          '<p class="veteran-bio">We want your support to keep Tip a Vet going. We would love to serve more veterans, especially those who are less fortunate. Help us get this going.</p>' +
        '</div>' +
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
      '<a href="#/tip" class="confirm-button hero-cta">Donate</a>' +
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
