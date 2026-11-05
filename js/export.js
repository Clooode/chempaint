/* ============================================================
   export.js - SVG / PNG export, JSON save + load, autosave

   Exports are built from the model (not by cloning the live DOM) with
   every sprite embedded as a data URI, so the files are self-contained
   and sized to the molecule instead of the browser window.
============================================================ */

import { state, on, snapshot, restore } from "./state.js";
import { BOND_SPRITES, BOND_THICKNESS, spriteUrl } from "./render.js";
import { ATOM_SIZE, ATOM_RADIUS, ELEMENTS, clampToCanvas } from "./chem.js";

const PAD = 32;
const PNG_SCALE = 2;
const AUTOSAVE_KEY = "chempaint.autosave";

/* ---------- helpers ---------- */

const round = n => Math.round(n * 100) / 100;

const dataUriCache = new Map();

async function toDataUri(url) {
  if (dataUriCache.has(url)) return dataUriCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url}`);
  const blob = await res.blob();
  const uri = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  dataUriCache.set(url, uri);
  return uri;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // revoking straight away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function requireAtoms() {
  if (state.atoms.length === 0) throw new Error("Nothing to export yet - add some atoms first!");
}

/* ---------- SVG / PNG ---------- */

async function buildSvg() {
  requireAtoms();
  const { atoms, bonds } = state;

  const minX = Math.min(...atoms.map(a => a.x)) - ATOM_RADIUS - PAD;
  const minY = Math.min(...atoms.map(a => a.y)) - ATOM_RADIUS - PAD;
  const maxX = Math.max(...atoms.map(a => a.x)) + ATOM_RADIUS + PAD;
  const maxY = Math.max(...atoms.map(a => a.y)) + ATOM_RADIUS + PAD;
  const width = round(maxX - minX);
  const height = round(maxY - minY);

  const uris = {};
  for (const type of new Set(atoms.map(a => a.type))) uris[`a:${type}`] = await toDataUri(spriteUrl(type));
  for (const order of new Set(bonds.map(b => b.order))) uris[`b:${order}`] = await toDataUri(BOND_SPRITES[order]);

  const byId = new Map(atoms.map(a => [a.id, a]));

  const bondXml = bonds.map(b => {
    const a = byId.get(b.a);
    const c = byId.get(b.b);
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const angle = (Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI;
    const mx = (a.x + c.x) / 2;
    const my = (a.y + c.y) / 2;
    return `<image xlink:href="${uris[`b:${b.order}`]}" preserveAspectRatio="none" ` +
      `x="${round(-len / 2)}" y="${-BOND_THICKNESS / 2}" width="${round(len)}" height="${BOND_THICKNESS}" ` +
      `transform="translate(${round(mx)} ${round(my)}) rotate(${round(angle)})"/>`;
  });

  const atomXml = atoms.map(a =>
    `<image xlink:href="${uris[`a:${a.type}`]}" x="${round(a.x - ATOM_RADIUS)}" y="${round(a.y - ATOM_RADIUS)}" ` +
    `width="${ATOM_SIZE}" height="${ATOM_SIZE}"/>`
  );

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="${round(minX)} ${round(minY)} ${width} ${height}">\n` +
    `<rect x="${round(minX)}" y="${round(minY)}" width="${width}" height="${height}" fill="#ffffff"/>\n` +
    `${bondXml.join("\n")}\n${atomXml.join("\n")}\n</svg>\n`;

  return { svg, width, height };
}

export async function exportSvg() {
  const { svg } = await buildSvg();
  download(new Blob([svg], { type: "image/svg+xml" }), "molecule.svg");
}

export async function exportPng() {
  const { svg, width, height } = await buildSvg();

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Couldn't render the picture."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * PNG_SCALE);
    canvas.height = Math.ceil(height * PNG_SCALE);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't create the PNG.");
    download(blob, "molecule.png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- JSON save / load ---------- */

export function saveJson() {
  const data = { app: "chempaint", version: 1, ...snapshot() };
  download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "molecule.chempaint.json");
}

/** Validate untrusted JSON and return a clean snapshot, or throw a friendly Error. */
export function parseMolecule(text) {
  const bad = () => new Error("That doesn't look like a ChemPaint file.");

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw bad();
  }
  if (!data || !Array.isArray(data.atoms) || !Array.isArray(data.bonds)) throw bad();

  const atoms = [];
  const ids = new Set();
  for (const a of data.atoms) {
    if (!a || !Number.isInteger(a.id) || ids.has(a.id) || !ELEMENTS.includes(a.type) ||
        !Number.isFinite(a.x) || !Number.isFinite(a.y)) throw bad();
    ids.add(a.id);
    atoms.push({ id: a.id, type: a.type, ...clampToCanvas(a) });
  }

  const bonds = [];
  const pairs = new Set();
  const seenBondIds = new Set();
  for (const b of data.bonds) {
    if (!b || !Number.isInteger(b.id) || seenBondIds.has(b.id) || !ids.has(b.a) || !ids.has(b.b) ||
        b.a === b.b || ![1, 2, 3].includes(b.order)) throw bad();
    const key = b.a < b.b ? `${b.a}-${b.b}` : `${b.b}-${b.a}`;
    if (pairs.has(key)) throw bad();
    pairs.add(key);
    seenBondIds.add(b.id);
    bonds.push({ id: b.id, a: b.a, b: b.b, order: b.order });
  }

  return { atoms, bonds };
}

/* ---------- autosave ---------- */

function writeAutosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot()));
  } catch {
    /* private mode / quota: autosave is a nicety, never an error */
  }
}

/** Restore the last session (if any) and keep saving changes. */
export function initAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) restore(parseMolecule(raw));
  } catch {
    /* corrupt or unavailable: start fresh */
  }

  let timer = 0;
  on("model", () => {
    clearTimeout(timer);
    timer = setTimeout(writeAutosave, 300);
  });
  window.addEventListener("pagehide", writeAutosave);
}
