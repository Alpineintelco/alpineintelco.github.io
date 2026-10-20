import json
import math
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
output = root / "assets" / "data" / "trails.json"
skip = {"PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"}

places = []
with open(sys.argv[1], encoding="utf-8") as source:
    for row in source:
        cell = row.rstrip("\n").split("\t")
        if cell[7] not in skip:
            places.append((int(cell[14] or 0), cell[1], float(cell[5]), float(cell[4])))
places.sort(reverse=True)


def frame(line):
    lngs = [p[0] for p in line]
    lats = [p[1] for p in line]
    west, east, south, north = min(lngs), max(lngs), min(lats), max(lats)
    kx = math.cos(math.radians((south + north) / 2))
    wide, tall = (east - west) * kx, north - south
    side = max(wide, tall)
    need_wide = max(wide, side * 0.7) / 2 + side * 0.15
    need_tall = max(tall, side * 0.7) / 2 + side * 0.15
    cx, cy = (west + east) / 2, (south + north) / 2
    return cx - need_wide / kx, cy - need_tall, cx + need_wide / kx, cy + need_tall


data = json.loads(output.read_text(encoding="utf-8"))
for trail in data["trails"]:
    west, south, east, north = frame(trail["line"])
    trail["towns"] = [[name, round(lng, 4), round(lat, 4)] for _, name, lng, lat in places if west < lng < east and south < lat < north][:40]
    print(trail["name"], len(trail["towns"]), ", ".join(t[0] for t in trail["towns"][:10]))

output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(output, output.stat().st_size)
