"""Index existing covers with content versions for local serving and tests."""

import hashlib
from pathlib import Path

EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg", ".avif", ".gif")


def build_cover_manifest(site_root):
    covers = {}
    directory = Path(site_root) / "assets" / "covers"
    if directory.is_dir():
        files = [path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in EXTENSIONS]
        files.sort(key=lambda path: (EXTENSIONS.index(path.suffix.lower()), path.name))
        for path in files:
            if path.stem in covers:
                continue
            try:
                version = hashlib.sha256(path.read_bytes()).hexdigest()
            except FileNotFoundError:
                # A cover may be renamed while the directory is being scanned.
                continue
            covers[path.stem] = {"file": path.name, "version": version}
    return {"covers": covers}
