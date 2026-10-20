const stage = document.querySelector(".stage");
const tune = document.querySelector(".tune");
const detail = tune.querySelector(".detail");
const named = tune.querySelector(".named");
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
const sober = {
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": "#ece7de" } },
    fill("town", "landuse", ["residential", "suburb", "neighbourhood", "commercial", "industrial", "retail"], "#e0d9cd"),
    fill("grass", "landcover", ["grass", "farmland", "wetland"], "#e5e4d6"),
    fill("rock", "landcover", ["rock", "sand"], "#e2dfd9"),
    fill("wood", "landcover", ["wood"], "#b8c9a3"),
    fill("ice", "landcover", ["ice"], "#f7f9f9"),
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#b8c4c7" } },
    {
      id: "river",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      filter: ["in", ["get", "class"], ["literal", ["river", "stream"]]],
      paint: { "line-color": "#b8c4c7", "line-width": ["match", ["get", "class"], "river", 2, 0.8] },
    },
  ],
};

function mx(lng) {
  return (lng + 180) / 360;
}

function my(lat) {
  return (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
}

async function paint([west, south, east, north]) {
  const { Map } = await import(maplibre);
  const w = 2048;
  const h = Math.round((w * (my(south) - my(north))) / (mx(east) - mx(west)));
  const holder = document.createElement("div");
  holder.style.cssText = `position: fixed; left: -99999px; top: 0; width: ${w}px; height: ${h}px`;
  document.body.append(holder);
  const map = new Map({
    container: holder,
    style: sober,
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
let started = false;
let running = false;
let frame = () => {};

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function keep(key, value) {
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

function frameOf(line) {
  const lngs = line.map((p) => p[0]);
  const lats = line.map((p) => p[1]);
  let [west, east, south, north] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
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

async function terrain([west, south, east, north]) {
  const zoom = Math.min(14, Math.max(8, Math.round(Math.log2((4500 * 360) / ((east - west) * 512)))));
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

function contour(material, step, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.spacing = { value: step };
    shader.uniforms.strength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float level;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nlevel = position.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float level;\nuniform float spacing;\nuniform float strength;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nfloat h = level / spacing;\nfloat edge = abs(fract(h - 0.5) - 0.5) / fwidth(h);\ngl_FragColor.rgb *= mix(strength, 1.0, min(edge, 1.0));",
      );
  };
  return material;
}

async function build(THREE, { OrbitControls, Line2, LineMaterial, LineGeometry, CSS2DRenderer, CSS2DObject }, trail) {
  const bounds = frameOf(trail.line);
  const [west, south, east, north] = bounds;
  const [height, picture] = await Promise.all([terrain(bounds), paint(bounds)]);
  const [lng0, lat0] = [(west + east) / 2, (south + north) / 2];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const unit = 100 / Math.max((east - west) * kx, (north - south) * ky);
  const at = (lng, lat, e) => new THREE.Vector3((lng - lng0) * kx * unit, e * unit * exaggeration, -(lat - lat0) * ky * unit);

  let base;
  let sharp;
  const made = new Map();
  const mould = (percent) => {
    const kept = made.get(percent);
    if (kept) {
      made.delete(percent);
      made.set(percent, kept);
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
        const y = Math.max(height(lng, lat), 0) * unit * exaggeration;
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

    sharp ??= bake(height, bounds, { x: kx * unit, y: unit * exaggeration, z: ky * unit });
    const bumps = new THREE.CanvasTexture(shrink(sharp, size));
    bumps.anisotropy = 16;
    made.set(percent, { surface, sides, bumps, low, high });
    if (made.size > 4) {
      const [oldest, gone] = made.entries().next().value;
      made.delete(oldest);
      gone.surface.dispose();
      gone.sides.dispose();
      if (gone.bumps.image !== sharp) gone.bumps.dispose();
    }
    return made.get(percent);
  };
  const show = () => {
    detail.nextElementSibling.textContent = `${detail.value}%`;
    detail.style.setProperty("--fill", `${((detail.value - detail.min) / (detail.max - detail.min)) * 100}%`);
  };
  detail.value = load("maquette-render", 65);
  show();
  const { surface, sides, bumps, low, high } = mould(Number(detail.value));

  const spacing = (north - south) * ky > 50000 || (east - west) * kx > 50000 ? 200 : 100;
  const step = spacing * unit * exaggeration;
  const scene = new THREE.Scene();
  const texture = new THREE.CanvasTexture(picture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const top = new THREE.Mesh(surface, contour(new THREE.MeshStandardMaterial({ map: texture, normalMap: bumps, normalMapType: THREE.ObjectSpaceNormalMap, roughness: 0.92 }), step, 0.94));
  const edge = new THREE.Mesh(sides, contour(new THREE.MeshStandardMaterial({ color: "#ebe5d6", roughness: 0.45, emissive: "#f7f0e1", emissiveIntensity: 0.4, side: THREE.DoubleSide }), step * 2, 0.93));
  top.castShadow = top.receiveShadow = edge.castShadow = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = base - 0.01;
  floor.receiveShadow = true;
  scene.add(top, edge, floor);

  let wait = 0;
  detail.addEventListener("input", () => {
    show();
    keep("maquette-render", Number(detail.value));
    clearTimeout(wait);
    wait = setTimeout(() => {
      const next = mould(Number(detail.value));
      top.geometry = next.surface;
      edge.geometry = next.sides;
      top.material.normalMap = next.bumps;
    }, 150);
  });

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
  const route = dense.map(([lng, lat]) => at(lng, lat, Math.max(height(lng, lat), 0)));
  const segments = route.length - 1;
  const path = route.flatMap((p) => [p.x, p.y + 0.35, p.z]);
  const along = [0];
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
  const glint = strand(3, "#ffffff", 1, 3);
  glint.computeLineDistances();
  Object.assign(glint.material, { dashed: true, dashSize: 4, gapSize: 1e6, depthTest: false, stencilWrite: true, stencilRef: 2, stencilFunc: THREE.EqualStencilFunc });

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
  const [padX, padY] = [(east - west) * 0.04, (north - south) * 0.04];
  for (const [name, lng, lat] of trail.towns) {
    if (lng < west + padX || lng > east - padX || lat < south + padY || lat > north - padY) continue;
    const spot = at(lng, lat, Math.max(height(lng, lat), 0));
    if (towns.some((town) => Math.hypot(town.x - spot.x, town.z - spot.z) < 14)) continue;
    towns.push(spot);
    const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([spot, spot.clone().setY(spot.y + 10)]), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }));
    const tag = document.createElement("span");
    tag.className = "city";
    tag.textContent = name;
    const label = new CSS2DObject(tag);
    label.position.copy(spot).y += 10;
    label.center.set(0.5, 1);
    scene.add(pole, label);
    signs.push(pole, label);
    if (towns.length === 8) break;
  }
  const toggle = () => {
    named.nextElementSibling.textContent = named.checked ? "on" : "off";
    for (const sign of signs) sign.visible = named.checked;
  };
  named.checked = load("maquette-labels", false);
  toggle();
  named.addEventListener("change", () => {
    keep("maquette-labels", named.checked);
    toggle();
  });

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
  controls.addEventListener("start", () => (controls.autoRotate = false));
  controls.target.set(0, (high + base) / 2, 0);

  let press = { time: 0, x: 0, y: 0 };
  stage.addEventListener(
    "pointerdown",
    (e) => {
      const again = performance.now() - press.time < 350 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10;
      controls.mouseButtons.LEFT = again ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      press = { time: performance.now(), x: e.clientX, y: e.clientY };
    },
    true,
  );

  const [halfX, halfZ] = [((east - west) * kx * unit) / 2, ((north - south) * ky * unit) / 2];
  controls.addEventListener("change", () => {
    const { x, z } = controls.target;
    const dx = Math.min(Math.max(x, -halfX), halfX) - x;
    const dz = Math.min(Math.max(z, -halfZ), halfZ) - z;
    if (!dx && !dz) return;
    controls.target.x += dx;
    controls.target.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
  });

  let centre = { x: 0, y: 0 };
  const fit = () => {
    const { clientWidth: w, clientHeight: h } = stage;
    if (!w || !h) return;
    renderer.setSize(w, h);
    names.setSize(w, h);
    camera.aspect = w / h;
    const box = stage.getBoundingClientRect();
    const aim = (box.top + h / 2 - innerHeight / 2) / (h / 2);
    camera.setViewOffset(w, h, (centre.x * w) / 2, ((aim - centre.y) * h) / 2, w, h);
  };
  fit();
  new ResizeObserver(fit).observe(stage);
  const distance = Math.max(200, 250 / camera.aspect);
  camera.position.set(distance * 0.35, distance * 0.7, distance * 0.62).add(controls.target);
  camera.clearViewOffset();
  camera.lookAt(controls.target);
  camera.updateMatrixWorld();
  const corners = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [base, high].map((y) => new THREE.Vector3(sx * halfX, y, sz * halfZ).project(camera))));
  const [xs, ys] = [corners.map((corner) => corner.x), corners.map((corner) => corner.y)];
  centre = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
  fit();

  let shown = 0;
  let from = 0;
  let goal = 0;
  let since = 0;
  const reveal = (fraction) => {
    from = shown;
    goal = fraction;
    since = performance.now();
  };
  frame = (now) => {
    const k = Math.min(Math.max((now - since) / 1800, 0), 1);
    shown = from + (goal - from) * (1 - (1 - k) ** 3);
    const drawn = Math.floor(shown * segments);
    glow.geometry.instanceCount = core.geometry.instanceCount = glint.geometry.instanceCount = drawn;
    const reach = along[drawn] + 20;
    const period = Math.min(Math.max(reach / 9, 3), 12) * 1000;
    glint.material.dashOffset = 4 - ((now % period) / period) * reach;
    first.visible = shown >= 0.999;
    last.visible = shown >= 0.999 && !loop;
    const reached = route[drawn];
    tip.position.copy(reached).y += 0.4;
    tip.visible = shown > 0 && shown < 0.999;
    const pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (stage.clientHeight || 1);
    for (const mark of [first, last, tip]) mark.scale.setScalar(camera.position.distanceTo(mark.position) * pixel * 5);
    controls.update();
    renderer.render(scene, camera);
    names.render(scene, camera);
  };
  return reveal;
}

function loop(now) {
  if (location.hash !== "#maquette") return (running = false);
  frame(now);
  requestAnimationFrame(loop);
}

async function start() {
  if (location.hash !== "#maquette") return;
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
  if (started) return;
  started = true;
  try {
    const [THREE, { OrbitControls }, { Line2 }, { LineMaterial }, { LineGeometry }, { CSS2DRenderer, CSS2DObject }, data] = await Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/lines/Line2.js"),
      import("three/addons/lines/LineMaterial.js"),
      import("three/addons/lines/LineGeometry.js"),
      import("three/addons/renderers/CSS2DRenderer.js"),
      fetch("assets/data/trails.json").then((res) => res.json()),
    ]);
    const trail = data.trails.find((trail) => trail.name === "utmb");
    const reveal = await build(THREE, { OrbitControls, Line2, LineMaterial, LineGeometry, CSS2DRenderer, CSS2DObject }, trail);
    reveal(1);
    tune.hidden = false;
  } catch (error) {
    started = false;
    console.error(error);
  }
}

addEventListener("hashchange", start);
start();
