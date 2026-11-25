(function () {
  var FILE_RE = /^([^_]+)_([^_]+)_(\d{10})\.txt$/;
  var modelsApi = window.ArenaModels;
  var filesApi = window.ArenaImportFiles;
  var pending = null;
  var rootHandle = null;
  var saving = false;
  var draftKey = "arena:import:" + location.pathname + ":";

  function $(id) { return document.getElementById(id); }

  function expandTime(ts10) {
    var mm = Number(ts10.slice(2, 4));
    var dd = Number(ts10.slice(4, 6));
    var hh = Number(ts10.slice(6, 8));
    var mi = Number(ts10.slice(8, 10));
    var date = new Date(Date.UTC(Number("20" + ts10.slice(0, 2)), mm - 1, dd));
    if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd || hh > 23 || mi > 59) return "";
    return "20" + ts10;
  }

  function parseName(name) {
    var match = FILE_RE.exec(name);
    if (!match) return { error: "文件名需要是「题目_模型_yymmddhhmm.txt」，模型名本身不要再含下划线。" };
    if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || !match[1].trim() || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(match[1])) {
      return { error: "题目或模型名含有不能用于站点文件的字符，请修改文件名。" };
    }
    if (match[2].indexOf("网页") !== -1) return { error: "模型名带有「网页」标注，这份文稿不收入。" };
    var time = expandTime(match[3]);
    if (!time) return { error: "时间戳不是有效的 yymmddhhmm。" };
    var model = modelsApi.canonicalModel(match[2]);
    if (!model) return { error: "模型名是空的。" };
    return { topic: match[1], modelRaw: match[2], model: model, time: time, filename: name };
  }

  function choiceValue(group) {
    var on = group.querySelector("button.on");
    return on ? on.getAttribute("data-value") : "";
  }

  function setChoice(group, value) {
    var matched = false;
    group.querySelectorAll("button").forEach(function (button) {
      var hit = button.getAttribute("data-value") === value;
      if (hit) matched = true;
      button.classList.toggle("on", hit);
      button.setAttribute("aria-pressed", hit ? "true" : "false");
    });
    if (!matched) {
      group.querySelectorAll("button").forEach(function (button) {
        var hit = button.getAttribute("data-value") === "__custom";
        button.classList.toggle("on", hit);
        button.setAttribute("aria-pressed", hit ? "true" : "false");
      });
      return "__custom";
    }
    return value;
  }

  function syncCustom(group, wrap) {
    wrap.classList.toggle("hidden", choiceValue(group) !== "__custom");
  }

  function forgetDraft() {
    try {
      sessionStorage.removeItem(draftKey + "file");
      sessionStorage.removeItem(draftKey + "fields");
    } catch {}
  }

  function rememberFields() {
    if (!pending || pending.checking || !pending.hasDraft) return;
    var fields = {};
    ["harness", "effort", "grade", "promptGrade", "modelVisibility"].forEach(id => fields[id] = choiceValue($(id)));
    ["harnessCustom", "effortCustom", "prompt", "releaseYear", "releaseMonth", "releaseDay"].forEach(id => fields[id] = $(id).value);
    fields.visibilityManual = pending.visibilityManual;
    fields.edited = pending.edited;
    try { sessionStorage.setItem(draftKey + "fields", JSON.stringify(fields)); } catch {}
  }

  function applyFields(fields) {
    ["harness", "effort", "grade", "promptGrade", "modelVisibility"].forEach(id => {
      if (typeof fields[id] === "string") setChoice($(id), fields[id]);
    });
    ["harnessCustom", "effortCustom", "prompt", "releaseYear", "releaseMonth", "releaseDay"].forEach(id => {
      if (typeof fields[id] === "string") $(id).value = fields[id];
    });
    pending.visibilityManual = Boolean(fields.visibilityManual);
    pending.edited = fields.edited || {};
    syncCustom($("harness"), $("harnessCustomWrap"));
    syncCustom($("effort"), $("effortCustomWrap"));
  }

  async function showFile(file, restoredFields) {
    if (saving) return;
    if (!restoredFields) forgetDraft();
    var parsed = parseName(file.name);
    $("panel").classList.remove("hidden");
    $("message").textContent = "";
    if (parsed.error) {
      pending = null;
      $("preview").textContent = parsed.error;
      $("save").disabled = true;
      $("export").disabled = true;
      $("releaseWrap").classList.add("hidden");
      return;
    }
    var selection = { parsed: parsed, checking: true, visibilityManual: false, visibilityMedian: null, edited: {} };
    pending = selection;
    $("save").disabled = true;
    $("export").disabled = true;
    $("preview").textContent = parsed.topic + "  ·  " + parsed.model + "  ·  " + parsed.time
      + "  ·  正在核对最新模型列表…";
    var preset = modelsApi.presetHarnessEffort(parsed.model, parsed.time);
    setChoice($("harness"), preset.harness);
    setChoice($("effort"), preset.effort);
    setChoice($("grade"), "");
    $("harnessCustom").value = "";
    $("effortCustom").value = "";
    setChoice($("promptGrade"), "__keep");
    $("prompt").value = "";
    syncCustom($("harness"), $("harnessCustomWrap"));
    syncCustom($("effort"), $("effortCustomWrap"));
    $("releaseWrap").classList.add("hidden");
    setReleased("");
    var textReady = file.text().then(function (text) {
      if (selection !== pending) return;
      selection.text = text;
      try {
        sessionStorage.setItem(draftKey + "file", JSON.stringify({ name: file.name, text: text }));
        selection.hasDraft = true;
      } catch {}
    }).catch(function () {
      if (selection === pending) $("message").textContent = "读取文稿失败，请重新选择文件。";
    });
    try {
      var catalog = await latestCatalog();
      if (pending !== selection) return;
      showModelInfo(parsed, catalog);
      var existing = catalog.entries.find(item => item.id === parsed.filename.slice(0, -4));
      if (existing) {
        ["harness", "effort"].forEach(function (id) {
          var value = existing[id] || "";
          if (setChoice($(id), value) === "__custom") $(id + "Custom").value = value;
          syncCustom($(id), $(id + "CustomWrap"));
        });
        setChoice($("grade"), existing.grade || "");
      }
    } catch (error) {
      if (pending !== selection) return;
      $("preview").textContent = parsed.topic + "  ·  " + parsed.model + "  ·  " + parsed.time
        + "  ·  暂时无法核对模型列表";
      $("message").textContent = "未能读取最新 catalog。保存时会重新读取；选择网站文件夹后，以该文件夹中的模型列表为准。";
      $("releaseWrap").classList.remove("hidden");
      setReleased(modelsApi.modelReleased(parsed.model));
    } finally {
      await textReady;
      if (pending === selection) {
        if (restoredFields) applyFields(restoredFields);
        selection.checking = false;
        $("save").disabled = $("export").disabled = typeof selection.text !== "string";
        if (typeof selection.text === "string" && !selection.hasDraft) $("message").textContent += " 此标签页无法暂存文稿，关闭前请保存或下载。";
        rememberFields();
      }
    }
  }

  function showModelInfo(parsed, catalog) {
    var known = (catalog.models || []).find(function (item) { return item.name === parsed.model; });
    var released = known ? known.released : modelsApi.modelReleased(parsed.model);
    $("preview").textContent = parsed.topic + "  ·  " + parsed.model + "  ·  " + parsed.time
      + (known ? (released ? "  ·  模型发布于 " + released : "  ·  已有模型，未记录发布日期")
        : "  ·  这是新的模型名，可补一个发布日期");
    $("releaseWrap").classList.toggle("hidden", Boolean(known));
    if (pending && pending.parsed === parsed) {
      pending.visibilityMedian = visibleReleaseMedian(catalog.models || []);
    }
    setReleased(released || "");
    if (known) setChoice($("modelVisibility"), known.hidden ? "no" : "yes");
  }

  function syncModelVisibility() {
    if (!pending || pending.visibilityManual) return;
    var hidden = hiddenForNewModel(readReleased(), pending.visibilityMedian);
    setChoice($("modelVisibility"), hidden ? "no" : "yes");
  }

  function setReleased(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    $("releaseYear").value = match ? match[1] : "";
    $("releaseMonth").value = match ? match[2] : "";
    $("releaseDay").value = match ? match[3] : "";
    $("releaseYear").dataset.len = String($("releaseYear").value.length);
    $("releaseMonth").dataset.len = String($("releaseMonth").value.length);
    $("releaseDay").dataset.len = String($("releaseDay").value.length);
    syncModelVisibility();
  }

  function readReleased() {
    var year = $("releaseYear").value.trim();
    var month = $("releaseMonth").value.trim();
    var day = $("releaseDay").value.trim();
    if (!year && !month && !day) return "";
    if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return "";
    return year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
  }

  function bindDatePart(input, next, size) {
    input.addEventListener("input", function () {
      var prevLen = Number(input.dataset.len || "0");
      var digits = input.value.replace(/\D/g, "").slice(0, size);
      input.value = digits;
      input.dataset.len = String(digits.length);
      syncModelVisibility();
      if (next && digits.length === size && prevLen < size) next.focus();
    });
  }

  function releaseDay(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var utc = Date.UTC(year, month - 1, day);
    var check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return utc / 86400000;
  }

  /* 默认显示模型里，有发布日期的那些日期的中位数。偶数个时取中间两天的中点。 */
  function visibleReleaseMedian(models) {
    var days = [];
    models.forEach(function (item) {
      if (item.hidden) return;
      var day = releaseDay(item.released);
      if (day != null) days.push(day);
    });
    days.sort(function (a, b) { return a - b; });
    if (!days.length) return null;
    var mid = Math.floor(days.length / 2);
    if (days.length % 2 === 1) return days[mid];
    return (days[mid - 1] + days[mid]) / 2;
  }

  /* 发布日期留空，或晚于中位数，则显示；否则默认隐藏。无法比较时显示。 */
  function hiddenForNewModel(released, median) {
    var day = releaseDay(released);
    if (day == null || median == null) return false;
    return !(day > median);
  }

  function insertModel(models, model) {
    if (models.some(function (item) { return item.name === model.name; })) return;
    if (!model.released) {
      var index = models.findIndex(function (item) {
        return item.released || item.name > model.name;
      });
      if (index < 0) models.push(model);
      else models.splice(index, 0, model);
      return;
    }
    var dated = models.findIndex(function (item) {
      return item.released && item.released < model.released;
    });
    if (dated < 0) models.push(model);
    else models.splice(dated, 0, model);
  }

  function insertTopic(topics, name, time, entries) {
    if (topics.some(function (item) { return item.name === name; })) return;
    function earliest(topicName) {
      return firstTimes.get(topicName) || "999999999999";
    }
    var firstTimes = new Map([[name, time]]);
    entries.forEach(function (entry) {
      if (entry.time < earliest(entry.topic)) firstTimes.set(entry.topic, entry.time);
    });
    var stamp = earliest(name);
    var index = topics.findIndex(function (item) { return earliest(item.name) > stamp; });
    var row = { name: name, grade: "", promptFile: "", promptAt: "" };
    if (index < 0) topics.push(row);
    else topics.splice(index, 0, row);
  }

  async function latestCatalog() {
    if (rootHandle) return filesApi.parseCatalog(await filesApi.catalogText(rootHandle));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("data/catalog.json", { cache: "no-cache", signal: controller.signal });
      if (!response.ok) throw new Error("读取 data/catalog.json 失败（HTTP " + response.status + "）。");
      return filesApi.parseCatalog(await response.text());
    } finally {
      clearTimeout(timeout);
    }
  }

  function downloadPackage(files, filename) {
    const url = URL.createObjectURL(filesApi.zip(files));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.slice(0, -4) + ".zip";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function chosen(id) {
    return choiceValue($(id)) === "__custom" ? $(id + "Custom").value.trim() : choiceValue($(id));
  }

  async function save(asDownload) {
    if (saving || !pending || pending.checking || typeof pending.text !== "string") return;
    const selection = pending;
    const parsed = selection.parsed;
    const harness = chosen("harness");
    const effort = chosen("effort");
    const released = readReleased();
    if (!harness) {
      $("message").textContent = "请填写 harness。";
      return;
    }
    if (choiceValue($("effort")) === "__custom" && !effort) {
      $("message").textContent = "请填写 effort，或改回「未记录」。";
      return;
    }
    if (!$("releaseWrap").classList.contains("hidden") && ["releaseYear", "releaseMonth", "releaseDay"].some(id => $(id).value) && releaseDay(released) === null) {
      $("message").textContent = "请填写有效的模型发布日期，或将年月日全部留空。";
      return;
    }
    const grade = choiceValue($("grade"));
    const hiddenOverride = selection.visibilityManual ? choiceValue($("modelVisibility")) === "no" : null;
    const promptText = $("prompt").value.trim();
    const promptGrade = choiceValue($("promptGrade"));
    function buildFiles(catalog) {
      const entry = applyToCatalog(catalog, parsed, harness, effort, grade, released, promptText, promptGrade, hiddenOverride, selection.edited);
      const files = new Map([[entry.file, selection.text]]);
      if (promptText) {
        const topic = catalog.topics.find(item => item.name === parsed.topic);
        files.set(topic.promptFile, promptText + "\n");
      }
      files.set(filesApi.catalogPath, JSON.stringify(catalog, null, 2) + "\n");
      return files;
    }

    saving = true;
    const fields = Array.from($("panel").querySelectorAll("input, textarea, .choice-row button")).filter(field => !field.disabled);
    fields.forEach(field => field.disabled = true);
    $("save").disabled = $("export").disabled = true;
    $("file").disabled = true;
    $("message").textContent = asDownload ? "正在准备导入包…" : "正在写入…";
    try {
      if (asDownload) {
        const catalog = await latestCatalog();
        downloadPackage(buildFiles(catalog), parsed.filename);
        $("message").textContent = "已生成 ZIP。请解压到与当前目录版本一致的网站文件夹，再运行「推送更新.bat」。";
      } else {
        if (!rootHandle) {
          const dir = await window.showDirectoryPicker({ mode: "readwrite", id: "novella-arena" });
          await dir.getFileHandle("index.html");
          await filesApi.catalogText(dir);
          rootHandle = dir;
        }
        await filesApi.save(rootHandle, buildFiles);
        $("dirLabel").textContent = "已写入 " + rootHandle.name;
        $("message").textContent = "已保存。返回本地主页即可查看，双击「推送更新.bat」可提交到 GitHub。";
      }
      forgetDraft();
      selection.hasDraft = false;
    } catch (error) {
      if (error.name === "AbortError") {
        $("message").textContent = "操作已取消或读取超时。文稿仍在，可重试或下载导入包。";
      } else if (error.name === "NotFoundError" || error.name === "NotAllowedError" || error.name === "SecurityError") {
        rootHandle = null;
        $("message").textContent = "请重新选择含有 data/catalog.json 的网站文件夹并允许写入，或下载导入包。";
      } else {
        const prefix = error instanceof SyntaxError ? "data/catalog.json 解析失败。" : "导入未完成。";
        $("message").textContent = prefix + (error.message || "请重试。");
      }
    } finally {
      saving = false;
      fields.forEach(field => field.disabled = false);
      $("save").disabled = $("export").disabled = false;
      $("file").disabled = false;
    }
  }

  function siteTextPath(path, folder) {
    return typeof path === "string" && path.startsWith(folder + "/") && /\.txt$/i.test(path)
      && !path.includes("\\") && path.split("/").every(part => part && part !== ".." && part !== ".");
  }

  function applyToCatalog(catalog, parsed, harness, effort, grade, released, promptText, promptGrade, hiddenOverride, edited) {
    var knownModel = catalog.models.some(function (item) { return item.name === parsed.model; });
    if (!knownModel) {
      insertModel(catalog.models, {
        name: parsed.model,
        released: released,
        hidden: typeof hiddenOverride === "boolean" ? hiddenOverride : hiddenForNewModel(released, visibleReleaseMedian(catalog.models))
      });
    }
    insertTopic(catalog.topics, parsed.topic, parsed.time, catalog.entries);
    var id = parsed.filename.replace(/\.txt$/, "");
    var entry = {
      id: id,
      topic: parsed.topic,
      model: parsed.model,
      time: parsed.time,
      effort: effort,
      harness: harness,
      grade: grade,
      file: "texts/" + parsed.filename,
      manual: true
    };
    var index = catalog.entries.findIndex(function (item) { return item.id === id; });
    if (index >= 0) {
      var previous = catalog.entries[index];
      entry.file = previous.file || entry.file;
      // Another tab or the selected directory may hold newer metadata than the preview.
      ["grade", "harness", "effort"].forEach(function (field) {
        if (!edited[field] && previous[field] != null) entry[field] = previous[field];
      });
      catalog.entries[index] = Object.assign({}, previous, entry);
    } else {
      catalog.entries.push(entry);
      catalog.entries.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    }
    if (!siteTextPath(entry.file, "texts")) throw new Error("已有文稿路径不在 texts/ 中，请检查目录。");
    var topic = catalog.topics.find(function (item) { return item.name === parsed.topic; });
    if (topic && ["", "A", "B", "C", "D", "E"].indexOf(promptGrade) !== -1) {
      topic.grade = promptGrade;
    }
    if (promptText) {
      if (topic) {
        topic.promptFile = topic.promptFile || "prompts/" + parsed.topic + ".txt";
        if (!siteTextPath(topic.promptFile, "prompts")) throw new Error("已有提示词路径不在 prompts/ 中，请检查目录。");
        topic.promptManual = true;
        var stamp = parsed.time;
        topic.promptAt = stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8) + " " + stamp.slice(8, 10) + ":" + stamp.slice(10, 12);
      }
    }
    return entry;
  }

  var drop = $("drop");
  drop.addEventListener("click", function (event) {
    if (event.target !== $("file") && !saving) $("file").click();
  });
  drop.addEventListener("dragover", function (event) {
    event.preventDefault();
    drop.classList.add("hot");
  });
  drop.addEventListener("dragleave", function () { drop.classList.remove("hot"); });
  drop.addEventListener("drop", function (event) {
    event.preventDefault();
    drop.classList.remove("hot");
    var file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) showFile(file);
  });
  $("file").addEventListener("change", function () {
    if ($("file").files[0]) showFile($("file").files[0]);
  });
  function bindChoices(group, onPick) {
    group.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button || !group.contains(button)) return;
      if (pending) pending.edited[group.id] = true;
      setChoice(group, button.getAttribute("data-value"));
      onPick(choiceValue(group));
    });
  }
  bindChoices($("harness"), function (value) {
    syncCustom($("harness"), $("harnessCustomWrap"));
    if (!pending || value === "__custom") return;
    pending.edited.effort = true;
    setChoice($("effort"), modelsApi.defaultEffort(pending.parsed.model));
    syncCustom($("effort"), $("effortCustomWrap"));
  });
  bindChoices($("effort"), function () { syncCustom($("effort"), $("effortCustomWrap")); });
  bindChoices($("grade"), function () {});
  bindChoices($("promptGrade"), function () {});
  bindChoices($("modelVisibility"), function () {
    if (pending) pending.visibilityManual = true;
  });
  bindDatePart($("releaseYear"), $("releaseMonth"), 4);
  bindDatePart($("releaseMonth"), $("releaseDay"), 2);
  bindDatePart($("releaseDay"), null, 2);
  $("save").addEventListener("click", () => save(false));
  $("export").addEventListener("click", () => save(true));
  if (!window.showDirectoryPicker) {
    $("save").hidden = true;
    $("export").classList.add("primary");
  }
  $("panel").addEventListener("input", function (event) {
    if (pending && /^(?:harness|effort)Custom$/.test(event.target.id)) {
      pending.edited[event.target.id.replace("Custom", "")] = true;
    }
    rememberFields();
  });
  $("panel").addEventListener("click", rememberFields);
  window.addEventListener("pagehide", rememberFields);
  try {
    var savedFile = JSON.parse(sessionStorage.getItem(draftKey + "file") || "null");
    if (savedFile && typeof savedFile.text === "string" && typeof savedFile.name === "string") {
      var fields = JSON.parse(sessionStorage.getItem(draftKey + "fields") || "{}");
      showFile(new File([savedFile.text], savedFile.name, { type: "text/plain" }), fields);
    }
  } catch { forgetDraft(); }
})();
