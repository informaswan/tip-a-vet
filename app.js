document.getElementById("payment-back-button").addEventListener("click", function () {
  window.location.hash = "#/";
});

document.getElementById("nav-toggle").addEventListener("click", function () {
  const nav = document.getElementById("site-nav");
  const isOpen = nav.classList.toggle("open");
  document.getElementById("nav-toggle").setAttribute("aria-expanded", String(isOpen));
});

document.getElementById("site-nav").addEventListener("click", function (event) {
  if (event.target.tagName === "A") {
    document.getElementById("site-nav").classList.remove("open");
  }
});

(function () {
  const dialog = document.getElementById("demo-dialog");
  let seen = false;
  try {
    seen = sessionStorage.getItem("demo-notice-seen") === "1";
  } catch (error) {}

  document.getElementById("demo-dismiss").addEventListener("click", function () {
    try {
      sessionStorage.setItem("demo-notice-seen", "1");
    } catch (error) {}
    dialog.close();
  });

  if (!seen && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
})();
