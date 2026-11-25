import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from library_index import build_library_index


class LibraryIndexTests(unittest.TestCase):
    def test_committed_index_matches_published_texts(self):
        root = Path(__file__).resolve().parents[1]
        saved = json.loads((root / "data/library-index.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, build_library_index(root))

    def test_local_preview_tracks_edits_additions_and_removals(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "texts").mkdir()
            (root / "prompts").mkdir()
            work = root / "texts/作品.txt"
            prompt = root / "prompts/题目.txt"
            work.write_text("\ufeff\n短标题\n第一章\n正文", encoding="utf-8")
            prompt.write_text("（《参考作品》，收录于文集）\n题目", encoding="utf-8")
            self.assertEqual(build_library_index(root), {
                "titles": {"texts/作品.txt": "短标题"},
                "references": {"prompts/题目.txt": "参考作品"},
            })
            work.write_text("第一章\n正文", encoding="utf-8")
            prompt.unlink()
            self.assertEqual(build_library_index(root), {"titles": {}, "references": {}})


if __name__ == "__main__":
    unittest.main()
