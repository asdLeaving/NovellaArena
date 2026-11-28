(function () {
  "use strict";
  const { loadJSON, loadCatalog, loadCoverFiles, showError, coverUrl, gradeClass, effortText,
    compareModels, displayTitle, byGradeThenTimeDesc } = window.Arena;
  const $ = id => document.getElementById(id);
  const wrap = $("table");
  const topicFilter = $("filter");
  const modelFilter = $("filter-model");
  const showAll = $("show-all");
  const gradeButtons = Array.from(document.querySelectorAll(".legend button[data-grade]"));
  const mobile = window.matchMedia("(max-width: 600px)");
  const list = $("showcase").querySelector(".showcase-list");
  const slots = Array.from(list.children);
  const cards = new WeakMap();
  const failedCovers = new Set();
  const fallbackTitles = new Map();
  const pendingTitles = new Set();
  const failedTitles = new Set();
  const more = document.createElement("button");
  // A restored document can receive pagehide after history writes are disabled. Give
  // this specific history entry a storage key while the document is fully active.
  const viewKey = history.state?.arenaViewKey || ("arena-view-" + Date.now() + "-" + Math.random());
  let saved = history.state?.arenaIndex || {};
  try {
    history.replaceState({ ...history.state, arenaViewKey: viewKey }, "");
    saved = JSON.parse(sessionStorage.getItem(viewKey)) || saved;
  } catch { /* Private browsing may disable storage. */ }
  let pages = Math.max(1, Number(saved.pages) || 1);
  let selectedGrade = ["", "A", "B", "C", "D", "E"].includes(saved.grade) ? saved.grade : null;
  let allModels = saved.all === true;
  let catalog;
  let models;
  let best;
  let entriesById;
  let tallies;
  let index = { titles: {}, references: {} };
  let titleIndexReady = false;
  let covers;
  let rows = [];
  let emptyStatus;
  let firstRender = true;

  function element(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label != null) node.textContent = label;
    return node;
  }

  // The same ranking serves the unfiltered matrix, featured picks and per-grade views.
  function groupEntries(entries, grade) {
    const result = new Map();
    for (const entry of entries) {
      if (grade !== null && (entry.grade || "") !== grade) continue;
      const key = entry.topic + "\0" + entry.model;
      const group = result.get(key);
      if (!group) result.set(key, { entry, count: 1 });
      else {
        group.count++;
        if (byGradeThenTimeDesc(entry, group.entry) < 0) group.entry = entry;
      }
    }
    return result;
  }

  function cellLink(entry, extra) {
    var link = document.createElement("a");
    link.className = "cell " + gradeClass(entry.grade);
    link.href = "read.html?id=" + encodeURIComponent(entry.id);
    if (entry.grade) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = entry.grade;
      link.appendChild(badge);
    }
    if (extra) link.appendChild(extra);
    var time = document.createElement("span");
    time.className = "time";
    time.textContent = entry.time;
    var meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = effortText(entry.effort) + " · " + entry.harness;
    link.appendChild(time);
    link.appendChild(meta);
    link.title = entry.time + "  " + effortText(entry.effort) + " · " + entry.harness;
    return link;
  }

  var VENDORS = [
    { re: /^GPT\b/, src: "assets/logos/openai.svg", name: "OpenAI", ink: true },
    { re: /^Claude\b/, src: "assets/logos/anthropic.svg", name: "Anthropic", ink: true },
    { re: /^Grok\b/, src: "assets/logos/xai.svg", name: "xAI", ink: true },
    { re: /^Gemini\b/, src: "assets/logos/google.svg", name: "Google", ink: false },
    { re: /^Kimi\b/, src: "assets/logos/moonshot.svg", name: "Moonshot AI", ink: true },
    { re: /^DeepSeek\b/, src: "assets/logos/deepseek.svg?v=f62e2b4142b6d09ea1b8d7517d02df57c7910da5b5873f6c4fcef7bfa10a878f", name: "DeepSeek", ink: false },
    { re: /^Qwen\b/, src: "assets/logos/qwen.png", name: "Qwen", ink: false },
    { re: /^Muse\b/, src: "assets/logos/meta.svg", name: "Meta", ink: false }
  ];

  function vendorOf(name) {
    for (var i = 0; i < VENDORS.length; i += 1) {
      if (VENDORS[i].re.test(name)) return VENDORS[i];
    }
    return null;
  }

  function modelDisplayName(name) {
    // Hide a separated MMDD suffix in table headings, preserving the model identity.
    return String(name || "").replace(/\s+(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/, "");
  }


  function logoFor(model, className) {
    const vendor = vendorOf(model);
    if (!vendor) return null;
    const logo = element("img", className + (vendor.ink ? " ink" : ""));
    logo.src = vendor.src;
    logo.alt = logo.title = vendor.name;
    logo.width = logo.height = 16;
    return logo;
  }

  function updateCover(slot, art, src, eager) {
    if (art.dataset.src === src && !failedCovers.has(slot)) return;
    failedCovers.delete(slot);
    art.dataset.src = src;
    art.querySelector("img")?.remove();
    art.classList.remove("has-cover");
    if (!src) return;
    const img = element("img", "showcase-cover");
    img.width = img.height = 512;
    img.alt = "";
    img.loading = eager ? "eager" : "lazy";
    img.decoding = "async";
    img.onload = () => art.classList.add("has-cover");
    img.onerror = () => {
      if (!art.contains(img)) return;
      failedCovers.add(slot);
      img.remove();
    };
    img.src = src;
    art.append(img);
  }

  function loadMissingTitle(entry) {
    const file = entry?.file;
    // Wait for the compact index before downloading any missing featured text.
    if (!titleIndexReady || !file || index.titles[file] || fallbackTitles.has(file)
        || pendingTitles.has(file) || failedTitles.has(file)) return;
    pendingTitles.add(file);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(encodeURI(file), { cache: "no-cache", signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(file);
      return response.text();
    }).then(text => {
      const first = text.split(/\r\n?|\n/).map(line => line.trim()).find(Boolean) || "";
      // Match the title rules used by the generated library index.
      const heading = /^(?:第[一二三四五六七八九十百千万零〇两0-9]+(?:[章幕篇部]|部分)|序章|楔子|终章|后记|引子|尾声|序|跋)(?:$|[\s　·.、:：])|^[一二三四五六七八九十百零〇0-9]{1,3}$/;
      fallbackTitles.set(file, first.length <= 22 && !/[。！？]$/.test(first) && !heading.test(first) ? first : "");
      renderCards();
    }).catch(() => {
      failedTitles.add(file);
    }).finally(() => {
      clearTimeout(timeout);
      pendingTitles.delete(file);
    });
  }

  function renderCards() {
    const limit = Math.min(slots.length, pages * (mobile.matches ? 10 : 15));
    slots.forEach((slot, i) => {
      slot.hidden = i >= limit;
      if (slot.hidden) return;
      const model = slot.dataset.model;
      const topic = slot.dataset.topic;
      const entry = slot.dataset.id ? entriesById.get(slot.dataset.id) : best.get(topic + "\0" + model)?.entry;
      const name = entry?.model || model || "";
      const title = displayTitle(index.titles[entry?.file] || fallbackTitles.get(entry?.file), entry?.topic || topic || "未找到文稿");
      loadMissingTitle(entry);
      const src = coverUrl(entry, covers);
      // Preserve decoded images and keyboard focus when metadata or the viewport changes.
      const key = JSON.stringify([entry?.id, name, entry?.grade, slot.getAttribute("complexity")]);
      const previous = cards.get(slot);
      const eager = i < (mobile.matches ? 2 : 5);
      if (previous?.key === key) {
        if (previous.heading.textContent !== title) previous.heading.textContent = title;
        updateCover(slot, previous.art, src, eager);
        return;
      }
      const card = element(entry ? "a" : "div", "showcase-work" + (entry ? "" : " unavailable"));
      if (entry) card.href = "read.html?id=" + encodeURIComponent(entry.id);
      const art = element("span", "showcase-art");
      const placeholder = element("span", "showcase-placeholder", "封面待补");
      placeholder.setAttribute("aria-hidden", "true");
      art.append(placeholder);
      updateCover(slot, art, src, eager);
      const complexity = slot.getAttribute("complexity") || "中";
      const ribbon = element("span", "showcase-complexity complexity-" + ({"高":"high", "低":"low"}[complexity] || "medium"), complexity);
      ribbon.title = "严肃程度：" + complexity;
      ribbon.setAttribute("aria-label", ribbon.title);
      art.append(ribbon);
      const meta = element("span", "showcase-meta");
      const logo = logoFor(name, "showcase-logo");
      if (logo) meta.append(logo);
      const grade = entry ? entry.grade || "未定" : "暂无";
      const badge = element("span", "showcase-grade " + gradeClass(entry?.grade), grade);
      badge.title = "评级：" + grade;
      badge.setAttribute("aria-label", badge.title);
      meta.append(element("span", "showcase-model", name), badge);
      const heading = element("h3", "showcase-title", title);
      card.append(art, heading, meta);
      cards.set(slot, { key, heading, art });
      const focused = slot.contains(document.activeElement);
      slot.replaceChildren(card);
      if (focused) card.focus({ preventScroll: true });
    });
    more.hidden = limit >= slots.length;
    $("showcase").querySelector("[data-loading-message]")?.remove();
    $("showcase").setAttribute("aria-busy", "false");
  }

  function modelHeading(model) {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.model = model.name;
    const name = element("span", "model-name", modelDisplayName(model.name));
    name.title = model.name;
    th.append(name);
    const counts = element("span", "grade-counts");
    counts.title = "同题同模型只统计一次，计入最高评级";
    const tally = tallies.get(model.name);
    for (const grade of ["A", "B", "C", "D", "E"]) {
      if (tally?.[grade]) counts.append(element("span", gradeClass(grade), tally[grade] + grade));
    }
    if (counts.childElementCount) th.append(counts);
    const foot = element("div", "model-foot");
    if (model.released) {
      foot.append(element("span", "released", model.released));
      th.title = "发布于 " + model.released;
    }
    const logo = logoFor(model.name, "vendor");
    if (logo) foot.append(logo);
    if (foot.childElementCount) th.append(foot);
    return th;
  }

  function updateReference(topic, link) {
    const title = index.references[topic.promptFile];
    let label = link.querySelector(".topic-reference");
    link.classList.toggle("has-reference", Boolean(title));
    if (!title) {
      label?.remove();
      return;
    }
    if (!label) {
      label = element("span", "topic-reference");
      link.append(label);
    }
    label.textContent = title;
    label.title = "参考作品：《" + title + "》";
    label.setAttribute("aria-label", label.title);
  }

  function topicLink(topic) {
    const link = element("a", "cell " + gradeClass(topic.grade));
    link.href = "prompt.html?topic=" + encodeURIComponent(topic.name);
    link.title = topic.promptFile ? "查看生成 prompt" : "对话记录里没有找到 prompt";
    if (topic.grade) link.append(element("span", "badge", topic.grade));
    link.append(element("span", "topic-name", topic.name));
    updateReference(topic, link);
    return link;
  }

  function workCell(model, group) {
    const td = document.createElement("td");
    td.dataset.model = model.name;
    if (!group) {
      td.className = "empty";
      td.textContent = "·";
      return td;
    }
    const { entry, count } = group;
    td.dataset.grade = entry.grade || "";
    let mark;
    if (count > 1) {
      mark = element("span", "count", String(count));
      mark.title = "同题同模型" + (selectedGrade === null ? "共 " : "符合当前评级的作品共 ") + count + " 篇";
    }
    const link = cellLink(entry, mark);
    link.setAttribute("aria-label", entry.topic + "，" + entry.model + "，" + (entry.grade || "未定") + "，" + entry.time);
    td.append(link);
    return td;
  }

  function filterTopics() {
    const query = topicFilter.value.trim();
    const revealHidden = allModels || Boolean(query || modelFilter.value.trim());
    let visible = 0;
    for (const { tr, topic } of rows) {
      tr.hidden = !topic.name.includes(query) || (topic.hidden === true && !revealHidden);
      if (!tr.hidden) visible++;
    }
    emptyStatus.hidden = visible > 0;
  }

  function renderTable() {
    const modelQuery = modelFilter.value.trim().toLowerCase();
    const columns = models.filter(model => modelQuery ? model.name.toLowerCase().includes(modelQuery) : allModels || !model.hidden);
    const groups = selectedGrade === null ? best : groupEntries(catalog.entries, selectedGrade);
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    const corner = element("th", "", "题目名称");
    corner.scope = "col";
    head.append(corner, ...columns.map(modelHeading));
    const body = table.createTBody();
    rows = [];
    for (const topic of catalog.topics) {
      const matches = columns.map(model => groups.get(topic.name + "\0" + model.name));
      if (!matches.some(Boolean)) continue;
      const tr = body.insertRow();
      tr.dataset.topic = topic.name;
      const link = topicLink(topic);
      tr.insertCell().append(link);
      columns.forEach((model, i) => tr.append(workCell(model, matches[i])));
      rows.push({ tr, topic, link });
    }
    emptyStatus = element("p", "table-note", "没有符合当前筛选条件的作品。");
    emptyStatus.setAttribute("role", "status");
    filterTopics();
    wrap.replaceChildren(table, emptyStatus);
    wrap.setAttribute("aria-busy", "false");
    gradeButtons.forEach(item => item.setAttribute("aria-pressed", String(item.dataset.grade === selectedGrade)));
    showAll.classList.toggle("on", allModels);
    showAll.setAttribute("aria-pressed", String(allModels));
  }

  function renderCatalog(data) {
    const left = firstRender ? Number(saved.left) || 0 : wrap.scrollLeft;
    const top = firstRender ? Number(saved.top) || 0 : wrap.scrollTop;
    catalog = data;
    models = catalog.models.slice().sort(compareModels);
    entriesById = new Map(catalog.entries.map(entry => [entry.id, entry]));
    best = groupEntries(catalog.entries, null);
    tallies = new Map();
    for (const { entry } of best.values()) {
      if (!entry.grade) continue;
      if (!tallies.has(entry.model)) tallies.set(entry.model, Object.create(null));
      const tally = tallies.get(entry.model);
      tally[entry.grade] = (tally[entry.grade] || 0) + 1;
    }
    $("summary").textContent = catalog.topics.length + " 道题目 · " + models.length + " 个模型 · " + catalog.entries.length + " 篇";
    renderCards();
    renderTable();
    if (left) wrap.scrollLeft = left;
    if (top) wrap.scrollTop = top;
    if (firstRender && typeof saved.y === "number") window.scrollTo({ top: saved.y, behavior: "instant" });
    firstRender = false;
  }

  function saveView() {
    if (!catalog) return;
    const arenaIndex = { topic: topicFilter.value, model: modelFilter.value, all: allModels, grade: selectedGrade,
      pages, left: wrap.scrollLeft, top: wrap.scrollTop, y: window.scrollY };
    try { sessionStorage.setItem(viewKey, JSON.stringify(arenaIndex)); } catch { /* Storage may be full. */ }
    try { history.replaceState({ ...history.state, arenaIndex }, ""); } catch { /* Storage may be unavailable. */ }
  }

  if (saved.topic != null) topicFilter.value = saved.topic;
  if (saved.model != null) modelFilter.value = saved.model;
  topicFilter.addEventListener("input", () => { if (catalog) { filterTopics(); saveView(); } });
  modelFilter.addEventListener("input", () => { if (catalog) { renderTable(); saveView(); } });
  showAll.addEventListener("click", () => { if (catalog) { allModels = !allModels; renderTable(); saveView(); } });
  gradeButtons.forEach(button => button.addEventListener("click", () => {
    if (!catalog) return;
    selectedGrade = selectedGrade === button.dataset.grade ? null : button.dataset.grade;
    renderTable();
    saveView();
  }));

  list.id = "showcase-list";
  more.type = "button";
  more.className = "button showcase-more";
  more.textContent = "显示更多";
  more.setAttribute("aria-controls", list.id);
  more.hidden = true;
  $("showcase").append(more);
  more.addEventListener("click", () => {
    const firstNew = pages * (mobile.matches ? 10 : 15);
    pages++;
    renderCards();
    slots[firstNew]?.querySelector("a")?.focus({ preventScroll: true });
    saveView();
  });
  mobile.addEventListener("change", () => { if (catalog) renderCards(); });

  // Refresh resources independently. A stalled or missing optional index cannot delay the table.
  const signatures = new Map();
  const pending = new Map();
  function refreshResource(key, load, update, onError) {
    const current = pending.get(key);
    if (current && Date.now() - current.started < 15000) return;
    const request = { started: Date.now() };
    pending.set(key, request);
    load().then(value => {
      if (pending.get(key) !== request || !value) return;
      if (key === "catalog") $("catalog-error")?.remove();
      const signature = JSON.stringify(value);
      if (signatures.get(key) === signature) return;
      update(value);
      signatures.set(key, signature);
    }).catch(error => {
      if (pending.get(key) === request && onError) onError(error);
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  }

  let lastRefresh = 0;
  function refresh() {
    lastRefresh = Date.now();
    const retryTitles = failedTitles.size > 0;
    failedTitles.clear();
    if (catalog && (failedCovers.size || retryTitles)) renderCards();
    refreshResource("catalog", loadCatalog, renderCatalog, () => {
      if (!catalog) {
        document.querySelectorAll("[data-loading-message]").forEach(label => {
          label.textContent = label.dataset.loadingMessage + "暂时无法加载。";
          label.parentElement.setAttribute("aria-busy", "false");
        });
      }
      showError(catalog ? "暂时无法更新目录，已保留上次加载的内容。"
        : "无法读取 data/catalog.json。请检查网络和目录文件，或通过「打开网页.bat」预览。", refresh);
    });
    refreshResource("covers", loadCoverFiles, value => { covers = value; if (catalog) renderCards(); });
    refreshResource("index", () => loadJSON("data/library-index.json"), value => {
      titleIndexReady = true;
      if (value.titles && value.references) index = value;
      if (catalog) {
        renderCards();
        rows.forEach(({ topic, link }) => updateReference(topic, link));
      }
    }, () => {
      titleIndexReady = true;
      if (catalog) renderCards();
    });
  }

  let scrollTimer;
  function saveAfterScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveView, 250);
  }
  window.addEventListener("scroll", saveAfterScroll, { passive: true });
  wrap.addEventListener("scroll", saveAfterScroll, { passive: true });
  function suspend() {
    saveView();
    // Responses begun before a freeze may describe an older version of the library.
    pending.clear();
  }
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspend();
    else refresh();
  });
  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible" && Date.now() - lastRefresh > 30000) refresh();
  });
  refresh();
})();
