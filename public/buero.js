/* Abgemacht Büro: gemeinsame Navigation für Übersicht, Akquise (CRM) und Vermittlung.
   Ein Login für alle drei (sessionStorage "hs_admin"), Wechsel mit einem Tipp. */
(function () {
  var tabs = [
    ["/admin", "Übersicht", '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>'],
    ["/crm", "Akquise", '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'],
    ["/vermittlung", "Vermittlung", '<path d="M8 12l3 3 5-6"/><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"/>'],
  ];
  var pfad = location.pathname.replace(/\.html$/, "").replace(/\/$/, "");
  var css = document.createElement("style");
  css.textContent =
    ".buero-nav{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:30;display:flex;gap:4px;padding:5px;border-radius:999px;background:#138A6B;box-shadow:0 14px 34px -12px rgba(0,0,0,.55)}" +
    ".buero-nav a{display:flex;align-items:center;gap:7px;padding:10px 16px;border-radius:999px;color:#CFEFE3;text-decoration:none;font-weight:700;font-size:14px;white-space:nowrap}" +
    ".buero-nav a svg{width:19px;height:19px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
    ".buero-nav a[aria-current=page]{background:#fff;color:#138A6B}" +
    ".buero-nav a:not([aria-current]):hover{background:rgba(255,255,255,.1);color:#fff}" +
    ".buero-nav a:focus-visible{outline:3px solid #F2B33D;outline-offset:2px}" +
    "[hidden]{display:none!important}" +
    "body.mit-buero{padding-bottom:90px}" +
    "body.mit-buero .panel{padding-bottom:110px}" +
    "@media (max-width:520px){.buero-nav{left:10px;right:10px;transform:none;justify-content:space-between}.buero-nav a{flex:1;flex-direction:column;gap:2px;padding:7px 4px;font-size:11.5px;border-radius:20px}}";
  document.head.appendChild(css);
  var nav = document.createElement("nav");
  nav.className = "buero-nav";
  nav.setAttribute("aria-label", "Bereiche");
  nav.innerHTML = tabs.map(function (t) {
    return '<a href="' + t[0] + '"' + (pfad === t[0] ? ' aria-current="page"' : "") + '><svg viewBox="0 0 24 24" aria-hidden="true">' + t[2] + "</svg>" + t[1] + "</a>";
  }).join("");
  document.body.appendChild(nav);
  document.body.classList.add("mit-buero");
})();
