/* ============================================================
   sound.js - manifest-based sound effects

   File names are listed explicitly. Probing for files with fetch() was
   slow, spammed the console with 404s, didn't work from file://, and
   silently missed sets whose files aren't named after their folder
   (bond/create is bond1.wav ... bond4.wav).
============================================================ */

const BASE = "assets/sounds";
const VOLUME = 0.7;
const POOL_SIZE = 4;

const MANIFEST = {
  "atom/place": ["place1", "place2", "place3"],
  "atom/pickup": ["pickup1", "pickup2", "pickup3", "pickup4"],
  "atom/drop": ["drop1", "drop2", "drop3"],
  "atom/delete": ["delete1"],
  "bond/create": ["bond1", "bond2", "bond3", "bond4"],
  "bond/delete": ["delete1", "delete2"],
  "ui/click": ["click1"],
  "ui/erase": ["erase1"],
  "ui/undo": ["undo1"],
  "ui/redo": ["redo1"],
  "ui/save": ["save1", "save2"],
};

const pools = new Map(); // url -> Audio[]
const lastPick = new Map(); // name -> last index played

let muted = false;
try {
  muted = localStorage.getItem("chempaint.muted") === "1";
} catch {
  /* storage can be unavailable; sound still works */
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem("chempaint.muted", value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function urlFor(name, file) {
  return `${BASE}/${name}/${file}.wav`;
}

function poolFor(url) {
  let pool = pools.get(url);
  if (!pool) {
    pool = [];
    pools.set(url, pool);
  }
  return pool;
}

function acquire(url) {
  const pool = poolFor(url);
  const idle = pool.find(a => a.paused || a.ended);
  if (idle) return idle;
  if (pool.length < POOL_SIZE) {
    const audio = new Audio(url);
    audio.volume = VOLUME;
    pool.push(audio);
    return audio;
  }
  return pool[0]; // all busy: restart the oldest
}

/** Start loading every sound. Browsers only allow this after a user gesture. */
function preloadAll() {
  for (const [name, files] of Object.entries(MANIFEST)) {
    for (const file of files) {
      const url = urlFor(name, file);
      const pool = poolFor(url);
      if (pool.length === 0) {
        const audio = new Audio(url);
        audio.preload = "auto";
        audio.volume = VOLUME;
        pool.push(audio);
      }
    }
  }
}

for (const evt of ["pointerdown", "keydown"]) {
  window.addEventListener(evt, preloadAll, { once: true, capture: true });
}

/** Play a random sound from a manifest group, e.g. playSound("atom/place"). */
export function playSound(name) {
  if (muted) return;
  const files = MANIFEST[name];
  if (!files) {
    console.warn(`[sound] unknown sound "${name}"`);
    return;
  }

  // random, but never the same take twice in a row
  let index = Math.floor(Math.random() * files.length);
  if (files.length > 1 && index === lastPick.get(name)) index = (index + 1) % files.length;
  lastPick.set(name, index);

  const audio = acquire(urlFor(name, files[index]));
  try {
    audio.currentTime = 0;
  } catch {
    /* not seekable yet */
  }
  // play() rejects when blocked by autoplay policy or if interrupted: not an error for us
  audio.play().catch(() => {});
}
