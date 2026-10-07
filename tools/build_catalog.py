# -*- coding: utf-8 -*-
"""从文稿目录和 Cursor 对话记录生成 NovellaArena 的 catalog、正文副本和 prompt。

可重复运行。已有条目的 grade 会保留；若条目带 manual 标记，effort 与 harness 也保留。
已有模型的 hidden 会保留。新出现的模型：发布日期留空，或晚于当时默认显示模型发布日期的中位数，则 hidden 为 false，否则为 true。
题目若带 promptManual，则不覆盖其 prompt 文件。
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent
TRANSCRIPTS = Path(
    r"C:\Users\Lenovo\.cursor\projects\c-Users-Lenovo-Documents-writing\agent-transcripts"
)

FILE_RE = re.compile(r"^([^_]+)_([^_]+)_(\d{10})\.txt$")

ALIASES = {
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
    "qwen 3.8 max": "Qwen 3.8 Max",
}

RELEASED = {
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
    "Kimi K3": "2026-07-16",
}

TOKEN = {
    "gpt": "GPT",
    "claude": "Claude",
    "grok": "Grok",
    "opus": "Opus",
    "fable": "Fable",
    "sonnet": "Sonnet",
    "haiku": "Haiku",
    "sol": "Sol",
    "astra": "Astra",
    "luna": "Luna",
    "terra": "Terra",
    "flash": "Flash",
    "max": "Max",
    "deepseek": "DeepSeek",
    "qwen": "Qwen",
    "gemini": "Gemini",
    "kimi": "Kimi",
    "mythos": "Mythos",
}


def canonical_model(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"网页.*$", "", s).strip()
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    s = re.sub(r"[_\-]+", " ", s)
    s = re.sub(r"([A-Za-z]{2,})(\d)", r"\1 \2", s)
    s = re.sub(r"(\d)([A-Za-z])", r"\1 \2", s)
    s = re.sub(r"\s+", " ", s).strip()
    key = s.lower()
    if key in ALIASES:
        return ALIASES[key]
    parts = []
    for tok in s.split(" "):
        low = tok.lower()
        if low in TOKEN:
            parts.append(TOKEN[low])
        elif re.fullmatch(r"\d+(?:\.\d+)*", tok):
            parts.append(tok)
        elif re.fullmatch(r"[Vv]\d.*", tok):
            parts.append("V" + tok[1:])
        elif tok:
            parts.append(tok[0].upper() + tok[1:])
    return " ".join(parts)


def expand_time(ts10: str) -> str | None:
    yy, mm, dd = int(ts10[0:2]), int(ts10[2:4]), int(ts10[4:6])
    hh, mi = int(ts10[6:8]), int(ts10[8:10])
    if not (1 <= mm <= 12 and 1 <= dd <= 31 and 0 <= hh <= 23 and 0 <= mi <= 59):
        return None
    return f"20{yy:02d}{mm:02d}{dd:02d}{hh:02d}{mi:02d}"


def cursor_effort(model: str) -> str:
    if model.startswith("Claude "):
        return "high"
    if model.startswith("GPT ") or model.startswith("Grok "):
        return "xhigh"
    return "max"


def harness_effort(model: str, time12: str) -> tuple[str, str]:
    if model.startswith("GPT ") and "202610031200" <= time12 < "202610041200":
        return "codex", "medium"
    if model.startswith("GPT ") and time12 >= "202610041200":
        return "codex", "high"
    return "cursor", cursor_effort(model)


REF_FILE = re.compile(
    r"[A-Za-z]:\\(?:[^\\/:*?\"<>|\r\n]+\\)*[^\\/:*?\"<>|\r\n]+?\.(?:xhtml|html|txt|pdf|epub|md)"
    r"|(?<![\w./\\])([\w\u4e00-\u9fff.\-]+\.(?:xhtml|html|txt|pdf|epub|md))",
    re.IGNORECASE,
)


def reference_label(filename: str) -> str:
    base = filename.replace("/", "\\").split("\\")[-1]
    stem = re.sub(r"\.(?:xhtml|html|txt|pdf|epub|md)$", "", base, flags=re.IGNORECASE).strip()
    compact = re.sub(r"[^A-Za-z]", "", stem).lower()
    if compact == "goodoldneon":
        return "Good Old Neon"
    return stem


def redact_prompt(text: str) -> str:
    """去掉贴入的参考文本和本地路径，改在开头标出作品名。"""
    labels: list[str] = []

    def take(match: re.Match[str]) -> str:
        raw = match.group(0)
        if any(token in raw for token in ("所用模型", "时间戳", "yymmdd", "{")):
            return raw
        labels.append(reference_label(raw))
        return ""

    body = REF_FILE.sub(take, text)
    body = body.replace("参考 的风格", "参考其风格").replace("参考的风格", "参考其风格")
    body = re.sub(r"[ \t]{2,}", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    seen: list[str] = []
    for label in labels:
        if label and label not in seen:
            seen.append(label)
    if not seen:
        return body
    return "".join(f"（{label}）" for label in seen) + "\n" + body


def parse_stamp(text: str) -> datetime:
    m = re.search(
        r"([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)",
        text,
    )
    if not m:
        return datetime.min
    month = datetime.strptime(m.group(1)[:3], "%b").month
    hour = int(m.group(4)) % 12
    if m.group(6) == "PM":
        hour += 12
    return datetime(int(m.group(3)), month, int(m.group(2)), hour, int(m.group(5)))


def stamp_label(dt: datetime) -> str:
    if dt == datetime.min:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M")


def is_prompt_for(topic: str, query: str) -> bool:
    if topic == "分析者（大纲）":
        return "分析者_大纲" in query
    if topic == "分析者（部分）":
        return "分析者" in query and ("前三部分" in query or "第一部分" in query) and "分析者_大纲" not in query
    if topic == "分析者":
        if "分析者_大纲" in query or "前三部分" in query or "第一部分" in query:
            return False
        return ("输出分析者_" in query) or ("保存为分析者_" in query)
    return (f"输出{topic}_" in query) or (f"保存为{topic}_" in query)


def load_queries() -> list[tuple[datetime, str]]:
    rows: list[tuple[datetime, str]] = []
    if not TRANSCRIPTS.exists():
        print("未找到对话记录目录，prompt 将留空。")
        return rows
    for path in TRANSCRIPTS.glob("*/*.jsonl"):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if '"role"' not in line or "user" not in line[:80]:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("role") != "user":
                    continue
                content = obj.get("message", {}).get("content", [])
                texts: list[str] = []
                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            texts.append(part.get("text") or "")
                        elif isinstance(part, str):
                            texts.append(part)
                elif isinstance(content, str):
                    texts.append(content)
                text = "\n".join(texts)
                match = re.search(r"<user_query>\s*(.*?)\s*</user_query>", text, re.S)
                query = match.group(1).strip() if match else ""
                if not query:
                    continue
                stamp = re.search(r"<timestamp>(.*?)</timestamp>", text)
                when = parse_stamp(stamp.group(1) if stamp else "")
                rows.append((when, query))
    rows.sort(key=lambda item: item[0])
    return rows


def latest_prompts(topics: list[str], queries: list[tuple[datetime, str]]) -> dict[str, tuple[datetime, str]]:
    found: dict[str, tuple[datetime, str]] = {}
    for when, query in queries:
        for topic in topics:
            if is_prompt_for(topic, query):
                found[topic] = (when, query)
    return found


def load_old() -> dict:
    path = ROOT / "data" / "catalog.json"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _release_day(value: str):
    try:
        return datetime.strptime((value or "").strip(), "%Y-%m-%d").toordinal()
    except ValueError:
        return None


def visible_release_median(models) -> float | None:
    days = []
    for item in models:
        if item.get("hidden"):
            continue
        day = _release_day(str(item.get("released") or ""))
        if day is not None:
            days.append(day)
    if not days:
        return None
    days.sort()
    mid = len(days) // 2
    if len(days) % 2 == 1:
        return float(days[mid])
    return (days[mid - 1] + days[mid]) / 2


def hidden_for_new_model(released: str, median: float | None) -> bool:
    day = _release_day(released)
    if day is None or median is None:
        return False
    return not (day > median)


def main() -> None:
    manuscripts = []
    for path in sorted(SOURCE.glob("*.txt")):
        match = FILE_RE.match(path.name)
        if not match:
            continue
        topic, model_raw, ts10 = match.group(1), match.group(2), match.group(3)
        if "网页" in model_raw:
            continue
        time12 = expand_time(ts10)
        if not time12:
            print("跳过无法解析的时间戳:", path.name)
            continue
        model = canonical_model(model_raw)
        manuscripts.append(
            {
                "topic": topic,
                "model": model,
                "time": time12,
                "source": path,
            }
        )

    if not manuscripts:
        raise SystemExit("没有找到符合命名规则的文稿。")

    topics = sorted({item["topic"] for item in manuscripts}, key=lambda name: min(i["time"] for i in manuscripts if i["topic"] == name))
    names = {item["model"] for item in manuscripts}
    undated = sorted(name for name in names if not RELEASED.get(name))
    dated = sorted(name for name in names if RELEASED.get(name))
    dated.sort(key=lambda name: RELEASED[name], reverse=True)
    model_names = undated + dated
    queries = load_queries()
    prompts = latest_prompts(topics, queries)

    old = load_old()
    old_entries = {item["id"]: item for item in old.get("entries", [])}
    old_topics = {item["name"]: item for item in old.get("topics", [])}

    texts_dir = ROOT / "texts"
    prompts_dir = ROOT / "prompts"
    texts_dir.mkdir(parents=True, exist_ok=True)
    prompts_dir.mkdir(parents=True, exist_ok=True)
    (ROOT / "data").mkdir(parents=True, exist_ok=True)

    kept_names = {item["source"].name for item in manuscripts}
    for existing in texts_dir.glob("*.txt"):
        if existing.name not in kept_names:
            existing.unlink()

    entries = []
    for item in sorted(manuscripts, key=lambda row: (row["time"], row["topic"], row["model"])):
        filename = item["source"].name
        entry_id = filename[:-4]
        dest = texts_dir / filename
        shutil.copyfile(item["source"], dest)
        harness, effort = harness_effort(item["model"], item["time"])
        previous = old_entries.get(entry_id, {})
        grade = previous.get("grade", "")
        if previous.get("manual"):
            harness = previous.get("harness", harness)
            effort = previous.get("effort", effort)
        entries.append(
            {
                "id": entry_id,
                "topic": item["topic"],
                "model": item["model"],
                "time": item["time"],
                "effort": effort,
                "harness": harness,
                "grade": grade if grade in ("", "A", "B", "C", "D", "E") else "",
                "file": f"texts/{filename}",
                "manual": bool(previous.get("manual")),
            }
        )

    topic_rows = []
    for name in topics:
        previous = old_topics.get(name, {})
        grade = previous.get("grade", "")
        if grade not in ("", "A", "B", "C", "D", "E"):
            grade = ""
        prompt_file = f"prompts/{name}.txt"
        manual_prompt = bool(previous.get("promptManual"))
        if name in prompts and not manual_prompt:
            when, text = prompts[name]
            (prompts_dir / f"{name}.txt").write_text(redact_prompt(text).strip() + "\n", encoding="utf-8")
            prompt_at = stamp_label(when)
        elif manual_prompt and (ROOT / prompt_file).exists():
            prompt_at = previous.get("promptAt", "")
        else:
            prompt_file = ""
            prompt_at = ""
            if name not in prompts:
                print("未找到 prompt:", name)
        row = {
            "name": name,
            "grade": grade,
            "promptFile": prompt_file,
            "promptAt": prompt_at,
        }
        if manual_prompt:
            row["promptManual"] = True
        topic_rows.append(row)

    old_models = {item["name"]: item for item in old.get("models", [])}
    median = visible_release_median(old.get("models", []))
    model_rows = []
    for name in model_names:
        previous_model = old_models.get(name)
        if previous_model is not None:
            hidden = bool(previous_model.get("hidden"))
        else:
            hidden = hidden_for_new_model(RELEASED.get(name, ""), median)
        model_rows.append({"name": name, "released": RELEASED.get(name, ""), "hidden": hidden})

    catalog = {
        "legend": "grade 留空为未定（灰色）。A 深绿，B 浅绿，C 浅黄，D 浅红，E 深红。题目的 grade 是主观复杂度，文稿的 grade 是生成质量。harness 为 cursor 时，Claude 系 effort 为 high，GPT 与 Grok 为 xhigh，其余模型为 max。10月3日12:00至10月4日12:00前的 GPT 文稿为 codex / medium，10月4日12:00及之后的 GPT 文稿为 codex / high。题目按 topics 数组的现有顺序展示。模型列自动排序：发布日期留空的排在最左，其余按发布日期从新到旧向右排。models 的 hidden 为 true 时该列默认隐藏。新模型导入时，发布日期留空或晚于当时默认显示模型发布日期的中位数则为 false，否则为 true；已有模型再导入不改 hidden。把某条文稿的 manual 设为 true 后，重新建站不会覆盖它的 effort 和 harness。题目若带 promptManual，重新建站不会覆盖它的 prompt。",
        "topics": topic_rows,
        "models": model_rows,
        "entries": entries,
    }
    out = ROOT / "data" / "catalog.json"
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"文稿 {len(entries)} 篇，题目 {len(topic_rows)} 道，模型 {len(model_names)} 个")
    print("模型列:", " | ".join(model_names))
    print("题目行:", " | ".join(topics))
    for row in topic_rows:
        text = ""
        if row["promptFile"]:
            text = (ROOT / row["promptFile"]).read_text(encoding="utf-8")
        print(f"  prompt {row['name']}: {row['promptAt'] or '无'} ({len(text)} 字)")


if __name__ == "__main__":
    main()
