(function () {
  var loader = document.currentScript;
  var scripts = loader.getAttribute("data-scripts").split(/\s+/).filter(Boolean);
  // A new URL also bypasses intermediary caches that ignore request cache modes.
  var version;
  function freshUrl(path) {
    var url = new URL(path, document.baseURI);
    url.searchParams.set("v", version);
    return url.href;
  }
  function refreshStyles() {
    version = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
      link.href = freshUrl(link.getAttribute("href"));
    });
  }
  refreshStyles();
  function loadScript(index) {
    if (index >= scripts.length) return;
    var script = document.createElement("script");
    script.src = freshUrl(scripts[index]);
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
  // Refresh restored pages without resetting the reader's scroll position.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) refreshStyles();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshStyles();
  });
})();
