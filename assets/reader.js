(function () {
  "use strict";
  const { loadCatalog, loadCoverFiles, coverUrl, gradeClass, effortText,
    naturalTime, displayTitle, compareModels, byGradeThenTimeDesc } = window.Arena;
  const page = document.body.dataset.page;
  const mount = document.getElementById(page === "read" ? "reader" : "prompt");
  const query = new URLSearchParams(location.search);
  const readingLine = 96;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // Find the last block crossing the reading line without walking the whole manuscript.
  function lastAbove(length, top) {
    let low = 0;
    let high = length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (top(mid) <= readingLine) low = mid + 1;
      else high = mid;
    }
    return low - 1;
  }

  function rememberPosition(captureBlock, restoreBlock) {
    const previous = history.state && history.state.arenaReading;
    const address = () => location.pathname + location.search + location.hash;
    if (previous && previous.address === address() && Number.isFinite(previous.y)) {
      if (!restoreBlock || !restoreBlock(previous)) window.scrollTo({ top: previous.y, behavior: "instant" });
    } else if (location.hash) {
      let id = location.hash.slice(1);
      try { id = decodeURIComponent(id); } catch { /* A literal percent can be part of a fragment. */ }
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
    }
    let timer;
    function save() {
      clearTimeout(timer);
      const position = { address: address(), y: window.scrollY, ...(captureBlock && captureBlock()) };
      try { history.replaceState({ ...history.state, arenaReading: position }, ""); } catch { /* The tab can already be frozen. */ }
    }
    window.addEventListener("scroll", function () {
      clearTimeout(timer);
      timer = setTimeout(save, 300);
    }, { passive: true });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") save();
    });
    return save;
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
    both.sort(byGradeThenTimeDesc);
    topicOnly.sort(byGradeThenTimeDesc);
    modelOnly.sort(byGradeThenTimeDesc);
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
    return /^[一二三四五六七八九十百零〇]{1,3}$/.test(text) || /^\d{1,2}(?:\.\d{1,2})?$/.test(text);
  }

  function unboxHeading(text) {
    return text.replace(/^【([^【】]+)】$/, "$1").trim();
  }

  function chapterOrdinal(text) {
    text = unboxHeading(text);
    var match = /^第([一二三四五六七八九十百千万零〇两0-9]+)(部分|[章幕篇部杯])(?:$|[\s·.、:：].+)$/.exec(text);
    if (!match || match[2] === "杯" && endsLikeNumberedBody(text)) return null;
    var value = /^\d+$/.test(match[1]) ? Number(match[1]) : chineseNumeralValue(match[1]);
    if (value === null || !Number.isSafeInteger(value)) return null;
    return { kind: match[2] === "部分" ? "部" : match[2], value: value };
  }

  function isStandaloneSectionHeading(text) {
    return /^(?:零|〇|序章|楔子|终章|后记|引子|尾声|序|跋)(?:$|[\s·.、:：].+)$/.test(unboxHeading(text));
  }

  function isInterlude(text) {
    return /^幕间(?:$|[\s·.、:：].+)$/.test(unboxHeading(text));
  }

  function isClosingSection(text) {
    return /^(?:尾声|终章|后记|跋)(?:$|[\s·.、:：].+)$/.test(unboxHeading(text));
  }

  function isClockLabel(text) {
    return /^\d{1,2}\s*[:：]\s*[0-5]\d(?!\d)/.test(text);
  }

  function endsLikeNumberedBody(text) {
    return /[。！？…；;，,](?:[”’"」』])?(?:\s*[（(【\[].*[）)】\]])?\s*$/.test(text);
  }

  var CHINESE_NUMERALS = {
    "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "两": 2
  };
  var CHINESE_UNITS = [["万", 10000], ["千", 1000], ["百", 100], ["十", 10]];
  var ENGLISH_NUMERALS = ("one two three four five six seven eight nine ten eleven twelve thirteen"
    + " fourteen fifteen sixteen seventeen eighteen nineteen twenty").split(" ");

  function chineseNumeralValue(text) {
    if (!/^[零〇一二两三四五六七八九十百千万]+$/.test(text)) return null;
    if (Object.prototype.hasOwnProperty.call(CHINESE_NUMERALS, text)) return CHINESE_NUMERALS[text];
    var value = 0;
    for (var [unit, multiplier] of CHINESE_UNITS) {
      var index = text.indexOf(unit);
      if (index === -1) continue;
      var digit = CHINESE_NUMERALS[text.slice(0, index)];
      if (unit === "十" && index === 0 && !value) digit = 1;
      if (!digit) return null;
      value += digit * multiplier;
      text = text.slice(index + 1).replace(/^[零〇]/, "");
    }
    if (text && !Object.prototype.hasOwnProperty.call(CHINESE_NUMERALS, text)) return null;
    return text ? value + CHINESE_NUMERALS[text] : value || null;
  }

  function labeledOrdinal(text) {
    var match = /^【(场景)?([一二三四五六七八九十百零〇0-9]+)】/.exec(text);
    if (match) {
      var value = /^\d+$/.test(match[2]) ? Number(match[2]) : chineseNumeralValue(match[2]);
      if (value !== null && Number.isSafeInteger(value)) {
        return { kind: match[1] ? "scene" : "boxed", value: value, level: 1 };
      }
    }
    text = unboxHeading(text);
    match = /^No\.?\s*(\d+)/i.exec(text);
    if (match && Number.isSafeInteger(Number(match[1]))) return { kind: "no", value: Number(match[1]), level: 1 };
    match = /^(?:（(\d{1,3})）|\((\d{1,3})\))/.exec(text);
    if (match) return { kind: "parenthesized", value: Number(match[1] || match[2]), level: 2 };
    match = /^(\d{1,2})\.(\d{1,2})$/.exec(text);
    if (match) return { kind: "decimal:" + match[1], value: Number(match[2]), level: 2, needsPair: true };
    var english = ENGLISH_NUMERALS.indexOf(text.toLowerCase());
    return english === -1 ? null : { kind: "english", value: english + 1, level: 1 };
  }

  function sequenceCandidate(line, index) {
    var text = unboxHeading(line);
    if (!text || text.length > 42 || isClockLabel(text)) return null;
    var chinese = chineseNumeralValue(text);
    if (chinese !== null) return { index: index, value: chinese, kind: "chinese", titled: false };
    var chineseTitle = /^([零〇一二两三四五六七八九十百千万]{1,6})[\s·、.．:：]+(\S.*)$/.exec(text);
    if (chineseTitle) {
      chinese = chineseNumeralValue(chineseTitle[1]);
      if (chinese !== null && !endsLikeNumberedBody(text) && !/\.{3}[”’"」』）)\]]*$/.test(text)
          && !/[；;]\s*[一二三四五六七八九十百零〇]{1,3}、/.test(text)) {
        return { index: index, value: chinese, kind: "chineseTitle", titled: true };
      }
    }
    var arabic = /^(\d{1,3})$/.exec(text);
    if (arabic) return { index: index, value: Number(arabic[1]), kind: "arabic", titled: false };
    // A number followed by a title is a strong outer-heading candidate. Sentence-like
    // lines and inline dialogue/lists are excluded before sequence inference.
    var titled = /^(\d{1,3})(?:[\s　]+|[、．。:：]|\.\s+)(\S.*)$/.exec(text);
    if (!titled || /^(?:[「“"（(【\[])/.test(titled[2])) return null;
    if (endsLikeNumberedBody(text) || /\.{3}[”’"」』）)\]]*$/.test(text)) return null;
    return { index: index, value: Number(titled[1]), kind: "arabicTitle", titled: true };
  }

  function isStartNumber(value) {
    return value === 0 || value === 1;
  }

  function headingSeparation(lines, index) {
    var blanks = 0;
    for (var step of [-1, 1]) {
      for (var distance = 1; distance <= 2 && lines[index + step * distance] === ""; distance++) blanks++;
    }
    return blanks;
  }

  function increasingHeadings(items, hasBodyBetween, parents) {
    // 保留从 0 或 1 开始的递增序列。较高层标题允许重新起号，也允许沿用正文原有编号。
    var best = null;
    var scope = 0;
    var paths = [];
    items.forEach(function (item, index) {
      while (scope < parents.length && parents[scope] < item.index) scope++;
      var path = isStartNumber(item.value) ? { item: item, scope: scope, size: 1, consecutive: 0, separation: item.separation } : null;
      for (var previous of paths) {
        if (!previous || path && previous.size + 1 < path.size) continue;
        var prior = previous.item;
        var continues = item.value > prior.value;
        var restarts = scope > previous.scope && isStartNumber(item.value);
        if ((!continues && !restarts) || !hasBodyBetween(prior.index, item.index)) continue;
        var next = {
          item: item, scope: scope, previous: previous, size: previous.size + 1,
          consecutive: previous.consecutive + (item.value === prior.value + 1 ? 1 : 0),
          separation: previous.separation + item.separation
        };
        if (betterHeadingPath(next, path)) path = next;
      }
      paths[index] = path;
      if (path && betterHeadingPath(path, best)) best = path;
    });
    var selected = [];
    for (var path = best; path; path = path.previous) selected.push(path.item.index);
    return selected.reverse();
  }

  function betterHeadingPath(a, b) {
    if (!b || a.size !== b.size) return !b || a.size > b.size;
    if (a.consecutive !== b.consecutive) return a.consecutive > b.consecutive;
    if (a.separation !== b.separation) return a.separation > b.separation;
    // 同一幕间有与正文重号的引文时，等分候选中靠后的重号更可能是正文的续接处。
    var left = a.item.index === b.item.index && a.previous ? a.previous.item : a.item;
    var right = a.item.index === b.item.index && b.previous ? b.previous.item : b.item;
    return left.interlude >= 0 && left.interlude === right.interlude
      && left.value === right.value && left.index > right.index;
  }

  function sequenceHeadingLevels(lines, following) {
    var candidates = new Map();
    var chapters = [];
    var labels = new Map();
    var standalone = new Set();
    var levels = new Map();
    var body = [0];
    var interlude = -1;
    var closingSection = -1;
    lines.forEach(function (line, index) {
      if (isInterlude(line)) interlude = index;
      if (isClosingSection(line)) closingSection = index;
      var startsParagraph = index === 0 || !lines[index - 1];
      var chapter = line.length <= 42 && chapterOrdinal(line);
      var label = !chapter && startsParagraph && line.length <= 42 && labeledOrdinal(line);
      var candidate = !chapter && !label && sequenceCandidate(line, index);
      var isStandalone = line.length <= 42 && isStandaloneSectionHeading(line);
      if (chapter) {
        chapter.index = index;
        chapter.separation = headingSeparation(lines, index);
        chapter.interlude = interlude;
        if (closingSection < 0) chapters.push(chapter);
      }
      if (label) {
        label.index = index;
        label.separation = headingSeparation(lines, index);
        if (closingSection >= 0) label.level = 2;
        var key = label.kind + ":" + closingSection;
        if (!labels.has(key)) labels.set(key, []);
        labels.get(key).push(label);
      }
      if (candidate) {
        candidate.separation = headingSeparation(lines, index);
        candidate.closingSection = closingSection;
        candidates.set(index, candidate);
      }
      if (isStandalone) {
        standalone.add(index);
        levels.set(index, 1);
      } else if (startsParagraph && /^[\u4e00-\u9fff]{2,4}$/.test(unboxHeading(line))
          && /^(?:\d{1,3}|[一二三四五六七八九十]{2,5})岁$/.test(following[index])) {
        levels.set(index, 1);
      }
      var ordinary = line && !chapter && !label && !candidate && !levels.has(index)
        && interlude !== index && !isClockLabel(unboxHeading(line)) && /[\p{L}\p{N}]/u.test(line);
      body.push(body[index] + (ordinary ? 1 : 0));
    });
    function hasBodyBetween(from, to) {
      return body[to] > body[from + 1];
    }
    var parents = [];
    var explicit = new Set();
    ["部", "篇", "章", "幕", "杯"].forEach(function (kind) {
      var items = chapters.filter(function (item) { return item.kind === kind; });
      var selected = increasingHeadings(items, hasBodyBetween, parents);
      selected.forEach(function (index) {
        explicit.add(index);
        // 用“第几杯”区分重起编号的小节，保留这类文稿原有的目录样式。
        if (kind !== "杯") levels.set(index, 1);
      });
      if (kind === "部" || kind === "篇") parents = parents.concat(selected).sort(function (a, b) { return a - b; });
    });

    var hiddenFromToc = new Set();
    var hasMainChapters = chapters.some(function (item) {
      return item.kind === "章" && explicit.has(item.index);
    });
    var insideInterlude = false;
    lines.forEach(function (text, index) {
      if (explicit.has(index) || isClosingSection(text)) insideInterlude = false;
      else if (hasMainChapters && isInterlude(text)) insideInterlude = true;
      if (insideInterlude) {
        hiddenFromToc.add(index);
        candidates.delete(index);
        if (!standalone.has(index)) levels.delete(index);
      }
    });
    function levelOneAnchors() {
      var anchors = new Set(explicit);
      levels.forEach(function (level, index) {
        if (level === 1 && !standalone.has(index)) anchors.add(index);
      });
      return Array.from(anchors).sort(function (a, b) { return a - b; });
    }
    function addLabeledHeadings(level) {
      var scopes = levelOneAnchors();
      labels.forEach(function (items) {
        if (items[0].level !== level) return;
        var selected = increasingHeadings(items.filter(function (item) { return !hiddenFromToc.has(item.index); }),
          hasBodyBetween, scopes);
        if (items[0].needsPair && selected.length < 2) return;
        selected.forEach(function (index) { levels.set(index, level); });
      });
    }
    addLabeledHeadings(1);
    addInferredHeadings(lines, Array.from(candidates.values()), levels, standalone, levelOneAnchors(), hasBodyBetween);
    addLabeledHeadings(2);
    return levels;
  }

  function addInferredHeadings(lines, candidates, levels, standalone, anchorIndexes, hasBodyBetween) {
    var groups = [];
    function collectGroups(kind, list) {
      var current = [];
      function finish(before) {
        if (isStartNumber(current[0]?.value)
            && (current.length >= 2 || kind === "chineseTitle" && hasBodyBetween(current[0].index, before))) {
          groups.push({
            kind: kind,
            items: current.slice(),
            start: current[0].index,
            end: current[current.length - 1].index,
            hasTitle: current.some(function (item) { return item.titled; })
          });
        }
        current = [];
      }
      list.forEach(function (item) {
        var previous = current[current.length - 1];
        if (!previous) {
          current = [item];
          return;
        }
        var consecutive = item.value === previous.value + 1;
        var hasText = hasBodyBetween(previous.index, item.index);
        if (consecutive && hasText && item.closingSection === previous.closingSection) current.push(item);
        else {
          finish(item.index);
          current = [item];
        }
      });
      finish(lines.length);
    }
    ["arabicTitle", "arabic", "chineseTitle", "chinese"].forEach(function (kind) {
      collectGroups(kind, candidates.filter(function (item) { return item.kind === kind; }));
    });
    // Some manuscripts alternate titled and bare Chinese markers (for example,
    // odd sections carry dates while even sections do not). If the titled-only
    // pass cannot form a sequence, validate the combined family as one run.
    var chineseTitleGroups = groups.filter(function (group) {
      return group.kind === "chineseTitle" && group.items.length >= 3;
    });
    var chineseTitles = candidates.filter(function (item) { return item.kind === "chineseTitle"; });
    var chineseBare = candidates.filter(function (item) { return item.kind === "chinese"; });
    if (!chineseTitleGroups.length && chineseTitles.length && chineseBare.length) {
      collectGroups("chinese", chineseTitles.concat(chineseBare).sort(function (a, b) { return a.index - b.index; }));
    }
    if (!groups.length) return;

    // 带标题的一级序列也可以统领贯穿多个章节的数字小节。
    var baseAnchors = anchorIndexes.map(function (index) { return { index: index, kind: null }; });
    groups.forEach(function (group) {
      if (group.kind !== "chineseTitle") return;
      group.items.forEach(function (item) { baseAnchors.push({ index: item.index, kind: group.kind }); });
    });
    baseAnchors.sort(function (a, b) { return a.index - b.index; });

    function contains(outer, inner) {
      return outer.start < inner.start && outer.end > inner.end;
    }

    function sequenceParent(outer, inner) {
      if (contains(outer, inner)) return true;
      // The last child sequence belongs to the final item of the outer
      // sequence even though the outer sequence's last marker is before it.
      var previous = null;
      var next = null;
      outer.items.forEach(function (item) {
        if (item.index < inner.start) previous = item;
        else if (next === null) next = item;
      });
      return Boolean(previous && (!next || inner.end < next.index)
        && (next || outer.kind !== inner.kind || outer.hasTitle));
    }

    // Longest spans are parents. A contained sequence is a child even when its
    // marker style changes (Arabic outer parts with Chinese inner sections, and
    // the reverse, are both common in the corpus).
    groups.sort(function (a, b) {
      var aSpan = a.end - a.start;
      var bSpan = b.end - b.start;
      return bSpan - aSpan || a.start - b.start;
    });
    groups.forEach(function (group) {
      var parent = groups.filter(function (other) { return other !== group && sequenceParent(other, group); })
        .sort(function (a, b) { return (a.end - a.start) - (b.end - b.start); })[0];
      var previousAnchor = baseAnchors.filter(function (anchor) { return anchor.index < group.start; }).pop();
      if (parent) group.level = Math.min(2, (parent.level || 1) + 1);
      else if (group.items[0].closingSection >= 0) group.level = 2;
      else if (group.kind === "arabicTitle") group.level = 1;
      else if (previousAnchor && previousAnchor.kind !== group.kind) group.level = 2;
      else group.level = 1;
    });

    var inferred = new Map();
    groups.forEach(function (group) {
      group.items.forEach(function (item) { inferred.set(item.index, group.level); });
    });
    [1, 2].forEach(function (level) {
      var siblings = new Map();
      var scopes = anchorIndexes.slice();
      if (level === 2) {
        levels.forEach(function (headingLevel, index) {
          if (headingLevel === 1 && !standalone.has(index)) scopes.push(index);
        });
      }
      candidates.forEach(function (item) {
        if (inferred.get(item.index) !== level) return;
        // 独立书名后的重新起号属于另一篇作品。
        if (level === 1 && isStartNumber(item.value)) {
          var previous = item.index - 1;
          while (lines[previous] === "") previous--;
          if (/^《[^《》]+》$/.test(lines[previous] || "")) scopes.push(previous);
        }
        var key = item.kind.replace(/Title$/, "") + ":" + item.closingSection;
        if (!siblings.has(key)) siblings.set(key, []);
        siblings.get(key).push(item);
      });
      scopes.sort(function (a, b) { return a - b; });
      siblings.forEach(function (items) {
        increasingHeadings(items, hasBodyBetween, scopes).forEach(function (index) {
          if (!standalone.has(index)) levels.set(index, level);
        });
      });
    });
  }

  function isAppendixStart(line) {
    var text = line.trim().replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/^[【（(\[]\s*/, "");
    return /^(?:注释|注解|脚注|尾注|附注|参考资料|参考文献|资料来源|生成情况(?:备注|说明)?|生成说明|生成备注|创作与资料说明|创作说明|写作说明|素材说明|修订记|修订说明)\s*(?:[：:】）)\]]|$)/.test(text);
  }

  function countWorkHan(lines, levels) {
    var end = lines.length;
    // 只查找最后一个正文标题之后的附加内容；不改变页面上的原文和目录。
    for (var i = lines.length - 1; i > 0; i -= 1) {
      var text = lines[i].trim();
      if (!text) continue;
      if (isAppendixStart(text)) {
        end = i;
      } else if (levels.has(i)) {
        break;
      }
    }
    var count = 0;
    for (var index = 0; index < end; index++) count += countHan(lines[index]);
    return count;
  }

  function parseWork(raw) {
    var lines = raw.split(/\r\n?|\n/).map(function (line) { return line.trim(); });
    // Precompute lookahead once, including for drafts with long runs of blank lines.
    var following = new Array(lines.length);
    var next = "";
    for (var n = lines.length - 1; n >= 0; n--) {
      following[n] = next;
      if (lines[n]) next = lines[n];
    }
    var levels = sequenceHeadingLevels(lines, following);
    var blocks = [];
    var firstIndex = lines.findIndex(Boolean);
    var first = lines[firstIndex];
    var title = "";
    if (first && first.length <= 22 && !/[。！？]$/.test(first)
        && !levels.has(firstIndex) && !chapterOrdinal(first)) {
      title = displayTitle(first, "");
    }
    lines.forEach(function (text, index) {
      if (!text || (index === firstIndex && title)) return;
      var level = levels.get(index);
      blocks.push(level ? { type: "h", level: level, text: text } : { type: "p", text: text });
    });
    return { title: title, blocks: blocks, chars: countWorkHan(lines, levels) };
  }

  function loadReaderCover(entry, covers, title, onLoad) {
    var src = coverUrl(entry, covers);
    if (!src) return;
    var cover = document.createElement("img");
    cover.className = "reader-cover";
    cover.alt = title + "封面";
    cover.decoding = "async";
    cover.addEventListener("load", function () { onLoad(cover); });
    cover.src = src;
  }

  function renderRead(catalog, entry, work, covers) {
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
    var mobileToc = window.matchMedia("(max-width: 760px)");
    function setTocOpen(open) {
      tocBar.classList.toggle("toc-open", open);
      tocToggle.setAttribute("aria-expanded", open ? "true" : "false");
      tocToggle.textContent = open ? "收起目录" : "目录";
    }
    tocToggle.addEventListener("click", function () {
      var open = !tocBar.classList.contains("toc-open");
      setTocOpen(open);
      if (open) {
        var active = toc.querySelector("a.active");
        if (active) {
          active.focus({ preventScroll: true });
          revealTocLink(active);
        }
      }
    });
    tocBar.appendChild(tocToggle);
    tocBar.appendChild(toc);
    document.addEventListener("pointerdown", function (event) {
      if (mobileToc.matches && !tocBar.contains(event.target)) setTocOpen(false);
    });
    document.addEventListener("focusin", function (event) {
      if (mobileToc.matches && !tocBar.contains(event.target)) setTocOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && mobileToc.matches && tocBar.classList.contains("toc-open")) {
        setTocOpen(false);
        tocToggle.focus();
      }
    });

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
    var activeLink;
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
    function addTocLink(target, text, className) {
      const link = document.createElement("a");
      link.href = "#" + target.id;
      link.textContent = text;
      if (className) link.className = className;
      toc.appendChild(link);
      tocLinks.push({ target, link });
    }
    toc.addEventListener("click", function (event) {
      const link = event.target.closest("a[href^='#']");
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      setTocOpen(false);
      const target = document.getElementById(link.hash.slice(1));
      if (mobileToc.matches) tocToggle.focus({ preventScroll: true });
      history.replaceState(history.state, "", link.hash);
      target.scrollIntoView({ behavior: "instant", block: "start" });
      syncToc();
      savePosition();
    });
    addTocLink(head, "全文");

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
        addTocLink(hx, block.text, block.level === 2 ? "lv2" : "");
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
      var related = document.createElement("section");
      related.className = "related";
      related.id = "related";
      addTocLink(related, "相关文稿", "toc-related");
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
    function placeToc() {
      setTocOpen(false);
      if (mobileToc.matches) document.querySelector(".topbar").appendChild(tocBar);
      else layout.insertBefore(tocBar, article);
    }
    placeToc();
    mobileToc.addEventListener("change", placeToc);

    // The targets stay in document order even when fonts or viewport width change.
    function syncToc() {
      const index = lastAbove(tocLinks.length, i => tocLinks[i].target.getBoundingClientRect().top);
      const link = tocLinks[Math.max(0, index)].link;
      if (activeLink === link) return;
      if (activeLink) {
        activeLink.classList.remove("active");
        activeLink.removeAttribute("aria-current");
      }
      activeLink = link;
      link.classList.add("active");
      link.setAttribute("aria-current", "location");
      if (!mobileToc.matches || tocBar.classList.contains("toc-open")) revealTocLink(link);
    }
    const blocks = prose.children;
    const previous = history.state && history.state.arenaReading;
    const restoringIntro = previous && previous.intro && previous.address === location.pathname + location.search + location.hash;
    const savePosition = rememberPosition(function () {
      const body = prose.getBoundingClientRect();
      if (body.top > readingLine) return { intro: true };
      if (body.bottom < readingLine) return { afterProse: readingLine - body.bottom };
      const i = lastAbove(blocks.length, n => blocks[n].getBoundingClientRect().top);
      if (i < 0) return {};
      const box = blocks[i].getBoundingClientRect();
      return { block: i, fraction: (readingLine - box.top) / Math.max(1, box.height) };
    }, function (position) {
      if (Number.isFinite(position.afterProse)) {
        window.scrollBy({ top: prose.getBoundingClientRect().bottom + position.afterProse - readingLine, behavior: "instant" });
        return true;
      }
      const block = blocks[position.block];
      if (!block || !Number.isFinite(position.fraction)) return false;
      const box = block.getBoundingClientRect();
      window.scrollBy({ top: box.top + position.fraction * box.height - readingLine, behavior: "instant" });
      return true;
    });
    const initialY = window.scrollY;
    let ticking = false;
    function scheduleSync() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        syncToc();
      });
    }
    syncToc();
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);
    covers.then(function (manifest) {
      loadReaderCover(entry, manifest, work.title || entry.topic, function (cover) {
        const before = prose.getBoundingClientRect().top;
        const stillAtIntro = restoringIntro && Math.abs(window.scrollY - initialY) < 1;
        article.insertBefore(cover, prose);
        if (stillAtIntro) window.scrollTo({ top: previous.y, behavior: "instant" });
        else if (before < readingLine) window.scrollBy({ top: prose.getBoundingClientRect().top - before, behavior: "instant" });
        syncToc();
      });
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

  let retryAction;
  function showProblem(container, message, retry) {
    const status = document.createElement("p");
    status.className = "error";
    status.setAttribute("role", "status");
    status.textContent = message;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = "重新加载";
    retryAction = function () {
      retryAction = null;
      button.disabled = true;
      retry();
    };
    button.addEventListener("click", retryAction, { once: true });
    container.replaceChildren(status, button);
  }

  async function fetchText(path) {
    const url = path.split("/").map(encodeURIComponent).join("/");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try {
        response = await fetch(url, { cache: "no-cache", signal: controller.signal });
      } catch (error) {
        response = await fetch(url, { cache: "only-if-cached", mode: "same-origin" });
        if (!response.ok) throw error;
      }
      if (!response.ok) throw new Error("文件读取失败（HTTP " + response.status + "）");
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderPrompt(catalog, topic, readText) {
    const when = naturalTime(topic.promptAt);
    document.title = topic.name + (when ? " · " + when : "") + " · 生成 prompt · NovellaArena";
    const heading = document.createElement("h1");
    heading.textContent = topic.name;
    mount.replaceChildren(heading);
    if (when) {
      const date = document.createElement("p");
      date.className = "subhead";
      date.textContent = when;
      mount.appendChild(date);
    }
    const meta = document.createElement("p");
    meta.className = "meta-line";
    meta.textContent = topic.promptAt ? "其中一版prompt，不同篇目可能有所调整" : "对话记录中没有找到生成 prompt";
    const content = document.createElement("div");
    mount.append(meta, content);
    appendTopicWorks(mount, catalog, topic.name);
    if (!topic.promptFile) {
      rememberPosition();
      return;
    }
    async function loadBody(getText) {
      content.textContent = "正在加载提示词…";
      try {
        const cleaned = redactPrompt(await getText(topic.promptFile));
        content.replaceChildren();
        if (cleaned.labels.length) {
          const refs = document.createElement("p");
          refs.className = "prompt-refs";
          cleaned.labels.forEach(function (label) {
            const code = document.createElement("code");
            code.textContent = "（" + label + "）";
            refs.appendChild(code);
          });
          content.appendChild(refs);
        }
        const body = document.createElement("pre");
        body.className = "prompt";
        body.textContent = cleaned.body;
        content.appendChild(body);
        rememberPosition();
      } catch {
        showProblem(content, "提示词文件加载失败。", () => loadBody(fetchText));
      }
    }
    return loadBody(readText);
  }

  async function loadPage() {
    const reading = page === "read";
    const key = reading ? "id" : "topic";
    let name = query.get(key) || "";
    const locationKey = reading ? "正文" : "提示词";
    mount.setAttribute("aria-busy", "true");
    mount.textContent = "正在加载" + locationKey + "…";
    // Imported works use these paths. Overridden paths in the catalog remain authoritative.
    const conventionalName = reading ? name.replace(/#(?:h-\d+|top|related)$/, "") : name;
    const normalPath = conventionalName && !/[\\/]/.test(conventionalName)
      ? (reading ? "texts/" : "prompts/") + conventionalName + ".txt" : "";
    const pendingText = normalPath && fetchText(normalPath).then(text => ({ text }), error => ({ error }));
    const covers = reading ? loadCoverFiles().catch(() => null) : null;
    async function readText(path) {
      if (!pendingText || path !== normalPath) return fetchText(path);
      const result = await pendingText;
      if (result.error) throw result.error;
      return result.text;
    }
    try {
      const catalog = await loadCatalog();
      if (reading) {
        let entry = catalog.entries.find(item => item.id === name);
        // Older shared links sometimes encoded the chapter fragment inside the id.
        if (!entry && name.includes("#")) {
          const mark = name.indexOf("#");
          const fragment = name.slice(mark);
          name = name.slice(0, mark);
          entry = catalog.entries.find(item => item.id === name);
          if (entry) {
            query.set("id", name);
            const address = new URL(location.href);
            address.search = query.toString();
            if (!address.hash) address.hash = fragment;
            history.replaceState(history.state, "", address.href);
          }
        }
        if (!entry) {
          mount.textContent = "没有找到这篇文稿。";
          return;
        }
        const work = parseWork(await readText(entry.file));
        renderRead(catalog, entry, work, covers);
      } else {
        const topic = catalog.topics.find(item => item.name === name);
        if (!topic) {
          mount.textContent = "没有找到这道题目。";
          return;
        }
        await renderPrompt(catalog, topic, readText);
      }
    } catch (error) {
      const detail = error && error.message ? "（" + error.message + "）" : "";
      const message = location.protocol === "file:" ? "请双击「打开网页.bat」或通过 GitHub Pages 打开本站。" : locationKey + "加载失败" + detail + "。";
      showProblem(mount, message, loadPage);
    } finally {
      mount.setAttribute("aria-busy", "false");
    }
  }

  function retryFailedLoad() { if (retryAction) retryAction(); }
  window.addEventListener("online", retryFailedLoad);
  window.addEventListener("pageshow", event => { if (event.persisted) retryFailedLoad(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryFailedLoad();
  });
  loadPage();
})();
