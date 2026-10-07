(function () {
  var GRADE = { "": "g-unset", A: "g-a", B: "g-b", C: "g-c", D: "g-d", E: "g-e" };

  function $(id) { return document.getElementById(id); }

  function showError(message) {
    var node = document.createElement("p");
    node.className = "error";
    node.textContent = message;
    document.body.prepend(node);
  }

  async function loadCatalog() {
    var response = await fetch("data/catalog.json", { cache: "no-store" });
    if (!response.ok) {
      var missing = new Error("打不开 data/catalog.json。请双击「打开网页.bat」，或在发布后通过 GitHub Pages 访问。直接双击 html 时，浏览器不允许读取旁边的数据文件。");
      missing.catalogKind = "open";
      throw missing;
    }
    var text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      var detail = error && error.message ? "：" + error.message : "";
      var parseError = new Error("data/catalog.json 解析失败" + detail + "。请检查这个文件的 JSON 格式。");
      parseError.catalogKind = "parse";
      throw parseError;
    }
  }

  function effortText(value) {
    return value ? value : "未记录";
  }

  function naturalTime(value) {
    var digits = String(value || "");
    var compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(digits);
    if (compact) return compact[1] + "年" + compact[2] + "月" + compact[3] + "日 " + compact[4] + ":" + compact[5];
    var spaced = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(digits);
    if (spaced) return spaced[1] + "年" + spaced[2] + "月" + spaced[3] + "日 " + spaced[4] + ":" + spaced[5];
    return digits;
  }

  function isHan(code) {
    return code === 0x3007
      || (code >= 0x3400 && code <= 0x4DBF)
      || (code >= 0x4E00 && code <= 0x9FFF)
      || (code >= 0xF900 && code <= 0xFAFF)
      || (code >= 0x20000 && code <= 0x2EBEF)
      || (code >= 0x30000 && code <= 0x323AF);
  }

  function countHan(text) {
    var count = 0;
    for (var ch of text) {
      if (isHan(ch.codePointAt(0))) count += 1;
    }
    return count;
  }

  function referenceLabel(filename) {
    var base = filename.split(/[\\/]/).pop();
    var stem = base.replace(/\.(?:xhtml|html|txt|pdf|epub|md)$/i, "").trim();
    if (stem.replace(/[^A-Za-z]/g, "").toLowerCase() === "goodoldneon") return "Good Old Neon";
    return stem;
  }

  function redactPrompt(text) {
    var labels = [];
    var pathRe = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+?\.(?:xhtml|html|txt|pdf|epub|md)/gi;
    var body = text.replace(pathRe, function (raw) {
      if (/所用模型|时间戳|yymmdd|\{/.test(raw)) return raw;
      labels.push(referenceLabel(raw));
      return "";
    });
    var bareRe = /(?<![\w./\\])([\w\u4e00-\u9fff.\-]+\.(?:xhtml|html|txt|pdf|epub|md))/gi;
    body = body.replace(bareRe, function (raw) {
      if (/所用模型|时间戳|yymmdd|\{/.test(raw)) return raw;
      labels.push(referenceLabel(raw));
      return "";
    });
    body = body.replace(/参考 的风格/g, "参考其风格").replace(/参考的风格/g, "参考其风格");
    body = body.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    var seen = [];
    labels.forEach(function (label) {
      if (label && seen.indexOf(label) < 0) seen.push(label);
    });
    var lines = body.split("\n");
    if (lines.length && /^（[^）\n]+）(?:（[^）\n]+）)*$/.test(lines[0].trim())) {
      lines[0].trim().match(/（[^）]+）/g).forEach(function (mark) {
        var name = mark.slice(1, -1);
        if (seen.indexOf(name) < 0) seen.push(name);
      });
      lines.shift();
      body = lines.join("\n").trim();
    }
    return { labels: seen, body: body };
  }

  function gradeClass(grade) {
    return GRADE[grade] || "g-unset";
  }

  function latestMap(entries) {
    var map = new Map();
    var count = new Map();
    entries.forEach(function (entry) {
      var key = entry.topic + "\0" + entry.model;
      count.set(key, (count.get(key) || 0) + 1);
      var prev = map.get(key);
      if (!prev) {
        map.set(key, entry);
        return;
      }
      var prevGraded = Boolean(prev.grade);
      var nextGraded = Boolean(entry.grade);
      if (nextGraded !== prevGraded) {
        if (nextGraded) map.set(key, entry);
        return;
      }
      if (entry.time > prev.time) map.set(key, entry);
    });
    return { latest: map, count: count };
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
    { re: /^Muse\b/, src: "assets/logos/meta.svg", name: "Meta", ink: false }
  ];

  function vendorOf(name) {
    for (var i = 0; i < VENDORS.length; i += 1) {
      if (VENDORS[i].re.test(name)) return VENDORS[i];
    }
    return null;
  }

  function releasedOf(model) {
    return String(model.released || "").trim();
  }

  /* 发布日期留空的排在最左（彼此按名称），其余从新到旧。 */
  function compareModels(a, b) {
    var ar = releasedOf(a);
    var br = releasedOf(b);
    if (!ar && br) return -1;
    if (ar && !br) return 1;
    if (ar !== br) return ar < br ? 1 : -1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  }

  function displayTitle(title, fallback) {
    var text = String(title || "").trim();
    var wrapped = /^(?:《(.+)》|「(.+)」|“(.+)”|"(.+)")$/.exec(text);
    if (wrapped) text = (wrapped[1] || wrapped[2] || wrapped[3] || wrapped[4] || "").trim();
    return text || fallback;
  }

  function renderShowcase(catalog) {
    var root = $("showcase");
    if (!root) return;
    var picked = latestMap(catalog.entries).latest;
    var jobs = [];
    root.querySelectorAll(".showcase-row").forEach(function (row) {
      var slots = Array.prototype.slice.call(row.querySelectorAll("[data-model][data-topic]"));
      var clusters = [];
      slots.forEach(function (slot) {
        var model = slot.getAttribute("data-model") || "";
        var topic = slot.getAttribute("data-topic") || "";
        var last = clusters[clusters.length - 1];
        if (!last || last.model !== model) {
          last = { model: model, items: [] };
          clusters.push(last);
        }
        last.items.push(topic);
      });
      row.textContent = "";
      var vendor = clusters.length ? vendorOf(clusters[0].model) : null;
      if (vendor) {
        var logo = document.createElement("img");
        logo.className = "showcase-logo" + (vendor.ink ? " ink" : "");
        logo.src = vendor.src;
        logo.alt = vendor.name;
        logo.title = vendor.name;
        logo.width = 16;
        logo.height = 16;
        row.appendChild(logo);
      }
      clusters.forEach(function (cluster) {
        var clusterEl = document.createElement("span");
        clusterEl.className = "showcase-cluster";
        var label = document.createElement("span");
        label.className = "showcase-model";
        label.textContent = cluster.model + "：";
        clusterEl.appendChild(label);
        cluster.items.forEach(function (topic) {
          var entry = picked.get(topic + "\0" + cluster.model);
          var link = document.createElement("a");
          link.className = "showcase-work " + gradeClass(entry && entry.grade);
          link.textContent = entry && entry.grade ? topic + " " + entry.grade : topic;
          if (entry) {
            link.href = "read.html?id=" + encodeURIComponent(entry.id);
            jobs.push({ link: link, entry: entry, topic: topic });
          }
          clusterEl.appendChild(link);
        });
        row.appendChild(clusterEl);
      });
    });
    jobs.forEach(function (job) {
      fetch(encodeURI(job.entry.file)).then(function (response) {
        if (!response.ok) throw new Error("text");
        return response.text();
      }).then(function (text) {
        var title = displayTitle(parseWork(text).title, job.topic);
        job.link.textContent = job.entry.grade ? title + " " + job.entry.grade : title;
      }).catch(function () {
        job.link.textContent = job.entry.grade ? job.topic + " " + job.entry.grade : job.topic;
      });
    });
  }

  function renderIndex(catalog) {
    var models = catalog.models.slice().sort(compareModels);
    var summary = $("summary");
    if (summary) {
      summary.textContent = catalog.topics.length + " 道题目 · " + catalog.models.length + " 个模型 · " + catalog.entries.length + " 篇";
    }
    renderShowcase(catalog);
    var groups = latestMap(catalog.entries);
    function markColumn(el, model) {
      el.dataset.model = model.name;
      if (model.hidden) el.dataset.hidden = "1";
    }
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    var corner = document.createElement("th");
    corner.textContent = "题目名称";
    headRow.appendChild(corner);
    models.forEach(function (model) {
      var th = document.createElement("th");
      markColumn(th, model);
      var name = document.createElement("span");
      name.className = "model-name";
      name.textContent = model.name;
      th.appendChild(name);
      var tally = {};
      catalog.entries.forEach(function (entry) {
        if (entry.model !== model.name || !entry.grade) return;
        tally[entry.grade] = (tally[entry.grade] || 0) + 1;
      });
      var counts = document.createElement("span");
      counts.className = "grade-counts";
      ["A", "B", "C", "D", "E"].forEach(function (grade) {
        if (!tally[grade]) return;
        var tag = document.createElement("span");
        tag.className = gradeClass(grade);
        tag.textContent = tally[grade] + grade;
        counts.appendChild(tag);
      });
      if (counts.childNodes.length) th.appendChild(counts);
      var foot = document.createElement("div");
      foot.className = "model-foot";
      if (model.released) {
        var sub = document.createElement("span");
        sub.className = "released";
        sub.textContent = model.released;
        foot.appendChild(sub);
        th.title = "发布于 " + model.released;
      }
      var vendor = vendorOf(model.name);
      if (vendor) {
        var logo = document.createElement("img");
        logo.className = vendor.ink ? "vendor ink" : "vendor";
        logo.src = vendor.src;
        logo.alt = vendor.name;
        logo.title = vendor.name;
        logo.width = 16;
        logo.height = 16;
        foot.appendChild(logo);
      }
      if (foot.childNodes.length) th.appendChild(foot);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    catalog.topics.forEach(function (topic) {
      var tr = document.createElement("tr");
      tr.dataset.topic = topic.name;
      var topicCell = document.createElement("td");
      var topicLink = document.createElement("a");
      topicLink.className = "cell " + gradeClass(topic.grade);
      topicLink.href = "prompt.html?topic=" + encodeURIComponent(topic.name);
      if (topic.grade) {
        var badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = topic.grade;
        topicLink.appendChild(badge);
      }
      var name = document.createElement("span");
      name.className = "topic-name";
      name.textContent = topic.name;
      topicLink.appendChild(name);
      topicLink.title = topic.promptFile ? "查看生成 prompt" : "对话记录里没有找到 prompt";
      topicCell.appendChild(topicLink);
      tr.appendChild(topicCell);

      models.forEach(function (model) {
        var td = document.createElement("td");
        markColumn(td, model);
        var key = topic.name + "\0" + model.name;
        var entry = groups.latest.get(key);
        if (!entry) {
          td.className = "empty";
          td.textContent = "·";
        } else {
          var count = groups.count.get(key) || 1;
          var mark = null;
          if (count > 1) {
            mark = document.createElement("span");
            mark.className = "count";
            mark.textContent = String(count);
            mark.title = "同题同模型共 " + count + " 篇。有评级时显示其中最新的一篇，否则显示最新一篇";
          }
          td.appendChild(cellLink(entry, mark));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var wrap = $("table");
    wrap.textContent = "";
    wrap.appendChild(table);

    var topicFilter = $("filter");
    var modelFilter = $("filter-model");
    var showAll = $("show-all");
    function columnHidden(el, modelQ) {
      var name = (el.dataset.model || "").toLowerCase();
      if (modelQ && name.indexOf(modelQ) === -1) return true;
      if (modelQ) return false;
      if (showAll && showAll.classList.contains("on")) return false;
      return el.dataset.hidden === "1";
    }
    function applyFilters() {
      var topicQ = topicFilter ? topicFilter.value.trim() : "";
      var modelQ = modelFilter ? modelFilter.value.trim().toLowerCase() : "";
      tbody.querySelectorAll("tr").forEach(function (row) {
        row.hidden = Boolean(topicQ) && row.dataset.topic.indexOf(topicQ) === -1;
        row.querySelectorAll("td[data-model]").forEach(function (cell) {
          cell.classList.toggle("col-hidden", columnHidden(cell, modelQ));
        });
      });
      headRow.querySelectorAll("th[data-model]").forEach(function (th) {
        th.classList.toggle("col-hidden", columnHidden(th, modelQ));
      });
    }
    if (topicFilter) topicFilter.addEventListener("input", applyFilters);
    if (modelFilter) modelFilter.addEventListener("input", applyFilters);
    if (showAll) {
      showAll.addEventListener("click", function () {
        var on = showAll.classList.toggle("on");
        showAll.setAttribute("aria-pressed", on ? "true" : "false");
        applyFilters();
      });
    }
    applyFilters();
  }

  function findEntry(catalog, id) {
    return catalog.entries.find(function (entry) { return entry.id === id; }) || null;
  }

  function byTimeDesc(a, b) {
    return a.time < b.time ? 1 : a.time > b.time ? -1 : 0;
  }

  function relatedGroups(catalog, entry) {
    var both = [];
    var topicOnly = [];
    var modelOnly = [];
    catalog.entries.forEach(function (item) {
      if (item.id === entry.id) return;
      var sameTopic = item.topic === entry.topic;
      var sameModel = item.model === entry.model;
      if (sameTopic && sameModel) both.push(item);
      else if (sameTopic) topicOnly.push(item);
      else if (sameModel) modelOnly.push(item);
    });
    both.sort(byTimeDesc);
    topicOnly.sort(byTimeDesc);
    modelOnly.sort(byTimeDesc);
    return [
      { title: "同题目、同模型", items: both, kind: "both" },
      { title: "仅题目相同", items: topicOnly, kind: "topic" },
      { title: "仅模型相同", items: modelOnly, kind: "model" }
    ].filter(function (group) { return group.items.length; });
  }

  function relatedLabel(item, kind) {
    var when = naturalTime(item.time);
    var head = kind === "topic" ? item.model : kind === "model" ? item.topic : "";
    var text = head ? head + "  ·  " + when : when;
    if (item.grade) text += "  ·  " + item.grade;
    return text;
  }

  function isPureNumeral(text) {
    return /^[一二三四五六七八九十百零〇]{1,3}$/.test(text) || /^\d{1,2}$/.test(text);
  }

  function headingOf(line, prevBlank, nextText) {
    var text = line.trim();
    if (!text || !prevBlank || text.length > 42) return null;
    if (/^[一二三四五六七八九十百零〇]{1,3}$/.test(text)) return { level: 1, text: text };
    if (/^[一二三四五六七八九十百零〇]{1,3}[\s　·.、:：].+/.test(text)) return { level: 1, text: text };
    if (/^【(?:场景)?[一二三四五六七八九十0-9]{1,3}】/.test(text)) return { level: 1, text: text };
    if (/^No\.?\s*\d+/i.test(text)) return { level: 1, text: text };
    if (/^(尾声|序章|楔子|终章|后记|引子|序)$/.test(text)) return { level: 1, text: text };
    if (/^[\u4e00-\u9fff]{2,4}$/.test(text) && /^(\d{1,3}|[一二三四五六七八九十]{2,5})岁$/.test(nextText)) {
      return { level: 1, text: text };
    }
    if (/^\d{1,2}$/.test(text)) return { level: 2, text: text };
    return null;
  }

  function nextNonEmpty(lines, index) {
    for (var i = index + 1; i < lines.length; i += 1) {
      if (lines[i].trim()) return lines[i].trim();
    }
    return "";
  }

  function parseWork(raw) {
    var lines = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var blocks = [];
    var first = "";
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].trim()) { first = lines[i].trim(); break; }
    }
    var title = "";
    var skipFirst = false;
    if (first && first.length <= 22 && !/[。！？]$/.test(first) && !headingOf(first, true, "")) {
      title = first;
      skipFirst = true;
    }
    var seenTitle = !skipFirst;
    lines.forEach(function (line, index) {
      var text = line.trim();
      if (!text) return;
      if (!seenTitle) {
        seenTitle = true;
        return;
      }
      var prevBlank = index === 0 || !lines[index - 1].trim();
      var heading = headingOf(text, prevBlank, nextNonEmpty(lines, index));
      blocks.push(heading ? { type: "h", level: heading.level, text: heading.text } : { type: "p", text: text });
    });
    return { title: title, blocks: blocks, chars: countHan(raw) };
  }

  function renderRead(catalog) {
    var id = new URLSearchParams(location.search).get("id");
    var entry = id && findEntry(catalog, id);
    var mount = $("reader");
    if (!entry) {
      mount.textContent = "没有找到这篇文稿。";
      return;
    }
    fetch(encodeURI(entry.file)).then(function (response) {
      if (!response.ok) throw new Error("text");
      return response.text();
    }).then(function (raw) {
      var work = parseWork(raw);
      var when = naturalTime(entry.time);
      document.title = (work.title || entry.topic) + " · " + when + " · NovellaArena";
      var layout = document.createElement("div");
      layout.className = "reader";
      var tocBar = document.createElement("div");
      tocBar.className = "toc-bar";
      var tocToggle = document.createElement("button");
      tocToggle.type = "button";
      tocToggle.className = "button toc-toggle";
      tocToggle.textContent = "目录";
      tocToggle.setAttribute("aria-expanded", "false");
      tocToggle.setAttribute("aria-controls", "toc");
      var toc = document.createElement("nav");
      toc.className = "toc";
      toc.id = "toc";
      toc.setAttribute("aria-label", "目录");
      var label = document.createElement("p");
      label.textContent = "目录";
      toc.appendChild(label);
      function setTocOpen(open) {
        layout.classList.toggle("toc-open", open);
        tocToggle.setAttribute("aria-expanded", open ? "true" : "false");
        tocToggle.textContent = open ? "收起目录" : "目录";
      }
      tocToggle.addEventListener("click", function () {
        var open = !layout.classList.contains("toc-open");
        setTocOpen(open);
        if (open) {
          var active = toc.querySelector("a.active");
          if (active) revealTocLink(active);
        }
      });
      tocBar.appendChild(tocToggle);
      tocBar.appendChild(toc);

      var article = document.createElement("article");
      var head = document.createElement("div");
      head.className = "article-head";
      head.id = "top";
      var h1 = document.createElement("h1");
      h1.textContent = work.title || entry.topic;
      var sub = document.createElement("p");
      sub.className = "subhead";
      sub.textContent = when;
      var meta = document.createElement("p");
      meta.className = "meta-line";
      var bits = [entry.topic, entry.model, effortText(entry.effort) + " · " + entry.harness, work.chars + " 字"];
      if (entry.grade) bits.push("质量 " + entry.grade);
      meta.textContent = bits.join("  ·  ");
      head.appendChild(h1);
      head.appendChild(sub);
      head.appendChild(meta);
      article.appendChild(head);

      var prose = document.createElement("div");
      prose.className = "prose";
      var groups = relatedGroups(catalog, entry);
      var tocLinks = [];
      var pinnedId = "";
      function revealTocLink(link) {
        var tocRect = toc.getBoundingClientRect();
        var linkRect = link.getBoundingClientRect();
        var pad = 8;
        if (linkRect.top < tocRect.top + pad) {
          toc.scrollTop -= tocRect.top + pad - linkRect.top;
        } else if (linkRect.bottom > tocRect.bottom - pad) {
          toc.scrollTop += linkRect.bottom - (tocRect.bottom - pad);
        }
      }
      function activate(id) {
        var current = null;
        tocLinks.forEach(function (item) {
          var on = item.id === id;
          item.link.classList.toggle("active", on);
          if (on) current = item.link;
        });
        if (current) revealTocLink(current);
      }
      function jumpTo(id, target) {
        pinnedId = id;
        if (window.matchMedia("(max-width: 760px)").matches) setTocOpen(false);
        activate(id);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + id);
      }
      var topLink = document.createElement("a");
      topLink.href = "#top";
      topLink.textContent = "全文";
      topLink.className = "active";
      topLink.addEventListener("click", function (event) {
        event.preventDefault();
        jumpTo("top", head);
      });
      toc.appendChild(topLink);
      tocLinks.push({ id: "top", link: topLink });

      var headingCount = 0;
      work.blocks.forEach(function (block) {
        if (block.type === "h") {
          headingCount += 1;
          var hid = "h-" + headingCount;
          var hx = document.createElement(block.level === 1 ? "h2" : "h3");
          hx.id = hid;
          hx.textContent = block.text;
          if (isPureNumeral(block.text)) hx.className = "center";
          prose.appendChild(hx);
          var link = document.createElement("a");
          link.href = "#" + hid;
          link.textContent = block.text;
          if (block.level === 2) link.className = "lv2";
          link.addEventListener("click", function (event) {
            event.preventDefault();
            jumpTo(hid, hx);
          });
          toc.appendChild(link);
          tocLinks.push({ id: hid, link: link });
        } else {
          var p = document.createElement("p");
          p.textContent = block.text;
          prose.appendChild(p);
        }
      });
      article.appendChild(prose);

      var topicRow = catalog.topics.find(function (item) { return item.name === entry.topic; });
      var promptJump = document.createElement("a");
      promptJump.className = "prompt-jump " + gradeClass(topicRow ? topicRow.grade : "");
      promptJump.href = "prompt.html?topic=" + encodeURIComponent(entry.topic);
      promptJump.textContent = "查看prompt";
      article.appendChild(promptJump);

      if (groups.length) {
        var relJump = document.createElement("a");
        relJump.href = "#related";
        relJump.className = "toc-related";
        relJump.textContent = "相关文稿";
        relJump.addEventListener("click", function (event) {
          event.preventDefault();
          var target = document.getElementById("related");
          if (!target) return;
          jumpTo("related", target);
        });
        toc.appendChild(relJump);
        tocLinks.push({ id: "related", link: relJump });

        var related = document.createElement("section");
        related.className = "related";
        related.id = "related";
        var rh = document.createElement("h2");
        rh.textContent = "相关文稿";
        related.appendChild(rh);
        groups.forEach(function (group) {
          var heading = document.createElement("h3");
          heading.textContent = group.title;
          related.appendChild(heading);
          var list = document.createElement("div");
          list.className = "related-list";
          group.items.forEach(function (item) {
            var link = document.createElement("a");
            link.className = gradeClass(item.grade);
            link.href = "read.html?id=" + encodeURIComponent(item.id);
            var left = document.createElement("span");
            left.textContent = relatedLabel(item, group.kind);
            var right = document.createElement("span");
            right.textContent = effortText(item.effort) + " · " + item.harness;
            link.appendChild(left);
            link.appendChild(right);
            list.appendChild(link);
          });
          related.appendChild(list);
        });
        article.appendChild(related);
      }

      layout.appendChild(tocBar);
      layout.appendChild(article);
      mount.textContent = "";
      mount.appendChild(layout);

      var readingLine = 96;
      function syncToc() {
        if (pinnedId) {
          var pinned = document.getElementById(pinnedId);
          if (pinned && Math.abs(pinned.getBoundingClientRect().top - readingLine) > 48) return;
          pinnedId = "";
        }
        var current = tocLinks.length ? tocLinks[0].id : "top";
        tocLinks.forEach(function (item) {
          var el = document.getElementById(item.id);
          if (el && el.getBoundingClientRect().top <= readingLine) current = item.id;
        });
        var link = null;
        var changed = false;
        tocLinks.forEach(function (item) {
          var on = item.id === current;
          if (on && !item.link.classList.contains("active")) changed = true;
          item.link.classList.toggle("active", on);
          if (on) link = item.link;
        });
        if (changed && link) revealTocLink(link);
      }
      var ticking = false;
      window.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          syncToc();
        });
      }, { passive: true });
      window.addEventListener("wheel", function () { pinnedId = ""; }, { passive: true });
      window.addEventListener("touchmove", function () { pinnedId = ""; }, { passive: true });
      requestAnimationFrame(syncToc);
    }).catch(function () {
      mount.textContent = "正文没有加载出来。请通过本地服务器或 GitHub Pages 打开本站。";
    });
  }

  function renderPrompt(catalog) {
    var topicName = new URLSearchParams(location.search).get("topic");
    var topic = catalog.topics.find(function (item) { return item.name === topicName; });
    var mount = $("prompt");
    if (!topic) {
      mount.textContent = "没有找到这道题目。";
      return;
    }
    var when = topic.promptAt ? naturalTime(topic.promptAt) : "";
    document.title = topic.name + (when ? " · " + when : "") + " · 生成 prompt · NovellaArena";
    var h1 = document.createElement("h1");
    h1.textContent = topic.name;
    if (when) {
      var sub = document.createElement("p");
      sub.className = "subhead";
      sub.textContent = when;
      mount.appendChild(h1);
      mount.appendChild(sub);
    } else {
      mount.appendChild(h1);
    }
    var meta = document.createElement("p");
    meta.className = "meta-line";
    meta.textContent = topic.promptAt ? "采用对话记录中较新的一版" : "对话记录中没有找到生成 prompt";
    mount.appendChild(meta);
    if (!topic.promptFile) {
      appendTopicWorks(mount, catalog, topic.name);
      return;
    }
    fetch(encodeURI(topic.promptFile)).then(function (response) {
      if (!response.ok) throw new Error("prompt");
      return response.text();
    }).then(function (text) {
      var cleaned = redactPrompt(text);
      if (cleaned.labels.length) {
        var refs = document.createElement("p");
        refs.className = "prompt-refs";
        cleaned.labels.forEach(function (label) {
          var code = document.createElement("code");
          code.textContent = "（" + label + "）";
          refs.appendChild(code);
        });
        mount.appendChild(refs);
      }
      var pre = document.createElement("pre");
      pre.className = "prompt";
      pre.textContent = cleaned.body;
      mount.appendChild(pre);
      appendTopicWorks(mount, catalog, topic.name);
    }).catch(function () {
      var p = document.createElement("p");
      p.textContent = "prompt 文件没有加载出来。";
      mount.appendChild(p);
      appendTopicWorks(mount, catalog, topic.name);
    });
  }

  function appendTopicWorks(mount, catalog, topicName) {
    var models = (catalog.models || []).slice().sort(compareModels);
    var order = {};
    models.forEach(function (model, index) { order[model.name] = index; });
    var works = catalog.entries.filter(function (entry) {
      return entry.topic === topicName;
    }).sort(function (a, b) {
      var ao = Object.prototype.hasOwnProperty.call(order, a.model) ? order[a.model] : models.length;
      var bo = Object.prototype.hasOwnProperty.call(order, b.model) ? order[b.model] : models.length;
      if (ao !== bo) return ao - bo;
      if (a.time === b.time) return 0;
      return a.time < b.time ? 1 : -1;
    });
    if (!works.length) return;
    var related = document.createElement("section");
    related.className = "related";
    var heading = document.createElement("h2");
    heading.textContent = "相关文稿";
    related.appendChild(heading);
    var list = document.createElement("div");
    list.className = "related-list";
    works.forEach(function (item) {
      var link = document.createElement("a");
      link.className = gradeClass(item.grade);
      link.href = "read.html?id=" + encodeURIComponent(item.id);
      var left = document.createElement("span");
      var when = naturalTime(item.time);
      left.textContent = item.grade ? item.model + "  ·  " + when + "  ·  " + item.grade : item.model + "  ·  " + when;
      var right = document.createElement("span");
      right.textContent = effortText(item.effort) + " · " + item.harness;
      link.appendChild(left);
      link.appendChild(right);
      list.appendChild(link);
    });
    related.appendChild(list);
    mount.appendChild(related);
  }

  var page = document.body.dataset.page;
  loadCatalog().then(function (catalog) {
    if (page === "index") renderIndex(catalog);
    else if (page === "read") renderRead(catalog);
    else if (page === "prompt") renderPrompt(catalog);
  }).catch(function (error) {
    var message = error && error.catalogKind
      ? error.message
      : "打不开 data/catalog.json。请双击「打开网页.bat」，或在发布后通过 GitHub Pages 访问。直接双击 html 时，浏览器不允许读取旁边的数据文件。";
    showError(message);
  });
})();
