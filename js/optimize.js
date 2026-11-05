/* ============================================================
   optimize.js - a very basic molecular-mechanics relaxer (pure, no DOM)

   A tiny "MD with friction" quench in 2D:

     bonds      springs to a rest length (double/triple bonds are shorter)
     angles     1-3 distance springs, so bonds around an atom spread out to
                120 deg (2-3 neighbours), 180 deg (triple / cumulated),
                or 360/n for crowded atoms
     repulsion  soft push between atoms that aren't bonded or 1-3 related,
                so the picture never collapses or overlaps
     damping    velocity is bled off every step, so it settles instead of
                oscillating forever

   Units are canvas pixels and unit mass. The centre of the molecule
   stays where it is.
============================================================ */

import { BOND_LENGTH } from "./chem.js";

const REST = { 1: BOND_LENGTH, 2: BOND_LENGTH * 0.92, 3: BOND_LENGTH * 0.83 };

const K_BOND = 0.3;
const K_ANGLE = 0.12;
const K_REPEL = 0.04;
const REPEL_RADIUS = 110;
// extra, stiffer push once two atoms' sprites would touch (they are 48px wide)
const CONTACT_RADIUS = 56;
const K_CONTACT = 0.3;
const DAMPING = 0.82;
const MAX_STEP = 6; // px per step; keeps a badly tangled start from exploding

export const MAX_STEPS = 1500;
const SETTLED_FORCE = 0.03;
const SETTLED_SPEED = 0.03;

/**
 * @param {{id:number,x:number,y:number}[]} atoms
 * @param {{a:number,b:number,order:number}[]} bonds
 * @param {object} [opts]
 * @param {boolean} [opts.recentre=true] keep the molecule's centre fixed (turn off for live
 *        mode, where the user is dragging things around)
 * @param {number} [opts.jitter=1] px of deterministic nudge to escape perfectly symmetric states
 * @param {number} [opts.maxSteps] safety cap on steps before step() reports "settled"
 */
export function createRelaxer(atoms, bonds, { recentre = true, jitter = 1, maxSteps = MAX_STEPS } = {}) {
  const n = atoms.length;
  const index = new Map(atoms.map((a, i) => [a.id, i]));
  const x = atoms.map(a => a.x);
  const y = atoms.map(a => a.y);
  const vx = new Array(n).fill(0);
  const vy = new Array(n).fill(0);

  // A tiny deterministic nudge: perfectly straight chains or stacked atoms
  // are saddle points the springs alone would never escape.
  for (let i = 0; i < n; i++) {
    x[i] += Math.sin(i * 12.9898 + 1) * jitter;
    y[i] += Math.cos(i * 78.233 + 2) * jitter;
  }

  /* ---------- build the force field once ---------- */

  const adj = Array.from({ length: n }, () => []); // [{j, order}]
  const springs = []; // {i, j, d, k}
  const excluded = new Set(); // pairs that don't repel
  const key = (i, j) => (i < j ? i * n + j : j * n + i);

  for (const b of bonds) {
    const i = index.get(b.a);
    const j = index.get(b.b);
    if (i === undefined || j === undefined) continue;
    adj[i].push({ j, order: b.order });
    adj[j].push({ j: i, order: b.order });
    springs.push({ i, j, d: REST[b.order] ?? BOND_LENGTH, k: K_BOND });
    excluded.add(key(i, j));
  }

  for (let c = 0; c < n; c++) {
    const nb = adj[c];
    if (nb.length < 2) continue;

    // everything two bonds apart is excluded from repulsion
    for (let p = 0; p < nb.length; p++)
      for (let q = p + 1; q < nb.length; q++) excluded.add(key(nb[p].j, nb[q].j));

    // neighbours in the order they currently sit around the atom
    const ring = [...nb].sort(
      (p, q) => Math.atan2(y[p.j] - y[c], x[p.j] - x[c]) - Math.atan2(y[q.j] - y[c], x[q.j] - x[c])
    );
    const m = ring.length;

    let degrees;
    if (m === 2) {
      const straight = ring.some(r => r.order === 3) || (ring[0].order === 2 && ring[1].order === 2);
      degrees = straight ? 180 : 120;
    } else {
      degrees = 360 / m;
    }
    const cos = Math.cos((degrees * Math.PI) / 180);

    const pairs = m === 2 ? [[0, 1]] : ring.map((_, k) => [k, (k + 1) % m]);
    for (const [p, q] of pairs) {
      const a = REST[ring[p].order] ?? BOND_LENGTH;
      const b = REST[ring[q].order] ?? BOND_LENGTH;
      const d = Math.sqrt(a * a + b * b - 2 * a * b * cos);
      springs.push({ i: ring[p].j, j: ring[q].j, d, k: K_ANGLE });
    }
  }

  const centre = () => {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
    return { x: sx / n, y: sy / n };
  };
  const start = centre();

  const fx = new Array(n);
  const fy = new Array(n);
  let steps = 0;

  // atoms held in place by the user (index -> {x, y}); the rest of the molecule moves around them
  const pinned = new Map();

  return {
    /** Hold atoms at fixed positions. `pins` is a Map of atom id -> {x, y}; replaces any previous pins. */
    setPins(pins) {
      pinned.clear();
      for (const [id, p] of pins) {
        const i = index.get(id);
        if (i !== undefined) pinned.set(i, p);
      }
    },

    /** Pull in positions changed from outside (undo, other tools). Big jumps reset that atom's speed. */
    sync(list) {
      for (const a of list) {
        const i = index.get(a.id);
        if (i === undefined) continue;
        if (Math.hypot(a.x - x[i], a.y - y[i]) > 0.5) { vx[i] = 0; vy[i] = 0; }
        x[i] = a.x;
        y[i] = a.y;
      }
    },

    /** Something changed: allow another round of settling. */
    nudge() {
      steps = 0;
    },

    /** Advance `count` steps. Returns true once the structure has settled (or time is up). */
    step(count = 1) {
      let maxF = 0;
      let maxV = 0;

      for (let s = 0; s < count; s++) {
        for (const [i, p] of pinned) { x[i] = p.x; y[i] = p.y; vx[i] = 0; vy[i] = 0; }
        fx.fill(0);
        fy.fill(0);

        for (const sp of springs) {
          let dx = x[sp.j] - x[sp.i];
          let dy = y[sp.j] - y[sp.i];
          let d = Math.hypot(dx, dy);
          if (d < 1e-6) { dx = 1e-3; dy = 0; d = 1e-3; }
          const f = (sp.k * (d - sp.d)) / d;
          fx[sp.i] += f * dx; fy[sp.i] += f * dy;
          fx[sp.j] -= f * dx; fy[sp.j] -= f * dy;
        }

        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (excluded.has(key(i, j))) continue;
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const d = Math.hypot(dx, dy);
            if (d >= REPEL_RADIUS) continue;
            let push = K_REPEL * (REPEL_RADIUS - d);
            if (d < CONTACT_RADIUS) push += K_CONTACT * (CONTACT_RADIUS - d);
            const f = push / Math.max(d, 1e-3);
            fx[i] -= f * dx; fy[i] -= f * dy;
            fx[j] += f * dx; fy[j] += f * dy;
          }
        }

        maxF = 0;
        maxV = 0;
        for (let i = 0; i < n; i++) {
          if (pinned.has(i)) continue; // held by the user
          maxF = Math.max(maxF, Math.hypot(fx[i], fy[i]));
          vx[i] = (vx[i] + fx[i]) * DAMPING;
          vy[i] = (vy[i] + fy[i]) * DAMPING;
          const speed = Math.hypot(vx[i], vy[i]);
          if (speed > MAX_STEP) { vx[i] *= MAX_STEP / speed; vy[i] *= MAX_STEP / speed; }
          maxV = Math.max(maxV, Math.min(speed, MAX_STEP));
          x[i] += vx[i];
          y[i] += vy[i];
        }
        steps++;
      }

      // keep the molecule where the user drew it
      if (recentre) {
        const c = centre();
        for (let i = 0; i < n; i++) { x[i] += start.x - c.x; y[i] += start.y - c.y; }
      }

      return (maxF < SETTLED_FORCE && maxV < SETTLED_SPEED) || steps >= maxSteps;
    },

    /** Current positions, in the same order and ids as the input atoms. */
    positions() {
      return atoms.map((a, i) => ({ id: a.id, x: x[i], y: y[i] }));
    },
  };
}
