"""Display metadata for the home page. The original TXT files remain authoritative."""

from functools import lru_cache
from pathlib import Path
import re


@lru_cache(maxsize=2048)
def _label(path, kind, revision):
    with path.open(encoding="utf-8-sig") as source:
        if kind == "references":
            match = re.fullmatch(r"[（(]\s*《([^《》]+)》.*[）)]", source.readline().strip())
            return match[1].strip() if match else ""
        first = next((line.strip() for line in source if line.strip()), "")
    if len(first.encode("utf-16-le")) > 44 or re.search(r"[。！？]$", first):
        return ""
    if re.match(r"^(?:第[一二三四五六七八九十百千万零〇两0-9]+(?:[章幕篇部]|部分)|序章|楔子|终章|后记|引子|尾声|序|跋)(?:$|[\s　·.、:：])|^[一二三四五六七八九十百零〇0-9]{1,3}$", first):
        return ""
    return first


def build_library_index(site_root):
    root = Path(site_root)
    index = {"titles": {}, "references": {}}
    for folder, kind in [("texts", "titles"), ("prompts", "references")]:
        for path in (root / folder).rglob("*.txt"):
            try:
                stat = path.stat()
                label = _label(path, kind, (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
            except (FileNotFoundError, UnicodeError):
                continue
            if label:
                index[kind][path.relative_to(root).as_posix()] = label
    return index
