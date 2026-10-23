"""Serve NovellaArena and index covers directly from disk on every request."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
from urllib.parse import urlsplit

from cover_manifest import build_cover_manifest

ROOT = Path(__file__).resolve().parent.parent


class ArenaHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        if urlsplit(self.path).path == "/data/covers.json":
            manifest = build_cover_manifest(self.directory)
            payload = (json.dumps(manifest, ensure_ascii=False) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            return io.BytesIO(payload)
        return super().send_head()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    handler = partial(ArenaHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print("NovellaArena  http://127.0.0.1:%d/" % args.port, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
