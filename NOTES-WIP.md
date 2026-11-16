# WIP notes (elder branch, 16 Nov 2026)

State: work in progress, not final. Do not merge as is.

## Done
- Elder wears a tunic and trousers (outfit `tunic` in tools/make_family.py, colours in src/look/people-materials.ts, SPEC 16.6.11b). Saree builder kept as outfit option `saree`.
- Owner's close/high-view complaint (SPEC 16.6.11d): man's shirt is now TUCKED in with belt, buckle, waistband; slimmer torso/sleeves (chest 1.08, upper arm 1.16); round flat collar (stand + conical fold, darker via vertex colour `SHADE`), front placket, yoke seam, back pleat. Woman, elder, child tops slimmed.
- Hair: roughness 0.9; tests/people-hair.test.ts rays down over the crown in 5 poses, both tiers, all four people, passes (least clearance 7.7 mm). The owner's bald spot could not be reproduced (geometry is fine).
- Sit hands: src/look/retarget.ts sitHandsUp (SIT_ELBOW_DEG 36, SIT_ARM_DEG 12), tests/people-sit-hands.test.ts.
- Trouser leg weights: below ankle follow the calf (shoe_free); trousers waist of woman/elder/child now outside the skin.
- GLBs/thumbs/lock: regenerated GLBs and thumbs are in public/characters; people.lock.json NOT yet refreshed in this checkpoint.

## Half-done / known problems
- Seated pose still shows small skin scraps at thigh front / knee for the woman and elder (man slightly), and a torn-looking trouser hem next to the shoe on one leg in some sit frames. Was about to: raise FIT_CAP for legs (0.006 -> 0.012) and the knee offsets by ~3 mm in make_family.py, then rebuild and re-check. HAND_HI/HAND_SPAN (trouser weights handover) was moved to 0.17/0.10 to give the hip thigh weights back: check the seat from behind is still clean.
- Close sheets (close-after-*.png) were taken before the last two changes (HAND_HI, shoe_free, trousers waist) except where noted.
- Not yet done after the last rebuild: full sheets for four people, before-after-elder.png refresh, together shot, tsc, make:room + vite build, fetch-people (needs `node tools/refresh-people-lock.mjs "<note>"` first), full vitest, killing vite/Chrome/Blender.

## Next steps (commands)
1. Fix the sit scraps (see above), rebuild all: `/private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/clothes/elder/shipall.sh` (blender export + thumbs + optimise + copy into public/characters; ~4 min; needs the sample file elder/cs.json made by `npx tsx tools/dump-clip-samples.ts <scratchpad>/clothes/elder/cs.json elder`).
2. Start `npx vite --port 5431` in this worktree, then `scratchpad/clothes/final2.sh` (close-after both tiers, phone, all sheets, picker, together) and `retake2.sh` (steady sit shots with motion.pause stepping). Look at the sheets.
3. `node tools/refresh-people-lock.mjs "..."`, `npx tsx scripts/fetch-people.ts`, `npx tsc --noEmit`, `npm run make:room && npx vite build` (git checkout public/upload/sample-plan.pdf if changed), `npx vitest run --maxWorkers=2`.
4. Kill vite, Chrome, Blender (`pkill -f "vite --port 5431"; pkill -f scratchpad/clothes`).

## Images (scratchpad = /private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/clothes/)
- close-before-man.png (old look from the owner's viewpoint), close-after-{man,woman,elder,child}.png, close-after-phone-man.png
- sheet-{man,woman,elder,child}.png, before-after-elder.png, before-after-man.png (older), retake2/sitall.png (steady sit crops)
