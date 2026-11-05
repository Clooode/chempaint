/* ============================================================
   tidy.js - "Tidy up" live mode

   While it is on, the optimizer keeps the molecule relaxed:
     - whenever the molecule changes (draw, erase, bond, undo...) it
       settles back into a tidy shape,
     - while you drag an atom it is pinned to your pointer and the rest
       of the molecule follows elastically; let go and it springs back,
     - once everything has settled the loop goes idle, so it costs
       nothing when nothing is happening.

   Turning it on that first tidies the whole molecule, as a single
   undo step. After that, changes belong to whatever you did.
============================================================ */

import { state, snapshot, setPositions, on, emit } from "./state.js";
import { checkpoint } from "./history.js";
import { createRelaxer } from "./optimize.js";
import { clampToCanvas } from "./chem.js";

const STEPS_PER_FRAME = 6;
const SAFETY_STEPS = 600; // per burst of activity; a settled molecule normally needs far fewer
const COMMIT_MOVE = 2; // px: the first tidy only becomes an undo step if something really moved

let live = false;
let relaxer = null;
let signature = "";
let raf = 0;
let ownWrite = false; // true while we are the ones changing the model
let before = null; // snapshot taken when switched on, until the first tidy is recorded

const pins = new Map(); // atom id -> {x, y}: atoms held by the pointer

export const isLive = () => live;

/** Only the structure matters for rebuilding the force field, not positions. */
const topology = () =>
  state.atoms.map(a => a.id).join(",") + "|" + state.bonds.map(b => `${b.a}-${b.b}:${b.order}`).join(",");

function wake() {
  if (live && !raf) raf = requestAnimationFrame(frame);
}

function frame() {
  raf = 0;
  if (!live) return;

  const now = topology();
  if (!relaxer || now !== signature) {
    relaxer = createRelaxer(state.atoms, state.bonds, { recentre: false, maxSteps: SAFETY_STEPS });
    signature = now;
  } else {
    relaxer.sync(state.atoms); // pick up undo / other edits
  }
  relaxer.setPins(pins);

  const settled = relaxer.step(STEPS_PER_FRAME);

  ownWrite = true;
  setPositions(relaxer.positions().map(p => ({ id: p.id, ...clampToCanvas(p) })));
  ownWrite = false;

  if (before) {
    const moved = state.atoms.some(a => {
      const old = before.atoms.find(o => o.id === a.id);
      return old && Math.hypot(a.x - old.x, a.y - old.y) > COMMIT_MOVE;
    });
    if (moved) {
      checkpoint(before); // the whole first tidy is one undo step
      before = null;
    } else if (settled) {
      before = null; // it was already tidy: nothing to record
    }
  }

  // keep going while dragging or still moving; otherwise go idle until something changes
  if (!settled || pins.size > 0) raf = requestAnimationFrame(frame);
}

// any change we didn't make ourselves (a new atom, an erase, undo...) wakes the optimizer
on("model", () => {
  if (ownWrite || !live) return;
  relaxer?.nudge();
  wake();
});

export function setLive(value) {
  if (value === live) return;
  live = value;

  if (live) {
    before = snapshot();
    relaxer = null;
    wake();
  } else {
    cancelAnimationFrame(raf);
    raf = 0;
    pins.clear();
    relaxer = null;
    before = null;
  }
  emit("tidy");
}

export const toggleLive = () => setLive(!live);

/** Hold an atom at a position (while the user drags it). Only meaningful in live mode. */
export function pinAtom(id, x, y) {
  if (!live) return;
  pins.set(id, { x, y });
  relaxer?.nudge();
  wake();
}

/** Let go of an atom: it relaxes back into place. */
export function unpinAtom(id) {
  if (!pins.delete(id)) return;
  relaxer?.nudge();
  wake();
}
