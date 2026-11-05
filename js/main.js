/* ============================================================
   main.js - bootstrap

   Module overview
     chem.js     pure geometry + valence helpers
     state.js    model + UI state + event bus
     history.js  undo / redo
     render.js   keyed SVG renderer
     input.js    pointer tools
     ui.js       toolbar + keyboard
     sound.js    sound effects
     export.js   SVG / PNG / JSON / autosave
============================================================ */

import { ELEMENTS } from "./chem.js";
import { preloadSprites } from "./render.js";
import { initAutosave } from "./export.js";
import "./input.js";
import "./ui.js";

preloadSprites(ELEMENTS);
initAutosave();
