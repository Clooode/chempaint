/* ============================================================
   input.js - pointer handling for every tool

   Everything goes through Pointer Events on the <svg>, so mouse, touch
   and pen behave the same. Hits are found by delegation (closest
   .atom / .bond), not per-element listeners.

   Tools
     atom   press empty space  -> place an atom (nudged off neighbours)
            press an atom      -> change that atom's element
     bond   drag atom -> atom  -> bond (existing pair: change order)
            drag atom -> empty -> new atom, bonded, at a snapped angle
            click atom, click another atom -> bond
            click a bond       -> change its order
     move   press-drag-release an atom (one undo step per drag)
     erase  click or sweep over atoms / bonds
   Hold Shift while dragging to turn angle snapping off.
============================================================ */

import {
  state, on, getAtom, getBond, findBond, bondsOf, neighbour,
  addAtom, setAtomType, moveAtom, removeAtom, addBond, setBondOrder, removeBond,
  snapshot,
} from "./state.js";
import { checkpoint, undo } from "./history.js";
import {
  svg, clientToSvg, targetOf, setHover, setHeld, setArmed, flash,
  showRubberBand, showGhost,
} from "./render.js";
import {
  clampToCanvas, resolveOverlap, atomNear, snapAround, nextOrder, MIN_ATOM_DIST,
} from "./chem.js";
import { playSound } from "./sound.js";

const DRAG_THRESHOLD = 4; // screen px before a press becomes a drag

/** The gesture in progress, if any. */
let drag = null;
/** Atom picked as the first end of a click-click bond. */
let armedId = null;

/* ---------- rAF-throttled move handling ---------- */

let frame = 0;
let latest = null;

function queueMove(e) {
  latest = {
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: e.shiftKey,
    pointerType: e.pointerType,
  };
  if (!frame) frame = requestAnimationFrame(flushMove);
}

function flushMove() {
  frame = 0;
  const e = latest;
  latest = null;
  if (e && drag) handleDragMove(e);
}

/** Apply any move that is still waiting for its frame (before finishing a gesture). */
function flushPending() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  flushMove();
}

/* ---------- helpers ---------- */

/** What is under a screen position? (Pointer capture hides it from e.target.) */
function hit(e) {
  return targetOf({ target: document.elementFromPoint(e.clientX, e.clientY) ?? svg });
}

function capture(e) {
  try {
    svg.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone */
  }
}

function arm(id) {
  armedId = id;
  setArmed(id);
  if (id == null) showRubberBand(null);
}

/** Bond (or re-order) a pair. Caller has already taken a history checkpoint. */
function bondPair(aId, bId) {
  const existing = findBond(aId, bId);
  if (existing) {
    const order = existing.order === state.bondOrder ? nextOrder(existing.order) : state.bondOrder;
    return setBondOrder(existing.id, order);
  }
  return !!addBond(aId, bId, state.bondOrder);
}

function connect(aId, bId) {
  if (aId === bId) return;
  checkpoint();
  if (bondPair(aId, bId)) playSound("bond/create");
}

/** Drop a new atom next to `fromId` along the pointer direction and bond it. */
function bondToNew(fromId, p, free) {
  const from = getAtom(fromId);
  if (!from) return;
  const pos = clampToCanvas(snapAround(from, p, { free }));
  const near = atomNear(pos, state.atoms, MIN_ATOM_DIST - 1, fromId);

  checkpoint();
  const target = near ?? addAtom(state.element, pos.x, pos.y);
  if (!near) flash(target.id);
  if (bondPair(fromId, target.id)) playSound("bond/create");
}

function placeAtom(p) {
  const pos = resolveOverlap(clampToCanvas(p), state.atoms);
  checkpoint();
  const atom = addAtom(state.element, pos.x, pos.y);
  flash(atom.id);
  setHover(atom.id);
  showGhost(null);
  playSound("atom/place");
}

/** Erase whatever is at `t`. Takes one history checkpoint per stroke. */
function eraseTarget(t) {
  if (t.kind === "atom" && getAtom(t.id)) {
    if (!drag.checkpointed) { checkpoint(); drag.checkpointed = true; }
    removeAtom(t.id);
    setHover(null);
    playSound("atom/delete");
  } else if (t.kind === "bond" && getBond(t.id)) {
    if (!drag.checkpointed) { checkpoint(); drag.checkpointed = true; }
    removeBond(t.id);
    playSound("bond/delete");
  }
}

/* ---------- pointer down ---------- */

svg.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (drag) return; // ignore a second finger mid-gesture

  const t = targetOf(e);
  const p = clientToSvg(e);

  switch (state.tool) {
    case "atom": {
      if (t.kind === "atom") {
        const atom = getAtom(t.id);
        if (atom && atom.type !== state.element) {
          checkpoint();
          setAtomType(atom.id, state.element);
          flash(atom.id);
          playSound("atom/place");
        }
      } else {
        placeAtom(p);
      }
      break;
    }

    case "bond": {
      if (t.kind === "atom") {
        if (armedId != null) {
          // second click of click-click bonding
          const from = armedId;
          arm(null);
          if (from !== t.id) connect(from, t.id);
          break;
        }
        drag = { kind: "bond", pointerId: e.pointerId, fromId: t.id, startX: e.clientX, startY: e.clientY, moved: false };
        capture(e);
      } else if (t.kind === "bond") {
        const bond = getBond(t.id);
        if (bond) {
          checkpoint();
          setBondOrder(bond.id, bond.order === state.bondOrder ? nextOrder(bond.order) : state.bondOrder);
          playSound("bond/create");
        }
      } else {
        arm(null); // clicking empty space cancels a half-made bond
      }
      break;
    }

    case "move": {
      if (t.kind !== "atom") break;
      const atom = getAtom(t.id);
      if (!atom) break;
      drag = {
        kind: "move",
        pointerId: e.pointerId,
        id: atom.id,
        offset: { x: atom.x - p.x, y: atom.y - p.y }, // keep the grab point: no jump
        before: snapshot(),
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      capture(e);
      setHover(null);
      setHeld(atom.id);
      svg.classList.add("dragging");
      playSound("atom/pickup");
      break;
    }

    case "erase": {
      drag = { kind: "erase", pointerId: e.pointerId, checkpointed: false };
      capture(e);
      eraseTarget(t);
      break;
    }
  }
});

/* ---------- pointer move ---------- */

svg.addEventListener("pointermove", e => {
  if (drag) {
    if (e.pointerId === drag.pointerId) queueMove(e);
    return;
  }
  updateHover(e);
});

function updateHover(e) {
  const t = targetOf(e);
  setHover(t.kind === "atom" ? t.id : null);

  const p = clientToSvg(e);

  // ghost atom previews where a click will land
  if (state.tool === "atom" && t.kind !== "atom" && e.pointerType === "mouse") {
    showGhost(resolveOverlap(clampToCanvas(p), state.atoms), state.element);
  } else {
    showGhost(null);
  }

  // rubber band for click-click bonding
  if (armedId != null) {
    const from = getAtom(armedId);
    if (!from) return arm(null);
    const over = t.kind === "atom" && t.id !== armedId ? getAtom(t.id) : null;
    showRubberBand(from, over ?? snapAround(from, p, { free: e.shiftKey }));
  }
}

svg.addEventListener("pointerleave", e => {
  if (drag) return;
  setHover(null);
  showGhost(null);
  if (e.pointerType !== "mouse") showRubberBand(null);
});

function handleDragMove(e) {
  const p = clientToSvg(e);

  switch (drag.kind) {
    case "move": {
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.moved = true;
        checkpoint(drag.before); // exactly one undo step for the whole drag
      }
      const atom = getAtom(drag.id);
      if (!atom) return cancelInteraction();

      let target = { x: p.x + drag.offset.x, y: p.y + drag.offset.y };
      const attached = bondsOf(atom.id);
      if (attached.length === 1 && !e.shiftKey) {
        // one bond: swing around its neighbour in tidy steps
        target = snapAround(neighbour(attached[0], atom.id), target);
      }
      target = clampToCanvas(target);
      moveAtom(atom.id, target.x, target.y);
      break;
    }

    case "bond": {
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.moved = true;
      }
      const from = getAtom(drag.fromId);
      if (!from) return cancelInteraction();

      const t = hit(e);
      const over = t.kind === "atom" && t.id !== from.id ? getAtom(t.id) : null;
      setHover(over ? over.id : null);

      if (over) {
        showRubberBand(from, over);
        showGhost(null);
      } else {
        const pos = clampToCanvas(snapAround(from, p, { free: e.shiftKey }));
        showRubberBand(from, pos);
        showGhost(pos, state.element);
      }
      break;
    }

    case "erase":
      eraseTarget(hit(e));
      break;
  }
}

/* ---------- pointer up / cancel ---------- */

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  flushPending();
  const d = drag;
  drag = null;

  try {
    svg.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }

  switch (d.kind) {
    case "move":
      setHeld(null);
      svg.classList.remove("dragging");
      if (d.moved && !cancelled) playSound("atom/drop");
      break;

    case "bond": {
      showRubberBand(null);
      showGhost(null);
      setHover(null);
      if (cancelled) break;

      if (!d.moved) {
        arm(d.fromId); // a plain click: wait for the second atom
        break;
      }
      const t = hit(e);
      if (t.kind === "atom" && t.id !== d.fromId) {
        connect(d.fromId, t.id);
      } else if (t.kind !== "atom") {
        bondToNew(d.fromId, clientToSvg(e), e.shiftKey);
      }
      break;
    }
  }
}

svg.addEventListener("pointerup", e => endDrag(e, false));
svg.addEventListener("pointercancel", e => endDrag(e, true));
svg.addEventListener("lostpointercapture", e => endDrag(e, true));

/* ---------- cancel (Esc, tool change, undo/redo) ---------- */

/**
 * Abort whatever gesture is in progress.
 * @param {{revert?: boolean}} opts revert: also undo a drag's movement (Esc)
 */
export function cancelInteraction({ revert = false } = {}) {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  latest = null;

  if (drag) {
    const d = drag;
    drag = null;
    try {
      svg.releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    if (d.kind === "move") {
      setHeld(null);
      svg.classList.remove("dragging");
      if (revert && d.moved) undo();
    }
  }

  arm(null);
  showRubberBand(null);
  showGhost(null);
}

let lastTool = state.tool;
on("ui", () => {
  if (state.tool !== lastTool) {
    lastTool = state.tool;
    cancelInteraction();
  }
});
