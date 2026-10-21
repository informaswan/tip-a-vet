// data.js
function escapeHtml(str) {
  str = str == null ? "" : String(str);
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
