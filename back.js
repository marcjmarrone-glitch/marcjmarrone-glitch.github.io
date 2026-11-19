// Adds a small "← claasic" button to a build's page so visitors can get back
// to the homepage. Include it in each build with:
//   <script src="../../back.js" defer></script>
(function () {
  if (window.self !== window.top) return; // hide inside homepage previews
  var a = document.createElement("a");
  a.href = "../../";
  a.textContent = "← claasic";
  a.setAttribute("style", [
    "position:fixed", "left:16px", "bottom:16px", "z-index:2147483647",
    "font:600 13px/1 ui-monospace,Consolas,monospace", "padding:10px 14px",
    "border-radius:999px", "background:#d7ff3d", "color:#11140a",
    "text-decoration:none", "box-shadow:0 4px 18px rgba(0,0,0,.35)"
  ].join(";"));
  function add() { document.body.appendChild(a); }
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
})();
