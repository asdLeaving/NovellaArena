/* 模型名归一。导入工具与建站脚本使用同一套规则。 */
(function () {
  var ALIASES = {
    "claude opus 4.5": "Claude Opus 4.5",
    "claude opus 5": "Claude Opus 5",
    "claude opus 5.5": "Claude Opus 5.5",
    "claude fable 5.1": "Claude Fable 5.1",
    "claude sonnet 5.5": "Claude Sonnet 5.5",
    "grok 4.5": "Grok 4.5",
    "grok 4.6": "Grok 4.6",
    "grok 4.7": "Grok 4.7",
    "gpt 5.6 sol": "GPT 5.6 Sol",
    "gpt 6 astra": "GPT 6 Astra",
    "gpt 6 sol": "GPT 6 Sol",
    "gpt 6.1 sol": "GPT 6.1 Sol",
    "deepseek v4.1 flash": "DeepSeek V4.1 Flash",
    "qwen 3.8 max": "Qwen 3.8 Max"
  };

  var RELEASED = {
    "Claude Opus 4.5": "2025-11-24",
    "GPT 5.6 Sol": "2026-07-09",
    "Grok 4.5": "2026-07-16",
    "Claude Opus 5": "2026-07-24",
    "Grok 4.6": "2026-08-12",
    "Claude Fable 5.1": "2026-09-01",
    "GPT 6 Astra": "2026-09-03",
    "Grok 4.7": "2026-09-21",
    "Claude Opus 5.5": "2026-09-22",
    "GPT 6 Sol": "2026-09-22",
    "GPT 6.1 Sol": "2026-09-29",
    "Muse Spark 1.3": "2026-09-02",
    "Gemini 3.1 Pro": "2026-02-19",
    "Kimi K3": "2026-07-16"
  };

  var TOKEN = {
    gpt: "GPT",
    claude: "Claude",
    grok: "Grok",
    opus: "Opus",
    fable: "Fable",
    sonnet: "Sonnet",
    haiku: "Haiku",
    sol: "Sol",
    astra: "Astra",
    luna: "Luna",
    terra: "Terra",
    flash: "Flash",
    max: "Max",
    deepseek: "DeepSeek",
    qwen: "Qwen",
    gemini: "Gemini",
    kimi: "Kimi",
    mythos: "Mythos"
  };

  function canonicalModel(raw) {
    var s = String(raw || "").trim();
    s = s.replace(/网页.*$/, "").trim();
    s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
    s = s.replace(/[_\-]+/g, " ");
    s = s.replace(/([A-Za-z]{2,})(\d)/g, "$1 $2");
    s = s.replace(/(\d)([A-Za-z])/g, "$1 $2");
    s = s.replace(/\s+/g, " ").trim();
    var key = s.toLowerCase();
    if (ALIASES[key]) return ALIASES[key];
    return s.split(" ").map(function (tok) {
      var low = tok.toLowerCase();
      if (TOKEN[low]) return TOKEN[low];
      if (/^\d+(\.\d+)*$/.test(tok)) return tok;
      if (/^v\d/i.test(tok)) return "V" + tok.slice(1);
      if (!tok) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    }).join(" ");
  }

  function modelReleased(name) {
    return RELEASED[name] || "";
  }

  function isGpt(name) {
    return /^GPT\b/.test(name);
  }

  /* 导入页 effort 默认值：GPT、Claude 为 max，Grok 为 xhigh，其余为 high。 */
  function defaultEffort(name) {
    if (isGpt(name) || /^Claude\b/.test(name)) return "max";
    return /^Grok\b/.test(name) ? "xhigh" : "high";
  }

  /* Claude 默认 claude chat；GPT 沿用 10月3日12:00起默认 codex 的规则。 */
  function presetHarnessEffort(modelName, time12) {
    if (/^Claude\b/.test(modelName)) {
      return { harness: "claude chat", effort: "max" };
    }
    if (isGpt(modelName) && time12 >= "202610031200") {
      return { harness: "codex", effort: "max" };
    }
    return { harness: "cursor", effort: defaultEffort(modelName) };
  }

  window.ArenaModels = {
    canonicalModel: canonicalModel,
    modelReleased: modelReleased,
    defaultEffort: defaultEffort,
    presetHarnessEffort: presetHarnessEffort
  };
})();
