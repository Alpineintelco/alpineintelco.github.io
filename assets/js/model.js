const exaggeration = 1.6;
const maplibre = "https://cdn.jsdelivr.net/npm/maplibre-gl@6.14.0/dist/maplibre-gl.mjs";
const fill = (id, layer, classes, color) => ({
  id,
  type: "fill",
  source: "openmaptiles",
  "source-layer": layer,
  filter: ["in", ["get", "class"], ["literal", classes]],
  paint: { "fill-color": color, "fill-antialias": false },
});
const look = (colors) => ({
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": colors.ground } },
    fill("town", "landuse", ["residential", "suburb", "neighbourhood", "commercial", "industrial", "retail"], colors.town),
    fill("grass", "landcover", ["grass", "farmland", "wetland"], colors.grass),
    fill("rock", "landcover", ["rock", "sand"], colors.rock),
    fill("wood", "landcover", ["wood"], colors.wood),
    fill("ice", "landcover", ["ice"], colors.ice),
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": colors.water } },
    {
      id: "river",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      filter: ["in", ["get", "class"], ["literal", ["river", "stream"]]],
      paint: { "line-color": colors.water, "line-width": ["match", ["get", "class"], "river", colors.river, colors.river * 0.4] },
    },
  ],
});
const sober = look({ ground: "#ece7de", town: "#e0d9cd", grass: "#e5e4d6", rock: "#e2dfd9", wood: "#b8c9a3", ice: "#f7f9f9", water: "#b8c4c7", river: 2 });
const highland = { meadow: "#b5d872", rock: "#d8cdbb", from: 1900, to: 2500 };
const cartoon = look({ ground: highland.meadow, town: "#f0c79b", grass: "#a3d064", rock: "#d8cdbb", wood: "#4c9a45", ice: "#ffffff", water: "#4cb2e6", river: 3 });

function mx(lng) {
  return (lng + 180) / 360;
}

function my(lat) {
  return (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
}

async function paint([west, south, east, north], style) {
  const { Map } = await import(maplibre);
  const w = 2048;
  const h = Math.round((w * (my(south) - my(north))) / (mx(east) - mx(west)));
  const holder = document.createElement("div");
  holder.style.cssText = `position: fixed; left: -99999px; top: 0; width: ${w}px; height: ${h}px`;
  document.body.append(holder);
  const map = new Map({
    container: holder,
    style,
    bounds: [west, south, east, north],
    fitBoundsOptions: { padding: 0 },
    pixelRatio: 1,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  await new Promise((resolve) => {
    map.once("idle", resolve);
    setTimeout(resolve, 20000);
  });
  const canvas = document.createElement("canvas");
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
  canvas.getContext("2d").drawImage(map.getCanvas(), 0, 0);
  map.remove();
  holder.remove();
  return canvas;
}
function alpine(canvas, height, [west, south, east, north]) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [meadow, rock] = [rgb(highland.meadow), rgb(highland.rock)];
  const pen = canvas.getContext("2d");
  const image = pen.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let j = 0; j < canvas.height; j++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * (my(north) + ((my(south) - my(north)) * (j + 0.5)) / canvas.height)))) * 180) / Math.PI;
    for (let i = 0; i < canvas.width; i++) {
      const k = (j * canvas.width + i) * 4;
      if (data[k] !== meadow[0] || data[k + 1] !== meadow[1] || data[k + 2] !== meadow[2]) continue;
      const t = Math.min(Math.max((height(west + ((east - west) * (i + 0.5)) / canvas.width, lat) - highland.from) / (highland.to - highland.from), 0), 1);
      for (let c = 0; c < 3; c++) data[k + c] = meadow[c] + (rock[c] - meadow[c]) * t;
    }
  }
  pen.putImageData(image, 0, 0);
  return canvas;
}

export function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function gauge(detail) {
  detail.nextElementSibling.textContent = `${detail.value}%`;
  detail.style.setProperty("--fill", `${((detail.value - detail.min) / (detail.max - detail.min)) * 100}%`);
}

export function keep(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function simplify(line, tolerance, kx, ky) {
  const keep = new Array(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = [line[first][0] * kx, line[first][1] * ky];
    const [bx, by] = [line[last][0] * kx, line[last][1] * ky];
    const length = Math.hypot(bx - ax, by - ay);
    let [far, index] = [0, 0];
    for (let i = first + 1; i < last; i++) {
      const [px, py] = [line[i][0] * kx, line[i][1] * ky];
      const d = length ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay);
      if (d > far) [far, index] = [d, i];
    }
    if (far > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

function unspike(line, kx, ky) {
  let changed = true;
  while (changed && line.length > 3) {
    changed = false;
    for (let i = 1; i < line.length - 1; i++) {
      const [ux, uy] = [(line[i][0] - line[i - 1][0]) * kx, (line[i][1] - line[i - 1][1]) * ky];
      const [vx, vy] = [(line[i + 1][0] - line[i][0]) * kx, (line[i + 1][1] - line[i][1]) * ky];
      if ((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1) < -0.8) {
        line = line.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return line;
}

function soften(line, rounds) {
  for (let round = 0; round < rounds; round++) {
    const next = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const [[ax, ay], [bx, by]] = [line[i], line[i + 1]];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(line[line.length - 1]);
    line = next;
  }
  return line;
}

function extent(line) {
  const lngs = line.map((p) => p[0]);
  const lats = line.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function frameOf([west, south, east, north]) {
  const kx = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const wide = (east - west) * kx;
  const tall = north - south;
  const side = Math.max(wide, tall);
  const margin = side * 0.15;
  const needWide = Math.max(wide, side * 0.7) / 2 + margin;
  const needTall = Math.max(tall, side * 0.7) / 2 + margin;
  const [cx, cy] = [(west + east) / 2, (south + north) / 2];
  return [cx - needWide / kx, cy - needTall, cx + needWide / kx, cy + needTall];
}

async function terrain([west, south, east, north], zoom = Math.min(14, Math.max(8, Math.round(Math.log2((4500 * 360) / ((east - west) * 512)))))) {
  const scale = 2 ** zoom * 512;
  const px = (lng) => ((lng + 180) / 360) * scale;
  const py = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * scale;
  const [x0, x1, y0, y1] = [Math.floor(px(west) / 512), Math.floor(px(east) / 512), Math.floor(py(north) / 512), Math.floor(py(south) / 512)];
  const canvas = new OffscreenCanvas((x1 - x0 + 1) * 512, (y1 - y0 + 1) * 512);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "rgb(128, 0, 0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  await Promise.all(
    tiles.map(async ([x, y]) => {
      try {
        const res = await fetch(`https://tiles.mapterhorn.com/${zoom}/${x}/${y}.webp`);
        if (!res.ok) return;
        const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        ctx.drawImage(bitmap, (x - x0) * 512, (y - y0) * 512);
      } catch {}
    }),
  );
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const at = (i, j) => {
    const k = (j * canvas.width + i) * 4;
    return data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
  };
  return (lng, lat) => {
    const x = Math.min(Math.max(px(lng) - x0 * 512, 0), canvas.width - 1.001);
    const y = Math.min(Math.max(py(lat) - y0 * 512, 0), canvas.height - 1.001);
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - i, y - j];
    return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  };
}

function bake(height, [west, south, east, north], scale) {
  const canvas = document.createElement("canvas");
  const [w, h] = [4096, Math.round((4096 * (my(south) - my(north))) / (mx(east) - mx(west)))];
  [canvas.width, canvas.height] = [w, h];
  const lngs = Array.from({ length: w }, (_, i) => west + ((east - west) * i) / (w - 1));
  const lats = Array.from({ length: h }, (_, j) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * (my(north) + ((my(south) - my(north)) * j) / (h - 1))))) * 180) / Math.PI);
  const grid = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) grid[j * w + i] = Math.max(height(lngs[i], lats[j]), 0) * scale.y;
  const image = canvas.getContext("2d").createImageData(w, h);
  const data = image.data;
  for (let j = 0; j < h; j++) {
    const [up, down] = [Math.max(j - 1, 0), Math.min(j + 1, h - 1)];
    const dz = (lats[up] - lats[down]) * scale.z;
    for (let i = 0; i < w; i++) {
      const [left, right] = [Math.max(i - 1, 0), Math.min(i + 1, w - 1)];
      const dx = (lngs[right] - lngs[left]) * scale.x;
      const nx = -(grid[j * w + right] - grid[j * w + left]) / dx;
      const nz = -(grid[down * w + i] - grid[up * w + i]) / dz;
      const length = Math.hypot(nx, 1, nz);
      const k = (j * w + i) * 4;
      data[k] = ((nx / length) * 0.5 + 0.5) * 255;
      data[k + 1] = ((1 / length) * 0.5 + 0.5) * 255;
      data[k + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  }
  canvas.getContext("2d").putImageData(image, 0, 0);
  return canvas;
}

function blur(height, [west, south, east, north], cols, rows, radius) {
  let grid = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) grid[r * cols + c] = Math.max(height(west + ((east - west) * c) / (cols - 1), north - ((north - south) * r) / (rows - 1)), 0);
  for (let pass = 0; pass < 3; pass++) {
    for (const [n, m, stride, jump] of [[cols, rows, 1, cols], [rows, cols, cols, 1]]) {
      const next = new Float32Array(grid.length);
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let d = -radius; d <= radius; d++) sum += grid[j * jump + Math.min(Math.max(i + d, 0), n - 1) * stride];
          next[j * jump + i * stride] = sum / (2 * radius + 1);
        }
      }
      grid = next;
    }
  }
  return (lng, lat) => {
    const x = Math.min(Math.max(((lng - west) / (east - west)) * (cols - 1), 0), cols - 1.001);
    const y = Math.min(Math.max(((north - lat) / (north - south)) * (rows - 1), 0), rows - 1.001);
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - i, y - j];
    const at = (c, r) => grid[r * cols + c];
    return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  };
}

function shrink(canvas, size) {
  if (size >= canvas.width) return canvas;
  const small = document.createElement("canvas");
  small.width = size;
  small.height = Math.round((size * canvas.height) / canvas.width);
  const pen = small.getContext("2d");
  pen.imageSmoothingQuality = "high";
  pen.drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}

async function shore(line) {
  const [west, south, east, north] = extent(line);
  const box = [west - (east - west), south - (north - south), east + (east - west), north + (north - south)];
  const height = await terrain(box, Math.min(12, Math.max(5, Math.round(Math.log2((1024 * 360) / ((box[2] - box[0]) * 512))))));
  const n = 200;
  const land = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) land[r * n + c] = height(box[0] + ((box[2] - box[0]) * c) / (n - 1), box[3] - ((box[3] - box[1]) * r) / (n - 1)) > 1;
  const stack = line.map(([lng, lat]) => Math.round(((box[3] - lat) / (box[3] - box[1])) * (n - 1)) * n + Math.round(((lng - box[0]) / (box[2] - box[0])) * (n - 1))).filter((k) => land[k]);
  if (!stack.length) return [west, south, east, north];
  const seen = new Uint8Array(n * n);
  let [c0, c1, r0, r1] = [n, 0, n, 0];
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || !land[k]) continue;
    seen[k] = 1;
    const [r, c] = [Math.floor(k / n), k % n];
    if (r === 0 || c === 0 || r === n - 1 || c === n - 1) return [west, south, east, north];
    [c0, c1, r0, r1] = [Math.min(c0, c), Math.max(c1, c), Math.min(r0, r), Math.max(r1, r)];
    stack.push(k - 1, k + 1, k - n, k + n);
  }
  const lng = (c) => box[0] + ((box[2] - box[0]) * c) / (n - 1);
  const lat = (r) => box[3] - ((box[3] - box[1]) * r) / (n - 1);
  return [Math.min(west, lng(c0 - 1)), Math.min(south, lat(r1 + 1)), Math.max(east, lng(c1 + 1)), Math.max(north, lat(r0 - 1))];
}

function contour(material, step, strength, lowest = -1e6) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.spacing = { value: step };
    shader.uniforms.strength = { value: strength };
    shader.uniforms.lowest = { value: lowest };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float level;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nlevel = position.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float level;\nuniform float spacing;\nuniform float strength;\nuniform float lowest;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nfloat h = level / spacing;\nfloat edge = abs(fract(h - 0.5) - 0.5) / fwidth(h);\ngl_FragColor.rgb *= h > lowest ? mix(strength, 1.0, min(edge, 1.0)) : 1.0;",
      );
  };
  return material;
}

export async function kit() {
  const [THREE, { OrbitControls }, { Line2 }, { LineMaterial }, { LineGeometry }, { LineSegments2 }, { LineSegmentsGeometry }, { CSS2DRenderer, CSS2DObject }] = await Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
    import("three/addons/lines/Line2.js"),
    import("three/addons/lines/LineMaterial.js"),
    import("three/addons/lines/LineGeometry.js"),
    import("three/addons/lines/LineSegments2.js"),
    import("three/addons/lines/LineSegmentsGeometry.js"),
    import("three/addons/renderers/CSS2DRenderer.js"),
  ]);
  return { THREE, OrbitControls, Line2, LineMaterial, LineGeometry, LineSegments2, LineSegmentsGeometry, CSS2DRenderer, CSS2DObject };
}

export async function build({ THREE, OrbitControls, Line2, LineMaterial, LineGeometry, LineSegments2, LineSegmentsGeometry, CSS2DRenderer, CSS2DObject }, trail, { stage, detail, named, toon, skirt }) {
  const bounds = frameOf(await shore(trail.line));
  const [west, south, east, north] = bounds;
  const [height, picture] = await Promise.all([terrain(bounds), paint(bounds, sober)]);
  const ending = new AbortController();
  const { signal } = ending;
  const [lng0, lat0] = [(west + east) / 2, (south + north) / 2];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const unit = 100 / Math.max((east - west) * kx, (north - south) * ky);
  const at = (lng, lat, e) => new THREE.Vector3((lng - lng0) * kx * unit, e * unit * exaggeration, -(lat - lat0) * ky * unit);
  const gentle = blur(height, bounds, 600, Math.round((600 * (north - south) * ky) / ((east - west) * kx)), 1);
  const cartoonish = () => (toon.type === "checkbox" ? toon.checked : toon.value === "cartoon");
  const say = (text) => {
    if (toon.type === "checkbox") toon.nextElementSibling.textContent = text;
  };
  const ground = () => (cartoonish() ? gentle : height);

  let base;
  let sharp;
  const made = new Map();
  const mould = (percent, relief) => {
    const key = relief === height ? percent : `${percent} cartoon`;
    const kept = made.get(key);
    if (kept) {
      made.delete(key);
      made.set(key, kept);
      return kept;
    }
    const t = (percent - 10) / 90;
    const across = Math.round(192 + 576 * t);
    const size = Math.round((1024 + 3072 * t) / 256) * 256;
    const cols = (east - west) * kx >= (north - south) * ky ? across : Math.round((across * (east - west) * kx) / ((north - south) * ky));
    const rows = Math.round((cols * (north - south) * ky) / ((east - west) * kx));
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    let low = Infinity;
    let high = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [lng, lat] = [west + ((east - west) * c) / (cols - 1), north - ((north - south) * r) / (rows - 1)];
        const k = r * cols + c;
        const y = Math.max(relief(lng, lat), 0) * unit * exaggeration;
        positions[k * 3] = (lng - lng0) * kx * unit;
        positions[k * 3 + 1] = y;
        positions[k * 3 + 2] = -(lat - lat0) * ky * unit;
        uvs[k * 2] = (mx(lng) - mx(west)) / (mx(east) - mx(west));
        uvs[k * 2 + 1] = 1 - (my(lat) - my(north)) / (my(south) - my(north));
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
    }
    const index = new Uint32Array((rows - 1) * (cols - 1) * 6);
    for (let r = 0, n = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++, n += 6) {
        const a = r * cols + c;
        index[n] = a;
        index[n + 1] = index[n + 4] = a + cols;
        index[n + 2] = index[n + 3] = a + 1;
        index[n + 5] = a + cols + 1;
      }
    }
    const surface = new THREE.BufferGeometry();
    surface.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    surface.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    surface.setIndex(new THREE.BufferAttribute(index, 1));
    surface.computeVertexNormals();

    base ??= low - 4;
    const ring = [];
    for (let c = 0; c < cols; c++) ring.push(c);
    for (let r = 1; r < rows; r++) ring.push(r * cols + cols - 1);
    for (let c = cols - 2; c >= 0; c--) ring.push((rows - 1) * cols + c);
    for (let r = rows - 2; r >= 0; r--) ring.push(r * cols);
    const walls = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [a, b] = [ring[i] * 3, ring[i + 1] * 3];
      const [ax, ay, az, bx, by, bz] = [positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]];
      walls.push(ax, ay, az, ax, base, az, bx, by, bz, bx, by, bz, ax, base, az, bx, base, bz);
    }
    const sides = new THREE.BufferGeometry();
    sides.setAttribute("position", new THREE.Float32BufferAttribute(walls, 3));
    sides.computeVertexNormals();

    let bumps = null;
    if (relief === height) {
      sharp ??= bake(height, bounds, { x: kx * unit, y: unit * exaggeration, z: ky * unit });
      bumps = new THREE.CanvasTexture(shrink(sharp, size));
      bumps.anisotropy = 16;
    }
    made.set(key, { surface, sides, bumps, low, high });
    if (made.size > 4) {
      const [oldest, gone] = made.entries().next().value;
      made.delete(oldest);
      gone.surface.dispose();
      gone.sides.dispose();
      if (gone.bumps && gone.bumps.image !== sharp) gone.bumps.dispose();
    }
    return made.get(key);
  };
  const show = () => gauge(detail);
  detail.value = load("maquette-detail", 75);
  show();
  const { surface, sides, bumps, low, high } = mould(Number(detail.value), height);

  const spacing = (north - south) * ky > 50000 || (east - west) * kx > 50000 ? 200 : 100;
  const step = spacing * unit * exaggeration;
  const scene = new THREE.Scene();
  const texture = new THREE.CanvasTexture(picture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const top = new THREE.Mesh(surface, contour(new THREE.MeshStandardMaterial({ map: texture, normalMap: bumps, normalMapType: THREE.ObjectSpaceNormalMap, roughness: 0.92 }), step, 0.94, 0.5));
  const edge = new THREE.Mesh(sides, contour(new THREE.MeshStandardMaterial({ color: "#ebe5d6", roughness: 0.45, emissive: "#f7f0e1", emissiveIntensity: 0.4, side: THREE.DoubleSide }), step * 2, 0.93));
  top.castShadow = top.receiveShadow = edge.castShadow = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = base - 0.01;
  floor.receiveShadow = true;
  const ramp = new THREE.DataTexture(new Uint8Array([80, 140, 205, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  const looks = {
    real: { top: top.material, edge: edge.material },
    cartoon: {
      top: contour(new THREE.MeshToonMaterial({ normalMap: new THREE.CanvasTexture(shrink(sharp, 1024)), normalMapType: THREE.ObjectSpaceNormalMap, gradientMap: ramp }), step, 0.86, 0.5),
      edge: contour(new THREE.MeshToonMaterial({ color: "#c08a5a", gradientMap: ramp, side: THREE.DoubleSide }), step * 2, 0.8),
    },
  };
  const rim = (walls) => new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(walls, 30));
  const outline = new LineSegments2(rim(sides), new LineMaterial({ color: new THREE.Color("#6e4a2c"), linewidth: 2.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  outline.visible = false;
  scene.add(top, edge, floor, outline);

  let drawing;
  const sketch = () =>
    (drawing ??= paint(bounds, cartoon).then((canvas) => {
      const texture = new THREE.CanvasTexture(alpine(canvas, height, bounds));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      looks.cartoon.top.map = texture;
    }));
  const shape = () => {
    const next = mould(Number(detail.value), ground());
    top.geometry = next.surface;
    edge.geometry = next.sides;
    if (next.bumps) looks.real.top.normalMap = next.bumps;
    outline.geometry.dispose();
    outline.geometry = rim(next.sides);
  };
  let wait = 0;
  detail.addEventListener(
    "input",
    () => {
      show();
      keep("maquette-detail", Number(detail.value));
      clearTimeout(wait);
      wait = setTimeout(shape, 150);
    },
    { signal },
  );

  const sun = new THREE.DirectionalLight("#ffffff", 2.8);
  sun.position.set(-70, 60, -55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, new THREE.HemisphereLight("#ffffff", "#8c826f", 0.9));

  const gap = 0.25 / unit;
  const dense = [];
  const smooth = soften(unspike(simplify(trail.line, 0.5 / unit, kx, ky), kx, ky), 4);
  smooth.forEach(([lng, lat], i) => {
    if (i) {
      const [plng, plat] = smooth[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot((lng - plng) * kx, (lat - plat) * ky) / gap));
      for (let k = 1; k <= n; k++) dense.push([plng + ((lng - plng) * k) / n, plat + ((lat - plat) * k) / n]);
    } else dense.push([lng, lat]);
  });
  let route = dense.map(([lng, lat]) => at(lng, lat, Math.max(height(lng, lat), 0)));
  const segments = route.length - 1;
  const path = route.flatMap((p) => [p.x, p.y + 0.35, p.z]);
  let along = [0];
  for (let i = 1; i < route.length; i++) along.push(along[i - 1] + route[i].distanceTo(route[i - 1]));
  const strand = (width, color, opacity, order) => {
    const shape = new LineGeometry();
    shape.setPositions(path);
    const material = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
    const strip = new Line2(shape, material);
    strip.renderOrder = order;
    shape.instanceCount = 0;
    return strip;
  };

  const glow = strand(11, "#fc4c02", 0.3, 1);
  Object.assign(glow.material, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const core = strand(4.5, "#fc4c02", 1, 2);
  Object.assign(core.material, { depthWrite: false, stencilWrite: true, stencilRef: 2, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const glint = strand(4.5, "#ffa04a", 1, 3);
  glint.computeLineDistances();
  Object.assign(glint.material, { dashed: true, transparent: true, depthTest: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.IncrementStencilOp });
  const reach = { value: 0 };
  glint.material.onBeforeCompile = (shader) => {
    shader.uniforms.reach = reach;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float reach;")
      .replace("if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps", "")
      .replace("if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX", "float wave = mod( vLineDistance + dashOffset, dashSize + gapSize ) / dashSize;")
      .replace("float alpha = opacity;", "float alpha = opacity * ( wave < 1.0 && vLineDistance < reach ? pow( sin( wave * PI ), 2.0 ) : 0.0 );");
  };

  const dot = document.createElement("canvas");
  dot.width = dot.height = 64;
  const pen = dot.getContext("2d");
  for (const [color, radius] of [["#fc4c02", 30], ["#ffffff", 21]]) {
    pen.fillStyle = color;
    pen.beginPath();
    pen.arc(32, 32, radius, 0, Math.PI * 2);
    pen.fill();
  }
  const face = new THREE.CanvasTexture(dot);
  face.colorSpace = THREE.SRGBColorSpace;
  const marker = (p) => {
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ map: face, transparent: true, alphaTest: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.copy(p).y += 0.4;
    mark.renderOrder = 4;
    mark.visible = false;
    return mark;
  };
  const first = marker(route[0]);
  const last = marker(route[segments]);
  const tip = marker(route[0]);
  const loop = route[0].distanceTo(route[segments]) < 1.5;
  scene.add(glow, core, glint, first, last, tip);

  const towns = [];
  const signs = [];
  const posts = [];
  const [padX, padY] = [(east - west) * 0.04, (north - south) * 0.04];
  for (const [name, lng, lat] of trail.towns) {
    if (lng < west + padX || lng > east - padX || lat < south + padY || lat > north - padY) continue;
    const spot = at(lng, lat, Math.max(height(lng, lat), 0));
    if (towns.some((town) => Math.hypot(town.x - spot.x, town.z - spot.z) < 14)) continue;
    towns.push(spot);
    const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 10, 0)]), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }));
    pole.position.copy(spot);
    const tag = document.createElement("span");
    tag.className = "city";
    tag.textContent = name;
    const label = new CSS2DObject(tag);
    label.position.copy(spot).y += 10;
    label.center.set(0.5, 1);
    scene.add(pole, label);
    signs.push(pole, label);
    posts.push({ pole, label, lng, lat });
    if (towns.length === 8) break;
  }
  let risen = -Infinity;
  const rise = () => {
    risen = performance.now();
    for (const sign of signs) sign.visible = true;
  };
  if (named) {
    const toggle = () => {
      named.nextElementSibling.textContent = named.checked ? "on" : "off";
      for (const sign of signs) sign.visible = named.checked;
    };
    named.checked = load("maquette-labels", false);
    toggle();
    named.addEventListener(
      "change",
      () => {
        keep("maquette-labels", named.checked);
        toggle();
      },
      { signal },
    );
  } else for (const sign of signs) sign.visible = false;

  const drape = () => {
    const relief = ground();
    route = dense.map(([lng, lat]) => at(lng, lat, Math.max(relief(lng, lat), 0)));
    along = [0];
    for (let i = 1; i < route.length; i++) along.push(along[i - 1] + route[i].distanceTo(route[i - 1]));
    const path = route.flatMap((p) => [p.x, p.y + 0.35, p.z]);
    for (const strip of [glow, core, glint]) strip.geometry.setPositions(path);
    glint.computeLineDistances();
    first.position.copy(route[0]).y += 0.4;
    last.position.copy(route[segments]).y += 0.4;
    for (const { pole, label, lng, lat } of posts) {
      const spot = at(lng, lat, Math.max(relief(lng, lat), 0));
      pole.position.copy(spot);
      label.position.copy(spot).y += 10;
    }
  };
  const dress = async () => {
    say(cartoonish() ? "…" : "off");
    if (cartoonish()) await sketch();
    say(cartoonish() ? "on" : "off");
    top.material = cartoonish() ? looks.cartoon.top : looks.real.top;
    shape();
    drape();
    side();
  };
  const edging = () => (skirt ? skirt.value : cartoonish() ? "cartoon" : "white");
  const side = () => {
    edge.visible = floor.visible = edging() !== "none";
    edge.material = edging() === "cartoon" ? looks.cartoon.edge : looks.real.edge;
    outline.visible = edging() === "cartoon";
  };
  if (skirt) {
    skirt.value = load("maquette-sides", "white");
    if (!skirt.value) skirt.value = "white";
    skirt.addEventListener(
      "change",
      () => {
        keep("maquette-sides", skirt.value);
        side();
      },
      { signal },
    );
  }
  const saved = load("maquette-cartoon", true);
  if (toon.type === "checkbox") toon.checked = saved;
  else toon.value = saved ? "cartoon" : "realist";
  await dress();
  toon.addEventListener(
    "change",
    () => {
      keep("maquette-cartoon", cartoonish());
      dress();
    },
    { signal },
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const names = new CSS2DRenderer();
  names.domElement.className = "names";
  stage.replaceChildren(renderer.domElement, names.domElement);
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.maxPolarAngle = 1.35;
  controls.minDistance = 25;
  controls.maxDistance = 500;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.4;
  let calm = false;
  controls.addEventListener("start", () => {
    if (!calm) controls.autoRotate = false;
  });
  controls.target.set(0, (high + base) / 2, 0);

  let press = { time: 0, x: 0, y: 0 };
  stage.addEventListener(
    "pointerdown",
    (e) => {
      const again = performance.now() - press.time < 350 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10;
      controls.mouseButtons.LEFT = again ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      press = { time: performance.now(), x: e.clientX, y: e.clientY };
    },
    { capture: true, signal },
  );

  const [halfX, halfZ] = [((east - west) * kx * unit) / 2, ((north - south) * ky * unit) / 2];
  controls.addEventListener("change", () => {
    const { x, z } = controls.target;
    const dx = Math.min(Math.max(x, -halfX * 0.4), halfX * 0.4) - x;
    const dz = Math.min(Math.max(z, -halfZ * 0.4), halfZ * 0.4) - z;
    if (!dx && !dz) return;
    controls.target.x += dx;
    controls.target.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
  });

  const fit = () => {
    const { clientWidth: w, clientHeight: h } = stage;
    if (!w || !h) return;
    renderer.setSize(w, h);
    names.setSize(w, h);
    camera.aspect = w / h;
    const lift = (stage.getBoundingClientRect().top + h / 2 - innerHeight / 2) / (h / 2);
    camera.setViewOffset(w, h, 0, (lift * h) / 2, w, h);
  };
  fit();
  const watch = new ResizeObserver(fit);
  watch.observe(stage);
  const distance = camera.aspect >= 1 ? Math.max(200, 250 / camera.aspect) : 210 / camera.aspect;
  camera.position.set(distance * 0.35, distance * 0.7, distance * 0.62).add(controls.target);
  camera.lookAt(controls.target);

  let shown = 0;
  let from = 0;
  let goal = 0;
  let since = 0;
  let done = 0;
  let span = 1800;
  let curve = (k) => 1 - (1 - k) ** 3;
  const reveal = (fraction, duration = 1800, ease = (k) => 1 - (1 - k) ** 3) => {
    from = shown;
    goal = fraction;
    since = performance.now();
    span = duration;
    curve = ease;
  };
  const frame = (now) => {
    const k = Math.min(Math.max((now - since) / span, 0), 1);
    shown = from + (goal - from) * curve(k);
    const drawn = Math.floor(shown * segments);
    glow.geometry.instanceCount = core.geometry.instanceCount = glint.geometry.instanceCount = drawn;
    const total = along[segments];
    const cycle = total / 3;
    if (shown < 0.999) done = 0;
    else if (!done) done = now;
    const travelled = done ? total + ((now - done) / ((Math.min(Math.max(total / 9, 3), 12) * 1000) / (3 * 1.4))) * cycle : along[drawn];
    glint.material.dashSize = cycle * 0.45;
    glint.material.gapSize = cycle * 0.55;
    glint.material.dashOffset = (((cycle * 0.45 - travelled) % cycle) + cycle) % cycle;
    reach.value = Math.min(travelled, 1e6);
    first.visible = shown >= 0.999;
    last.visible = shown >= 0.999 && !loop;
    const reached = route[drawn];
    tip.position.copy(reached).y += 0.4;
    tip.visible = shown > 0 && shown < 0.999;
    const pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (stage.clientHeight || 1);
    for (const mark of [first, last, tip]) mark.scale.setScalar(camera.position.distanceTo(mark.position) * pixel * 5);
    posts.forEach(({ pole, label }, i) => {
      const t = now - risen - i * 250;
      pole.scale.y = Math.min(Math.max(t / 600, 0.001), 1);
      label.element.style.opacity = Math.min(Math.max((t - 600) / 300, 0), 1);
    });
    controls.update();
    renderer.render(scene, camera);
    names.render(scene, camera);
  };
  const dispose = () => {
    ending.abort();
    watch.disconnect();
    controls.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  const rest = camera.position.distanceTo(controls.target);
  const hold = (locked) => {
    calm = locked;
    controls.enablePan = controls.enableRotate = !locked;
    controls.minDistance = locked ? rest * 0.8 : 25;
    controls.maxDistance = locked ? rest * 1.1 : 500;
  };
  return { frame, reveal, rise, hold, dispose };
}
