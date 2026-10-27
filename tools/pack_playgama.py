"""Zip game/dist/ for the Playgama console: index.html at the archive's root, files only.

usage: python tools/pack_playgama.py [out.zip]   (default: release/snowfort-playgama.zip)

Python's zipfile on purpose: a Compress-Archive zip (directory entries, backslashes) fails
Bridge's upload check. Run `npm run build` first; `npm run pack` does both.
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "game", "dist")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "release", "snowfort-playgama.zip")
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        sys.exit("game/dist/index.html missing: run `npm run build` first")
    html = open(os.path.join(DIST, "index.html"), encoding="utf8").read()
    if "bridge.playgama.com" not in html:
        sys.exit("index.html has no Playgama Bridge script")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(DIST):
            for name in sorted(files):
                path = os.path.join(folder, name)
                z.write(path, os.path.relpath(path, DIST).replace(os.sep, "/"))
                count += 1
    print(f"{out}: {count} files, {os.path.getsize(out) / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
