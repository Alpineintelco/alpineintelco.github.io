const cdn = "https://cdn.jsdelivr.net/npm/maplibre-gl@6.14.0/dist/";
const box = document.querySelector(".earth");
const toggle = document.querySelector(".view");
const quality = document.querySelector(".quality");
const floor = document.querySelector(".floor");
const levels = [1024, 512, 256];
const names = ["low", "mid", "high"];
const dem = { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json", encoding: "terrarium", tileSize: 512 };
const style = "https://tiles.openfreemap.org/styles/liberty";
const imagery = {
  type: "raster",
  tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
  tileSize: 256,
  maxzoom: 18,
};
const covered = ["transportation", "building"];
let started = false;
let satellite = false;
let level = 1;
let low = 1000;

function switched(layer) {
  return layer.id === "satellite" || covered.includes(layer["source-layer"]);
}

function shown(layer) {
  return (layer.id === "satellite") === satellite ? "visible" : "none";
}

function lift(e) {
  if (e <= low) return low;
  if (e >= low + 600) return e - 300;
  return low + (e - low) ** 2 / 1200;
}

async function relief(params, controller) {
  const res = await fetch(params.url.replace("relief://", "https://").split("?")[0], { signal: controller.signal });
  if (!res.ok) throw Object.assign(new Error(res.statusText), { status: res.status });
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const e = lift(px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768) + 32768;
    px[i] = e >> 8;
    px[i + 1] = e & 255;
    px[i + 2] = (e % 1) * 256;
  }
  ctx.putImageData(image, 0, 0);
  const png = await canvas.convertToBlob();
  return { data: await png.arrayBuffer() };
}

function globe(prev, next) {
  const layers = next.layers.filter((layer) => layer.type !== "fill-extrusion" && layer.type !== "symbol" && !layer.id.includes("tunnel"));
  for (const layer of layers) if (layer["source-layer"] === "boundary") layer.maxzoom = 9;
  const building = layers.find((layer) => layer.id === "building");
  if (building) delete building.maxzoom;
  const roads = layers.findIndex((layer) => layer["source-layer"] === "transportation");
  layers.splice(roads, 0, {
    id: "hills",
    type: "hillshade",
    source: "hills",
    paint: { "hillshade-shadow-color": "#473b24", "hillshade-exaggeration": 0.35 },
  }, {
    id: "satellite",
    type: "raster",
    source: "imagery",
  }, {
    id: "tunnels",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["all", ["==", ["get", "brunnel"], "tunnel"], ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]]],
    paint: {
      "line-color": "#6b6b6b",
      "line-opacity": 0.5,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 1.6],
      "line-dasharray": [3, 3],
    },
  });
  for (const layer of layers) if (switched(layer)) layer.layout = { ...layer.layout, visibility: shown(layer) };
  return {
    ...next,
    layers,
    sources: { ...next.sources, terrain: { ...dem, tileSize: levels[level] }, hills: { type: "raster-dem", tiles: ["relief://tiles.mapterhorn.com/{z}/{x}/{y}.webp?" + low], encoding: "terrarium", tileSize: levels[level] }, imagery },
    terrain: { source: "terrain", exaggeration: 1 },
    sky: {
      "sky-color": ["interpolate", ["linear"], ["zoom"], 9, "rgba(185, 211, 236, 0)", 11, "#b9d3ec"],
      "horizon-color": ["interpolate", ["linear"], ["zoom"], 9, "rgba(233, 240, 245, 0)", 11, "#e9f0f5"],
      "fog-color": "#e9f0f5",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.7,
      "atmosphere-blend": 0,
    },
    projection: { type: "globe" },
  };
}

function ramp(zoom, from, to) {
  const t = Math.min(Math.max((zoom - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

function steepest(zoom) {
  return 45 + 35 * ramp(zoom, 4, 10);
}

function fit() {
  return Math.log2((Math.min(box.clientWidth, box.clientHeight) * 0.8 * Math.PI) / 512);
}

function controls(map) {
  let tilt = 0;
  let frame = 0;
  const halt = () => cancelAnimationFrame(frame);

  map._camera._keepCameraAboveTerrain = (tr) => tr;
  map.setCenterClampedToGround(false);
  let rest = 0;
  map.on("moveend", () => {
    clearTimeout(rest);
    rest = setTimeout(() => {
      if (!map.isMoving()) map._camera.applyTransformChange((tr) => tr.recalculateZoomAndCenter(map.terrain));
    }, 300);
  });

  map.setTransformCameraUpdate(({ zoom }) => {
    tilt = Math.min(Math.max(tilt, 0), steepest(zoom));
    return { pitch: tilt };
  });

  function glide(to, ms) {
    halt();
    const c = map.getCenter();
    const from = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), tilt };
    const end = { ...from, ...to };
    end.lng = from.lng + ((((end.lng - from.lng) % 360) + 540) % 360) - 180;
    end.bearing = from.bearing + ((((end.bearing - from.bearing) % 360) + 540) % 360) - 180;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min((now - start) / ms, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2;
      const at = (key) => from[key] + (end[key] - from[key]) * e;
      tilt = at("tilt");
      map.jumpTo({ center: [at("lng"), at("lat")], zoom: at("zoom"), bearing: at("bearing") });
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function drag(down, move, tap) {
    let x = down.clientX;
    let y = down.clientY;
    let t = performance.now();
    const began = t;
    let vx = 0;
    let vy = 0;
    let moved = 0;
    const onMove = (e) => {
      const now = performance.now();
      const dt = Math.max(now - t, 1);
      const dx = e.clientX - x;
      const dy = e.clientY - y;
      vx = 0.6 * (dx / dt) + 0.4 * vx;
      vy = 0.6 * (dy / dt) + 0.4 * vy;
      moved += Math.hypot(dx, dy);
      x = e.clientX;
      y = e.clientY;
      t = now;
      move(dx, dy);
    };
    const onUp = () => {
      removeEventListener("mousemove", onMove);
      removeEventListener("mouseup", onUp);
      if (moved < 4 && tap) return performance.now() - began < 250 && tap();
      if (performance.now() - t > 80) return;
      let last = performance.now();
      const step = (now) => {
        const dt = now - last;
        last = now;
        vx *= Math.exp(-dt / 300);
        vy *= Math.exp(-dt / 300);
        if (Math.hypot(vx, vy) < 0.02) return;
        move(vx * dt, vy * dt);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    addEventListener("mousemove", onMove);
    addEventListener("mouseup", onUp);
  }

  const orbit = (dx, dy) => {
    tilt -= dy * 0.25;
    map.jumpTo({ bearing: map.getBearing() + dx * 0.3 });
  };

  const pivot = (lngLat) => {
    const ground = map.queryTerrainElevation(lngLat) ?? 0;
    const m = 111320;
    const k = Math.cos((lngLat.lat * Math.PI) / 180);
    return (dx, dy) => {
      if (map.getZoom() < 12) return orbit(dx, dy);
      const tr = map._camera.transform;
      const camera = tr.getCameraLngLat();
      let x = (camera.lng - lngLat.lng) * k * m;
      let y = (camera.lat - lngLat.lat) * m;
      let z = tr.getCameraAltitude() - ground;
      const bearing = map.getBearing() + dx * 0.3;
      const pitch = Math.min(Math.max(map.getPitch() - dy * 0.25, 0), 80);
      const turn = ((bearing - map.getBearing()) * Math.PI) / 180;
      const lift = ((pitch - map.getPitch()) * Math.PI) / 180;
      const b = (bearing * Math.PI) / 180;
      [x, y] = [x * Math.cos(turn) + y * Math.sin(turn), -x * Math.sin(turn) + y * Math.cos(turn)];
      const ahead = x * Math.sin(b) + y * Math.cos(b);
      const side = x * Math.cos(b) - y * Math.sin(b);
      const tilted = ahead * Math.cos(lift) - z * Math.sin(lift);
      z = ahead * Math.sin(lift) + z * Math.cos(lift);
      x = tilted * Math.sin(b) + side * Math.cos(b);
      y = tilted * Math.cos(b) - side * Math.sin(b);
      tilt = pitch;
      map.jumpTo(map.calculateCameraOptionsFromCameraLngLatAltRotation([lngLat.lng + x / (k * m), lngLat.lat + y / m], ground + z, bearing, pitch));
    };
  };

  const look = (dx, dy) => {
    const tr = map._camera?.transform;
    if (!tr) return orbit(dx, dy);
    const camera = tr.getCameraLngLat();
    const altitude = tr.getCameraAltitude();
    const pitch = Math.min(Math.max(map.getPitch() - dy * 0.2, 0), 80);
    const view = map.calculateCameraOptionsFromCameraLngLatAltRotation(camera, altitude, map.getBearing() + dx * 0.2, pitch);
    tilt = pitch;
    map.jumpTo(view);
  };

  let click = { time: 0, x: 0, y: 0 };
  let press = null;

  box.addEventListener(
    "mousedown",
    (e) => {
      halt();
      const again = e.button === 0 && performance.now() - click.time < 350 && Math.hypot(e.clientX - click.x, e.clientY - click.y) < 10;
      press = e.button === 0 && !again ? { x: e.clientX, y: e.clientY } : null;
      if (again) {
        e.preventDefault();
        e.stopPropagation();
        click.time = 0;
        const rect = box.getBoundingClientRect();
        const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        return drag(e, pivot(lngLat), () => map.easeTo({ zoom: map.getZoom() + 1, around: lngLat, duration: 400 }));
      }
      const looking = e.button === 0 && (e.metaKey || e.ctrlKey);
      const turning = e.button === 1 || (e.button === 0 && e.shiftKey);
      if (e.button !== 2 && !turning && !looking) return;
      e.preventDefault();
      e.stopPropagation();
      if (looking) return drag(e, look);
      if (turning) return drag(e, orbit);
      const rect = box.getBoundingClientRect();
      const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      drag(e, (dx, dy) => map.easeTo({ zoom: map.getZoom() - dy * 0.007, around, duration: 0 }));
    },
    true,
  );
  addEventListener("mouseup", (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) click = { time: performance.now(), x: e.clientX, y: e.clientY };
    press = null;
  });
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  box.addEventListener(
    "wheel",
    (e) => {
      halt();
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      tilt -= e.deltaY * 0.1;
      map.jumpTo({ bearing: map.getBearing() - e.deltaX * 0.15 });
    },
    { capture: true, passive: false },
  );
  box.addEventListener("touchstart", halt, { passive: true });

  addEventListener("keydown", (e) => {
    if (location.hash !== "#globe" || e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement) return;
    const k = e.altKey ? 0.3 : 1;
    const b = map.getBearing();
    const keys = {
      ArrowLeft: () => (e.shiftKey ? glide({ bearing: b - 15 * k }, 250) : map.panBy([-120 * k, 0], { duration: 250 })),
      ArrowRight: () => (e.shiftKey ? glide({ bearing: b + 15 * k }, 250) : map.panBy([120 * k, 0], { duration: 250 })),
      ArrowUp: () => (e.shiftKey ? glide({ tilt: tilt - 8 * k }, 250) : map.panBy([0, -120 * k], { duration: 250 })),
      ArrowDown: () => (e.shiftKey ? glide({ tilt: tilt + 8 * k }, 250) : map.panBy([0, 120 * k], { duration: 250 })),
      "+": () => map.zoomTo(map.getZoom() + k, { duration: 300 }),
      "=": () => map.zoomTo(map.getZoom() + k, { duration: 300 }),
      "-": () => map.zoomTo(map.getZoom() - k, { duration: 300 }),
      n: () => glide({ bearing: 0 }, 600),
      u: () => glide({ tilt: 0 }, 600),
      s: () => toggle.click(),
      r: () => glide({ lng: 8, lat: 46, zoom: fit(), bearing: 0, tilt: 0 }, 1500),
      " ": () => {
        halt();
        map.stop();
      },
    };
    const action = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!action) return;
    e.preventDefault();
    action();
  });
}

async function start() {
  if (started || location.hash !== "#globe") return;
  started = true;

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = cdn + "maplibre-gl.css";
  document.head.append(css);

  try {
    const maplibregl = await import(cdn + "maplibre-gl.mjs");
    maplibregl.addProtocol("relief", relief);
    const map = new maplibregl.Map({
      container: box,
      center: [-30, 30],
      zoom: fit() - 0.5,
      minZoom: -1,
      maxZoom: 19,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      maxPitch: 80,
      boxZoom: false,
      doubleClickZoom: false,
      dragRotate: false,
      keyboard: false,
      touchPitch: false,
      dragPan: { linearity: 0.25, deceleration: 700, maxSpeed: 3000 },
    });
    map.setStyle(style, { transformStyle: globe });
    map.scrollZoom.setWheelZoomRate(1 / 600);
    controls(map);
    quality.addEventListener("input", () => (quality.nextElementSibling.value = names[quality.value]));
    floor.addEventListener("input", () => (floor.nextElementSibling.value = floor.value + " m"));
    quality.addEventListener("change", () => {
      level = +quality.value;
      map.setStyle(style, { transformStyle: globe });
    });
    floor.addEventListener("change", () => {
      low = +floor.value;
      map.setStyle(style, { transformStyle: globe });
    });
    toggle.addEventListener("click", () => {
      satellite = !satellite;
      toggle.setAttribute("aria-pressed", satellite);
      if (!map.getLayer("satellite")) return;
      for (const layer of map.getStyle().layers) if (switched(layer)) map.setLayoutProperty(layer.id, "visibility", shown(layer));
    });
    map.once("load", () => map.easeTo({ center: [8, 46], zoom: fit(), duration: 2000 }));
  } catch {
    started = false;
  }
}

addEventListener("hashchange", start);
start();
