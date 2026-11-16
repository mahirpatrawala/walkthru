# NOTES-WIP (branch `crisp`, work in progress, not pushed)

Task: make the walk-through crisp (owner complaint: soft picture, beige walls, slab doors, thick joints). Brief and later owner messages (competitor
references, both first and third person must be crisp, zoom test at 30 cm) are in the coordinator's chat; this file is the state.

## Done (code, all compiling: `npx tsc --noEmit` is clean)
- A. Sharpness: `src/look/resolution.ts` (pure governor, 2 -> 1.75 -> 1.5 -> 1.25 before the tier steps down; tests `tests/resolution-governor.test.ts`), tier table in
  `src/look/quality.ts` (medium cap 2.0, phones 1.5, msaa 4, anisotropy 16, medium has post, shadows 2048 medium / 4096 high), look.ts integration (governor,
  shadow step 4096 -> 2048, compileAsync), composer MSAA + optional sharpen/SMAA switches in `src/look/post.ts` (`?aa=smaa`, `?sharpen=0.6`, `?ao=off`), crisp text
  canvases (signs, door labels, pool signs, door plates).
- B. No photos on the shell: `src/look/procedural.ts` + shader work in `src/look/materials.ts` (tile joint/bevel/speckle, paint grain/relief/ceiling shadow line, wall corner
  shading from the `lkEnd` vertex attribute, procedural frame wood); frames with lining/stop/architrave/lintel + window lining in `src/engine/shell.ts`; skirting
  profile + downlight rings + pack trim in `src/look/kit/*`; door leaf rewrite in `src/buyer/doors-model.ts`.
- C. Packs: `clean-contrast` (default) and `clean-contrast-dark` in `src/look/packs/`, finishes in `src/look/finishes.ts`, `trim`/`tiles` pack fields, 8 typical design sheets
  retargeted (and `scripts/building/flats.ts`), grade presets less warm (`src/look/grade.ts`).
- D. Camera: `src/engine/camera.ts` (FP fov 72/80 portrait, near 0.03, third-person glide to the eyes when the boom is short, `fade`), `viewer.ts` fov hook,
  `buyer/main.ts` (hide body by `camera.fade`, `?view=`), default view flip point `DEFAULT_VIEW` in `src/buyer/person-store.ts`.
- Tests written/updated: `tests/crisp-shell.test.ts`, `tests/resolution-governor.test.ts`, look-pure, gen-style, look-kit, shell, building-brochure-flats, gen-furniture, model-library.

## Half done
- Visual tuning at DPR 2 (AO smudges on walls near frames, floor tint, handle shading): last edits lowered AO (`AO_BASE` 0.95, radius 0.35) and made dark handles part-diffuse.
  Not yet re-captured.
- Full "after" capture set not yet taken (it was killed to apply the edits above). "Before" set is complete except: flat first medium/high have no sign/zoom views.
- SPEC 16.18 draft is in the scratchpad (`spec1618.md`), NOT yet in SPEC.md. Numbers (renderer.info, texture memory) still to fill.
- Full vitest run: last full run (excluding understand-*) had only the expected pin failures now fixed + 3 load-sensitive timeouts (building-validate, doors e2e, podium-level):
  re-run those alone. `tests/understand-raster-eval.test.ts` and `tests/understand-elevations.test.ts` time out under load: re-run alone.
- Not done: sharpen on/off comparison, SMAA vs MSAA crops, phone-size capture set, standalone-home capture set, `npm run make:room && npx vite build`.

## Next steps (commands)
1. `cd ~/walkthru-wt/crisp && npx vite --port 5441` (and the pre-change copy of the repo for "before" lives at
   `/private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/beforetree`, `npx vite --port 5442` there).
2. Captures (never edit src while one runs: vite reloads the page): `S=/private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad;`
   `$S/runlist.sh after 5441 "flat first medium" "club first medium" "flat third medium" "club third medium" "flat first high" "club first high" "flat third high" "club third high"`
   (each combo is `<set> <mode> <tier>`, sets: flat, club, home; env DPR=2 W=1280 H=800; phone: `MOBILE=1 W=390 H=844 DPR=3`; `VIEWS=door,sign,zoomfloor,...`).
   Scripts: `tools/crisp/shots.js`, `tools/crisp/inject-gl.js`, `tools/cdp.mjs` (DPR, INJECT, MOBILE env added).
3. Sheets: `~/walkthru-tools/ocr/venv/bin/python $S/sheet.py out.png before.png after.png "door edge:x,y,w,h" ...` -> `$S/crisp/before-after-<view>.png`.
4. `npx tsc --noEmit`, `npm run make:room && npx vite build` (revert public/upload/sample-plan.pdf), `npx vitest run --maxWorkers=2`.
5. Paste the SPEC subsection into SPEC.md after 16.17 (before `## 17`), kill `vite --port 5441/5442` and headless chrome (`pkill -f scratchpad/crisp`).

## Images
Before (current code of the day, DPR 2, 1280x800 css px): `/private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/crisp/before-*.png`
Tuning tests: `.../crisp/t1..t4-*.png` (DPR 1). After set: `.../crisp/after-*.png` (partial).
