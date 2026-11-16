# WIP notes: navigation aids (mini plan, room bar, Tour), branch `nav`

## Done
- `src/buyer/nav/`: grid-path.ts (lattice Dijkstra + string pulling), door-route.ts (shut doors on a route, standing spot outside the swing, plan grid with open leaves), tour-plan.ts (stops, order, dwell), nav-model.ts (chips from roomsSummary, liftAbove, conePath, roomNear, goDecision), driver.ts (pure state machine: goTo, startTour, pause/resume/stop), mount.ts (DOM: minimap via planSvg, room bar, tour strip, fade, input interrupts, debug hooks), nav.css.
- Hooks: main.ts (import, mountNav + cleanup, `nav.drive(dt)` before stepLocomotion, `nav` in debug api), doors.ts (`Doors.route.leaves/open`), buyer.css (.wt-stack bottom uses --wt-nav-h).
- Tests: tests/nav-pure.test.ts (14 pass), tests/nav-tour.test.ts (7 pass; full 15-room tour of Flat 204 on real layout, doors shut, no body in solid, ends at start, go-to walk/fade, pause/stop/reduced motion), helpers in tests/helpers/nav-sim.ts.
- SPEC 2.6 written (verification numbers section still to add).
- Browser checks so far: desktop + phone portrait screenshots OK (map open/collapsed, bar, chip jump, tour strip, mid-tour rooms/door).

## Half-done / open
- Browser full-tour audit: `nav.debug.simulate(seconds)` + `audit()` added (headless, runs doors + driver without frames). A run with the real furniture showed many rooms skipped with "door X would not open" in an earlier stepped (paused) harness run; that is believed to be a harness artefact (doors use real frame dt, the stepped sim does not) but is NOT yet confirmed. Real-time audit: 15420 frames, 0 in solid. Confirm with `scratchpad/t6.js` (uses simulate).
- Not yet captured: single-room scenes (pool, clubhouse, gym, son-bedroom), standalone sample home, first person, leak cycle (`__walkthruBuilding.go` x20, check one .wt-nav-map/.wt-nav-bar).
- Full verification: `npx tsc --noEmit`, `npm run make:room && npx vite build` (revert public/upload/sample-plan.pdf if changed), `npx vitest run --maxWorkers=2` (tests/doors.test.ts "end to end on made-up drawing sets" timed out under load: re-run alone).
- SPEC: add verification numbers; final cleanup: `pkill -f "vite --port 5461"`, `pkill -f scratchpad/nav` (careful: pkill -f matches your own shell if its command line contains the pattern).

## Commands
- dev: `npx vite --port 5461`; harness: `CDP_OUT=/private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/nav node tools/cdp.mjs "<url>&debug=1" <script.js>`
- Scripts t1..t6, t4 (per-scene check, env NAME) are in /private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/

## Screenshots
/private/tmp/claude-501/-Users-mahir/140fc635-6aa7-4006-8592-bed65a74eea9/scratchpad/nav/ (t1-desktop, t2-phone-*, t3-tour-*)
