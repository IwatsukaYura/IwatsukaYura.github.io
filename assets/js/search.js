/* 記事検索。index.json を Fuse.js で引く */
(function () {
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");
  var status = document.getElementById("search-status");
  if (!input || !results) return;

  var LIMIT = 30;
  var options = { keys: ["title", "summary", "tags", "content"], threshold: 0.35, ignoreLocation: true };
  var config = document.getElementById("search-config");
  if (config) {
    try {
      options = JSON.parse(config.textContent);
    } catch (e) {
      /* 設定が壊れていても既定値で動かす */
    }
  }

  var fuse = null;
  var queued = null;

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function entryHTML(item) {
    var external = item.external;
    var tags = (item.tags || [])
      .map(function (t) {
        return "<li><span>" + escapeHTML(t) + "</span></li>";
      })
      .join("");
    var source = external
      ? '<span class="entry__source">' + escapeHTML(item.source.toLowerCase()) +
        '<span class="entry__out" aria-hidden="true">↗</span></span>'
      : "";
    var note = external ? "" : '<span class="entry__note">' + escapeHTML(item.readingTime) + " min</span>";

    return (
      '<article class="entry">' +
      '<span class="entry__date">' + escapeHTML(item.date) + "</span>" +
      '<div class="entry__body">' +
      '<h3 class="entry__title"><a href="' + escapeHTML(item.permalink) + '"' +
      (external ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + escapeHTML(item.title) + "</a></h3>" +
      '<div class="entry__meta"><div class="entry__facets">' + source +
      (tags ? '<ul class="entry__tags">' + tags + "</ul>" : "") +
      "</div>" + note +
      "</div></div></article>"
    );
  }

  function run(query) {
    if (!fuse) {
      queued = query;
      return;
    }
    if (!query) {
      results.innerHTML = "";
      status.textContent = "";
      return;
    }
    var hits = fuse.search(query).slice(0, LIMIT);
    results.innerHTML = hits
      .map(function (hit) {
        return entryHTML(hit.item);
      })
      .join("");
    status.textContent = hits.length
      ? hits.length + " 件" + (hits.length === LIMIT ? " 以上" : "")
      : "該当する記事はありません";
  }

  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    var value = input.value.trim();
    timer = setTimeout(function () {
      run(value);
      var url = value ? "?q=" + encodeURIComponent(value) : location.pathname;
      history.replaceState(null, "", url);
    }, 120);
  });

  fetch(results.dataset.index)
    .then(function (res) {
      if (!res.ok) throw new Error("search index: HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      fuse = new Fuse(data, options);
      var initial = new URLSearchParams(location.search).get("q");
      if (initial && !input.value) input.value = initial;
      run(queued !== null ? queued : input.value.trim());
      queued = null;
    })
    .catch(function (err) {
      status.textContent = "検索インデックスを読み込めませんでした。";
      console.error(err);
    });

  input.focus();
})();
