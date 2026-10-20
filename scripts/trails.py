import json
import math
import time
import urllib.error
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
output = root / "assets" / "data" / "trails.json"
brouter = "https://brouter.de/brouter"

trails = {
    "utmb": [
        (45.9237, 6.8694), (45.8906, 6.7980), (45.8800, 6.7660), (45.8920, 6.7128), (45.8215, 6.7271),
        (45.7985, 6.7215), (45.7760, 6.7220), (45.7386, 6.7149), (45.7290, 6.7220), (45.6990, 6.7373),
        (45.7120, 6.7700), (45.7533, 6.8086), (45.7760, 6.8690), (45.7780, 6.8900), (45.7870, 6.9350),
        (45.7935, 6.9720), (45.8125, 6.9750), (45.8326, 7.0237), (45.8460, 7.0480), (45.8612, 7.0679),
        (45.8790, 7.0790), (45.8960, 7.0850), (45.9330, 7.0960), (45.9860, 7.0980), (46.0300, 7.1150),
        (46.0436, 7.0596), (46.0580, 7.0010), (46.0560, 6.9930), (46.0480, 6.9620), (46.0330, 6.9330),
        (46.0030, 6.9230), (45.9780, 6.9050), (45.9610, 6.8870), (45.9237, 6.8694),
    ],
    "diagonale des fous": [
        (-21.3430, 55.4620), (-21.3000, 55.5250), (-21.2700, 55.6000), (-21.2080, 55.6160), (-21.1750, 55.5650),
        (-21.1350, 55.5200), (-21.1100, 55.4850), (-21.1350, 55.4710), (-21.1110, 55.4520), (-21.1030, 55.4370),
        (-21.0770, 55.4430), (-21.0580, 55.4190), (-21.0300, 55.4300), (-21.0100, 55.4200), (-20.9950, 55.4300),
        (-20.9680, 55.4000), (-20.9400, 55.4200), (-20.9130, 55.4300), (-20.8840, 55.4440),
    ],
    "maxi-race": [
        (45.9010, 6.1340), (45.9100, 6.1750), (45.9130, 6.1830), (45.8940, 6.2140), (45.8600, 6.2300),
        (45.8150, 6.2470), (45.7750, 6.2180), (45.7700, 6.1700), (45.7980, 6.1050), (45.8500, 6.1150),
        (45.9010, 6.1340),
    ],
    "western states 100": [
        (39.1970, -120.2355), (39.1650, -120.2700), (39.1500, -120.3600), (39.1300, -120.4200), (39.1300, -120.4700),
        (39.1500, -120.5200), (39.1000, -120.6300), (39.0700, -120.6800), (39.0400, -120.7360), (39.0200, -120.8180),
        (38.9600, -120.9500), (38.9200, -121.0000), (38.9150, -121.0400), (38.9020, -121.0660),
    ],
    "lavaredo ultra trail": [
        (46.5370, 12.1350), (46.5940, 12.1770), (46.5850, 12.2280), (46.5820, 12.2530), (46.6125, 12.2950),
        (46.6200, 12.3070), (46.6320, 12.3040), (46.6360, 12.2300), (46.6200, 12.1400), (46.5190, 12.0100),
        (46.4830, 12.0540), (46.5000, 12.1000), (46.5370, 12.1350),
    ],
    "zegama-aizkorri": [
        (42.9750, -2.2900), (42.9580, -2.2670), (42.9300, -2.2800), (42.9580, -2.3330), (42.9600, -2.3800),
        (42.9750, -2.2900),
    ],
    "sierre-zinal": [
        (46.2930, 7.5340), (46.2700, 7.5900), (46.2520, 7.5920), (46.2300, 7.6100), (46.2050, 7.6320),
        (46.1500, 7.6300), (46.1340, 7.6270),
    ],
    "tor des géants": [
        (45.7935, 6.9720), (45.7160, 6.9510), (45.6300, 7.0640), (45.5700, 7.1190), (45.5750, 7.2080),
        (45.6080, 7.3550), (45.6000, 7.5500), (45.6030, 7.7660), (45.7760, 7.8260), (45.8770, 7.6240),
        (45.8510, 7.3810), (45.8480, 7.3110), (45.8200, 7.1800), (45.8600, 7.1000), (45.7935, 6.9720),
    ],
    "transvulcania": [
        (28.4570, -17.8440), (28.4870, -17.8490), (28.6120, -17.8350), (28.6950, -17.8480), (28.7545, -17.8846),
        (28.6800, -17.9380), (28.6400, -17.9420), (28.6590, -17.9130),
    ],
    "eiger ultra trail": [
        (46.6240, 8.0410), (46.6540, 8.1030), (46.6590, 8.0540), (46.6760, 7.9970), (46.6520, 7.9100),
        (46.6110, 7.9410), (46.5850, 7.9610), (46.6080, 8.0090), (46.6240, 8.0410),
    ],
}

decoys = [
    "ccc", "occ", "tds", "ptl", "mcc", "marathon du mont-blanc", "grand raid des pyrénées", "festival des templiers",
    "trail verbier saint-bernard", "ultra-trail mt. fuji", "ultra-trail cape town", "barkley marathons", "leadville 100",
    "badwater 135", "spartathlon", "comrades marathon", "transgrancanaria", "madeira island ultra trail", "penyagolosa trails",
    "istria 100", "mozart 100", "zugspitz ultratrail", "swiss irontrail", "échappée belle", "restonica trail",
    "andorra by utmb", "val d'aran by utmb", "trail du saint-jacques", "ultra trail du vercors", "hardrock 100",
    "golden trail series", "marathon des sables", "pikes peak marathon", "broken arrow skyrace", "matterhorn ultraks",
    "dolomyths run", "grossglockner ultra trail", "chianti ultra trail", "mont-blanc 90k", "trail des aiguilles rouges",
    "grand trail du saint-jacques", "ultra trail atlas toubkal", "patagonia run", "ultra-trail australia", "tarawera ultra",
]


def get(url, body=None):
    request = urllib.request.Request(url, data=body, method="POST" if body else "GET", headers={"User-Agent": "alpineintelco-trailfinder"})
    for wait in (0, 15, 45, 90):
        time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=30) as res:
                return json.load(res)
        except urllib.error.HTTPError as error:
            if error.code != 403:
                raise
    raise TimeoutError("rate limited")


profile = get(brouter + "/profile", (root / "assets" / "js" / "run.brf").read_bytes())["profileid"]


def route(a, b, depth=0):
    url = f"{brouter}?lonlats={a[1]},{a[0]}|{b[1]},{b[0]}&profile={profile}&alternativeidx=0&format=geojson"
    try:
        feature = get(url)["features"][0]
        time.sleep(1.5)
        return feature["geometry"]["coordinates"], float(feature["properties"]["filtered ascend"])
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as error:
        if depth >= 3:
            print("  straight", a, b, error)
            return [[a[1], a[0], 0], [b[1], b[0], 0]], 0
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        first, up = route(a, mid, depth + 1)
        second, more = route(mid, b, depth + 1)
        return first + second[1:], up + more


def metres(p, q):
    k = math.pi / 180
    h = math.sin((q[1] - p[1]) * k / 2) ** 2 + math.cos(p[1] * k) * math.cos(q[1] * k) * math.sin((q[0] - p[0]) * k / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))


def simplify(line, tolerance):
    lat = math.radians(sum(p[1] for p in line) / len(line))
    xy = [(p[0] * 111320 * math.cos(lat), p[1] * 110540) for p in line]
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        first, last = stack.pop()
        (ax, ay), (bx, by) = xy[first], xy[last]
        length = math.hypot(bx - ax, by - ay)
        far, index = 0, 0
        for i in range(first + 1, last):
            px, py = xy[i]
            d = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length if length else math.hypot(px - ax, py - ay)
            if d > far:
                far, index = d, i
        if far > tolerance:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(line, keep) if k]


result = []
for name, stops in trails.items():
    print(name)
    line, climb = [], 0
    for a, b in zip(stops, stops[1:]):
        part, up = route(a, b)
        line += part if not line else part[1:]
        climb += up
    km = sum(metres(p, q) for p, q in zip(line, line[1:])) / 1000
    short = simplify(line, 12)
    print(f"  {km:.0f} km, {climb:.0f} m, {len(line)} -> {len(short)} points")
    result.append({"name": name, "km": round(km), "climb": int(round(climb, -1)), "line": [[round(p[0], 5), round(p[1], 5)] for p in short]})

names = sorted({*trails, *decoys})
output.write_text(json.dumps({"trails": result, "names": names}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(output, output.stat().st_size)
