/* コードブロックにコピーボタンを付ける */
(function () {
  var codes = document.querySelectorAll(".prose pre > code");
  if (!codes.length || !navigator.clipboard) return;

  Array.prototype.forEach.call(codes, function (code) {
    var pre = code.parentNode;
    var wrap = document.createElement("div");
    wrap.className = "codeblock";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "codeblock__copy";
    btn.textContent = "copy";
    btn.setAttribute("aria-label", "コードをコピーする");

    var timer = null;
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(code.innerText).then(
        function () {
          btn.textContent = "copied";
          clearTimeout(timer);
          timer = setTimeout(function () {
            btn.textContent = "copy";
          }, 1600);
        },
        function () {
          btn.textContent = "failed";
        }
      );
    });

    wrap.appendChild(btn);
  });
})();
