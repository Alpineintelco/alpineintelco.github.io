import { build, gauge, keep, kit, load } from "./model.js";

const section = document.querySelector("#game");
const stage = section.querySelector(".stage");
const lobby = section.querySelector(".lobby");
const number = lobby.querySelector(".number");
const balance = lobby.querySelector(".balance");
const detail = lobby.querySelector(".detail");
const toon = choice(lobby.querySelector(".toon"));
const go = lobby.querySelector(".go");
const next = lobby.querySelector(".next");
const clock = section.querySelector(".clock");
const bar = clock.querySelector(".bar span");
const left = clock.querySelector(".left");
const play = section.querySelector(".play");
const hint = clock.querySelector(".hint");
const feed = section.querySelector(".feed");
const flash = section.querySelector(".flash");
const answer = play.querySelector(".answer");
const picks = play.querySelector(".picks");
const send = play.querySelector(".send");
const result = section.querySelector(".result");
const first = new Date(2026, 9, 20);
const length = 60000;
const drawing = 50000;
const towns = 40000;
let started = false;
let running = false;
let frame = () => {};

function coin() {
  const piece = document.createElement("i");
  piece.className = "coin";
  return piece;
}

function purse() {
  const amount = document.createElement("span");
  amount.textContent = load("game-coins", 0);
  number.textContent = `#${today() + 1}`;
  balance.replaceChildren(coin(), amount);
}

function replay(element, name) {
  element.classList.remove(name);
  void element.offsetWidth;
  element.classList.add(name);
}

function note(text) {
  balance.querySelector(".drop")?.remove();
  const drop = document.createElement("span");
  drop.className = "drop";
  drop.textContent = text;
  balance.append(drop);
  setTimeout(() => drop.remove(), 900);
}

function spend(from, price) {
  const amount = balance.querySelector("span");
  note(`−${price}`);
  const start = performance.now();
  const step = (now) => {
    const k = Math.min((now - start) / 600, 1);
    amount.textContent = Math.round(from - price * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function choice(group) {
  const buttons = [...group.querySelectorAll("button")];
  const open = (button) => !button.dataset.price || load("game-unlocks", []).includes(button.dataset.value);
  const paint = () => buttons.forEach((button) => button.classList.toggle("locked", !open(button)));
  Object.defineProperty(group, "value", {
    get: () => buttons.find((button) => button.getAttribute("aria-pressed") === "true")?.dataset.value ?? "",
    set: (value) => {
      const chosen = buttons.find((button) => button.dataset.value === value && open(button)) ?? buttons.find(open);
      buttons.forEach((button) => button.setAttribute("aria-pressed", button === chosen));
    },
  });
  group.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button || button.dataset.value === group.value || button.classList.contains("opening")) return;
    if (!open(button)) {
      const coins = load("game-coins", 0);
      const price = Number(button.dataset.price);
      if (coins < price) {
        replay(button, "denied");
        return replay(balance, "short");
      }
      keep("game-coins", coins - price);
      keep("game-unlocks", [...load("game-unlocks", []), button.dataset.value]);
      spend(coins, price);
      button.classList.add("opening");
      await wait(700);
      button.classList.remove("opening");
      paint();
    }
    group.value = button.dataset.value;
    group.dispatchEvent(new Event("change"));
  });
  paint();
  return group;
}

next.textContent = `next course in ${until()}`;
setInterval(() => (next.textContent = `next course in ${until()}`), 1000);
detail.value = load("maquette-detail", 75);
gauge(detail);
toon.value = load("maquette-cartoon", true) ? "cartoon" : "realist";
detail.addEventListener("input", () => {
  gauge(detail);
  keep("maquette-detail", Number(detail.value));
});
toon.addEventListener("change", () => keep("maquette-cartoon", toon.value === "cartoon"));

function today() {
  const now = new Date();
  return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - first) / 86400000);
}

function order(count) {
  let seed = 20261020;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const list = [...Array(count).keys()];
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function plain(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function score(elapsed) {
  return Math.max(0, Math.round(100 * (1 - elapsed / length)));
}

function about(value, step) {
  return (Math.round(value / step) * step).toLocaleString("en").replace(/,/g, " ");
}

function until() {
  const now = new Date();
  const gone = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now) / 1000);
  return [Math.floor(gone / 3600), Math.floor(gone / 60) % 60, gone % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

function run(trail, official, names, lookup, made, day) {
  const known = (name) => lookup.get(name) ?? [name];
  const facts = `~${about(trail.km, trail.km >= 100 ? 10 : 5)} km · ~${about(trail.climb, trail.climb >= 3000 ? 500 : 100)} m d+`;
  const tried = [];
  let begun = null;
  let over = false;
  let risen = false;
  let active = -1;
  let found = [];

  const tick = (now) => {
    if (begun === null || over) return;
    const elapsed = Math.max(now - begun, 0);
    bar.style.scale = `${Math.max(1 - elapsed / length, 0)} 1`;
    left.textContent = `${Math.max(Math.ceil((length - elapsed) / 1000), 0)}s remaining`;
    clock.classList.toggle("late", elapsed >= drawing);
    if (elapsed >= towns && !risen) {
      risen = true;
      made.rise();
    }
    if (elapsed >= drawing) hint.hidden = false;
    if (elapsed >= length) finish(false);
  };

  const summary = ({ solved, points, seconds }) => {
    result.replaceChildren();
    const line = (text, name) => {
      const p = document.createElement("p");
      p.textContent = text;
      if (name) p.className = name;
      result.append(p);
      return p;
    };
    line(`trailable.io #${day + 1}`, "label");
    line(official, "title");
    line(solved ? `found in ${seconds.toFixed(1)} s` : "not found");
    const earn = document.createElement("div");
    earn.className = "earn";
    const wallet = document.createElement("p");
    wallet.className = "balance";
    wallet.append(coin(), String(load("game-coins", 0)));
    earn.append(wallet);
    const gain = document.createElement("span");
    gain.className = points > 0 ? "gain" : "gain none";
    gain.textContent = `+${points}`;
    earn.append(gain);
    result.append(earn);
    const soon = line(`next course in ${until()}`, "label");
    setInterval(() => (soon.textContent = `next course in ${until()}`), 1000);
    const row = document.createElement("div");
    row.className = "row";
    const visit = document.createElement("button");
    visit.type = "button";
    visit.textContent = "visit maquette";
    visit.addEventListener("click", () => {
      result.hidden = true;
      made.hold(false);
    });
    row.append(visit);
    result.append(row);
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      const again = document.createElement("button");
      again.type = "button";
      again.textContent = "play again";
      again.addEventListener("click", () => {
        localStorage.removeItem("game-day");
        location.reload();
      });
      row.append(again);
    }
    result.hidden = false;
  };

  const finish = (solved) => {
    over = true;
    const elapsed = Math.min(performance.now() - begun, length);
    const saved = { day, solved, points: solved ? score(elapsed) : 0, seconds: elapsed / 1000 };
    keep("game-day", saved);
    keep("game-coins", load("game-coins", 0) + saved.points);
    purse();
    clock.hidden = play.hidden = feed.hidden = true;
    made.reveal(1, 1200);
    if (!risen) made.rise();
    summary(saved);
  };

  const hide = () => {
    picks.hidden = true;
    active = -1;
  };

  const suggest = () => {
    const query = plain(answer.value);
    const rank = (name) => (known(name).some((key) => plain(key).startsWith(query)) ? 0 : name.split(/[\s-]+/).some((word) => plain(word).startsWith(query)) ? 1 : 2);
    found = query
      ? names
          .filter((name) => known(name).some((key) => plain(key).includes(query)) && !tried.includes(name))
          .sort((a, b) => rank(a) - rank(b))
          .slice(0, 6)
      : [];
    picks.replaceChildren(
      ...found.map((name, i) => {
        const item = document.createElement("li");
        item.textContent = name;
        item.classList.toggle("active", i === active);
        return item;
      }),
    );
    picks.hidden = !found.length;
  };

  const guess = (name) => {
    if (over || !name) return;
    if (plain(name) === plain(official)) return finish(true);
    tried.push(name);
    const kill = document.createElement("li");
    kill.textContent = name;
    feed.prepend(kill);
    answer.value = "";
    replay(answer, "wrong");
    hide();
  };

  const pick = () => found[Math.max(active, 0)] ?? names.find((name) => known(name).some((key) => plain(key) === plain(answer.value)));

  answer.addEventListener("input", () => {
    active = -1;
    suggest();
  });
  answer.addEventListener("blur", hide);
  answer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!found.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length;
      suggest();
    }
    if (e.key === "Escape") hide();
    if (e.key === "Enter") guess(pick());
  });
  picks.addEventListener("mousedown", (e) => {
    const item = e.target.closest("li");
    if (!item) return;
    e.preventDefault();
    guess(item.textContent);
  });
  send.addEventListener("click", () => guess(pick()));
  hint.textContent = facts;

  const saved = load("game-day", null);
  if (saved?.day === day) {
    lobby.hidden = true;
    over = true;
    made.reveal(1);
    made.rise();
    summary(saved);
  } else {
    go.disabled = false;
    go.textContent = "start";
    go.addEventListener("click", async () => {
      go.disabled = true;
      keep("game-day", { day, solved: false, points: 0, seconds: length / 1000 });
      lobby.classList.add("leaving");
      await wait(350);
      lobby.hidden = true;
      bar.style.transition = "none";
      bar.style.scale = "0 1";
      clock.hidden = false;
      void bar.offsetWidth;
      bar.style.transition = "scale 2.1s linear";
      bar.style.scale = "1 1";
      for (const second of [3, 2, 1]) {
        left.textContent = `starting in ${second}s`;
        await wait(700);
      }
      bar.style.transition = "none";
      play.hidden = feed.hidden = false;
      replay(flash, "on");
      begun = performance.now();
      made.reveal(1, drawing, (k) => k);
      answer.focus({ preventScroll: true });
    });
  }
  return tick;
}

function loop(now) {
  if (location.hash !== "#game") return (running = false);
  frame(now);
  requestAnimationFrame(loop);
}

async function start() {
  if (location.hash !== "#game") return;
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
  if (started) return;
  started = true;
  try {
    const [three, data, courses] = await Promise.all([kit(), fetch("assets/data/trails.json").then((res) => res.json()), fetch("assets/data/courses.json").then((res) => res.json())]);
    const day = today();
    const list = order(data.trails.length);
    const opener = data.trails.findIndex((trail) => trail.name === "utmb");
    list.splice(list.indexOf(opener), 1);
    list.unshift(opener);
    const trail = data.trails[list[((day % list.length) + list.length) % list.length]];
    const lookup = new Map(courses.map((course) => [course.name, [course.name, ...course.short]]));
    const names = [...lookup.keys()].sort((a, b) => a.localeCompare(b));
    const official = courses.find((course) => course.short.includes(trail.name))?.name ?? trail.name;
    purse();
    const made = await build(three, trail, { stage, detail, named: null, toon, skirt: null });
    made.hold(true);
    const tick = run(trail, official, names, lookup, made, day);
    frame = (now) => {
      tick(now);
      made.frame(now);
    };
  } catch (error) {
    started = false;
    console.error(error);
  }
}

addEventListener("hashchange", start);
start();
