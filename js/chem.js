/* ============================================================
   chem.js - pure helpers (no DOM, no state)
============================================================ */

/** Logical canvas size. The <svg> uses this as its viewBox. */
export const VIEW_W = 1200;
export const VIEW_H = 800;

export const ATOM_SIZE = 48;
export const ATOM_RADIUS = ATOM_SIZE / 2;

/** Atoms closer than this (centre to centre) count as overlapping. */
export const MIN_ATOM_DIST = 40;

/** Length of bonds created automatically, and the allowed range when dragging. */
export const BOND_LENGTH = 72;
export const MIN_BOND_LENGTH = 44;
export const MAX_BOND_LENGTH = 180;

export const SNAP_STEP = 30; // degrees

/** Max total bond order before we show a (soft) warning. */
export const VALENCE = { H: 1, C: 4, N: 3, O: 2, F: 1, Cl: 1, Br: 1, S: 6 };

export const ELEMENTS = Object.keys(VALENCE);

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The part of the logical canvas that is actually on screen. The <svg> scales
 * with "slice" (so it fills the window), which can crop the logical canvas;
 * render.js keeps this up to date so atoms can never end up where they can't
 * be reached.
 */
const bounds = { minX: 0, minY: 0, maxX: VIEW_W, maxY: VIEW_H };

export function setVisibleBounds(b) {
  Object.assign(bounds, b);
}

/** Keep a whole atom (not just its centre) inside the visible canvas. */
export function clampToCanvas(p) {
  return {
    x: clamp(p.x, bounds.minX + ATOM_RADIUS, bounds.maxX - ATOM_RADIUS),
    y: clamp(p.y, bounds.minY + ATOM_RADIUS, bounds.maxY - ATOM_RADIUS),
  };
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Snap an angle in degrees to the nearest multiple of `step`. */
export function snapAngle(deg, step = SNAP_STEP) {
  return Math.round(deg / step) * step;
}

export function clampBondLength(len) {
  return clamp(len, MIN_BOND_LENGTH, MAX_BOND_LENGTH);
}

/**
 * Position at `from` + a bond in the direction of `toward`, with the angle
 * snapped to SNAP_STEP. If `length` is omitted the distance to `toward` is
 * used (clamped to the legal bond range). Hold `free` to skip angle snapping.
 */
export function snapAround(from, toward, { length, free = false } = {}) {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = clampBondLength(length ?? Math.hypot(dx, dy));
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;
  if (!free) deg = snapAngle(deg);
  const rad = deg * Math.PI / 180;
  return { x: from.x + Math.cos(rad) * len, y: from.y + Math.sin(rad) * len };
}

/** Sum of bond orders touching an atom. */
export function bondSum(atomId, bonds) {
  let sum = 0;
  for (const b of bonds) if (b.a === atomId || b.b === atomId) sum += b.order;
  return sum;
}

/** Soft chemistry hint: true when an atom has more bonds than its usual valence. */
export function isOverValence(atom, bonds) {
  const max = VALENCE[atom.type];
  return max !== undefined && bondSum(atom.id, bonds) > max;
}

/** Nearest atom to a point within `maxDist`, or null. */
export function atomNear(point, atoms, maxDist, ignoreId = null) {
  let best = null;
  let bestD = maxDist;
  for (const a of atoms) {
    if (a.id === ignoreId) continue;
    const d = dist(a, point);
    if (d <= bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Push a point out of any atoms it would overlap, so new atoms never stack. */
export function resolveOverlap(point, atoms, ignoreId = null) {
  let p = { ...point };
  for (let i = 0; i < 6; i++) {
    const hit = atomNear(p, atoms, MIN_ATOM_DIST - 0.01, ignoreId);
    if (!hit) break;
    let dx = p.x - hit.x;
    let dy = p.y - hit.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    p = clampToCanvas({ x: hit.x + dx * MIN_ATOM_DIST, y: hit.y + dy * MIN_ATOM_DIST });
  }
  return p;
}

/** Next bond order when cycling single -> double -> triple -> single. */
export function nextOrder(order) {
  return order >= 3 ? 1 : order + 1;
}
