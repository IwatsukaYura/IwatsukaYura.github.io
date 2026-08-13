/* 配色の切り替え。初期値は head 内のインラインスクリプトが決定する */
(function () {
  var root = document.documentElement;
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;

  function currentTheme() {
    if (root.dataset.theme === "dark" || root.dataset.theme === "light") return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function label(theme) {
    return theme === "dark" ? "ライト配色に切り替える" : "ダーク配色に切り替える";
  }

  btn.setAttribute("aria-label", label(currentTheme()));

  btn.addEventListener("click", function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    btn.setAttribute("aria-label", label(next));
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      /* プライベートモード等で保存できない場合はセッション内だけ反映する */
    }
  });
})();
