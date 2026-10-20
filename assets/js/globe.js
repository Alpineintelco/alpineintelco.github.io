const cdn = "https://cdn.jsdelivr.net/npm/maplibre-gl@6.14.0/dist/";
const box = document.querySelector(".earth");
const quality = document.querySelector(".quality");
const floor = document.querySelector(".floor");
const shown = document.querySelector(".shown");
const named = document.querySelector(".named");
const levels = [1024, 512, 256];
const names = ["low", "mid", "high"];
const dem = { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json", encoding: "terrarium", tileSize: 512, maxzoom: 17 };
const style = "https://tiles.openfreemap.org/styles/liberty";
const hidden = ["landcover_grass", "landcover_wetland", "park", "road_area_pattern"];
const brouter = "https://brouter.de/brouter";
const ranges = ["0-255", "512-767", "8192-8447", "9216-9471", "9472-9727"];
let route = { type: "FeatureCollection", features: [] };
let started = false;
let level = 1;
let low = 900;

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
  const layers = next.layers.filter((layer) => layer.type !== "fill-extrusion" && layer.type !== "symbol" && !hidden.includes(layer.id) && !layer.id.includes("tunnel"));
  for (const layer of layers) if (layer["source-layer"] === "boundary") layer.maxzoom = 9;
  for (const layer of layers) {
    if (!layer.id.endsWith("path_pedestrian")) continue;
    layer.paint["line-color"] = "#8c8c8c";
    layer.paint["line-width"] = ["interpolate", ["exponential", 1.2], ["zoom"], 14, 0.5, 20, 5];
    layer.paint["line-dasharray"] = [3, 3.5];
    layer.paint["line-opacity"] = 0.7;
  }
  const building = layers.find((layer) => layer.id === "building");
  if (building) delete building.maxzoom;
  const roads = layers.findIndex((layer) => layer["source-layer"] === "transportation");
  layers.splice(roads, 0, {
    id: "hills",
    type: "hillshade",
    source: "hills",
    layout: { visibility: shown.checked ? "visible" : "none" },
    paint: { "hillshade-shadow-color": "#473b24", "hillshade-exaggeration": 0.35 },
  }, {
    id: "tunnels",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["all", ["==", ["get", "brunnel"], "tunnel"], ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]]],
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.5,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 1.6],
      "line-dasharray": [3, 3],
    },
  });
  layers.push({
    id: "route-edge",
    type: "line",
    source: "route",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 6 },
  }, {
    id: "route",
    type: "line",
    source: "route",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#802e7f", "line-width": 3.5 },
  }, {
    id: "cities",
    type: "symbol",
    source: "cities",
    minzoom: 6,
    layout: {
      visibility: named.checked ? "visible" : "none",
      "text-field": ["get", "n"],
      "text-font": ["OCR-A"],
      "text-size": ["interpolate", ["linear"], ["get", "p"], 20000, 10, 1000000, 13],
      "text-padding": 4,
      "symbol-sort-key": ["-", ["get", "p"]],
    },
    paint: {
      "text-color": "#333333",
      "text-halo-color": "rgba(255, 255, 255, 0.8)",
      "text-halo-width": 1.2,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 7, 0.75],
    },
  });
  return {
    ...next,
    layers,
    sources: { ...next.sources, route: { type: "geojson", data: route }, cities: { type: "geojson", data: new URL("assets/data/cities.geojson", location.href).href }, terrain: { ...dem, tileSize: levels[level] }, hills: { type: "raster-dem", tiles: ["relief://tiles.mapterhorn.com/{z}/{x}/{y}.webp?" + low], encoding: "terrarium", tileSize: levels[level], maxzoom: 17 } },
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

  const reset = () => glide({ lng: 8, lat: 46, zoom: fit(), bearing: 0, tilt: 0 }, 1500);
  document.querySelector('.nav a[href="#globe"]').addEventListener("click", () => location.hash === "#globe" && reset());

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
      r: reset,
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

function metres([a, b], [c, d]) {
  const k = Math.PI / 180;
  const h = Math.sin(((d - b) * k) / 2) ** 2 + Math.cos(b * k) * Math.cos(d * k) * Math.sin(((c - a) * k) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

function rise(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += Math.max(coords[i][2] - coords[i - 1][2], 0);
  return sum;
}

function plan(map, Marker) {
  const panel = document.querySelector(".plan");
  const [course, undo, save] = panel.querySelectorAll(".row button:not(.open)");
  const opens = panel.querySelectorAll(".open");
  const sheets = panel.querySelectorAll(".settings");
  const chart = panel.querySelector(".chart");
  const pins = [];
  let on = false;
  let profile = null;
  let pending = null;
  let stops = [];
  let legs = [];
  let past = [];
  let trace = [];
  const mark = document.createElement("div");
  mark.className = "spot";
  const spot = new Marker({ element: mark });

  const upload = () =>
    (profile ??= fetch("assets/js/run.brf")
      .then((res) => res.text())
      .then((text) => fetch(brouter + "/profile", { method: "POST", body: text }))
      .then((res) => res.json())
      .then((json) => json.profileid));

  async function follow(a, b) {
    const id = await upload();
    const res = await fetch(`${brouter}?lonlats=${a.lng},${a.lat}|${b.lng},${b.lat}&profile=${id}&alternativeidx=0&format=geojson`);
    if (!res.ok) throw new Error(res.statusText);
    return (await res.json()).features[0];
  }

  function leg(a, b) {
    const n = Math.max(Math.ceil(metres([a.lng, a.lat], [b.lng, b.lat]) / 50), 1);
    const coords = Array.from({ length: n + 1 }, (_, i) => {
      const at = [a.lng + ((b.lng - a.lng) * i) / n, a.lat + ((b.lat - a.lat) * i) / n];
      return [...at, map.queryTerrainElevation(at) ?? 0];
    });
    const part = { coords, climb: rise(coords) };
    (async () => {
      for (let tries = 0; tries < 2; tries++) {
        try {
          const feature = await follow(a, b);
          part.coords = feature.geometry.coordinates;
          part.climb = +feature.properties["filtered ascend"];
          [a.lng, a.lat] = part.coords[0];
          [b.lng, b.lat] = part.coords.at(-1);
          return draw();
        } catch {
          profile = null;
        }
      }
    })();
    return part;
  }

  function pin() {
    const dot = document.createElement("div");
    dot.className = "stop";
    const marker = new Marker({ element: dot, draggable: true }).setLngLat(map.getCenter()).addTo(map);
    let moved = false;
    marker.on("dragstart", () => (moved = true));
    marker.on("dragend", () => {
      const { lng, lat } = marker.getLngLat();
      move(pins.indexOf(marker), { lng, lat });
    });
    dot.addEventListener("click", (e) => {
      if (moved) return (moved = false);
      const i = pins.indexOf(marker);
      if (e.detail > 1 || i === stops.length - 1) return;
      add({ ...stops[i] });
    });
    return marker;
  }

  function graph() {
    const points = [];
    let km = 0;
    let last = null;
    for (const part of legs) {
      for (const c of part.coords) {
        if (last) km += metres(last, c) / 1000;
        points.push([km, c[2] ?? 0, c[0], c[1]]);
        last = c;
      }
    }
    trace = points;
    const climb = legs.reduce((sum, part) => sum + part.climb, 0);
    const heights = points.map((p) => p[1]);
    const top = Math.max(...heights);
    const bottom = Math.min(...heights);
    const x = (d) => 44 + (km ? (d / km) * 256 : 0);
    const y = (e) => 12 + ((top - e) / (top - bottom || 1)) * 44;
    const ridge = points.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(" ");
    return `<p>${km.toFixed(1)} km · ${Math.round(climb)} m D+</p>
<svg width="300" height="74">
<polygon points="44,56 ${ridge} 300,56" fill="#802e7f"/>
<polyline points="${ridge}" fill="none" stroke="#ffffff" stroke-width="1"/>
<text x="40" y="15" text-anchor="end">${Math.round(top)} m</text>
<text x="40" y="56" text-anchor="end">${Math.round(bottom)} m</text>
<text x="44" y="70">0</text>
<text x="172" y="70" text-anchor="middle">${(km / 2).toFixed(1)}</text>
<text x="300" y="70" text-anchor="end">${km.toFixed(1)} km</text>
<line class="cursor" y1="12" y2="56" stroke="#ffffff" visibility="hidden"/>
<text class="cursor" y="8" text-anchor="middle" visibility="hidden"></text>
</svg>`;
  }

  function point(e) {
    const svg = chart.querySelector("svg");
    if (!svg || !trace.length) return;
    const km = trace.at(-1)[0];
    const d = (Math.min(Math.max(e.clientX - svg.getBoundingClientRect().left - 44, 0), 256) / 256) * km;
    const at = trace.find((p) => p[0] >= d) ?? trace.at(-1);
    const x = 44 + (km ? (at[0] / km) * 256 : 0);
    const [line, label] = svg.querySelectorAll(".cursor");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    label.setAttribute("x", Math.min(Math.max(x, 92), 252));
    label.textContent = `${at[0].toFixed(1)} km · ${Math.round(at[1])} m`;
    line.setAttribute("visibility", "visible");
    label.setAttribute("visibility", "visible");
    spot.setLngLat([at[2], at[3]]).addTo(map);
  }

  function unpoint() {
    spot.remove();
    for (const el of chart.querySelectorAll(".cursor")) el.setAttribute("visibility", "hidden");
  }

  function draw() {
    spot.remove();
    while (pins.length > stops.length) pins.pop().remove();
    while (pins.length < stops.length) pins.push(pin());
    stops.forEach((stop, i) => {
      pins[i].setLngLat(stop).setDraggable(on);
      pins[i].getElement().classList.toggle("start", i === 0);
      pins[i].getElement().classList.toggle("end", i > 0 && i === stops.length - 1);
    });
    route = { type: "FeatureCollection", features: legs.map((part) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: part.coords } })) };
    map.getSource("route")?.setData(route);
    undo.disabled = !past.length;
    save.disabled = !legs.length;
    chart.hidden = !on || !legs.length;
    chart.innerHTML = legs.length ? graph() : "";
  }

  function change(next, joined) {
    past.push([stops, legs]);
    [stops, legs] = [next, joined];
    draw();
  }

  function add(stop) {
    if (!on) return;
    change([...stops, stop], stops.length ? [...legs, leg(stops.at(-1), stop)] : legs);
  }

  function move(i, stop) {
    const next = stops.with(i, stop);
    const joined = legs.slice();
    if (i > 0) joined[i - 1] = leg(next[i - 1], stop);
    if (i < legs.length) joined[i] = leg(stop, next[i + 1]);
    change(next, joined);
  }

  chart.addEventListener("mousemove", point);
  chart.addEventListener("mouseleave", unpoint);
  map.on("click", (e) => {
    const event = e.originalEvent;
    if (!on || event.detail > 1 || event.target.closest(".stop")) return;
    const { lng, lat } = e.lngLat;
    pending = { x: event.clientX, y: event.clientY, timer: setTimeout(() => add({ lng, lat }), 350) };
  });
  box.addEventListener(
    "mousedown",
    (e) => {
      if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 10) clearTimeout(pending.timer);
    },
    true,
  );

  function drawing(state) {
    on = state;
    course.setAttribute("aria-pressed", on);
    undo.hidden = save.hidden = !on;
    box.classList.toggle("drawing", on);
    draw();
  }

  function tab(pick) {
    opens.forEach((open, j) => {
      sheets[j].hidden = open !== pick;
      open.setAttribute("aria-pressed", open === pick);
    });
  }

  course.addEventListener("click", () => {
    if (on) {
      [stops, legs, past] = [[], [], []];
      return drawing(false);
    }
    tab(null);
    drawing(true);
  });
  opens.forEach((open, i) =>
    open.addEventListener("click", () => {
      if (!sheets[i].hidden) return tab(null);
      if (on) drawing(false);
      tab(open);
    }),
  );
  undo.addEventListener("click", () => {
    [stops, legs] = past.pop();
    draw();
  });
  save.addEventListener("click", () => {
    const points = legs.flatMap((part, i) => (i ? part.coords.slice(1) : part.coords));
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="The Alpine Intelligence Collective" xmlns="http://www.topografix.com/GPX/1/1">',
      "<trk><name>course</name><trkseg>",
      ...points.map(([lng, lat, ele]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${(ele ?? 0).toFixed(1)}</ele></trkpt>`),
      "</trkseg></trk>",
      "</gpx>",
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    link.download = "course.gpx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
      transformRequest: (url, type) => {
        if (type !== "Glyphs" || !url.includes("OCR-A")) return;
        const range = url.match(/\d+-\d+(?=\.pbf)/)[0];
        return { url: ranges.includes(range) ? new URL(`assets/glyphs/${range}.pbf`, location.href).href : url.replace("OCR-A", "Noto%20Sans%20Regular") };
      },
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
    plan(map, maplibregl.Marker);
    quality.addEventListener("input", () => (quality.nextElementSibling.value = names[quality.value]));
    floor.addEventListener("input", () => (floor.nextElementSibling.value = floor.value + " m"));
    shown.addEventListener("change", () => {
      shown.nextElementSibling.value = shown.checked ? "on" : "off";
      map.setLayoutProperty("hills", "visibility", shown.checked ? "visible" : "none");
    });
    named.addEventListener("change", () => {
      named.nextElementSibling.value = named.checked ? "on" : "off";
      map.setLayoutProperty("cities", "visibility", named.checked ? "visible" : "none");
    });
    quality.addEventListener("change", () => {
      level = +quality.value;
      map.setStyle(style, { transformStyle: globe });
    });
    floor.addEventListener("change", () => {
      low = +floor.value;
      map.setStyle(style, { transformStyle: globe });
    });
    map.once("load", () => map.easeTo({ center: [8, 46], zoom: fit(), duration: 2000 }));
  } catch {
    started = false;
  }
}

addEventListener("hashchange", start);
start();
