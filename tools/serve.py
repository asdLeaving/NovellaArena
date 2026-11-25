"""Preview a NovellaArena folder on a stable local origin."""

import argparse
import errno
from functools import partial
import hashlib
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
import webbrowser

from cover_manifest import build_cover_manifest
from library_index import build_library_index

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
IDENTITY_PATH = "/.well-known/novellaarena-preview"


def folder_id(directory):
    canonical = os.path.normcase(str(Path(directory).resolve()))
    return hashlib.sha256(os.fsencode(canonical)).hexdigest()


class PreviewServer(ThreadingHTTPServer):
    # Windows permits two listeners on one address when SO_REUSEADDR is set.
    allow_reuse_address = os.name != "nt"
    allow_reuse_port = False


class ArenaHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        path = urlsplit(self.path).path
        if path == IDENTITY_PATH:
            self.send_response(204)
            self.send_header("X-NovellaArena-Folder", folder_id(self.directory))
            self.end_headers()
            return None
        manifests = {"/data/covers.json": build_cover_manifest, "/data/library-index.json": build_library_index}
        build = manifests.get(path)
        if build:
            manifest = build(self.directory)
            payload = (json.dumps(manifest, ensure_ascii=False) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            return io.BytesIO(payload)
        return super().send_head()


def serving_folder(port, identity):
    connection = HTTPConnection(HOST, port, timeout=1)
    try:
        connection.request("HEAD", IDENTITY_PATH)
        response = connection.getresponse()
        return response.status == 204 and response.getheader("X-NovellaArena-Folder") == identity
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()


def preview_ports(directory, identity):
    # Remember a collision fallback so the saved draft keeps its origin on restart.
    cache = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    state = cache / "NovellaArena" / "preview-ports" / (identity + ".port")
    default = 8765 if directory.name.casefold() == "novellaarena" else None
    first = int(identity[:8], 16) % 30000
    candidates = ([default] if default else []) + [15000 + (first + n) % 30000 for n in range(16)]
    try:
        previous = int(state.read_text(encoding="ascii"))
        if previous in candidates:
            candidates = [previous] + [port for port in candidates if port != previous]
    except (OSError, ValueError):
        pass
    return candidates, state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, help="Explicit port (0 chooses a temporary free port)")
    parser.add_argument("--open", action="store_true", help="Open the preview in the default browser")
    args = parser.parse_args()
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    identity = folder_id(ROOT)
    candidates, state = preview_ports(ROOT, identity) if args.port is None else ([args.port], None)
    handler = partial(ArenaHandler, directory=str(ROOT))
    for port in candidates:
        server = None
        try:
            server = PreviewServer((HOST, port), handler)
            port = server.server_port
        except OSError as error:
            if error.errno not in (errno.EADDRINUSE, errno.EACCES):
                raise
            if not serving_folder(port, identity):
                continue
        if state is not None and port != candidates[0]:
            try:
                state.parent.mkdir(parents=True, exist_ok=True)
                state.write_text(str(port), encoding="ascii")
            except OSError:
                pass
        url = f"http://{HOST}:{port}/"
        print("NovellaArena  " + url, flush=True)
        try:
            if args.open:
                webbrowser.open(url)
            if server is not None:
                server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if server is not None:
                server.server_close()
        return 0
    print("No preview port is available for this folder. Try another --port.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
