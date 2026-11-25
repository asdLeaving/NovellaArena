(function () {
  "use strict";

  const grades = ["A", "B", "C", "D", "E"];

  function showError(message, retry) {
    let node = document.getElementById("catalog-error");
    if (!node) {
      node = document.createElement("p");
      node.id = "catalog-error";
      node.className = "error";
      node.setAttribute("role", "status");
      document.body.prepend(node);
    }
    node.textContent = message;
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "重试";
      button.addEventListener("click", retry);
      node.append(" ", button);
    }
  }

  async function loadJSON(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try {
        response = await fetch(path, { cache: "no-cache", signal: controller.signal });
      } catch (networkError) {
        response = await fetch(path, { cache: "only-if-cached", mode: "same-origin" });
        if (!response.ok) throw networkError;
      }
      if (!response.ok) throw new Error(path + "（HTTP " + response.status + "）");
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadCatalog() {
    const catalog = await loadJSON("data/catalog.json");
    if (![catalog.topics, catalog.models, catalog.entries].every(Array.isArray)) {
      throw new Error("data/catalog.json 缺少题目、模型或作品列表");
    }
    return catalog;
  }

  async function loadCoverFiles() {
    try {
      const manifest = await loadJSON("data/covers.json");
      return manifest.covers || null;
    } catch {
      return null;
    }
  }

  function coverUrl(entry, covers) {
    if (!entry || !entry.file || !covers) return "";
    const stem = entry.file.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
    const cover = covers[stem];
    if (!cover || !cover.file || !cover.version) return "";
    return "assets/covers/" + encodeURIComponent(cover.file) + "?v=" + encodeURIComponent(cover.version);
  }

  function gradeClass(grade) {
    return grades.includes(grade) ? "g-" + grade.toLowerCase() : "g-unset";
  }

  function byGradeThenTimeDesc(a, b) {
    const rank = grade => grades.includes(grade) ? grades.indexOf(grade) : grades.length;
    return rank(a.grade) - rank(b.grade)
      || Number(b.preferred === true) - Number(a.preferred === true)
      || String(b.time).localeCompare(String(a.time));
  }

  function compareModels(a, b) {
    const ar = String(a.released || "").trim();
    const br = String(b.released || "").trim();
    if (ar !== br) return !ar ? -1 : !br ? 1 : br.localeCompare(ar);
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }

  function displayTitle(title, fallback) {
    let text = String(title || "").trim();
    const wrapped = /^(?:《(.+)》|「(.+)」|“(.+)”|"(.+)")$/.exec(text);
    if (wrapped) text = (wrapped[1] || wrapped[2] || wrapped[3] || wrapped[4]).trim();
    return text || fallback;
  }

  function naturalTime(value) {
    const digits = String(value || "");
    const parts = /^(\d{4})-?(\d{2})-?(\d{2}) ?(\d{2}):(\d{2})$/.exec(digits)
      || /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(digits);
    return parts ? parts[1] + "年" + parts[2] + "月" + parts[3] + "日 " + parts[4] + ":" + parts[5] : digits;
  }

  window.Arena = {
    loadJSON, loadCatalog, loadCoverFiles, coverUrl, showError, gradeClass, byGradeThenTimeDesc,
    compareModels, displayTitle, naturalTime, effortText: value => value || "未记录"
  };
})();
