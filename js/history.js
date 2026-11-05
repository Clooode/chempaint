/* ============================================================
   history.js - undo / redo over pure-data snapshots
============================================================ */

import { snapshot, restore, emit } from "./state.js";

const LIMIT = 100;
let undoStack = [];
let redoStack = [];

/**
 * Call BEFORE mutating the model. Pass an earlier snapshot to record a
 * state captured previously (e.g. at the start of a drag).
 */
export function checkpoint(snap = snapshot()) {
  undoStack.push(snap);
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
  emit("history");
}

/** @returns {boolean} whether anything actually changed */
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  emit("history");
  return true;
}

/** @returns {boolean} whether anything actually changed */
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  emit("history");
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function resetHistory() {
  undoStack = [];
  redoStack = [];
  emit("history");
}
