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
  render.js   keyed SVG renderer (bonds under atoms)
  input.js    pointer-event tools
  ui.js       toolbar, keyboard shortcuts, toasts
  sound.js    sound effects (explicit manifest of files)
  export.js   SVG / PNG / JSON export, autosave
```

Adding a sound: drop the `.wav` in `assets/sounds/<group>/<action>/` and list it in the manifest in `js/sound.js`.
