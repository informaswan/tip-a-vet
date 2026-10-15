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
