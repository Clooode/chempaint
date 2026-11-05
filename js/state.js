/* ============================================================
   state.js - the single source of truth + a tiny event bus

   The model holds plain data only. Atoms are {id, type, x, y} and
   bonds are {id, a, b, order}. Nothing here knows about the DOM, so
   snapshots for undo/redo are trivial and can never go stale.

   Events:
     "model"   atoms/bonds changed (renderer redraws)
     "ui"      tool / element / bond order changed
     "history" undo/redo availability changed
============================================================ */

const listeners = {};

export function on(event, fn) {
  (listeners[event] ||= []).push(fn);
}

export function emit(event, data) {
  for (const fn of listeners[event] || []) fn(data);
}

export const state = {
  atoms: [],
  bonds: [],
  nextAtomId: 1,
  nextBondId: 1,

  tool: "atom", // "atom" | "bond" | "move" | "erase"
  element: "C",
  bondOrder: 1,
};

/* ---------- lookups ---------- */

export const getAtom = id => state.atoms.find(a => a.id === id);
export const getBond = id => state.bonds.find(b => b.id === id);

export function findBond(aId, bId) {
  return state.bonds.find(
    b => (b.a === aId && b.b === bId) || (b.a === bId && b.b === aId)
  );
}

export const bondsOf = atomId =>
  state.bonds.filter(b => b.a === atomId || b.b === atomId);

/** The atom on the other end of `bond` from `atomId`. */
export function neighbour(bond, atomId) {
  return getAtom(bond.a === atomId ? bond.b : bond.a);
}

/* ---------- mutations (callers are responsible for history checkpoints) ---------- */

export function addAtom(type, x, y) {
  const atom = { id: state.nextAtomId++, type, x, y };
  state.atoms.push(atom);
  emit("model");
  return atom;
}

export function setAtomType(id, type) {
  const atom = getAtom(id);
  if (!atom || atom.type === type) return false;
  atom.type = type;
  emit("model");
  return true;
}

export function moveAtom(id, x, y) {
  const atom = getAtom(id);
  if (!atom) return;
  atom.x = x;
  atom.y = y;
  emit("model");
}

/** Move many atoms at once (one "model" event). Unknown ids are ignored. */
export function setPositions(positions) {
  for (const p of positions) {
    const atom = getAtom(p.id);
    if (atom) {
      atom.x = p.x;
      atom.y = p.y;
    }
  }
  emit("model");
}

/** Removes the atom and every bond attached to it. */
export function removeAtom(id) {
  state.bonds = state.bonds.filter(b => b.a !== id && b.b !== id);
  state.atoms = state.atoms.filter(a => a.id !== id);
  emit("model");
}

/** Adds a bond. Returns null for self-bonds or when the pair is already bonded. */
export function addBond(aId, bId, order) {
  if (aId === bId || !getAtom(aId) || !getAtom(bId) || findBond(aId, bId)) return null;
  const bond = { id: state.nextBondId++, a: aId, b: bId, order };
  state.bonds.push(bond);
  emit("model");
  return bond;
}

export function setBondOrder(id, order) {
  const bond = getBond(id);
  if (!bond || bond.order === order) return false;
  bond.order = order;
  emit("model");
  return true;
}

export function removeBond(id) {
  state.bonds = state.bonds.filter(b => b.id !== id);
  emit("model");
}

export function clearAll() {
  state.atoms = [];
  state.bonds = [];
  emit("model");
}

/* ---------- snapshots (used by history + save/load) ---------- */

export function snapshot() {
  return {
    atoms: state.atoms.map(a => ({ ...a })),
    bonds: state.bonds.map(b => ({ ...b })),
  };
}

export function restore(snap) {
  state.atoms = snap.atoms.map(a => ({ ...a }));
  state.bonds = snap.bonds.map(b => ({ ...b }));
  // keep id counters ahead of anything we just loaded
  state.nextAtomId = Math.max(state.nextAtomId, ...state.atoms.map(a => a.id + 1), 1);
  state.nextBondId = Math.max(state.nextBondId, ...state.bonds.map(b => b.id + 1), 1);
  emit("model");
}

export const isEmpty = () => state.atoms.length === 0;

/* ---------- UI state ---------- */

export function setTool(tool) {
  if (state.tool === tool) return;
  state.tool = tool;
  emit("ui");
}

export function setElement(element) {
  state.element = element;
  emit("ui");
}

export function setBondOrderPref(order) {
  state.bondOrder = order;
  emit("ui");
}
