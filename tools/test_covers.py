"""Run with: python tools/test_covers.py (standard library only)."""

from functools import partial
import hashlib
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import quote
from urllib.request import Request, urlopen

from cover_manifest import build_cover_manifest
from serve import ArenaHandler

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(ArenaHandler):
    def log_message(self, *args):
        pass


class CoverTests(unittest.TestCase):
    def test_static_index_matches_current_files(self):
        saved = json.loads((ROOT / "data" / "covers.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, build_cover_manifest(ROOT))
        for cover in saved["covers"].values():
            contents = (ROOT / "assets" / "covers" / cover["file"]).read_bytes()
            self.assertEqual(cover["version"], hashlib.sha256(contents).hexdigest())

    def test_format_priority_and_missing_directory(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(build_cover_manifest(root), {"covers": {}})
            directory = Path(root) / "assets" / "covers"
            directory.mkdir(parents=True)
            (directory / "题目.png").write_bytes(b"png")
            (directory / "题目.WEBP").write_bytes(b"webp")
            (directory / "ignored.txt").write_text("not a cover")
            manifest = build_cover_manifest(root)
            self.assertEqual(list(manifest["covers"]), ["题目"])
            self.assertEqual(manifest["covers"]["题目"]["file"], "题目.WEBP")

    def test_live_server_overwrite_rename_add_and_delete(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "assets" / "covers"
            directory.mkdir(parents=True)
            file = directory / "测试_Model_2610231000.webp"
            file.write_bytes(b"old-cover")
            handler = partial(QuietHandler, directory=root)
            with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                base = "http://127.0.0.1:%d/" % server.server_port

                def index():
                    with urlopen(base + "data/covers.json") as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                        return json.load(response)["covers"]

                try:
                    first = index()[file.stem]
                    stat = file.stat()
                    file.write_bytes(b"new-cover")
                    os.utime(file, ns=(stat.st_atime_ns, stat.st_mtime_ns))
                    second = index()[file.stem]
                    self.assertNotEqual(first["version"], second["version"])
                    path = "assets/covers/" + quote(second["file"]) + "?v=" + second["version"]
                    with urlopen(base + path) as response:
                        self.assertEqual(response.read(), b"new-cover")
                    with urlopen(Request(base + "data/covers.json", method="HEAD")) as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.read(), b"")
                    renamed = file.with_suffix(".png")
                    file.rename(renamed)
                    self.assertEqual(index()[file.stem]["file"], renamed.name)
                    extra = directory / "新增封面.gif"
                    extra.write_bytes(b"gif")
                    self.assertIn(extra.stem, index())
                    renamed.unlink()
                    self.assertNotIn(file.stem, index())
                    self.assertIn(extra.stem, index())
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
