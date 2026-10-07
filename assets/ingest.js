(function () {
  var FILE_RE = /^([^_]+)_([^_]+)_(\d{10})\.txt$/;
  var modelsApi = window.ArenaModels;
  var pending = null;
  var rootHandle = null;

  function $(id) { return document.getElementById(id); }

  function expandTime(ts10) {
    var mm = Number(ts10.slice(2, 4));
    var dd = Number(ts10.slice(4, 6));
    var hh = Number(ts10.slice(6, 8));
    var mi = Number(ts10.slice(8, 10));
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return "";
    return "20" + ts10;
  }

  function parseName(name) {
    var match = FILE_RE.exec(name);
    if (!match) return { error: "文件名需要是「题目_模型_yymmddhhmm.txt」，模型名本身不要再含下划线。" };
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

  function showFile(file) {
    var parsed = parseName(file.name);
    $("panel").classList.remove("hidden");
    $("message").textContent = "";
    if (parsed.error) {
      pending = null;
      $("preview").textContent = parsed.error;
      $("save").disabled = true;
      $("releaseWrap").classList.add("hidden");
      return;
    }
    pending = { file: file, parsed: parsed };
    $("save").disabled = false;
    var known = modelsApi.modelReleased(parsed.model);
    $("preview").textContent = parsed.topic + "  ·  " + parsed.model + "  ·  " + parsed.time
      + (known ? "  ·  模型发布于 " + known : "  ·  这是新的模型名，可补一个发布日期");
    var preset = modelsApi.presetHarnessEffort(parsed.model, parsed.time);
    setChoice($("harness"), preset.harness);
    setChoice($("effort"), preset.effort);
    setChoice($("grade"), "");
    $("prompt").value = "";
    syncCustom($("harness"), $("harnessCustomWrap"));
    syncCustom($("effort"), $("effortCustomWrap"));
    $("releaseWrap").classList.toggle("hidden", Boolean(known));
    setReleased(known || "");
  }

  function setReleased(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    $("releaseYear").value = match ? match[1] : "";
    $("releaseMonth").value = match ? match[2] : "";
    $("releaseDay").value = match ? match[3] : "";
    $("releaseYear").dataset.len = String($("releaseYear").value.length);
    $("releaseMonth").dataset.len = String($("releaseMonth").value.length);
    $("releaseDay").dataset.len = String($("releaseDay").value.length);
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
      var times = entries.filter(function (entry) { return entry.topic === topicName; }).map(function (entry) { return entry.time; });
      times.push(topicName === name ? time : "999999999999");
      return times.reduce(function (a, b) { return a < b ? a : b; });
    }
    var stamp = earliest(name);
    var index = topics.findIndex(function (item) { return earliest(item.name) > stamp; });
    var row = { name: name, grade: "", promptFile: "", promptAt: "" };
    if (index < 0) topics.push(row);
    else topics.splice(index, 0, row);
  }

  async function pickRoot() {
    if (!window.showDirectoryPicker) return null;
    var handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await handle.getFileHandle("index.html");
    return handle;
  }

  async function writeText(dir, parts, contents) {
    var current = dir;
    for (var i = 0; i < parts.length - 1; i += 1) {
      current = await current.getDirectoryHandle(parts[i], { create: true });
    }
    var file = await current.getFileHandle(parts[parts.length - 1], { create: true });
    var writable = await file.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  async function readCatalog(dir) {
    var dataDir = await dir.getDirectoryHandle("data");
    var file = await dataDir.getFileHandle("catalog.json");
    var text = await (await file.getFile()).text();
    return JSON.parse(text);
  }

  function download(name, text) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    if (name.endsWith(".txt")) {
      link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    }
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  async function save() {
    if (!pending) return;
    var parsed = pending.parsed;
    var harness = choiceValue($("harness")) === "__custom" ? $("harnessCustom").value.trim() : choiceValue($("harness"));
    var effort = choiceValue($("effort")) === "__custom" ? $("effortCustom").value.trim() : choiceValue($("effort"));
    if (!harness) {
      $("message").textContent = "请填写 harness。";
      return;
    }
    if (choiceValue($("effort")) === "__custom" && !effort) {
      $("message").textContent = "请填写 effort，或改回「未记录」。";
      return;
    }
    var grade = choiceValue($("grade"));
    var text = await pending.file.text();
    var released = modelsApi.modelReleased(parsed.model) || readReleased();

    $("save").disabled = true;
    $("message").textContent = "正在写入…";
    try {
      if (!rootHandle) {
        try {
          rootHandle = await pickRoot();
        } catch (error) {
          rootHandle = null;
          if (!error || error.name !== "AbortError") {
            $("message").textContent = "请选择本站文件夹（里面要有 index.html）。";
            $("save").disabled = false;
            return;
          }
        }
      }
      var promptText = $("prompt").value.trim();
      if (!rootHandle) {
        var catalogResponse = await fetch("data/catalog.json");
        var catalog = await catalogResponse.json();
        var wrotePrompt = applyToCatalog(catalog, parsed, text, harness, effort, grade, released, promptText);
        download("catalog.json", JSON.stringify(catalog, null, 2) + "\n");
        download(parsed.filename, text.endsWith("\n") ? text : text + "\n");
        if (wrotePrompt) download(parsed.topic + ".txt", promptText + "\n");
        $("message").textContent = wrotePrompt
          ? "已下载 catalog.json、正文和 prompt。json 放到 data/，正文放到 texts/，prompt 放到 prompts/ 并保持 catalog 里的文件名。"
          : "已下载 catalog.json 和正文。json 放到 data/，正文放到 texts/。用 Chrome 或 Edge 打开本页时，可以选择网站文件夹直接写入。";
        $("save").disabled = false;
        return;
      }
      var catalog = await readCatalog(rootHandle);
      var wrotePrompt = applyToCatalog(catalog, parsed, text, harness, effort, grade, released, promptText);
      await writeText(rootHandle, ["texts", parsed.filename], text.endsWith("\n") ? text : text + "\n");
      if (wrotePrompt) {
        await writeText(rootHandle, ["prompts", parsed.topic + ".txt"], promptText + "\n");
      }
      await writeText(rootHandle, ["data", "catalog.json"], JSON.stringify(catalog, null, 2) + "\n");
      $("dirLabel").textContent = "已写入所选网站文件夹";
      $("message").textContent = "已加入。返回主页刷新即可看到。";
    } catch (error) {
      if (error instanceof SyntaxError) {
        var detail = error.message ? "：" + error.message : "";
        $("message").textContent = "data/catalog.json 解析失败" + detail + "。请先修正这个文件的 JSON 格式。";
      } else {
        $("message").textContent = "没有写进去。请选择含有 index.html 的 NovellaArena 文件夹，或改用下载方式。";
      }
    }
    $("save").disabled = false;
  }

  function applyToCatalog(catalog, parsed, text, harness, effort, grade, released, promptText) {
    catalog.models = catalog.models || [];
    catalog.topics = catalog.topics || [];
    catalog.entries = catalog.entries || [];
    var knownModel = catalog.models.some(function (item) { return item.name === parsed.model; });
    if (!knownModel) {
      insertModel(catalog.models, {
        name: parsed.model,
        released: released,
        hidden: hiddenForNewModel(released, visibleReleaseMedian(catalog.models))
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
      if (!grade) entry.grade = previous.grade || "";
      catalog.entries[index] = entry;
    } else {
      catalog.entries.push(entry);
      catalog.entries.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    }
    var wrotePrompt = false;
    if (promptText) {
      var topic = catalog.topics.find(function (item) { return item.name === parsed.topic; });
      if (topic) {
        topic.promptFile = "prompts/" + parsed.topic + ".txt";
        topic.promptManual = true;
        var stamp = parsed.time;
        topic.promptAt = stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8) + " " + stamp.slice(8, 10) + ":" + stamp.slice(10, 12);
        wrotePrompt = true;
      }
    }
    return wrotePrompt;
  }

  var drop = $("drop");
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
      setChoice(group, button.getAttribute("data-value"));
      onPick(choiceValue(group));
    });
  }
  bindChoices($("harness"), function (value) {
    syncCustom($("harness"), $("harnessCustomWrap"));
    if (!pending || value === "__custom") return;
    if (value === "cursor") setChoice($("effort"), modelsApi.cursorEffort(pending.parsed.model));
    else if (value === "codex") {
      var preset = modelsApi.presetHarnessEffort(pending.parsed.model, pending.parsed.time);
      if (preset.harness === "codex") setChoice($("effort"), preset.effort);
    }
    syncCustom($("effort"), $("effortCustomWrap"));
  });
  bindChoices($("effort"), function () { syncCustom($("effort"), $("effortCustomWrap")); });
  bindChoices($("grade"), function () {});
  bindDatePart($("releaseYear"), $("releaseMonth"), 4);
  bindDatePart($("releaseMonth"), $("releaseDay"), 2);
  bindDatePart($("releaseDay"), null, 2);
  $("save").addEventListener("click", save);
})();
