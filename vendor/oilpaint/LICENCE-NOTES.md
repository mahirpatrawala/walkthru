# Licence notes: oil paint

Code MIT. Art CC0 1.0. Checked 2026-11-11.

| Part | Where it came from | Licence | In this repo? |
|---|---|---|---|
| `src/oilpaint/` (dabs, brush, ground, pins, shade, canvas) | Written by Patch for this block | MIT | Yes |
| `src/world/` (land, floor, trees, sky, leaves) | Written by Patch for this demo. Every tree, leaf and brush mark is made in code; no picture or model is loaded for them | MIT; what it draws CC0 | Yes |
| `src/night/` (the ridge, snow, spruces, sky and aurora, water and ranges, the cabin and all in it, the lantern, tracks, snow in the air) | Written by Patch for this demo. Every stroke of it is made in code; no picture, model or sound is loaded for it | MIT; what it draws CC0 | Yes |
| `src/scenes.js`, `src/boot.js`, `src/world/noise.js` | Written by Patch for this demo | MIT | Yes |
| `src/figure/cloak.js`, `figure.js`, `camera.js` | Written by Patch for this demo | MIT; what it draws CC0 | Yes |
| `src/figure/man.js`, `animator.js`, `player.js`, `input.js`, `hands-anymove.json` | Patch's starter man (patch-lab, `starter-character-combined`), copied with three small changes: the three.js import, a loading-progress callback, and a caught pointer-lock refusal | CC0 1.0, Patch | Yes |
| `public/figure/starter-man.glb` | Patch's starter man: built with MPFB2 from MakeHuman system assets (the body, `male_casualsuit06`, `shoes05`, `short01` hair), rigged by Patch onto the Universal Animation Library's skeleton. Its pictures are taken out here, since the demo paints him | CC0 1.0 (MakeHuman's system assets are released as CC0) | Yes, in Git LFS |
| `public/figure/starter-man-clips.glb` | Quaternius' Universal Animation Library 1 and 2 (idle, walk, jog, strafes, turns, jumps), and Patch's own clips made with anymove (run, sprint, starts, stops, the tired idle). The file is rewritten by `tools/compact-glb.mjs`, which leaves out data no clip reads; the clips themselves are unchanged, byte for byte | CC0 1.0 (Quaternius); CC0 1.0, Patch | Yes, in Git LFS |
| `src/figure/rapier/` | Rapier 0.21.0, `@dimforge/rapier3d-compat`, as vendored in patch-lab | Apache-2.0, `src/figure/rapier/LICENSE`, shipped as `RAPIER-LICENSE.txt` | Yes |
| `lib/patch-block.js` | Patch's block helper, from staging.patch.gg/patch-block.js | Patch's, shipped with every block | Yes |
| `shots/` | Stills of this demo | CC0 1.0, Patch | Yes, in Git LFS |
| three.js 0.186.1 | npm | MIT | Installed by npm; its notice ships as `THIRD-PARTY-NOTICES.md` |

No picture is stored or copied, and there is no sound. The aurora scene began from one photograph its author showed as a mood: a small figure with a light under a snowy peak and a green aurora. Nothing of that photograph is in the repo, and its place was not reproduced: the ridge, the horns, the fjord, the cabin and the sky here are this demo's own, made in code.

**Nothing here has no stated source.**
