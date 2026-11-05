/* ============================================================
   ui.js - toolbar, keyboard shortcuts, toasts
============================================================ */

import { state, on, setTool, setElement, setBondOrderPref, clearAll, isEmpty, restore } from "./state.js";
import { checkpoint, undo, redo, canUndo, canRedo } from "./history.js";
import { cancelInteraction } from "./input.js";
import { isLive, toggleLive } from "./tidy.js";
import { playSound, isMuted, setMuted } from "./sound.js";
import { exportSvg, exportPng, saveJson, parseMolecule } from "./export.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const BOND_ORDERS = { single: 1, double: 2, triple: 3 };

/* ---------- toast ---------- */

const toastEl = $("#toast");
let toastTimer = 0;

export function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ---------- actions ---------- */

function doUndo() {
  cancelInteraction();
  if (undo()) playSound("ui/undo");
}

function doRedo() {
  cancelInteraction();
  if (redo()) playSound("ui/redo");
}

function doClear() {
  if (isEmpty()) return;
  cancelInteraction();
  checkpoint(); // undoable, so no "are you sure?" needed
  clearAll();
  playSound("ui/erase");
}

function doTidy() {
  toggleLive();
  playSound("ui/click");
}

/** Run an async/throwing file action, showing friendly errors as toasts. */
async function guarded(fn, okSound = "ui/save") {
  try {
    await fn();
    if (okSound) playSound(okSound);
  } catch (err) {
    toast(err.message || "Something went wrong.");
  }
}

function chooseTool(tool) {
  setTool(tool);
  playSound("ui/click");
}

/* ---------- toolbar wiring ---------- */

for (const btn of $$(".element-btn")) {
  btn.addEventListener("click", () => {
    setElement(btn.dataset.element);
    setTool("atom");
    playSound("ui/click");
  });
}

for (const btn of $$(".bond-btn")) {
  btn.addEventListener("click", () => {
    setBondOrderPref(BOND_ORDERS[btn.dataset.bond]);
    setTool("bond");
    playSound("ui/click");
  });
}

for (const btn of $$("[data-tool]")) {
  btn.addEventListener("click", () => chooseTool(btn.dataset.tool));
}

$("#undoBtn").addEventListener("click", doUndo);
$("#redoBtn").addEventListener("click", doRedo);
$("#clearBtn").addEventListener("click", doClear);
$("#tidyBtn").addEventListener("click", doTidy);

$("#saveBtn").addEventListener("click", () => guarded(saveJson));
$("#exportSvgBtn").addEventListener("click", () => guarded(exportSvg));
$("#exportPngBtn").addEventListener("click", () => guarded(exportPng));

const fileInput = $("#openInput");
$("#openBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // so picking the same file again still fires "change"
  if (!file) return;
  guarded(async () => {
    const snap = parseMolecule(await file.text());
    cancelInteraction();
    checkpoint();
    restore(snap);
  }, "ui/click");
});

const muteBtn = $("#muteBtn");
function refreshMute() {
  muteBtn.textContent = isMuted() ? "Sound: off" : "Sound: on";
  muteBtn.setAttribute("aria-pressed", String(isMuted()));
}
muteBtn.addEventListener("click", () => {
  setMuted(!isMuted());
  refreshMute();
  playSound("ui/click");
});
refreshMute();

/* ---------- reflect state in the toolbar ---------- */

function refreshToolbar() {
  const { tool, element, bondOrder } = state;

  for (const btn of $$(".element-btn")) {
    const selected = btn.dataset.element === element;
    btn.classList.toggle("selected", selected);
    btn.classList.toggle("active", selected && tool === "atom");
    btn.setAttribute("aria-pressed", String(selected && tool === "atom"));
  }
  for (const btn of $$(".bond-btn")) {
    const selected = BOND_ORDERS[btn.dataset.bond] === bondOrder;
    btn.classList.toggle("selected", selected);
    btn.classList.toggle("active", selected && tool === "bond");
    btn.setAttribute("aria-pressed", String(selected && tool === "bond"));
  }
  for (const btn of $$("[data-tool]")) {
    const isOn = btn.dataset.tool === tool;
    btn.classList.toggle("active", isOn);
    btn.setAttribute("aria-pressed", String(isOn));
  }
}

function refreshHistory() {
  $("#undoBtn").disabled = !canUndo();
  $("#redoBtn").disabled = !canRedo();
}

function refreshClear() {
  $("#clearBtn").disabled = isEmpty();
}

const tidyBtn = $("#tidyBtn");
function refreshTidy() {
  tidyBtn.textContent = isLive() ? "Tidy up: on" : "Tidy up: off";
  tidyBtn.classList.toggle("active", isLive());
  tidyBtn.setAttribute("aria-pressed", String(isLive()));
}
on("tidy", refreshTidy);
refreshTidy();

on("ui", refreshToolbar);
on("history", refreshHistory);
on("model", refreshClear);
refreshToolbar();
refreshHistory();
refreshClear();

/* ---------- keyboard shortcuts ---------- */

// single letters pick that element (either case); Shift+L = Cl, Shift+B = Br
// (plain "b" is the bond tool, so Br needs the capital)
const ELEMENT_KEYS = { L: "Cl", B: "Br" };
for (const el of ["C", "H", "O", "N", "S", "F"]) {
  ELEMENT_KEYS[el] = el;
  ELEMENT_KEYS[el.toLowerCase()] = el;
}

window.addEventListener("keydown", e => {
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;

  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;

  if (mod) {
    const k = key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      e.shiftKey ? doRedo() : doUndo();
    } else if (k === "y") {
      e.preventDefault();
      doRedo();
    } else if (k === "s") {
      e.preventDefault();
      guarded(saveJson);
    }
    return;
  }
  if (e.altKey) return;

  if (key === "Escape") {
    cancelInteraction({ revert: true });
  } else if (key === "Delete" || key === "Backspace") {
    e.preventDefault();
    chooseTool("erase");
  } else if (key === "1" || key === "2" || key === "3") {
    setBondOrderPref(Number(key));
    setTool("bond");
  } else if (ELEMENT_KEYS[key]) {
    setElement(ELEMENT_KEYS[key]);
    setTool("atom");
  } else if (key === "t" || key === "T") {
    doTidy();
  } else if (key === "m" || key === "M") {
    chooseTool("move");
  } else if (key === "e" || key === "E") {
    chooseTool("erase");
  } else if (key === "b") {
    chooseTool("bond");
  } else if (key === "a" || key === "A") {
    chooseTool("atom");
  }
});
