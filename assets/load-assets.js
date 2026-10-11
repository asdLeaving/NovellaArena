(function () {
  var loader = document.currentScript;
  var scripts = loader.getAttribute("data-scripts").split(/\s+/).filter(Boolean);
  function loadScript(index) {
    if (index >= scripts.length) return;
    var script = document.createElement("script");
    script.src = scripts[index];
    script.onload = function () { loadScript(index + 1); };
    script.onerror = function () {
      document.querySelectorAll("[data-loading-message]").forEach(function (status) {
        status.textContent = status.getAttribute("data-loading-message") + "加载失败，请刷新重试。";
        status.parentElement.setAttribute("aria-busy", "false");
      });
      var message = document.createElement("p");
      message.className = "error";
      message.textContent = "网页资源没有加载出来，请刷新重试。";
      document.body.prepend(message);
    };
    document.body.appendChild(script);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { loadScript(0); }, { once: true });
  } else {
    loadScript(0);
  }
})();
