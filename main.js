/* ============================================================
   GLOBAL STATE
============================================================ */

let currentTool = "atom";

let atoms = [];
let bonds = [];

let atomId = 0;
let bondId = 0;

let selectedAtomForBond = null;

let undoStack = [];
let redoStack = [];
let pickedAtom = null;
let canMove = false;

const canvas = document.getElementById("canvas");

const soundCache = {};

async function loadSoundFolder(folderPath, prefix) {
  if (soundCache[folderPath]) return soundCache[folderPath];

  const sounds = [];
  let index = 1;

  while (true) {
    const path = `${folderPath}${prefix}${index}.wav`;

    const res = await fetch(path);
    if (!res.ok) break;

    sounds.push(new Audio(path));
    index++;
  }

  soundCache[folderPath] = sounds;
  return sounds;
}

async function playSound(folder) {
  // folder = "atom/place"
  const parts = folder.split("/");
  const prefix = parts[parts.length - 1]; // "place", "pickup", "delete", etc.

  const sounds = await loadSoundFolder(`assets/sounds/${folder}/`, prefix);
  if (!sounds || sounds.length === 0) return;

  const sound = sounds[Math.floor(Math.random() * sounds.length)].cloneNode();
  sound.volume = 0.7;
  sound.play();
}


/* ============================================================
   STATE SNAPSHOTS (UNDO / REDO)
============================================================ */

function saveState() {
  undoStack.push({
    atoms: JSON.parse(JSON.stringify(atoms)),
    bonds: JSON.parse(JSON.stringify(bonds))
  });
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push({
    atoms: JSON.parse(JSON.stringify(atoms)),
    bonds: JSON.parse(JSON.stringify(bonds))
  });

  const prev = undoStack.pop();
  atoms = prev.atoms;
  bonds = prev.bonds;

  redrawAll();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push({
    atoms: JSON.parse(JSON.stringify(atoms)),
    bonds: JSON.parse(JSON.stringify(bonds))
  });

  const next = redoStack.pop();
  atoms = next.atoms;
  bonds = next.bonds;

  redrawAll();
}

/* ============================================================
   REDRAW EVERYTHING
============================================================ */

function redrawAll() {
  canvas.innerHTML = "";

  atoms.forEach(a => {
    const el = drawAtom(a);
    a.el = el;
  });

  bonds.forEach(b => {
    const el = drawBond(b);
    b.el = el;
  });
}

/* ============================================================
   TOOLBAR
============================================================ */

document.querySelectorAll("#toolbar button[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => {
    currentTool = btn.dataset.tool;
    selectedAtomForBond = null;

    playSound("ui/click");
  });
});

document.getElementById("undoBtn").addEventListener("click", () => {
  playSound("ui/undo");
  undo();
});

document.getElementById("redoBtn").addEventListener("click", () => {
  playSound("ui/redo");
  redo();
});

document.querySelectorAll(".element-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentElementType = btn.dataset.element;
    // DO NOT set currentTool here
  });
});

/* ============================================================
   ATOM CREATION
============================================================ */

function drawAtom(atom) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "image");

  el.setAttribute("href", `assets/elements/${atom.type}.png`);
  el.setAttribute("width", 48);
  el.setAttribute("height", 48);
  el.setAttribute("x", atom.x - 24);
  el.setAttribute("y", atom.y - 24);

  el.setAttribute("pointer-events", "all");

  el.classList.add("atom");
  el.dataset.id = atom.id;

  canvas.appendChild(el);

  el.addEventListener("click", e => {

  // If we are already holding an atom, let the canvas handle the drop
  if (currentTool === "move" && pickedAtom) {
    return;
  }

  e.stopPropagation();

  if (currentTool === "erase") {
    deleteAtom(el);
    return;
  }

  if (currentTool === "bond") {
    handleBondClick(el);
    return;
  }

  if (currentTool === "move") {
    if (!pickedAtom) {
      pickedAtom = el;
      playSound("atom/pickup");
      return;
    }
  }
});}


let currentElementType = "C";

document.querySelectorAll(".element-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentElementType = btn.dataset.element;
    currentTool = "atom";
  });
});

function placeAtom(x, y) {
  saveState();

  const id = ++atomId;
  const type = currentElementType;

  const atom = { id, type, x, y };
  atoms.push(atom);

  atom.el = drawAtom(atom);
  playSound("atom/place");

}


/* ============================================================
   DELETE ATOM
============================================================ */

function deleteAtom(atomEl) {
  saveState();

  const id = Number(atomEl.dataset.id);

  bonds = bonds.filter(b => {
    if (b.a === id || b.b === id) {
      if (b.el && b.el.remove) b.el.remove();
      return false;
    }
    return true;
  });

  atoms = atoms.filter(a => a.id !== id);
  atomEl.remove();
  playSound("atom/delete");

}


let currentBondOrder = 1;

const bondMap = { single: 1, double: 2, triple: 3 };

document.querySelectorAll(".bond-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentBondOrder = bondMap[btn.dataset.bond];
    currentTool = "bond";
  });
});

function handleBondClick(atomEl) {
  if (!selectedAtomForBond) {
    selectedAtomForBond = atomEl;
    return;
  }

  if (selectedAtomForBond === atomEl) {
    selectedAtomForBond = null;
    return;
  }

  createBond(selectedAtomForBond, atomEl);
  selectedAtomForBond = null;
}

function createBond(aEl, bEl) {
  saveState();

  const a = atoms.find(x => x.id == aEl.dataset.id);
  const b = atoms.find(x => x.id == bEl.dataset.id);

  const id = ++bondId;
  const bond = { id, a: a.id, b: b.id, order: currentBondOrder };

  bonds.push(bond);
  bond.el = drawBond(bond);
  playSound("bond/create");

}

function drawBondImage(group, a, b, order) {
while (group.firstChild) group.removeChild(group.firstChild);


  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.sqrt(dx*dx + dy*dy);

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  // midpoint
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  // choose correct sprite
  const src = {
    1: "assets/bonds/single.png",
    2: "assets/bonds/double.png",
    3: "assets/bonds/triple.png"
  }[order];

  const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
  img.setAttribute("href", src);

  img.setAttribute("width", length);
  img.setAttribute("height", 16); // adjust to your sprite height

  // position so the center of the image is at midpoint
  img.setAttribute("x", midX - length/2);
  img.setAttribute("y", midY - 8); // half of height

  img.setAttribute("transform", `rotate(${angle}, ${midX}, ${midY})`);
  img.setAttribute("image-rendering", "pixelated");

  group.appendChild(img);
}

function drawBond(bond) {
  const a = atoms.find(x => x.id === bond.a);
  const b = atoms.find(x => x.id === bond.b);

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.dataset.id = bond.id;
  group.classList.add("bond");

  drawBondImage(group, a, b, bond.order);

  canvas.appendChild(group);
  return group;
}

function deleteBond(bondEl) {
  saveState();

  const id = Number(bondEl.dataset.id);

  // Remove from array
  bonds = bonds.filter(b => b.id !== id);

  // Remove from DOM
  if (bondEl && bondEl.remove) bondEl.remove();

  // Play sound
  playSound("bond/delete");
}

/* ============================================================
   DRAGGING
============================================================ */


window.addEventListener("mousemove", e => {
if (!pickedAtom) return;

  const id = Number(pickedAtom.dataset.id);
  const atom = atoms.find(a => a.id === id);

  const pt = canvas.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const svgP = pt.matrixTransform(canvas.getScreenCTM().inverse());

  // svgP is top-left of the image, so add half-size to get center
// Check how many bonds this atom has
const connected = bonds.filter(b => b.a === id || b.b === id);

// If no bonds → free movement
if (connected.length === 0) {
  atom.x = svgP.x + 24;
  atom.y = svgP.y + 24;
}

// If exactly one bond → snap angle
else if (connected.length === 1) {
  const bond = connected[0];
  const anchorId = bond.a === id ? bond.b : bond.a;
  const anchor = atoms.find(a => a.id === anchorId);

  // Raw vector from anchor to mouse
  const dx = (svgP.x + 24) - anchor.x;
  const dy = (svgP.y + 24) - anchor.y;

  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const snapped = snapToNearest60(angle);

  const rad = snapped * Math.PI / 180;
  const length = Math.sqrt(dx*dx + dy*dy);

  atom.x = anchor.x + Math.cos(rad) * length;
  atom.y = anchor.y + Math.sin(rad) * length;
}

// If 2+ bonds → do NOT snap (too constrained)
else {
  atom.x = svgP.x + 24;
  atom.y = svgP.y + 24;
}


  pickedAtom.setAttribute("x", atom.x - 24);
  pickedAtom.setAttribute("y", atom.y - 24);

  // redraw bonds
  bonds.forEach(b => {
    if (b.a === id || b.b === id) {
      const a = atoms.find(a => a.id === b.a);
      const bb = atoms.find(a => a.id === b.b);
      drawBondImage(b.el, a, bb, b.order);
    }
  });
});


/* ============================================================
   CANVAS CLICK
============================================================ */
canvas.addEventListener("click", e => {

  // 1. If moving and holding an atom → DROP IT
  if (currentTool === "move" && pickedAtom) {
    pickedAtom = null;
    canMove = false;
    playSound("atom/drop");
    return;
  }

  // 2. If NOT moving anything, and you clicked an atom/bond → ignore (prevents placing atoms on top)
  if (!pickedAtom && (e.target.classList.contains("atom") || e.target.classList.contains("bond"))) {
    return;
  }

  // 3. Atom placement
  if (currentTool === "atom") {
    const pt = canvas.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(canvas.getScreenCTM().inverse());

    placeAtom(svgP.x, svgP.y);
  }
});


/* ============================================================
   EXPORT TO SVG
============================================================ */

function exportSVG() {
  const data = new XMLSerializer().serializeToString(canvas);
  const blob = new Blob([data], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "molecule.svg";
  a.click();

  URL.revokeObjectURL(url);
}

document.getElementById("exportBtn").addEventListener("click", exportSVG);
