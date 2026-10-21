import { build, keep, kit, load } from "./model.js";

const stage = document.querySelector("#maquette .stage");
const tune = document.querySelector("#maquette .tune");
const detail = tune.querySelector(".detail");
const named = tune.querySelector(".named");
const toon = tune.querySelector(".toon");
const race = tune.querySelector(".race");
const skirt = tune.querySelector(".sides");
const loading = stage.querySelector(".loading");
const gate = document.querySelector("#maquette .gate");
const word = gate.querySelector("input");
let open = false;
let started = false;
let running = false;
let frame = () => {};

function loop(now) {
  if (location.hash !== "#maquette") return (running = false);
  frame(now);
  requestAnimationFrame(loop);
}

async function start() {
  if (location.hash !== "#maquette") return (open = false);
  gate.hidden = open;
  if (!open) {
    word.value = "";
    return word.focus();
  }
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
  if (started) return;
  started = true;
  try {
    const [three, data] = await Promise.all([kit(), fetch("assets/data/trails.json").then((res) => res.json())]);
    race.replaceChildren(...data.trails.map((trail) => new Option(trail.name)));
    race.value = load("maquette-trail", "utmb");
    if (!race.value) race.value = data.trails[0].name;
    let dispose = () => {};
    const open = async () => {
      race.disabled = true;
      dispose();
      frame = () => {};
      stage.replaceChildren(loading);
      try {
        const made = await build(three, data.trails.find((trail) => trail.name === race.value), { stage, detail, named, toon, skirt });
        dispose = made.dispose;
        frame = made.frame;
        made.reveal(1);
      } finally {
        race.disabled = false;
      }
    };
    race.onchange = () => {
      keep("maquette-trail", race.value);
      open().catch(console.error);
    };
    await open();
    tune.hidden = false;
  } catch (error) {
    started = false;
    console.error(error);
  }
}

gate.addEventListener("submit", (e) => {
  e.preventDefault();
  if (word.value !== "Pass") {
    word.value = "";
    word.classList.remove("wrong");
    void word.offsetWidth;
    word.classList.add("wrong");
    return;
  }
  open = true;
  start();
});

addEventListener("hashchange", start);
start();
