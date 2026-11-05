/* ============================================================
   render.js - keyed SVG renderer

   Layers (bottom -> top):  bonds, atoms, overlay (previews)
   Elements are created once per model object and then only have their
   attributes updated, so dragging never rebuilds DOM and undo/redo never
   flashes. Redraws are coalesced to one per animation frame.
============================================================ */

import { state, on } from "./state.js";
import { VIEW_W, VIEW_H, ATOM_SIZE, ATOM_RADIUS, isOverValence, setVisibleBounds } from "./chem.js";

const NS = "http://www.w3.org/2000/svg";
export const BOND_THICKNESS = 20;

export const svg = document.getElementById("canvas");

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
svg.removeAttribute("width");
svg.removeAttribute("height");

const bondLayer = el("g", { id: "bondLayer" });
const atomLayer = el("g", { id: "atomLayer" });
const overlayLayer = el("g", { id: "overlayLayer", "pointer-events": "none" });
svg.append(bondLayer, atomLayer, overlayLayer);

const atomEls = new Map(); // atom id -> <g>
const bondEls = new Map(); // bond id -> <g>

/* ---------- sprites ---------- */

export const spriteUrl = (type, variant = "") =>
  `assets/elements/${type}${variant ? "_" + variant : ""}.png`;

export const BOND_SPRITES = {
  1: "assets/bonds/single.png",
  2: "assets/bonds/double.png",
  3: "assets/bonds/triple.png",
};

/** Warm the cache so hover/squish swaps never flicker. */
export function preloadSprites(types) {
  const urls = [
    ...types.flatMap(t => [spriteUrl(t), spriteUrl(t, "glow"), spriteUrl(t, "squish")]),
    ...Object.values(BOND_SPRITES),
  ];
  for (const url of urls) new Image().src = url;
}

/* ---------- transient visual state ---------- */

let hoverId = null;
let heldId = null;
let armedId = null;
const flashing = new Set();

function variantFor(id) {
  if (heldId === id || flashing.has(id)) return "squish";
  if (hoverId === id) return "glow";
  return "";
}

function refreshAtom(id) {
  const node = atomEls.get(id);
  const atom = state.atoms.find(a => a.id === id);
  if (node && atom) updateAtomEl(node, atom);
}

export function setHover(id) {
  if (hoverId === id) return;
  const prev = hoverId;
  hoverId = id;
  if (prev != null) refreshAtom(prev);
  if (id != null) refreshAtom(id);
}

export function setHeld(id) {
  const prev = heldId;
  heldId = id;
  if (prev != null) refreshAtom(prev);
  if (id != null) refreshAtom(id);
}

export function setArmed(id) {
  const prev = armedId;
  armedId = id;
  if (prev != null) refreshAtom(prev);
  if (id != null) refreshAtom(id);
}

/** Briefly show the squished sprite (place / pick up feedback). */
export function flash(id, ms = 160) {
  flashing.add(id);
  refreshAtom(id);
  setTimeout(() => {
    flashing.delete(id);
    refreshAtom(id);
  }, ms);
}

/* ---------- atoms ---------- */

function createAtomEl(atom) {
  const g = el("g", { class: "atom" });
  g.dataset.id = atom.id;
  g.append(
    el("circle", { class: "ring", r: ATOM_RADIUS + 6 }),
    el("circle", { class: "hit", r: ATOM_RADIUS }),
    el("image", {
      class: "sprite",
      width: ATOM_SIZE,
      height: ATOM_SIZE,
      x: -ATOM_RADIUS,
      y: -ATOM_RADIUS,
    })
  );
  return g;
}

function updateAtomEl(g, atom) {
  g.setAttribute("transform", `translate(${atom.x} ${atom.y})`);
  const sprite = g.querySelector(".sprite");
  const href = spriteUrl(atom.type, variantFor(atom.id));
  if (sprite.getAttribute("href") !== href) sprite.setAttribute("href", href);
  g.classList.toggle("over", isOverValence(atom, state.bonds));
  g.classList.toggle("armed", armedId === atom.id);
  g.classList.toggle("held", heldId === atom.id);
}

/* ---------- bonds ---------- */

function createBondEl(bond) {
  const g = el("g", { class: "bond" });
  g.dataset.id = bond.id;
  g.append(
    el("line", { class: "hit", y1: 0, y2: 0 }),
    el("image", {
      class: "sprite",
      preserveAspectRatio: "none",
      height: BOND_THICKNESS,
      y: -BOND_THICKNESS / 2,
    })
  );
  return g;
}

function updateBondEl(g, bond) {
  const a = state.atoms.find(x => x.id === bond.a);
  const b = state.atoms.find(x => x.id === bond.b);
  if (!a || !b) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  // everything inside is drawn in a local frame: x runs along the bond
  g.setAttribute("transform", `translate(${mx} ${my}) rotate(${angle})`);

  const hit = g.querySelector(".hit");
  hit.setAttribute("x1", -length / 2);
  hit.setAttribute("x2", length / 2);

  const sprite = g.querySelector(".sprite");
  sprite.setAttribute("x", -length / 2);
  sprite.setAttribute("width", length);
  const href = BOND_SPRITES[bond.order];
  if (sprite.getAttribute("href") !== href) sprite.setAttribute("href", href);
}

/* ---------- reconcile ---------- */

function reconcile(items, nodes, layer, create, update) {
  const live = new Set();
  for (const item of items) {
    live.add(item.id);
    let node = nodes.get(item.id);
    if (!node) {
      node = create(item);
      nodes.set(item.id, node);
      layer.append(node);
    }
    update(node, item);
  }
  for (const [id, node] of nodes) {
    if (!live.has(id)) {
      node.remove();
      nodes.delete(id);
    }
  }
}

export function render() {
  reconcile(state.atoms, atomEls, atomLayer, createAtomEl, updateAtomEl);
  reconcile(state.bonds, bondEls, bondLayer, createBondEl, updateBondEl);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
}

on("model", schedule);
on("ui", () => {
  svg.dataset.tool = state.tool;
});

/* ---------- overlay: rubber band + ghost atom ---------- */

const rubber = el("line", { class: "rubber", visibility: "hidden" });
const ghost = el("image", {
  class: "ghost",
  width: ATOM_SIZE,
  height: ATOM_SIZE,
  x: -ATOM_RADIUS,
  y: -ATOM_RADIUS,
  visibility: "hidden",
});
overlayLayer.append(rubber, ghost);

export function showRubberBand(from, to) {
  if (!from || !to) {
    rubber.setAttribute("visibility", "hidden");
    return;
  }
  rubber.setAttribute("x1", from.x);
  rubber.setAttribute("y1", from.y);
  rubber.setAttribute("x2", to.x);
  rubber.setAttribute("y2", to.y);
  rubber.setAttribute("visibility", "visible");
}

export function showGhost(pos, type) {
  if (!pos) {
    ghost.setAttribute("visibility", "hidden");
    return;
  }
  const href = spriteUrl(type);
  if (ghost.getAttribute("href") !== href) ghost.setAttribute("href", href);
  ghost.setAttribute("transform", `translate(${pos.x} ${pos.y})`);
  ghost.setAttribute("visibility", "visible");
}

/* ---------- coordinates ---------- */

/** Convert a pointer event's client position into logical canvas coordinates. */
export function clientToSvg(e) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/* ---------- visible area ---------- */

/** Tell chem.js which part of the logical canvas is on screen right now. */
function updateVisibleBounds() {
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const inv = ctm.inverse();
  const r = svg.getBoundingClientRect();
  const corner = (x, y) => {
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    return pt.matrixTransform(inv);
  };
  const tl = corner(r.left, r.top);
  const br = corner(r.right, r.bottom);
  setVisibleBounds({
    minX: Math.max(0, tl.x),
    minY: Math.max(0, tl.y),
    maxX: Math.min(VIEW_W, br.x),
    maxY: Math.min(VIEW_H, br.y),
  });
}

new ResizeObserver(updateVisibleBounds).observe(svg);
updateVisibleBounds();

/* ---------- hit-testing helpers for input.js ---------- */

/** What is under this event target? */
export function targetOf(e) {
  const atom = e.target.closest?.(".atom");
  if (atom) return { kind: "atom", id: Number(atom.dataset.id) };
  const bond = e.target.closest?.(".bond");
  if (bond) return { kind: "bond", id: Number(bond.dataset.id) };
  return { kind: "empty" };
}

svg.dataset.tool = state.tool;
render();
