# ChemPaint

A Tux Paint-style molecule builder. Plain HTML, CSS and JavaScript (ES modules): no build step, no backend, so it runs as-is on GitHub Pages.

## Run it locally

Browsers won't load ES modules from `file://`, so serve the folder:

```
python -m http.server 8000
```

then open <http://localhost:8000>.

## How to use

| Tool | What it does |
|---|---|
| **Atoms** | Pick an element, click the canvas to place it. Click an existing atom to change its element. |
| **Bonds** | Drag from an atom to another atom to bond them, or drag to empty space to grow a new atom. Or click one atom, then another. Click a bond (or re-bond a pair) to change its order. |
| **Move** | Press, drag, release. Atoms with one bond swing around their neighbour in 30° steps. |
| **Erase** | Click or sweep over atoms and bonds. |

**Tidy up** (button, or `T`) is a switch. While it is on, a tiny physics simulation keeps the molecule relaxed: bonds spring to a standard length (double and triple bonds are shorter), bonds around an atom spread to 120° / 180° / 90°, and atoms that aren't bonded push apart. Draw, erase, bond or undo and it settles back into shape. **You can drag atoms while it's on**: the atom you hold follows your pointer, the rest of the molecule is pulled along elastically, and when you let go it springs back. Turning it on is one undo step, and each drag after that is its own step. It goes idle when everything has settled. (With it off, dragging an atom that has one bond snaps it to 30° steps instead.)

Hold **Shift** while dragging to turn angle snapping off. A red pulsing ring means an atom has more bonds than its usual valence (a hint only, nothing is blocked).

Shortcuts: `Ctrl+Z` undo, `Ctrl+Shift+Z` / `Ctrl+Y` redo, `Ctrl+S` save, `Esc` cancel a drag, `1` `2` `3` bond order, `C H O N S F` elements (`Shift+L` Cl, `Shift+B` Br), `M` move, `E` / `Delete` erase, `A` atoms, `B` bonds.

Work is autosaved in your browser. **Save** / **Open** use a `.json` file; **SVG** / **PNG** export a picture.

## Code layout

```
js/
  main.js     bootstrap
  state.js    model (plain data), UI state, tiny event bus
  chem.js     pure helpers: snapping, overlap, valence
  history.js  undo / redo (snapshots)
  optimize.js physics relaxer behind "Tidy up" (pure, no DOM)
  tidy.js     live "Tidy up" mode: runs the relaxer, pins dragged atoms
  render.js   keyed SVG renderer (bonds under atoms)
  input.js    pointer-event tools
  ui.js       toolbar, keyboard shortcuts, toasts
  sound.js    sound effects (explicit manifest of files)
  export.js   SVG / PNG / JSON export, autosave
```

Adding a sound: drop the `.wav` in `assets/sounds/<group>/<action>/` and list it in the manifest in `js/sound.js`.
