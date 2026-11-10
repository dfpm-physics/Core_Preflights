// nav-shell.js: paint the last top bar at once, so it does not blink out between pages.
//
// Every page builds its top bar in renderNav (nav.js), which can run only after the sign-in check, a
// network round trip. Until then the bar was empty, so each click on a link showed a page with no
// header for a moment and then pushed everything down. renderNav now keeps a copy of the bar it drew
// (sessionStorage, this tab only), and this classic script, placed right after <header id="topnav">,
// paints that copy before the browser's first paint. renderNav then replaces it with the real bar.
//
// The copy is only a picture: its buttons do nothing until renderNav wires the real bar a moment later.
// It is painted only when a sign-in session is stored, so a signed-out visitor never sees the last
// person's bar, and sign-out removes it (auth.js). It is the bar renderNav drew, already escaped.
(function () {
  try {
    var h = document.getElementById('topnav');
    if (!h || h.firstChild && h.firstChild.nodeType === 1) return;
    var raw = sessionStorage.getItem('cp.navshell');
    if (!raw) return;
    var signedIn = false;
    for (var i = 0; i < localStorage.length; i++) {
      if (/^sb-.+-auth-token$/.test(localStorage.key(i) || '')) { signedIn = true; break; }
    }
    if (!signedIn) return;
    var s = JSON.parse(raw);
    var parts = location.pathname.split('/');
    var dir = parts[parts.length - 2], file = parts[parts.length - 1] || 'index.html';
    if (!s || s.dir !== dir || typeof s.html !== 'string') return;   // a cadet bar never shows on a staff page
    h.className = s.cls || 'topnav';
    h.innerHTML = s.html;
    h.setAttribute('data-shell', '');
    var links = h.querySelectorAll('.nav-link');
    for (var j = 0; j < links.length; j++) {
      var on = (links[j].getAttribute('href') || '').split('?')[0] === file;
      links[j].classList.toggle('active', on);
    }
    // The copy keeps its classes, which is all the styles use, and loses every id and data- attribute, so a
    // script or a test that looks for a working control (#nav-links, [data-user-toggle]) never finds the picture.
    var els = h.querySelectorAll('*');
    for (var k = 0; k < els.length; k++) {
      var el = els[k];
      el.classList.remove('open');
      el.removeAttribute('id');
      for (var a = el.attributes.length - 1; a >= 0; a--) {
        if (el.attributes[a].name.indexOf('data-') === 0) el.removeAttribute(el.attributes[a].name);
      }
    }
  } catch (e) { /* a missing copy only means the old blink */ }
})();
