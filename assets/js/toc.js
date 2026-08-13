/* 目次のスクロール追従 */
(function () {
  var toc = document.getElementById("TableOfContents");
  if (!toc) return;

  var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
  var targets = [];
  var linkFor = {};

  links.forEach(function (a) {
    var id = decodeURIComponent(a.getAttribute("href").slice(1));
    var heading = document.getElementById(id);
    if (!heading) return;
    targets.push(heading);
    linkFor[id] = a;
  });
  if (!targets.length) return;

  var active = null;

  function update() {
    var threshold = window.scrollY + 140;
    var current = targets[0];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].getBoundingClientRect().top + window.scrollY <= threshold) {
        current = targets[i];
      } else {
        break;
      }
    }
    var next = linkFor[current.id];
    if (next === active) return;
    if (active) active.classList.remove("is-active");
    if (next) next.classList.add("is-active");
    active = next || null;
  }

  var ticking = false;
  window.addEventListener(
    "scroll",
    function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        update();
        ticking = false;
      });
    },
    { passive: true }
  );

  update();
})();
