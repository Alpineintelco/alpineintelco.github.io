import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root.parent.parent / "Photos"
output = root / "assets" / "gallery"
page = root / "index.html"
extensions = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".tif", ".tiff"}

output.mkdir(parents=True, exist_ok=True)
photos = sorted(
    (p for p in source.iterdir() if p.suffix.lower() in extensions),
    key=lambda p: p.stat().st_mtime,
    reverse=True,
)

names = []
for photo in photos:
    name = photo.stem.lower() + ".jpg"
    target = output / name
    if not target.exists() or target.stat().st_mtime < photo.stat().st_mtime:
        subprocess.run(
            ["sips", "-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "75", str(photo), "--out", str(target)],
            check=True,
            capture_output=True,
        )
    names.append(name)

for old in output.glob("*.jpg"):
    if old.name not in names:
        old.unlink()

count = len(names)


def layout(width, height):
    best = (1, max(count, 1), 0)
    for cols in range(1, max(count, 1) + 1):
        rows = -(-max(count, 1) // cols)
        tile = min(width / cols, height / rows * 4 / 3)
        if tile > best[2]:
            best = (cols, rows, tile)
    return best[:2]


cd, rd = layout(1376, 700)
cm, rm = layout(350, 600)
thumbs = "".join(f'\n          <img src="assets/gallery/{n}" alt="" loading="lazy">' for n in names)
content = (
    '\n      <div class="photos-wrap">'
    f'\n        <div class="photos" style="--cd: {cd}; --rd: {rd}; --cm: {cm}; --rm: {rm}">' + thumbs + '\n        </div>'
    '\n      </div>\n    '
)
html = page.read_text()
html = re.sub(r'(<section id="gallery">).*?(</section>)', lambda m: m.group(1) + content + m.group(2), html, flags=re.S)
page.write_text(html)
print(f"{len(names)} photos in gallery")
