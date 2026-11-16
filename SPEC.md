# walkthru: build spec (Phase 1, walkable prototype)

Status: locked for build, 12 Nov 2026. Source plan: `~/.claude/plans/i-want-to-create-swirling-quiche.md`, amended by two later instructions from Mahir (virtual furniture, and layout-first; see 0.1).
Audience: Sonnet coding agents, one chunk each (section 9). If something here is ambiguous, follow the literal text and leave a `// SPEC-GAP:` comment. Do not invent scope.

## 0. What we are building

A property broker sends what brokers actually send. A buyer opens a web link, picks their height, and walks the flat as a third-person character.

The thing no competitor has is **checks at real-body scale**:

1. **Furnish and fit.** Most Indian listings are empty flats. The buyer drops a real-size bed, sofa, dining table or wardrobe into a room and immediately sees "King bed fits. 62 cm walking space on the left, 110 cm at the foot."
2. **Lie, sit, stand.** The character lies on a bed and gets a verdict against their own height. Sits on the sofa. Stands at a counter.
3. **Room sizes.** Every room and the balcony shows its area in sq ft and m², plus the carpet area.
4. **Measure anything.** Tap two points.

Everything else stays minimal. No accounts, no backend, no video processing pipeline, no multi-floor, no stairs.

### 0.1 The hard constraint: layout first, splat optional

Assume **every** input looks like the reference sample: a 35 second, 720x1280, WhatsApp-compressed phone video, one fast walk through an empty flat with blank white walls and glossy vitrified tiles, and maybe a few WhatsApp photos. Better capture cannot be required. Evidence: COLMAP placed only 23 of 142 frames of that video, in two fragments. A photoreal splat of the whole flat will usually not exist.

So the base world is **a clean 3D shell built from a traced room layout**, not a splat:

- Floor, walls with real thickness, door and window openings, balcony with railing.
- Tinted with colours sampled from the video frames, with a tile grid at the real tile size. It should feel like that flat, honestly labelled "colours approximate (from phone video)".
- The shell gives collision, scale, room areas and furniture fit checks exactly, with nothing patchy about it.
- A Gaussian splat, where a fragment or a full scan exists, is an **optional overlay** aligned to the shell. With a future good capture the splat can replace the shell's look while the layout still does collision and measurement.

Decisions this replaces from the original plan, each with its reason:
- Collision comes from the layout, not from splat points. A vector layout rasterises to a perfect grid; a patchy splat does not.
- Scale comes from the floor plan's printed dimensions (or typed room sizes), not from tapping two points on a splat. Two-point is kept only for aligning a splat.
- Floor detection from splat points survives, but only to level a splat before aligning it.

### 0.2 How a layout gets made

(a) **Phase 1, semi-automatic, in the broker editor.** Best path: upload the builder's floor-plan image (brokers nearly always have the brochure plan with room dimensions), click the two ends of two printed dimensions and type them, then trace the rooms. Second path with no plan: draw rooms on a blank metric grid and type their sizes, using the tile-count helper. Third path when a decent splat exists: trace over its top-down image.

(a2) **Drawing import (C8, section 13).** When the broker or an interior designer has a vector CAD drawing set (a PDF plan, ideally with elevations), a script reads walls, rooms, openings, labelled furniture and the ceiling height straight from it and writes a proposal for review in the editor. This is the ideal input.

(b) **Phase 2, automatic, not built now.** A cloud GPU job (Modal) runs per-frame metric depth (MoGe-2, Depth Anything V2 metric, UniDepth) and feed-forward pose models (VGGT, MASt3R, pi3) and proposes walls. Phase 1 only defines the plug: a `proposal.json` in the scene folder with the `LayoutProposal` type (3.3) and a "Load proposal" button that drops it into the editor for correction.

---

## 1. Locked library choices

Node 24 lives at `~/.local/node/bin` and is not on PATH. Every command starts with `export PATH="$HOME/.local/node/bin:$PATH"`.

All versions were checked on npm on 12 Nov 2026 and are at least two weeks old. The full set was installed together and a file importing three, `GLTFLoader` and Spark's `SparkRenderer` / `SplatMesh` / `forEachSplat` passed `tsc --noEmit`. Pin exactly, no `^`.

| Package | Version | Published | Why this one |
|---|---|---|---|
| `three` | `0.186.1` | 24 Sep 2026 | 0.187.0 is only 13 days old. Spark's peer range is `>=0.180.0`. |
| `@sparkjsdev/spark` | `2.4.0` | 20 Oct 2026 | Splat renderer for the overlay. See below. |
| `typescript` | `6.0.3` | 16 Apr 2026 | Last classic compiler line. 7.x is the native port, not worth the risk here. |
| `vite` | `8.3.5` | 21 Oct 2026 | 8.3.6 to 8.3.8 are under two weeks old. |
| `vitest` | `5.0.5` | 15 Oct 2026 | 5.1.0 is under two weeks old. |
| `tsx` | `4.23.15` | 20 Sep 2026 | Runs the Node scripts. |
| `@types/three` | `0.186.0` | 11 Sep 2026 | Matches three. |
| `@types/node` | `24.19.2` | 9 Oct 2026 | Matches Node 24. |

`three` and `@sparkjsdev/spark` are `dependencies`, the rest `devDependencies`. Nothing else may be added without the integrator's say.

**Splat renderer: Spark, not `@mkkellogg/gaussian-splats-3d`.** mkkellogg's last release (0.4.7) is from Jan 2025. Spark is current, MIT, built by World Labs (so Marble output is first-class), reads `.ply`, `.spz`, `.splat`, `.ksplat`, renders inside the normal three.js pipeline so shell and character meshes depth-composite with the splat, and exposes `SplatMesh.forEachSplat((index, center, scales, quaternion, opacity, color) => ...)` for reading point positions. Spark needs a browser (`Worker`); it cannot run under Node, so nothing headless may import it.

**Physics: none. Plain grid collision, no Rapier.** The character moves in 2D on one flat floor. A height-valued occupancy grid rasterised from the layout gives sliding collision, camera occlusion and furniture clearance in pure, unit-testable TypeScript. Rapier would add a 1.5 MB WASM for nothing. A Marble collider GLB is out of scope now that the layout is the collider.

**Character: Quaternius "Universal Animation Library" (Standard), CC0 1.0.** One rigged human mannequin, 1.83 m native, 53 joints, one mesh `Mannequin` with two flat-colour materials (`M_Main`, `M_Joints`), no textures. Clips verified inside the GLB: `Idle_Loop` (2.50 s), `Walk_Loop` (1.33 s), `Jog_Fwd_Loop` (0.93 s), `Sitting_Enter` (1.30 s), `Sitting_Idle_Loop` (1.67 s), `Sitting_Exit` (1.03 s). All are in place (root translation is zero throughout).

- Download: `https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip` (14,541,205 bytes; send a browser `User-Agent` header). SHA-256 `18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2`.
- File inside the zip: `Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb` (6,671,104 bytes, SHA-256 `1b7bf67866360665426bb99e4c71bd619f19b408453c24e30f0c3071601eee5c`). Copy to `public/characters/mannequin.glb`, and `License.txt` to `public/characters/LICENSE.txt`.
- Licence: CC0 1.0 Universal, stated in the zip's `License.txt` and on the source pages `https://opengameart.org/content/universal-animation-library` and `https://quaternius.itch.io/universal-animation-library`. Redistribution is fine.
- Rejected: three.js `Xbot.glb` / `Soldier.glb` (Mixamo-derived, redistribution unclear, no sit clip); `RobotExpressive.glb` (CC0, has Sitting, but robot proportions make a body-fit check meaningless).

**"Pick a character" = one mannequin, three body presets, plus exact height.** Presets 160 / 175 / 190 cm with distinct tints, and a stepper for any height from 140 to 200 cm. The check is about the buyer's own height, so a correct-height neutral figure beats three costumes.

**Lying down is procedural.** No free lie clip fits this rig without retargeting (UAL2 has `LayToIdle`, but on a skeleton with different bone names). We freeze `Idle_Loop` at t = 0 and rotate the figure -90° about X so it is supine and fully extended. That is the right pose for a length check: the lying body is exactly the chosen height (4.6).

**Names the code may rely on:** the clips above; hips bone `DEF-hips`; materials `M_Main`, `M_Joints`. The model faces +Z, Y up, feet at the origin.

**Furniture and shell are procedural three.js boxes.** No model downloads. Matte `MeshStandardMaterial`, all opaque. Nothing in the scene uses alpha blending except the character's contact shadow, because transparent meshes sort unpredictably against a splat.

---

## 2. Experience design

Two HTML entry points, no router:
- `index.html` = buyer. `/?scene=<id>` (default `test-flat-empty`). Flag: `&debug=1`.
- `editor.html` = broker or ops person. `/editor.html?scene=<id>`.

Style (the walkthru brand, `src/brand/brand.css`): full-bleed 3D; warm paper `#F7F0E4` and ink `#2B211C`, cards `#FFFDF8` with 14 px radius and one soft corner; terracotta `#B2472B` is the action colour, teal `#1E6B73` the colour of "measured" (measure lines, the mode bar), ochre `#E3A33A` the warmth; Bricolage Grotesque (Google Fonts) for display (wordmark, headings, chips, buttons) and the system font for anything you read. All text pairs checked at WCAG AA (white on terracotta 5.5, on teal 6.2, ink on paper 13.9, muted on paper 5.5). Verdict colours unchanged: good `#1E9E5A`, warn `#E0A100`, bad `#D64545`. Touch targets at least 44 px. The start page opens with a hero (name, "Walk through a flat before you visit it", an inline-SVG isometric flat in warm light, no image file and no three.js); the loading screens are dark and calm: a small floor plan that draws itself, the place's name and a progress bar under the factual status line (2.7).

Rendering: `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping`, `antialias: true` when the scene has no splat and `false` when it has one (Spark's requirement), pixel ratio `min(devicePixelRatio, 2)` on desktop and `min(devicePixelRatio, 1.5)` on touch devices. One `HemisphereLight(0xffffff, 0xb8b0a8, 1.0)` and one `DirectionalLight(0xffffff, 0.6)` from (3, 6, 2). No shadow maps.

### 2.1 Buyer flow

**B0 Start page** (`/` with no `?scene=`; `src/start/`, no three.js). A gallery of homes, each a card with the floor plan redrawn from `property.json` (walls, doorways, windows, room names and sizes; never the source drawing), the title, the room count and a tag: "Your drawing" (real input), "Sample drawing · made-up" (`test-*`, or a subtitle that says synthetic or sample) or "From a phone video" (`video-*`, or any other scene with a scan); see `sceneOrigin` in `buyer/scene-tag.ts`. Real drawings first. The list comes from `public/scenes/index.json`, written by `scripts/make-scene-index.ts` (`npm run make:room`, the Vite build, and fresh on every dev request) by scanning `public/scenes/*/property.json`, so a new scene folder needs no code change. A room that is not measured (`proposal-extras.json`) shows "not measured" instead of a size, and a `partial` room is drawn dashed and hatched, shows "partly on the drawing" and is never a start point. A card opens "Where do you want to start?" (`/?home=<id>[&room=<id>]`): the plan large, every whole room tappable (not partial, not passage, bathroom or balcony unless nothing else is left), the largest measured bedroom or living room preselected, button "Start walking in <Room>". That goes to `/?scene=<id>&room=<id>`, then B2 and B3 as below. `?scene=<id>` alone still works and starts in the default room.

**Spawn.** `core/spawn.ts` `chooseSpawn`: inside the chosen room, just in from its main door (a door or opening that leads to another room, else the widest), or with no door near the wall whose middle is farthest from the room's centre; at least 0.6 m clear of walls and furniture on the walking grid (relaxed only when the room has no such point); facing the room's centroid; the first camera must not end outside the room. Never a `partial` room. `property.spawn` is only the fallback when no room has a place to stand. The buyer HUD has a small "All homes" link back to `/`.

**B1 Loading.** Property title and subtitle, a progress bar, and "Walk around. Try a bed. Check the sizes." Under it, small: "Sizes from the floor plan. Colours approximate (from phone video)." If `property.json` is missing: "This home is not set up yet." with a link to the editor.

**B2 Pick your height.** Shown once the shell is built, over the live view.
- Heading: "How tall are you?"
- Three chips: `160 cm`, `175 cm` (default), `190 cm`, each showing its tint (teal `#1FA3A3`, crimson `#B71C6C` (was orange `#E8823A` until 16 Nov 2026: it read as skin next to a light tone), violet `#7A5AF0`).
- Stepper row: `-` `175 cm · 5 ft 9 in` `+`, 1 cm steps, 140 to 200. A preset sets the stepper. A custom height takes the tint of the nearest preset.
- Button "Start walking". Stored in `localStorage` key `walkthru:height`.
- Reopen any time from the HUD person button. Changing height rescales the character and refreshes any open verdict card.
- The same sheet has **Add a person**: more people in the home, for size and space (16.6.10).

**B3 Walking (main screen).**
- Third-person camera behind the character, who spawns at `property.spawn`.
- Top left: the identity card (2.7): the place, the room and its area ("Bedroom 1 · 215 sq ft · 20.0 m²", updating as the character crosses room polygons, hidden in a doorway) and one quiet line of what is illustrative.
- Top centre: one glass bar (2.7): the Walk / Doll house / Plan control (once the views module is there) and the Third person / First person toggle, then the labelled tools: Tour, Flats (in a building), Rooms, Measure, Furnish, Light, You, Scan (only with a splat), Clean view, Fullscreen. Top right: the way back, "Building" in a building and "All homes" for a lone home.
- Bottom centre: the interaction prompt pill.
- First visit: key-cap chips above the room strip (desktop: W A S D walk, Drag look around, E open a door or sit, Click a door to go through; touch: Left thumb walk, Right thumb look around, Tap a door), gone at the first input or after 14 s. On a phone the tool names show for 7 s once.

**Rooms sheet.** Lists every room: label, sq ft, m². Then "Carpet area (rooms, excluding balcony): 267 sq ft · 24.8 m²". Footer: "Sizes from the floor plan. Colours approximate (from phone video)."

**Interaction prompts.** When the character's centre is within 1.0 m of a furniture item's footprint (or inside it), the pill shows the nearest item's action:

| Item kind | Prompt |
|---|---|
| bed | "Lie on the bed" |
| sofa | "Sit on the sofa" |
| counter | "Stand at the counter" |
| dining, wardrobe | "See dimensions" (card with `{W} × {D} × {H} cm`, tone good, no pose) |

Desktop E, touch tap the pill. While posed the pill reads "Get up" (bed, sofa) or "Step back" (counter). Any movement input, E, Esc or the pill ends the pose.

**Lie on the bed.** The character moves to the bed and lies along its length, head 5 cm from the head end of the mattress. On a mattress 120 cm wide or more they take the half nearest to where they stood. The camera swings to a raised three-quarter view. The mattress outline glows in the verdict colour. Card:

- Title: `{label} · {W} × {L} cm` (mattress size, whole cm).
- `spareCm = round((sleepLength - height) * 100)`:

| Tier | Rule | Headline | Detail |
|---|---|---|---|
| `fits` (good) | `spareCm >= 15` | "You fit." | "{spareCm} cm to spare at {heightCm} cm tall." |
| `tight` (warn) | `0 <= spareCm <= 14` | "Tight fit." | "Only {spareCm} cm to spare. Your feet reach the end." |
| `too-short` (bad) | `spareCm < 0` | "Too short for you." | "Your feet hang {-spareCm} cm over the end." |

- Width line (`W` cm): `>= 135` "{W} cm wide, sleeps two." · `90..134` "{W} cm wide, sleeps one." · `75..89` "{W} cm wide, a narrow single." · `< 75` "{W} cm wide, too narrow to sleep on."
- Footer: real item "Measured from the floor plan, accurate to about 5 cm." · virtual "Standard {name} size."

The 15 cm rule is ordinary mattress guidance (body length plus 15 cm). In the too-short case the feet visibly overhang, which is the point.

**Sit on the sofa.** `Sitting_Enter`, then `Sitting_Idle_Loop` looping, at the seat spot nearest the character. Camera swings to the front. Card:
- Title `{label} · {W} cm wide`. Headline "Seats {n}.", `n = max(1, floor(W_m / 0.6))`.
- Line, with `diff = seatHeight - 0.25 * height`: `|diff| <= 0.05` "Seat height {h} cm suits you." (good) · `diff > 0.05` "Seat height {h} cm is high. Your feet may not rest flat." (warn) · `diff < -0.05` "Seat height {h} cm is low. Your knees sit above your hips." (warn).

**Stand at the counter.** Character faces it from the front, idle. Card: title `{label} · {h} cm high`; `diff = top - (0.63 * height - 0.15)`: `|diff| <= 0.07` "Comfortable working height for you." (good) · `diff < -0.07` "Low for you. Expect to stoop." (warn) · `diff > 0.07` "High for you." (warn).

**Measure mode** (ruler or M). Pill: "Tap the first point", then "Tap the second point". Points are ray hits on the shell and furniture meshes. A line with end dots and a label: `2.43 m · 8 ft 0 in` (under 1 m: `62 cm · 2 ft 0 in`). A third tap starts over. Esc or the ruler exits and clears. Walking stays on.

**Furnish mode** (sofa button or F). This is the main hook. It must feel instant.
1. A tray slides up with the catalogue (4.4): name and size, e.g. "King bed · 183 × 198 cm (72 × 78 in)".
2. Tapping an item spawns it centred 1.8 m in front of the character, its front facing the character (item yaw = character yaw + 180°), then passed through `snapToWalls` (4.5). If that spot is blocked it still spawns there, shown red, for the buyer to drag.
3. Drag it along the floor (pointer down on the item, then move). Rotate: "Rotate" button (90° per tap); desktop Q / E for 15° steps, R for 90°. On release it magnetically squares up to a nearby wall (4.5).
4. The verdict updates live while dragging. The item is tinted (green / amber / red), its footprint outlined, and clearance lines with labels ("62 cm") are drawn from each side with under 1.5 m of space.
5. Verdict bar above the tray:

| Verdict | Rule | Copy |
|---|---|---|
| `fits` (good) | no overlap, access rules met | "{Name} fits. {phrases}." |
| `tight` (warn) | no overlap, an access rule fails | "{Name} fits, but it is tight. {phrases}." |
| `blocked` (bad) | overlaps a wall, another item, or leaves the floor | "{Name} does not fit here." |
| `blocked` (bad) | taller than the ceiling | "{Name} is too tall for this ceiling ({ceiling} m)." |

   `{phrases}`: up to two sides, smallest clearance first, never the back, skipping sides with 1.5 m or more. First phrase "{cm} cm walking space {word}", second "{cm} cm {word}". None qualify: "Plenty of space around it". Side words per item are in 4.4.
6. Buttons "Place" (disabled while blocked) and "Cancel". Placed items are solid, block walking, and are interactable (lie, sit).
7. Tapping a placed virtual item in furnish mode selects it: "Move", "Remove". Real items (tagged by the broker, `source: 'real'`) cannot be moved.
8. Buyer placements persist per scene in `localStorage` key `walkthru:<sceneId>:placed`. "Clear all" link in the tray. Broker-staged virtual items come from `property.json`; a buyer may move or remove them for their own session.
9. **My layout (14 Nov 2026).** Any piece can be selected (tap it, or pick it from "In this home" in the tray). The action card offers Move, Rotate and **Resize** (see 10: a piece that came with the home is moved and resized in the viewer's layout only), **Replace**, **Change look** and **Remove**. Replace lists the catalogue, the same family first (bed: single, double, queen, king; sofa: 2-seat, 3-seat, L-shaped; wardrobe: 2, 3, 4 doors; table: study, side, dining), then everything else. The replacement appears at the same spot with the old piece's back edge kept, squared to the wall (4.5), as a preview with the normal fit verdict (the piece it replaces is not an obstacle); Replace commits, Cancel brings the original back. A replacement shows its own catalogue size; the original's size never changes. Everything is a per-viewer overlay, never an edit of the home: the home as drawn (`property.json`) is the record. While the layout differs from it, a chip "Your layout · edited" shows in every mode, the tray lists "Removed: Bed (as drawn)" with Undo, and "Reset to the home as drawn" restores the exact original state. In a home from a REAL drawing, fixed built-ins (anything with a `designs.json` entry, and every wardrobe or counter) can only be hidden with the note "Built-in on the drawing: hidden in your layout only" (shown in the card, asked for twice, and kept in the removed list). Storage: `walkthru:<sceneId>:placed` (placed pieces, with their `finish`) and `walkthru:<sceneId>:mine` (`{ version: 1, removed, finishes }`), both written inside try/catch. Sharing: the overlay travels in `?my=1.<base64url JSON>` (`src/buyer/my-layout.ts`), checked against the home it opens on. Decor on a hidden or replaced piece (lived-in cushions, a drawing's chair at a hidden desk) goes with it; collision grid, poses, wardrobe opening and kit bed-head boards follow the store.
10. **Edit everything (16 Nov 2026).** Everything a buyer sees can be tapped, moved, resized where that makes sense, or removed, in My layout only; the home as drawn never changes and every card says what is typical. **Pieces that came with the home** keep their id and `source: 'real'`; the viewer's change is an `OriginalEdit { cx, cz, yawDeg, w, d, heightM, surfaceHeightM }` stored in the overlay (`moved`), put on the drawn piece by `applyEdit` (`src/buyer/resize.ts`) with limits per family (a size the drawing already has is never corrected). Move and Rotate use the same ghost, verdict and Place as a placed piece; Resize is a width, length and height stepper (a bed's height is its mattress top) that keeps the back edge where it is, so growing is not moving. The card says "Moved in your layout" and "Your size: 150 x 190 cm. On the drawing: 183 x 198 cm."; a built-in of a real drawing adds "Built-in on the drawing: moved or resized in your layout only". Hiding a moved piece and undoing brings the drawn piece back; "Back to drawn size" and "Back to drawn place" undo one thing. Fit verdicts, the walking grid, poses, door-swing and wardrobe-shutter notes, the wardrobe model (bays scale with the width, the drawing's gap and conflict lines are dropped for an edited one), the drawing's chairs (they follow their desk) and lived-in decor on the piece (it follows the piece, scaled in the piece's frame) all read the live piece. **Fittings** (`src/look/fittings.ts`) are the split AC, ceiling fan, tube light, downlights, bowl wall lights, curtains, rug, switchboards, plants, wall clock, picture, pooja shelf, window seat, panelling, slatted wall, ceiling band, the lived-in surface decor, and the drawing's chairs. Each planner (the kit, the design mount, lived-in decor, the chairs) emits stable ids (`fan:<room>`, `tube:<room>`, `board:<room>:<edge>:<n>`, `board:bed:<bed>`, `ac:<room>:<n>`, `curtain:<room>:<edge>:<n>`, `rug:<room>:<n>`, `downlight:<room>:<n>:<i>`, `wall-light:<room>:<n>:<i>`, `li:<piece>`, `chair:<decor id>`) and applies the overlay `fittings: { removed, moved, sized }` itself when it builds, then reports every fitting (removed ones too, flagged, for the tray's Undo) as a record: name, size, where it is mounted, "Typical fitting, not from your drawing" or "From the designer's renders", its movement rule and its size options. Movement by mount: a wall fitting slides along its wall, up and down within the kind's range, and can jump to another wall of its room, never across a door or opening, never across a window (curtains and the window seat hang over one by design) and never off the wall or into a corner, and the viewer is not offered a stretch that a tall piece stands in front of; a ceiling fitting moves across its room's ceiling keeping its margin from the walls; a floor fitting moves on free floor of its room, inside it, off the doorways. Resize: AC 80 / 100 / 120 cm, fan sweep 900 / 1200 / 1400 mm (only those that fit the room), tube 2 / 3 / 4 ft, clock and picture sizes, rug width and depth, curtain and window seat width, plant height. A tap is ONE hit test for furniture and fittings (`BuyerContext.pickAt`): a fitting is hit by its oriented box (small things get a generous reach, more on a phone), furniture by its mesh, the nearest wins, a wall or floor in front hides either, and a tap on nothing clears the selection; the measure tool and placement rays (`raycast`, `raycastFloor`) never see a fitting, and no fitting is in the walking grid or any fit check. Move shows a ghost box (green where legal, red where not) that follows the pointer, and Place commits. Storage `mine` is now `{ version: 2, removed, finishes, moved, fittings }` (version 1 still reads); the link is `?my=2.<base64url>` with `p` (moved originals, centimetres) and `x` (fittings), and a layout with neither is still written as `1.`, so every old link opens and every new link without edits opens in an old reader. **Baked lighting**: the kit's static meshes are always built from the home as drawn (so the bake still matches), a moved, resized or removed fan, tube or board has its triangles collapsed in place (the mesh keeps the checksum of its drawn positions, `PRISTINE_CHECKSUM_KEY`) and, unless removed, is built again in `kit:edited`, lit by probes like furniture; the design decor and lived-in decor were already dynamic. The bake stores all lamps as one `lamps` picture, so a light pool of a fixture that was moved or removed stays where it was baked: lighting is simulated and nothing claims otherwise.
10. **Change look.** Swatches from the finish palette (`src/look/finishes.ts`: woods, solid laminates, fabrics, metals, bedding). Bed: frame, headboard, bedding, style (panel, upholstered, storage box). Sofa and armchair: fabric, legs. Wardrobe: shutters, handles. Tables: top, legs. A kitchen counter has no look. The piece updates live; the choice is `FurnitureItem.finish` (ids only) on the placed piece, or in the overlay for a piece that came with the home. Looks are illustrative: sizes are exact (16.2 rule 4).

### 2.2 Broker editor flow

One page. Left: a step list (green tick when done). Centre: the **plan canvas** (top-down, pan with right-drag or two fingers, zoom with wheel). A "3D preview" toggle swaps the centre for the live shell with an orbit camera. Right: the panel of the active step. Steps can be revisited in any order after E2.

**E1 Scene and media.** Scene id field (from `?scene=`), "Load" (reads existing `property.json` if any). Three drop zones:
- "Floor plan image (best)": PNG, JPG, WebP or SVG. Saved into the scene folder as `plan.<ext>` through the dev API.
- "Video or photos": an MP4 or images. The editor grabs one frame per second (max 60) in the browser with a `<video>` element and a canvas. Frames stay in memory, shown as a strip along the bottom for reference and for colour sampling. Nothing is uploaded or saved.
- "3D scan (optional)": shown as found or not found (`scene.ply`, `.spz`, `.splat` in the scene folder).

**E2 Scale.**
- With a floor plan: "Click the two ends of a dimension printed on the plan, then type it." Accepts `13'1"`, `13 ft 1 in`, `4 m`, `4.0`, `400 cm`, `4000 mm` (a bare number is metres). Do it twice, ideally one across and one down. The panel shows "53.1 px per metre. The two dimensions agree within 0.4%." If they disagree by more than 3%: "These two disagree by {n}%. Check what you typed, or the plan image may be stretched." (the mean is used either way).
- Without a plan: a blank grid with 1 m squares and 0.5 m minor lines. Scale is already metric; the step is done automatically.
- Hint box, always visible: "No dimensions? Use Indian standards. Door frame height 2.1 m. Main door 0.90 m wide, bedroom door 0.80 m, bathroom door 0.75 m. Floor tiles are 600 × 600, 800 × 800 or 600 × 1200 mm: count them."

**E3 Rooms.**
- Tool "Rectangle" (default): drag corner to corner. Tool "Polygon": click corners, close with Enter, double-click, or a click on the first corner.
- Snapping: to existing corners and edges within 8 screen px; otherwise to a 5 cm grid when there is no plan image.
- While drawing, a live label shows the size: `4.00 × 5.00 m · 13'1" × 16'5"` and the area.
- After drawing: type (Bedroom, Living, Kitchen, Bathroom, Balcony, Other) and label ("Bedroom 1"). For rectangles, an editable size field (`4.0 x 5.0`, or `13'1" x 16'5"`) resizes it about its first corner.
- Tile helper in the panel: tile size dropdown and two counts, "6.5 tiles × 600 mm = 3.90 m", with "Use as width" / "Use as length".
- Trace along the **inside faces** of the walls. Leave the wall's thickness as a gap between neighbouring rooms, as the plan shows it. Corridors are rooms too (type Other, label "Passage").
- Edge kinds: each room edge is `wall`, `railing` or `none`. Click an edge to cycle. Defaults: `wall`; for a Balcony, edges that do not face another room default to `railing`. Use `none` for open-plan boundaries such as living to dining.
- Room list with area ("215 sq ft · 20.0 m²"), rename, delete. No corner dragging; delete and redraw.
- "Load proposal" appears if `proposal.json` exists (Phase 2 plug).

**E4 Openings.** Pick a preset, then click a room edge to place it centred on the click:

| Preset | type | width | sill | head |
|---|---|---|---|---|
| Main door | `door` | 0.90 | 0 | 2.10 |
| Bedroom door | `door` | 0.80 | 0 | 2.10 |
| Bathroom door | `door` | 0.75 | 0 | 2.10 |
| Sliding door / open archway | `opening` | 1.80 | 0 | 2.10 |
| Window | `window` | 1.20 | 0.90 | 2.10 |

Selected opening: editable width, sill, head; drag along its edge; delete. An opening between two rooms is placed once, on either room's edge; it cuts through both walls automatically.

**E5 Finishes.** Wall height field (default 2.75 m; hint "Usually 2.75 to 3.0 m. Door frames are 2.1 m."). Then colour sampling from the frame strip: choose a target ("Walls", "Floor", "Door frames", or a selected room's walls or floor), then click patches on any frames. Each click samples a 15 × 15 px patch; a counter shows "5 patches from 3 frames"; the colour is the robust median (4.9) and previews live on the 3D shell. Tile size dropdown: None, 600 × 600, 800 × 800, 600 × 1200 mm. Note under the swatches: "Colours are approximate. Phone video shifts white balance." With no frames, defaults apply.

**E6 Furniture (optional).**
- "Fixed item (already in the flat)": kind (Wardrobe, Counter, Bed, Sofa), then three clicks: clicks 1 and 2 are the two ends of the **back edge** (the wall side), click 3 anywhere on the front side sets the depth. Editable height and surface height (defaults in 4.4). Saved with `source: 'real'`.
- "Stage virtual furniture": pick from the catalogue, click the plan to drop, R to rotate 90°, drag to move. Same snapping and verdict as the buyer sees. Saved with `source: 'virtual'`.

**E7 Scan overlay (optional, only when a splat file exists).**
- Up axis: "Looks right" (`as-is`), "Upside down" (`flip-x`, usual for raw 3DGS / COLMAP output), "On its side" (`z-up`). After each choice the floor is detected and levelled automatically: "Floor found. Tilt corrected 3.0°." If confidence is low: "Tap three spots on the floor" in the 3D view.
- The scan's top-down image appears over the layout at 50% opacity. "Pin 1": click a recognisable point on the scan image, then the same point on the layout. "Pin 2": the same again. The scan snaps into place; the layout is the ruler, so this also sets the scan's scale.
- Mode: "Overlay on the clean walls" (default) or "Replace the clean walls" (for a complete, good scan).
- Reverse path when a good scan exists but no plan: "Trace from the scan instead". Pick two points on the scan image, type the distance (door presets offered), and the scan image becomes the tracing underlay for E3.

**E8 Spawn and save.** Click the plan for the spawn point, drag from it for the facing direction. Title and subtitle. "Save" validates, writes `public/scenes/<id>/property.json` through the dev API and also downloads it. "Open as buyer" opens `/?scene=<id>`.

Minimum to save: at least one room, no validation errors (5.5), and a spawn point on a walkable cell.

### 2.3 Controls

| Action | Desktop | Touch |
|---|---|---|
| Walk | WASD or arrows, relative to camera | left half: floating joystick under the thumb, 60 px radius |
| Jog | hold Shift | push the joystick past 85% |
| Look | drag with the left mouse button (no pointer lock) | drag on the right half |
| Zoom | wheel | pinch |
| Interact / get up | E | tap the pill |
| Measure | M | ruler button |
| Furnish | F | sofa button |
| Rotate furniture | Q / E (15°), R (90°) | "Rotate" button (90°) |
| Cancel / exit mode | Esc | X on the mode bar |

In furnish mode E rotates instead of interacting. A tap is pointer down and up within 250 ms and 8 px.

Speeds: walk 1.4 m/s, jog 3.4 m/s (2.8 until 15 Nov 2026, see 16.6.8), both times `height / 1.75`. The character turns toward its movement direction at 6 rad/s (10 until 15 Nov 2026), walks only once it faces that way, and speeds up and slows down over a fraction of a second (16.6.8). Animation `timeScale = speed / (the clip's own planted-foot speed on that body * model scale)`, measured per body at load, so the planted foot does not slide (it was `speed / (1.4 * height / 1.75)` for walk and `speed / (2.8 * height / 1.75)` for jog, which slid by about a third). Cross-fade 0.2 s.

### 2.4 Camera indoors

- Pivot: character position at `0.85 * height`, shifted 0.20 m to the camera's right (over the shoulder).
- Defaults: boom 2.0 m, pitch 12° down, FOV 60° (70° in portrait), near 0.05, far 200. Limits: pitch -5° to 60°, boom 1.0 to 3.5 m.
- **No clipping through walls.** Each frame, march from the pivot toward the wanted camera position through the grid (`boomDistance`, 4.3). The boom stops 0.20 m short of the first blocking cell. Full-height cells (walls, wardrobes) always block. Lower cells (beds, sofas, railings, window sills) block only if the camera would pass below their top plus 15 cm. The camera stays below `wallHeight - 0.15` and above 0.15 m.
- Shorten instantly, lengthen at 2 m/s.
- Below a 0.7 m boom the character is hidden (reads as first person in a tight passage) and reappears above 0.8 m.
- `focusOn(centre, distance, pitchDeg)` swings in 0.5 s to look at a point. Bed: distance `max(2.2, 1.2 * length)`, pitch 50°. Sofa: 2.4 m, pitch 20°, from the front. Furnish mode does not change the camera. The boom rule always applies.

### 2.5 Doors (`core/doors.ts`, `buyer/doors.ts`, `buyer/doors-model.ts`)

Every opening of type `door` has a leaf (not `opening`, not `window`, and not a door between a whole room and a `partial` one: the drawing ends there and that doorway keeps its hatched "drawing's edge" treatment).

- **Where hinge and swing come from.** The drawing's swing arc (`import/openings.ts` `readGap` and `leafFromArc`, `import/passage.ts` for a door added at an arc): the end of the gap the arc is centred on is the hinge, the side the arc bulges to is the swing. Such a leaf is not `assumed`. A door with no arc, or whose arc does not hinge on its wall, has no `leaf` in the file, and `resolveDoors` gives it one by rule, always `assumed: true`: it swings into the more private room (bathroom, bedroom, kitchen, living, other rooms, a passage last; a door to the outside swings in) and hangs on the end nearer the wall it opens against.
- **Size.** The leaf is as wide as the opening less the two 50 mm frame posts, 35 mm thick, as high as the opening's head less the frame head. Height and thickness are standard unless the drawing gives them (a head other than 2.10 m is taken as drawn).
- **Behaviour.** Doors start shut, except the doors of the room the buyer starts in. A prompt "Open door" / "Close door" shows within 1.15 m of a doorway the buyer can see (E, or tap the pill). A quarter turn takes 0.5 s. The buyer can reverse it mid-swing.
- **Collision (the grid is never re-rasterised; leaves are the store's temporary obstacles `doors`).** A shut leaf is a strip across the doorway, full height, so the doorway is closed to walking and to the camera boom. An open leaf frees the doorway and is a 7 cm strip (the grid resolution, not the 35 mm) where the panel stands, at 90 degrees unless a wall or furniture stops it earlier (it opens as far as it can). A moving leaf steps at most 1.5 degrees and before each step is checked against walls, furniture, chairs and wardrobe shutters (a grid without the door stamps), the other doors' panels, and the walker, who may not come nearer than body radius + half the strip + one cell. If anything is in the way the leaf stops where it is and the buyer is told ("Something is in the way of this door."; "...Step back." when it is the walker). So the walker is never inside a panel in any state.
- **Fit checks.** A real or placed piece that sits in a door's swing says "Blocks the <room> door from opening." (the leaf stops before 45 degrees) or "Stops the <room> door opening fully."; in furnish mode it is added to the verdict message (the wardrobe-swing hook), on a real piece's card it is a line.
- **Honesty (16.2).** The door's card says "Swing side assumed: the drawing does not show it." for an assumed leaf, "Swing side and hinge from the drawing's door arc." otherwise, and that height (2.10 m) and thickness (35 mm) are standard assumptions when the drawing does not give them. The panel's look is labelled illustrative.
- **Spawn.** `chooseSpawn` keeps the walker out of every leaf's footprint and swing of the doors of the chosen room (body radius + 5 cm), unless the room is too small for that.
- **Portals of a building (18.6).** In a building a door can lead to another space (a flat's main door, a lift, the stairs): its prompt then says where it goes and sits in front of "Open door"; the leaf is still solid and swings, and a style (`buildDoorModel(door, frameColor, style)`) gives a main door its number plate, a lobby door its glass, a lift its steel.
- **Sliding.** `leaf.kind: 'sliding'` is supported end to end (steps out in front of the wall, then slides along it; blocks the doorway shut, frees it open). The drawing reader does not detect sliding doors (a sliding symbol is read as an `opening`, which gets no leaf), so no scene read from a drawing has one; the Sample Tower's flats (18.13) have them on their balconies. A sliding leaf is built as a glazed door (an aluminium frame round tinted glass, `src/buyer/doors-model.ts`), not a flush panel.

### 2.6 Navigation aids: the mini plan, the room bar and the Tour (`src/buyer/nav/`, 16 Nov 2026)

Three aids, mounted in the HUD of every space (a lone home, an uploaded plan, and each space of a building: `mountNav` is called once per `boot`, `dispose` is on the clean-up list, so a building's leak check is unchanged). Everything that decides something is a pure module with tests (`tests/nav-pure.test.ts`, `tests/nav-tour.test.ts`); `mount.ts` is the DOM and three side. The aids are hidden in Furnish and Measure and while any sheet that needs an answer is open (height picker, Rooms, the lift panel, the people sheets); a tour stops the moment one opens or the mode changes.

- **Mini plan** (`mount.ts`, drawn by the start page's `planSvg`, so the walls, door gaps and window marks are the 3D shell's own pieces; its text labels are hidden at this size). Bottom left, above the room bar; 124 to 230 px wide by the screen (about 140 px on a 390 px phone). The room you are in is filled terracotta, a dot is where you stand and a cone is where the camera looks (`camera.viewYawDeg`; forward is (sin yaw, cos yaw), plan north up, z down). Redrawn at 10 Hz and only when the walker moved 4 cm or turned 2.5 degrees; the plan itself is built once. Tap a room (an SVG group that is a real `role="button"` with `tabindex`, Enter or Space also work) to go there; a tap just off a small room snaps to the nearest room within 18 px (`roomNear`). The round button on its corner collapses it to a plan icon, and the choice is kept in `localStorage` (`walkthru:nav:map-collapsed`, in try/catch) per viewer. An open-air space draws its outline and the water of a pool (`outdoor.json` basins). A space with one room draws the plan but its room is not a button. It never covers the prompt pill, a verdict card or the pool cards: every 250 ms the plan is lifted (`liftAbove`) above any of them that stands over it sideways, and the stack of card and pill is itself lifted over the room bar by `--wt-nav-h` (the one line changed in `buyer.css`).
- **Room bar.** One chip per room in the layout's order, from the same rows as the Rooms sheet (`roomsSummary`): name and the area as the sheet says it (`215 sq ft · 20.0 m²`); a size that is not measured (`proposal-extras.json`) says **Not measured** and never a number, a room only partly on the drawing says **Shape guessed**, is dashed and not a place to go (tap: a toast). The chip of the room you are in is terracotta, `aria-current="location"`, and is scrolled to the centre as you walk (an instant scroll with reduced motion). Chips are buttons at least 48 px high. Hidden when the space has one room (the HUD's room chip already says it).
- **Going to a room** (`driver.goTo`, from a chip or the plan). The standing spot is the start page's smart spawn (`chooseSpawn`: just in from the room's main door, 0.6 m clear, clear of every door's swing, facing into the room). If a walkable path from where you stand is at most 12 m (`MAX_WALK_M`, the whole path, doors included) the walker **walks it** at 3 m/s with the jog clip, then eases round to face into the room; otherwise, or when there is no path (a piece of furniture walls the room in), there is a 0.2 s **fade** to the same spot and heading (a cut with reduced motion). A walk that fails on the way (a person in a doorway for good) falls back to the fade. Works the same in third and first person: it moves the body and the camera's heading, the same things the keys move.
- **Paths** (`grid-path.ts`; there was no path finder in the code base, the followers walk straight at the walker). A Dijkstra on a 10 cm lattice over the collision grid, a node walkable when a body of radius 0.30 m fits (0.25 m when nothing fits at 0.30), a small extra cost within 0.44 m of an obstacle so a route runs down the middle of a doorway, then pulled straight wherever the body fits along the line. One search gives the lengths to every room for the tour's ordering. The walker's own collision (`moveCircle` on the live grid, followers and leaves included) is never bypassed: if it makes no headway for a second the route is planned again (three times at most), then the walk reports failure.
- **Doors on the way** (`door-route.ts`, `Doors.route` in `buyer/doors.ts`). A route is planned on the grid **without** the shut leaves (an open leaf is a solid strip on it) and cut at the first shut door it goes through, at the nearest point outside that leaf's whole swing (`inDoorSweep`, body radius + 12 cm). The walker stands there, the door is opened through the door system (the same 0.5 s swing, which still refuses to touch the body, a wall, furniture or another leaf; no card, no toast unless it is blocked), and the route is planned again from where they stand with the open leaf now solid. So a route never goes through a leaf and a leaf is never asked to open into the body. A door that will not open (three tries) ends that walk in failure. Doors the tour opened stay open.
- **Tour** (`driver.startTour`, `tour-plan.ts`; the Tour button in the bar, a strip above the bar while it runs). The first stop is the room you stand in, seen from where you are; then the nearest room not yet seen by path length with a surcharge on the rooms nobody wants early (toilets +12 m, utility rooms +5 m, balconies +4 m; passages, lobbies and corridors are 'transit' stops of 1.6 s with no pan), so a flat reads living, dining, kitchen, bedrooms, utility and toilets last. In each room the walker stands at its smart-spawn spot for 3 to 5.5 s while the camera turns to face in and pans 52 degrees either side (reduced motion: a hold, no pan), and the strip shows the room's name and size as the HUD chip words them (`Living · 228 sq ft · 21.1 m²`), "Room 3 of 15" and a progress bar. The walk is at 1.5 m/s. It ends by walking back to where it began and facing the way it faced. Rooms that cannot be reached (no path even with every shut door opened, or a door that would not open) are left out and named in the strip at the end ("Left out: Balcony."), a room only partly on the drawing is left out too. Pause and resume (a button, the walker stands still), stop (a button, Esc, any other key, a tap or drag on the 3D view, the wheel: the walker stays where they are, the camera is theirs again). The tour never starts while a sheet is open or in Furnish or Measure; a walker sitting or lying gets up first. People added by the buyer behave as ever: followers follow the walker through the tour and are in the collision, not in the plan (a follower standing in a doorway makes the walk plan again, then skip the room).
- **Honesty (16.2).** Names and sizes are the drawing's, through the same function as the Rooms sheet, so the bar can never say a size the sheet does not. The tour caption uses the same words.
- **Verification (16 Nov 2026).** `tests/nav-pure.test.ts` (14) and `tests/nav-tour.test.ts` (7) run the Driver frame by frame on the real layouts without a browser: a tour of Flat 204 (16 rooms, every door shut, the drawing's furniture) visits 15 rooms once each, opens 8 doors, never puts the body inside a wall, a piece or a leaf, ends within 10 cm of its start, and names the Balcony as not reachable (two planters leave a 0.45 m gap at its door, about the width of a body); a go-to of a few metres walks and opens the door on the way, one over 12 m fades; pause holds, stop leaves the walker where they stand, reduced motion cuts. In the page (headless Chrome, SwiftShader, the real furniture, fixtures and door system, `nav.debug.simulate`): the same tour visited 15 of 16 rooms (Balcony named), 3,853 auto-walk frames with 0 inside something solid, all doors left open, back at the start within 4 cm. Screenshots at 1280 x 800 and 390 x 844 (map open and collapsed, bar with the current room lit and scrolled to, a chip jump, the tour in three rooms and at a door, first person, the pool with its water, the clubhouse foyer, a standalone home with a "Not measured" chip). Not measured: a real phone, frame cost on a GPU; the frame-by-frame audit of the stepped harness is meaningless for doors (they take the page's frame time, not the stepped time), so use `simulate`.
- **Hooks.** `window.__walkthru.nav` under `?debug`: `go(roomId)`, `startTour()`, `stop()`, `chips()`, `here()`, `setMapOpen()`, `driver` (state: `driver.tour`) and `audit(on)` (counts auto-walk frames where the body was inside something solid, and records the positions).


### 2.7 The interface layer: design tokens, the glass chrome and the showroom display (`src/brand/tokens.css`, `scale.ts`, `src/buyer/hud.ts`, `presence.ts`, `share.ts`, `src/building/flats.ts`, 16 Nov 2026)

The product is shown on a screen in a builder's sales office (a wall display, a touch panel, a tablet), driven by a salesperson or by a lead standing beside them. The interface is quiet so the 3D is the picture. No enquiry, price or marketing feature exists, and none is planned.

**Tokens (one file, `tokens.css`).** Every size of the chrome is `calc(N * var(--wt-u))`; `--wt-u` is `1px * --wt-z`, and `scale.ts` sets `--wt-z` on `<html>` from the short side of the window (1 up to 820 px, then short side / 820, at most 3, in steps of 0.05: 1440 x 900 is 1.1, 1920 x 1080 is 1.3, 3840 x 2160 is 2.65, a phone or a 1180 x 820 tablet is 1). Panels that keep their own pixel sizes (the furnish tray, the people card, the look sheet, the pool's cards) use `zoom: var(--wt-z)`. Scale: spacing 4 / 8 / 12 / 16 / 24 / 32 (`--wt-sp-1..6`), radii `--wt-r-panel` 16 (every panel), `--wt-r-control` 11, pills 999; type `--wt-fs-xs..2xl` 12 / 13.5 / 15 / 18 / 24 / 36 in the system UI font at weights 500 and 650 for the chrome, the display face for page headings only; touch target `--wt-hit` 46 (never under 44 css px); layers `--wt-z-nav` 12, `-sheet` 20, `-screen` 30, `-overlay` 40, `-curtain` 60, `-toast` 70. `html[data-labels]` (`icons` below 1400 design units of width, `primary` from 1400, `full` from 1850) decides how many tools carry a text label: Tour and Flats always, Rooms, Measure and Furnish from `primary`, everything from `full`; a phone shows every name for 7 s on the first visit and then icons. `tests/ux-pure.test.ts` fails on a raw pixel size over 1.5 px in the chrome's CSS (media queries and `zoom` panels excepted).

**Two surfaces.** Glass (`.wt-glass`: `--wt-glass` rgba(26,21,19,0.74), 14 px blur, a 1 px light border, one shadow, white text, the terracotta only as the accent) for everything floating over the 3D view: the identity card, the bar, the floor plan card, the room strip, the tour card, the prompt, the verdict cards, toasts, the lift panel and the Flats panel. The dim text is white at 74 %, checked on a near-white scene. Paper (cream, ink text) for pages and the sheets that ask something: the start and building pages, the height picker, Rooms, the look sheet, the furnish tray. Both use the same radius, shadow and scale.

**The chrome.** Identity card top left: the place (the flat's own name, two lines at most), the room and its area, one quiet third line (the scene tag, SPEC 16.2: "Sample building. Plan follows a published brochure; furniture is illustrative."; "Sample home. Made up, not a real home."), and a quiet Share button. Top bar: the three views (Walk selected as a white pill; hidden until `ctx.views` exists, so the bar is shippable alone), the Third / First person toggle (Walk only), the tools. Top right: Building or All homes. Bottom left: the floor plan card (header "Floor plan" with a chevron, thin light lines on glass, the room you are in filled with the accent, a glowing dot and a soft view cone). Bottom centre: the room strip, one pill of rooms each with a colour dot, the name and the area in a dimmer weight, the current one a lighter capsule, scrolled into view. The prompt is a glass chip with an accent key-cap (E) on a pointer device and the accent fill on touch. Above the strip, on the first visit, the control chips. During a tour a card sits above the strip: "6 OF 9", the room large, its area, a thin line that fills while the camera dwells, pause, next room and close; the Tour tool reads Stop. **Clean view** (a tool) hides all of it but a small "Controls" pill top right; **idle fade** hides the chrome after 8 s without input (`?autohide=<s>`, 0 = never) and any touch, key or mouse move brings it back; the prompt, the cards and toasts stay. **Fullscreen** (a tool, hidden where the browser has none).

**Share.** A link that reopens the same place and view: the address (`building` + `space`, or `scene`), `at=x,z,yaw` (metres, degrees: the walker and the heading), `cam=first|third`, `view=walk|doll|plan` when the views module is there, and for a lone home the viewer rearranged, the `my=` code of 2.1. On load the spot is used only when it is free on the grid and inside a whole room (`parseShare`, `src/buyer/share.ts`), otherwise the normal start. The Web Share sheet on a touch device, the clipboard elsewhere, a toast "Link copied". No backend.

**Flats switcher (18.14).** **A showroom that runs by itself** (`presence.ts`): `?kiosk=1` skips the height picker and starts the tour after 90 s without input, `?idle=<s>` sets that delay, the tour loops (the last room glides back to the start and begins again) and stops at the first touch, key or wheel; sheets are closed first (every sheet answers Escape), so no dialog waits for ever. Nothing needs a keyboard; the way back to the building is always in the top right.

**Loading.** Dark, calm: the plan drawing itself, the place's name and a progress bar. Through a door the screen fades in over the standing space (0.28 s) before that space is taken down, and fades out when the next is ready; a lift has its own doors. The first-paint splash matches the screen it leads to.

**The tour's motion (2.6 is the model; this is what it enforces).** First person at eye height, the body hidden, a 75 degree lens, 3 degrees down, through the camera director (`driveTo`, `setBodyHidden`, `setFov`), which glides in and out. The route is rounded into a curve (quadratic corners up to 0.9 m, tried at full size and halved until the body keeps its 4 cm margin); the speed along it is the smooth minimum of the cruise speed (1.0 m/s, 0.72 of that through a doorway, less in a bend by sqrt(0.7 / curvature)), an S-curve ease-in and an S-curve ease-out (jerk 1.5 m/s^3), so every start and stop eases and a leg ends exactly where it should. The heading looks 1.2 m down the path through a low-pass (0.5 s) and a critically damped follower (2.8 rad/s), at most 60 degrees a second. Everything is integrated in steps of 1/120 s from the real frame time (a frame over 0.1 s counts as 0.1 s), so 20, 60 and 120 frames a second give the same path (within 2 cm) and the same duration (within 2 %). A door is asked to open 1.5 m before the standing spot; if it stands open on arrival the glide goes on without a stop. A room is one slow arc of 40 to 70 degrees (6.5 s in a living area) from a vantage point (the lattice point with the longest sight lines in a fan toward the room's focal point: bed, sofa, table, counter, a window, else the middle), a passage is glided through, next skips with an eased move, the tour loops without a reset, reduced motion cuts with a short fade. Going to a room uses the same glide at 2.2 m/s, in the viewer's own view. Limits measured on a tour of Flat 204 (15 rooms, 201 s): speed never above 1.00 m/s, acceleration never above 1.06 m/s^2, heading rate never above 60 degrees/s, heading acceleration never above about 150 degrees/s^2 (a 0.1 s average).

### 2.8 View modes: Walk, Doll house, Plan (`src/buyer/views/`, 16 Nov 2026)

Every scene (a lone home, an uploaded plan, each space of a building) opens in **Walk**, exactly the walk of 2.1 to 2.4, and can be seen two more ways through the HUD's glass top bar (the segmented control **Walk / Doll house / Plan** of 2.7, bound with `hud.bindViews(ctx.views)`, which shows itself only once `ctx.views` exists). The module's own temporary control (`mountViewControl`, the `wt-views-bar` classes) stays as one small function behind `controls: false` in the `mountViews` call; `main.ts` leaves it off. The modes are named `walk | doll | plan` (the HUD's and the Share link's names). `?view=doll|plan|walk` picks the mode a link opens in (`dollhouse` and `doll-house` are read as `doll`) and is kept in sync with `history.replaceState` (written as `doll`, left out for Walk; a building's own address rewrite keeps it, `walk.ts`). A space reached later in a building always opens in Walk. Everything is in new files: `view-modes.ts` (the pure state machine, the address, `ViewsApi`), `framing.ts` (orbit maths), `wall-caps.ts`, `hang.ts` (what hangs from the ceiling, rules by name), `labels.ts` (room name placement), and the three-side `hanger.ts`, `stage.ts`, `marker.ts`, `outline.ts`, `orbit-input.ts`, `dollhouse.ts`, `plan-view.ts`, `mount.ts`, `views.css`. Tests: `tests/views-pure.test.ts`.

- **State machine.** `createViewMachine`: the mode asked for, a flight progress 0..1 between the walker's camera and the doll house pose (0.9 s, `smootherstep`, any frame size, reversible mid-flight), a plan fade (0.28 s). The plan keeps whichever camera it was opened from; the 3D loop rests (`look.holdFrame`) only when the plan fully covers it.
- **Doll house.** A perspective orbit (fov 42, 52 in portrait) about the middle of the layout. The first pose is 58 degrees up, the main entrance side nearest the viewer (the widest door whose far side is outside every room; else from the south), the distance the least that brings the eight corners of the layout box into the frame at that angle (`fitDistance`, never more than the bounding-sphere rule `radius / sin(fov / 2)`), with a 6% margin (30% in portrait). It is framed inside the part of the picture the panels leave free: `freeRect` takes the identity card, the mini plan, the room strip, the top bar and Furnish's tray (measured from the page) off the side that costs least, the fit is made for what is left (`fill`), and the camera's view offset puts the model in the middle of it, so no panel covers the model at 1440 x 900, 1920 x 1080 or on a phone. Limits: polar angle 20 to 80 degrees from vertical, distance from 0.3 of the radius to 1.9 times the fit, pan inside the bounds plus 30%. Damping is `1 - exp(-9 dt)`. Mouse: drag orbits, right or shift drag pans, wheel zooms; touch: one finger orbits, two pan and pinch. The viewer has one camera that every pass (the composer's too) holds on to, so the doll house sets that camera's pose each frame after the walk's own camera has run, as the debug free camera does (**no edit to `viewer.ts` or `camera.ts`**), and gives the walker's field of view back on leaving.
- **Ceiling and what hangs from it** (`hang.ts` rules, `hanger.ts` applies them and `release()` puts everything back): `ceiling:*` slabs fade out by 55% of the flight (their shared materials turn transparent and are restored exactly); the kit's `kit:cove`, `cove-led`, `fan-light`, `fan-blades`, `tube-lens`, `downlight-lens`, the signs (`door-labels`, `portal-signs`) and any `walkthruLight` fan, tube or cove are hidden once the flight has begun; the kit's one merged `kit:fixtures` mesh (switchboards on the wall, fan bodies and wall tubes up high) is drawn through a copy whose index leaves out the triangles in the top 0.8 m of the wall, and the copy is disposed on leaving; a top-level piece of the furniture tree that starts within 0.75 m of the ceiling is hidden. The sweep is repeated twice a second so a rebuilt kit is caught.
- **Near walls cut, wall caps** (`wall-cut-core.ts` pure and tested, `wall-cut.ts`). A wall piece has the outward normal of its edge; when that is within 75 degrees of the way to the camera (cos > 0.26, with a margin against flicker) the piece stands between the camera and its room and is cut to 1.0 m; when it faces away it is the far wall of its room and stays full height with its windows. A partition is two pieces with opposite normals, so one half is cut and each room keeps its far wall. The shell's own `walls:<room>` meshes are changed in place (the top vertices of each 36-vertex box are lowered, so every attribute the look's wall shader reads is untouched; a room whose mesh does not have 36 vertices a box is left as built), the height eases in about 250 ms and follows the camera as it orbits (`cutEdges` from the damped orbit angle), and starts once the ceiling is going. What is on a cut wall above the cut goes with it: the shell's frames and panes and the kit's grills and window nets are drawn through a shorter index of a copy (one index buffer rewritten in place), the door leaves of that edge and wall-hung decor (a piece of the furniture tree that starts above 0.9 m and is under 1.6 m tall) are hidden. Every wall box wears a charcoal cap (`#474C54`, 4 mm above the top) that rides the top of its box and is built from the same footprints; a lintel's cap goes when its wall is cut. `release()` restores every vertex, index, visibility and the caps' geometry. **Ground** (`stage.ts`): the pale disc with its faint grid, and, for a building, the soft shadow; an open-air space has the disc too (no building shadow). A large pale ground disc with a faint grid (1 m and 5 m, fading with distance) and a soft shadow of the building laid in by a canvas texture (an outdoor space keeps its own ground).
- **Light.** `Look.setLightOverride(LightOverride | null)` in `look.ts`: the hour the grade and the sun are taken from moves from the viewer's own to noon with the flight (so an evening or a night crosses over, with no jump), the bake, the planar reflection and the window and lamp light of 16.19 step back at the half, the sky is held (`holdSky`: not rebuilt while the hour moves), the exposure is scaled (`exposureScale`, 0.76), and `apply()` is called at the end of every lighting pass to move the look's own lights `mixK` (the flight's eased amount) of the way to a soft key from above and the front (52 degrees up, 30 degrees round from the entrance side, intensity 3.1, shadows where the tier has a shadow map, the fit of its map to the layout), a restrained fill (hemisphere 0.9, so floors and furniture keep their tone and the contact shadows and corner shading show) and a low environment. A view calls `setLightOverride(sameObject)` again while its values move and only the lighting pass re-runs. `null` and the next lighting pass give the look everything back (the override holds no state in the look). The background is a light neutral while it is on. Without a look the two lights are set by hand and restored.
- **The walker** is out of the picture once the flight is under way (its visibility is restored); a marker lies on the floor where they stand: a view cone, a soft contact shadow, a white ring and a dot, depth tested so a wall in front hides them, with a faint ghost of the ring and the dot drawn over the walls so they are still found in a room the near walls hide. **Room names** are one line, the name only (the size as the room bar words it, "Not measured" and "Shape guessed" included, shows when the pointer is on the tag or the view has come in under 62% of its first distance); a tiny room (under 6 m2: a toilet, a passage) is a dot that opens to its name on hover; a tag goes to the place in its room with the least furniture under it that no wall hides (`pickSpot` / `coverage`: a 3 x 3 grid inside the room, a few rays a room), is dimmed far from the camera, left out where two collide (the larger room keeps its name), and left out when no place shows.
- **Pieces.** Hovering a piece (`ctx.pickAt`) outlines it with a soft glow (inverted hulls of welded smooth vertices, constant width in pixels) and shows its prompt ("Sit on the bed", the wardrobe's, the chair's) in a tip; tapping it keeps the outline and shows its card (`interactions.card`). **Tapping a room's floor** puts the walker there facing into the room (toward its middle; or the nav aids' own standing spot, `driver.spotIn`, when the point is not free or is in the middle) and the camera flies down into Walk. The room bar and mini plan stay on screen; a tap on a chip, a room of the mini plan or Tour first returns to Walk (their own go-to then walks). **Furnish in the doll house is not done**: Furnish and Measure step aside (their buttons hide, their keys are swallowed, entering the doll house leaves them) and stay Walk's. The tour forces Walk, and so does an idle kiosk tour (`presence.ts`: the view goes back to Walk, then the tour starts). The walk-only chrome (the Measure tool, the first-visit hints, the wardrobe bay bar, the prompt pill; the Furnish tool too in the plan) steps aside in the doll house and the plan. **`?debug` frames:** the debug overlay of the collision grid (a faint tint on the floors, red on water and pieces, grey on voids: it is what made the pool and a clubhouse's courtyard look magenta and smudged in the first captures) and its fps readout are hidden in frames meant for the owner (the capture scripts hide the `debug-grid` mesh and the `.wt-debug` element); without `?debug` neither exists.
- **Plan** (`plan-view.ts`). The start page's `planSvg` (floors, walls cut by doorways, windows, room names with sizes worded as there) plus door swings (`resolveDoors`), furniture outlines, overall dimensions only when `scaleSource` is `plan-dimensions` and no room is unmeasured or partial (never invented), a north arrow when the look file knows north, the walker's dot and cone, pan, wheel and pinch zoom, buttons, double click to fit, a tap on a room to walk there. Light and dark follow `prefers-color-scheme` or `data-wt-theme` on the page root.
- **Hooks.** `ctx.views = { mode(), set(m), onChange(cb) }`; `window.__walkthru.views` under `?debug` adds `machine`, `dollhouse` (`debug()`, `setOrbit`, `reset`), `plan` and `census()` (objects, meshes, geometries, materials, what is hidden, what the renderer holds). Shared files touched: `look.ts` (`LightOverride`, `setLightOverride`, 7 lines in the lighting pass), `context.ts` (`views?`), `interactions.ts` (`card`), `main.ts` (the `mountViews` call and its dispose, `api.views`), `building/walk.ts` (the address keeps `?view=`).

---

### 2.9 The landing page (`src/landing/`, bare `/`, 17 Nov 2026)

The page a builder is sent to. It shows only at the bare address (`/`, `/#projects`, or with nothing but share tags such as `utm_*` and `fbclid`: `isLandingAddress` in `address.ts`); any parameter the app reads keeps the page it always opened (`?home=`, `?building=`, `?scene=`, `?check=`, the view and sales-room settings). It is part of the start chunk: no three.js.

- **Hero** (dark: the boot screen's warm charcoal, warm off-white text, terracotta the one accent). A slim rounded nav (mark, wordmark, "Walk a project"), a small label, the headline "We make your project / impossible to ignore" with a hand-drawn stroke that draws in once under the second line, one paragraph, "Walk a sample project" (the featured building's map page) and "See the projects" (scrolls to the band), then three true facts. No numbers, customers, logos or testimonials, and no contact button while `CONTACT_URL` (`config.ts`) is empty.
- **The picture** is the featured building (`FEATURED_BUILDING_ID` in `config.ts`, the only place a building is named) drawn from its own files on a 2D canvas. `hero-model.ts` (pure) lines the levels up on their lift doors (`levelFrame`: each level's plan has its own origin, the lifts run through all of them), takes every room's wall and railing lines, the pool basins of `outdoor.json`, the convex hull of each flats floor (its envelope), a stroll through the largest flat of the top floor (`strollPath`: in at the main door, room to room through the doorways and open sides, back the way it came, no wet rooms or balconies) and the facts the labels state: the flat's name as the building file gives it, "<N> flats a floor" when every flats floor has the same count, "<level> · <L> m lap pool" from the longest basin (a lap pool is 20 m or longer and at least three times as long as wide) and "Lobby · <N> lifts" from the lifts that serve the lowest level. `hero-canvas.ts` draws it as an orthographic stack (storey heights stretched so each plan shows): the lines draw in floor by floor, a highlight then moves up the floors and that floor's walls rise 1.25 m, a dot walks the stroll, the lift shafts are dashed lines, and the stack turns a few degrees with the pointer (and sways a little on its own). Labels are HTML over the canvas with leader lines. It stops when off screen or when the tab is hidden; with reduced motion it is one settled frame. A level wider than the frame (the clubhouse podium) runs off the edge and fades.
- **Projects band** (paper, drawn up over the foot of the hero): the heading "Projects", then the buildings, the homes, "Your uploads" and the upload card exactly as the start page renders them (`renderGallery` draws into the band). The hero element is made once and kept across redraws of the list.
- **Link previews**: `index.html` carries the title, description, Open Graph and Twitter tags; `public/og.png` (1200 x 630) is captured from the page itself by `tools/og-image.cdp.js`. The picture's address is made absolute at build time from `SITE_ORIGIN` or Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (`walkthruSiteOrigin` in `vite.config.ts`).
- Tests: `tests/landing-hero.test.ts` (the facts against the files, the lift alignment, the stroll, the view fit, the addresses).

## 3. Coordinates and data contracts

### 3.1 Conventions (every module obeys these)

- **World space:** right-handed, **Y up**, **metres**, floor at **y = 0**. The world origin is wherever the layout's coordinates put it.
- **Plan 2D:** `Vec2 = { x, z }`, world metres. On the plan canvas +x is right and +z is down the screen (a true top-down view, not mirrored).
- **Plan image pixels:** `{ x, y }` with y down. `world.x = (px.x - originPx.x) / pxPerM`, `world.z = (px.y - originPx.y) / pxPerM`. `originPx` is the image centre.
- **Yaw:** degrees about +Y. Yaw 0 faces +Z. Forward `a = (sin yaw, cos yaw)` in (x, z). Equals `Object3D.rotation.y` for a model facing +Z. Heading of a 2D vector `v`: `atan2(v.x, v.z)`.
- **Box frame:** `Box { cx, cz, w, d, yawDeg }`. Depth `d` runs along `a = (sin yaw, cos yaw)`; width `w` along `b = (cos yaw, -sin yaw)`. Sides: `front` = +a, `back` = -a, `right` = +b, `left` = -b (left and right as seen by someone standing in front of the item, facing it). The three.js object sits at `(cx, 0, cz)` with `rotation.y = yaw`; local +Z is front, local +X is right.
- **"Back" per kind:** bed = head end. Sofa = backrest. Wardrobe and counter = wall side. Dining = symmetric.
- **Room polygons:** stored with positive signed area, `A = 0.5 * Σ (x_i * z_{i+1} - x_{i+1} * z_i) > 0`. Edge `i` runs from `polygon[i]` to `polygon[(i+1) % n]`. For edge direction `(dx, dz)` the outward unit normal is `(dz, -dx) / length`. `normalizeRoom` reverses a polygon (and its `edges` array to match) when the area is negative.
- **Raw space (splats only):** whatever the splat file contains. `p_world = scale * rotate(rotation, p_raw) + position`, applied as `mesh.quaternion.set(...rotation)`, `mesh.scale.setScalar(scale)`, `mesh.position.set(...position)`.

### 3.2 `src/types.ts` (written by C0, imported by everyone, edited by no one else)

```ts
// ---------- maths ----------
export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };
/** [x, y, z, w] */
export type Quat = [number, number, number, number];
export type Px = { x: number; y: number };

// ---------- layout ----------
export type RoomType = 'bedroom' | 'living' | 'kitchen' | 'bathroom' | 'balcony' | 'other';
export type EdgeKind = 'wall' | 'railing' | 'none';
export interface RoomTag {
  id: string;
  roomType: RoomType;
  label: string;
  /** inside faces of the walls, world XZ, >= 3 points, positive signed area, not self-intersecting */
  polygon: Vec2[];
  /** same length as polygon; edges[i] is the edge polygon[i] -> polygon[i+1] */
  edges: EdgeKind[];
  /** '#rrggbb' overrides of the global finishes */
  wallColor?: string;
  floorColor?: string;
}
export type OpeningType = 'door' | 'opening' | 'window';
export interface Opening {
  id: string;
  roomId: string;
  edge: number;
  type: OpeningType;
  /** distance along the edge from polygon[edge] to the opening's centre */
  centreM: number;
  widthM: number;
  /** bottom of the hole above the floor; 0 for doors and openings */
  sillM: number;
  /** top of the hole above the floor */
  headM: number;
  /** the door panel, `type: 'door'` only (2.5). Absent in older scenes: the buyer derives one by rule and says it is assumed. */
  leaf?: DoorLeaf;
}
/** hinge: which end of the opening along its edge the leaf hangs on; swing: 'in' = the opening's own room, 'out' = the other side */
export interface DoorLeaf { hinge: 'start' | 'end'; swing: 'in' | 'out'; kind: 'hinged' | 'sliding'; assumed?: boolean }
export interface Finishes {
  wallColor: string;
  floorColor: string;
  /** tile size in metres, or null for a plain floor */
  tile: { wM: number; lM: number } | null;
  groutColor: string;
  frameColor: string;
  ceilingColor: string;
  railingColor: string;
  /** 'sampled' when any colour came from video frames */
  source: 'default' | 'sampled';
}
export const DEFAULT_FINISHES: Finishes = {
  wallColor: '#F2EFE9', floorColor: '#D9CFC1', tile: { wM: 0.6, lM: 0.6 }, groutColor: '#B9AE9F',
  frameColor: '#4A3528', ceilingColor: '#FAFAF8', railingColor: '#3A3A3C', source: 'default',
};
export interface PlanUnderlay {
  /** file in the scene folder, e.g. 'plan.jpg' */
  file: string;
  pxPerM: number;
  originPx: Px;
  /** the dimensions the broker clicked and typed */
  dimensions: { a: Px; b: Px; lengthM: number }[];
  disagreementPct: number;
}
export interface Layout {
  wallHeightM: number;      // default 2.75
  wallThicknessM: number;   // default 0.12, used where a wall has no room behind it
  railingHeightM: number;   // default 1.1
  rooms: RoomTag[];
  openings: Opening[];
  finishes: Finishes;
  scaleSource: 'plan-dimensions' | 'typed-sizes' | 'scan';
  underlay?: PlanUnderlay;
}
/** Phase 2 plug: what an automatic pipeline hands the editor. File: public/scenes/<id>/proposal.json */
export interface LayoutProposal {
  version: 1;
  source: string;                 // e.g. 'moge2+vggt@modal'
  rooms: RoomTag[];
  openings: Opening[];
  wallHeightM?: number;
  finishes?: Partial<Finishes>;
  confidence: number;             // 0..1
  notes?: string[];
}

// ---------- derived wall geometry (core/layout-geom.ts) ----------
export interface EdgeFrame {
  roomId: string; edge: number; kind: EdgeKind;
  a: Vec2; b: Vec2;
  /** unit a -> b */ dir: Vec2;
  /** unit outward normal */ out: Vec2;
  length: number;
  /** slab thickness for this edge, metres */ thickness: number;
  /** gap to the facing room's edge, or null when nothing faces it */ partnerGap: number | null;
}
/** A box of wall: along the edge from u0 to u1, outward by `thickness`, from y0 to y1. */
export interface WallPiece {
  roomId: string; edge: number; kind: 'wall' | 'railing';
  u0: number; u1: number; y0: number; y1: number; thickness: number;
}
/** The hole an opening (or a 'none' edge) cuts, measured on its own edge. */
export interface Tunnel {
  openingId: string | null;
  roomId: string; edge: number;
  type: OpeningType;
  u0: number; u1: number;
  /** how far outward the hole goes */ depth: number;
  sillM: number; headM: number;
  /** true for door, opening and 'none' edges */ passable: boolean;
}

// ---------- grid ----------
export const GRID_CELL_M = 0.05;
export const GRID_FREE = 0;
export const GRID_VOID = 255;
/** obstacle cells hold their height in cm, 1..250. >= GRID_TALL_CM means full height. */
export const GRID_TALL_CM = 170;
export const GRID_WALL_CM = 250;
/** Cell (i, j) covers x in [originX + i*cellM, +cellM), z likewise. Index = j*nx + i. */
export interface Grid {
  cellM: number; originX: number; originZ: number; nx: number; nz: number;
  /** 0 free, 1..250 obstacle height in cm, 255 void (no floor) */
  cells: Uint8Array;
}

// ---------- furniture ----------
export interface Box { cx: number; cz: number; w: number; d: number; yawDeg: number }
export type Side = 'front' | 'back' | 'left' | 'right';
export type FurnitureKind = 'bed' | 'sofa' | 'dining' | 'wardrobe' | 'counter';
export interface AccessRule { sides: Side[]; minM: number; mode: 'any' | 'all' }
export interface CatalogItem {
  id: string;
  kind: FurnitureKind;
  name: string;                         // 'King bed'
  sizeLabel: string;                    // '183 × 198 cm (72 × 78 in)'
  footprint: { w: number; d: number };  // outer, metres
  heightM: number;                      // overall, for collision and the ceiling check
  surfaceHeightM: number;               // mattress top, seat, table top, counter top
  inner?: { w: number; d: number };     // mattress, when smaller than the footprint
  access: AccessRule[];
  sideWords: Record<Side, string>;
}
export interface FurnitureItem {
  id: string;
  /** real = already in the flat, tagged by the broker, immovable. virtual = catalogue item. */
  source: 'real' | 'virtual';
  kind: FurnitureKind;
  catalogId?: string;
  label: string;
  box: Box;
  heightM: number;
  surfaceHeightM: number;
  inner?: { w: number; d: number };
}

// ---------- splat overlay ----------
export type UpPreset = 'as-is' | 'flip-x' | 'z-up';
export interface SceneTransform { rotation: Quat; scale: number; position: [number, number, number] }
export interface SplatOverlay {
  file: string;
  format: 'ply' | 'spz' | 'splat';
  upPreset: UpPreset | 'manual';
  transform: SceneTransform;
  mode: 'overlay' | 'replace';
}
/** Splat centres as read from a file. positions = xyz * count. */
export interface RawCloud { count: number; positions: Float32Array; opacity: Uint8Array; rgb: Uint8Array }
export interface LevelResult {
  /** takes raw points to a Y-up frame whose floor is horizontal */
  rotation: Quat;
  /** floor height in that frame, raw units */
  floorOffsetRaw: number;
  /** ceiling height above the floor, raw units, or null */
  ceilingRaw: number | null;
  tiltDeg: number;
  confidence: number;
  /** true when confidence < 3 or tiltDeg > 15 */
  lowConfidence: boolean;
}

// ---------- property.json ----------
export interface PropertyFile {
  version: 1;
  id: string;
  title: string;
  subtitle?: string;
  layout: Layout;
  furniture: FurnitureItem[];
  splat?: SplatOverlay;
  spawn: { x: number; z: number; yawDeg: number };
  updatedAt: string; // ISO 8601
}

// ---------- check results ----------
export type Tone = 'good' | 'warn' | 'bad';
export interface CheckCard { title: string; tone: Tone; headline: string; lines: string[]; footer?: string }
export interface BedFit { verdict: 'fits' | 'tight' | 'too-short'; spareCm: number; sleeps: 0 | 1 | 2; card: CheckCard }
export interface PlacementResult {
  verdict: 'fits' | 'tight' | 'blocked';
  reason: 'ok' | 'access' | 'collides' | 'outside' | 'too-tall';
  /** metres to the first non-free cell on each side, capped at 3.0 */
  clearanceM: Record<Side, number>;
  tone: Tone;
  message: string;
}

// ---------- poses ----------
export interface LiePose { feet: Vec2; yawDeg: number; surfaceY: number }
export interface SeatPose { root: Vec2; rootY: number; yawDeg: number }
export interface StandPose { root: Vec2; yawDeg: number }

// ---------- character constants ----------
export const CHARACTER_URL = '/characters/mannequin.glb';
export const HEIGHT_PRESETS_CM = [160, 175, 190] as const;
export const HEIGHT_MIN_CM = 140;
export const HEIGHT_MAX_CM = 200;
export const HEIGHT_TINTS = ['#1FA3A3', '#B71C6C', '#7A5AF0'] as const;
export const CHARACTER_RADIUS_M = 0.22;
/** ratios of body height, read from the GLB's Sitting_Idle_Loop hips keyframes */
export const SIT_HIP_BACK_RATIO = 0.181;  // hips sit this far behind the root
export const SIT_SEAT_RATIO = 0.242;      // seat height the clip assumes
export const LIE_BACK_RATIO = 0.09;       // lift so the back rests on the surface
export const WALKWAY_M = 0.6;
```

### 3.3 `property.json` worked example

Written by the generator for `test-flat` (the furnished variant, 6.1). `splat.transform` numbers are computed by the generator; the ones shown are placeholders.

```json
{
  "version": 1,
  "id": "test-flat",
  "title": "Test flat, 1 bedroom",
  "subtitle": "Synthetic scene with known sizes",
  "layout": {
    "wallHeightM": 2.6,
    "wallThicknessM": 0.12,
    "railingHeightM": 1.1,
    "rooms": [
      { "id": "bedroom", "roomType": "bedroom", "label": "Bedroom 1",
        "polygon": [{ "x": 0, "z": 0 }, { "x": 4, "z": 0 }, { "x": 4, "z": 5 }, { "x": 0, "z": 5 }],
        "edges": ["wall", "wall", "wall", "wall"] },
      { "id": "balcony", "roomType": "balcony", "label": "Balcony",
        "polygon": [{ "x": 0.5, "z": -1.62 }, { "x": 3.5, "z": -1.62 }, { "x": 3.5, "z": -0.12 }, { "x": 0.5, "z": -0.12 }],
        "edges": ["railing", "railing", "wall", "railing"] },
      { "id": "passage", "roomType": "other", "label": "Passage",
        "polygon": [{ "x": 0, "z": 5.12 }, { "x": 4, "z": 5.12 }, { "x": 4, "z": 6.32 }, { "x": 0, "z": 6.32 }],
        "edges": ["wall", "wall", "wall", "wall"] }
    ],
    "openings": [
      { "id": "door-bed", "roomId": "bedroom", "edge": 2, "type": "door", "centreM": 3.15, "widthM": 0.9, "sillM": 0, "headM": 2.1 },
      { "id": "slider", "roomId": "bedroom", "edge": 0, "type": "opening", "centreM": 2.0, "widthM": 1.6, "sillM": 0, "headM": 2.2 },
      { "id": "window", "roomId": "bedroom", "edge": 3, "type": "window", "centreM": 1.0, "widthM": 1.2, "sillM": 0.9, "headM": 2.1 },
      { "id": "door-main", "roomId": "passage", "edge": 1, "type": "door", "centreM": 0.6, "widthM": 0.9, "sillM": 0, "headM": 2.1 }
    ],
    "finishes": { "wallColor": "#F2EFE9", "floorColor": "#D9CFC1", "tile": { "wM": 0.6, "lM": 0.6 }, "groutColor": "#B9AE9F",
                  "frameColor": "#4A3528", "ceilingColor": "#FAFAF8", "railingColor": "#3A3A3C", "source": "default" },
    "scaleSource": "plan-dimensions",
    "underlay": { "file": "plan.svg", "pxPerM": 53, "originPx": { "x": 182, "y": 285.5 },
                  "dimensions": [], "disagreementPct": 0 }
  },
  "furniture": [
    { "id": "bed-1", "source": "real", "kind": "bed", "label": "Bed",
      "box": { "cx": 1.0, "cz": 2.25, "w": 1.5, "d": 2.0, "yawDeg": 90 }, "heightM": 0.55, "surfaceHeightM": 0.55 },
    { "id": "sofa-1", "source": "real", "kind": "sofa", "label": "Sofa",
      "box": { "cx": 3.55, "cz": 3.5, "w": 2.0, "d": 0.9, "yawDeg": 270 }, "heightM": 0.85, "surfaceHeightM": 0.42 }
  ],
  "splat": { "file": "scene.ply", "format": "ply", "upPreset": "flip-x", "mode": "overlay",
             "transform": { "rotation": [0, 0, 0, 1], "scale": 0.37, "position": [0, 0, 0] } },
  "spawn": { "x": 2.6, "z": 0.8, "yawDeg": 0 },
  "updatedAt": "2026-11-12T00:00:00.000Z"
}
```

Reading it:
- Bedroom edges: 0 is z = 0 (north, to the balcony), 1 is x = 4 (east), 2 is z = 5 running from (4,5) to (0,5), 3 is x = 0 running from (0,5) to (0,0). The bedroom door spans x 0.4 to 1.3 on edge 2, so `centreM = 4 - 0.85 = 3.15`. The window is centred at z = 4.0 on edge 3, so `centreM = 1.0`.
- The bedroom and balcony are 0.12 m apart: that gap is the wall. Same for bedroom and passage.
- The bed's head is on the wall x = 0 and its foot points along +X, so `a = (1, 0)`, yaw 90°. Its left side (-b) faces +Z.
- The sofa's back is on x = 4 and it faces -X, so yaw 270°.

### 3.4 Files per property

```
public/scenes/<id>/
  property.json          written by the editor
  plan.<png|jpg|jpeg|webp|svg>   optional floor-plan image
  scene.<ply|spz|splat>  optional splat
  proposal.json          optional, Phase 2
  truth.json, plan-truth.json    synthetic scenes only
```

---

## 4. Algorithms (the parts that must be identical everywhere)

### 4.1 Wall geometry from rooms (`core/layout-geom.ts`)

`computeEdgeFrames(layout)`: one `EdgeFrame` per room edge.
- **Partner search.** Edge F of another room is a partner of edge E when: `|E.dir · F.dir| >= cos(10°)`; the outward distance `g = mean over F's two endpoints of ((p - E.a) · E.out)` satisfies `-0.02 <= g <= 0.45`; and F's projection onto E's axis overlaps `[0, E.length]` by more than 0.05 m. `partnerGap` = the smallest such `g` (clamped at 0), or null.
- **Thickness.** Kind `wall`: `partnerGap === null ? layout.wallThicknessM : clamp(partnerGap / 2, 0.03, layout.wallThicknessM)`. So two facing rooms each build half of the wall between them. Kind `railing`: 0.05. Kind `none`: 0.

`computeTunnels(layout)`:
- Each `Opening` gives a tunnel on its own edge: `u0 = centreM - widthM/2`, `u1 = centreM + widthM/2` (clamped to the edge), `depth` = the partner gap of a partner edge overlapping at least half the interval, else the edge's thickness. `passable = type !== 'window'`.
- Each edge of kind `none` gives a passable tunnel over the whole edge: `u0 = 0`, `u1 = length`, `sillM = 0`, `headM = wallHeightM`, `type: 'opening'`, `openingId: null`, `depth` = partner gap or 0.

`computeWallPieces(layout)`: for each edge of kind `wall` or `railing`:
1. Height `H = wallHeightM` for `wall`, `railingHeightM` for `railing`.
2. Base interval `[-extA, length + extB]`, where `ext` = the edge's thickness at a convex corner and 0 at a reflex corner (so corners close and nothing pokes into an L-shaped room). A corner at vertex v is convex when the cross product of the incoming and outgoing edge directions `(d_in.x * d_out.z - d_in.z * d_out.x)` is positive.
3. Cuts: this edge's own tunnels, plus every tunnel belonging to a partner edge, projected onto this edge's axis.
4. Outside the cuts: one piece `y0 = 0, y1 = H`. Inside each cut: a piece `0..sillM` when `sillM > 0`, and a lintel piece `headM..H` when `headM < H`.

### 4.2 Collision grid from the layout (`core/layout-raster.ts`)

`rasterizeLayout(layout): Grid`. A cell is "in" a shape when its centre is.
1. Bounds: bounding box of all room polygons padded by 1.0 m, snapped outward to multiples of `GRID_CELL_M`. All cells `GRID_VOID`.
2. Cells inside any room polygon become `GRID_FREE`.
3. For every wall piece with `y0 <= 0.2`: cells inside its rectangle (edge axis `u0..u1`, outward `0..thickness`) get `min(250, round(y1 * 100))`. Full walls are 250, railings 110, window sills 90. Pieces with `y0 > 0.2` (lintels) are ignored.
4. For every passable tunnel: cells inside the rectangle (`u0..u1`, outward `-0.02..depth + 0.02`) become `GRID_FREE`. This opens doorways through both rooms' walls and floors the threshold.

`stampFurniture(grid, items): Grid` returns a copy where cells inside each item's `Box` get `clamp(round(heightM * 100), 20, 250)`.

The buyer's live grid is `stampFurniture(rasterizeLayout(layout), allFurniture)`, recomputed when furniture changes.

### 4.3 Grid queries (`core/grid-codec.ts` and `core/grid-query.ts`)

- `cellValue(grid, x, z)`: the cell's value, `GRID_VOID` outside the bounds.
- `circleFree(grid, x, z, r)`: true when every cell whose centre is within `r` of (x, z) is `GRID_FREE`.
- `moveCircle(grid, from, delta, r)`: split `delta` into sub-steps of at most 0.04 m. Per sub-step try the full step; if not `circleFree`, try the x part alone, then the z part alone; if neither, stop. Returns the final position. This gives wall sliding.
- `nearestFree(grid, x, z, r, maxM = 3)`: nearest point (searched in rings of one cell) where `circleFree`, or null.
- `clearance(grid, origin, dir, maxM = 3)`: march in 0.025 m steps; distance to the first sample whose cell is not `GRID_FREE`; `maxM` if none.
- `boomDistance(grid, pivot: Vec3, dir: Vec3, maxDist, ceilingM)`: march in 0.04 m steps from the pivot. A sample blocks when its cell value `v` is in `[GRID_TALL_CM, 250]`; or `0 < v < GRID_TALL_CM` and `sample.y < v/100 + 0.15`; or `sample.y > ceilingM - 0.15`; or `sample.y < 0.15`. Void never blocks. Returns `max(0, hitDistance - 0.20)`, or `maxDist`.

### 4.4 Catalogue (`core/catalog.ts`, data only)

Beds are Indian mattress sizes; the footprint adds a 5 cm frame all round. Metres.

| id | name | sizeLabel | footprint w × d | inner w × d | heightM | surfaceHeightM | access | sideWords front / back / left / right |
|---|---|---|---|---|---|---|---|---|
| `bed-single` | Single bed | 91 × 183 cm (36 × 72 in) | 1.01 × 1.93 | 0.91 × 1.83 | 0.90 | 0.50 | any of left, right >= 0.60 | at the foot / at the head / on the left / on the right |
| `bed-double` | Double bed | 122 × 183 cm (48 × 72 in) | 1.32 × 1.93 | 1.22 × 1.83 | 0.90 | 0.50 | same | same |
| `bed-queen` | Queen bed | 152 × 198 cm (60 × 78 in) | 1.62 × 2.08 | 1.52 × 1.98 | 0.90 | 0.50 | same | same |
| `bed-king` | King bed | 183 × 198 cm (72 × 78 in) | 1.93 × 2.08 | 1.83 × 1.98 | 0.90 | 0.50 | same | same |
| `sofa-3` | 3-seat sofa | 210 × 90 cm | 2.10 × 0.90 | none | 0.85 | 0.43 | all of front >= 0.75 | in front / behind / on the left / on the right |
| `dining-6` | 6-seat dining table | 180 × 90 cm table | 1.80 × 1.70 | none | 0.95 | 0.75 | all of front, back >= 0.60 | on the near side / on the far side / on the left / on the right |
| `wardrobe-2` | 2-door wardrobe | 120 × 60 × 210 cm | 1.20 × 0.60 | none | 2.10 | 2.10 | all of front >= 0.90 | in front / behind / on the left / on the right |
| `sofa-2` | 2-seat sofa | 150 × 85 cm | 1.50 × 0.85 | none | 0.85 | 0.43 | all of front >= 0.75 | sofa words |
| `sofa-l` | L-shaped sofa | 250 × 160 cm overall | 2.50 × 1.60 | none | 0.85 | 0.43 | all of front >= 0.75 | sofa words |
| `armchair` | Armchair | 80 × 85 cm | 0.80 × 0.85 | none | 0.85 | 0.43 | all of front >= 0.60 | sofa words |
| `wardrobe-3` | 3-door wardrobe | 180 × 60 × 210 cm | 1.80 × 0.60 | none | 2.10 | 2.10 | all of front >= 0.90 | sofa words |
| `wardrobe-4` | 4-door wardrobe | 240 × 60 × 210 cm | 2.40 × 0.60 | none | 2.10 | 2.10 | all of front >= 0.90 | sofa words |
| `study-table` | Study table | 120 × 60 cm | 1.20 × 0.60 | none | 0.75 | 0.75 | all of front >= 0.60 | sofa words |
| `side-table` | Side table | 45 × 45 cm | 0.45 × 0.45 | none | 0.55 | 0.55 | none | sofa words |

The first seven rows are the original table; rows eight to fourteen were added for Replace (14 Nov 2026). A real counter still takes the fallback rule below, not the study table's.

Defaults for broker-tagged real items: bed height 0.55 / surface 0.50; sofa 0.85 / 0.43; counter 0.85 / 0.85; wardrobe 2.10 / 2.10. Real items use the access rules and side words of the first catalogue item of their kind (counter: all of front >= 0.90, sofa words).

Procedural look (`engine/furniture.ts`), all boxes, origin at the footprint centre on the floor, +Z front:
- Bed: frame box to 0.30 high in `#8A6F55`; mattress (inner size) from 0.30 to `surfaceHeightM` in `#EDEAE4`; headboard 0.05 deep across the back to `heightM`; two pillows 0.45 × 0.30 × 0.10 at the head (one for singles) in `#FFFFFF`.
- Sofa: base to `surfaceHeightM`, backrest 0.25 deep at the back to `heightM`, arms 0.15 wide to `surfaceHeightM + 0.20`, in `#6E7F8D`.
- Dining: top 1.80 × 0.90 × 0.04 at `surfaceHeightM`, four 0.06 legs, six chairs (three per long side; seat 0.42 × 0.42 at 0.45, back to 0.95) in `#9B7B5C`.
- Wardrobe and counter: one box, plus a 1 cm door seam line down the wardrobe's front centre; `#C9B79C`.
- `setFurnitureTint(group, tone | null)` multiplies material colours toward the verdict colour (lerp 0.45). Null restores.

### 4.5 Placement check and wall snap (`core/placement.ts`)

`checkPlacement(grid, spec, box, ceilingM): PlacementResult`, where `grid` excludes the item being placed:
1. Too tall: `spec.heightM > ceilingM - 0.02` gives `blocked` / `too-tall`.
2. Overlap: take cells whose centre lies inside the box shrunk by 0.03 m on every side. Any `GRID_VOID` gives `blocked` / `outside`; else any non-zero gives `blocked` / `collides`.
3. Clearance per side: five rays from the side's edge at offsets `-0.8h, -0.4h, 0, 0.4h, 0.8h` along it (`h` = half the side's length), starting 0.03 m outside, direction the side's outward normal, using `clearance(...)`. The side's clearance is the **minimum** of the five. Always computed, even when blocked.
4. Access: every `AccessRule` must hold (`any`: at least one listed side `>= minM`; `all`: every listed side). All hold: `fits` / `ok`. Otherwise `tight` / `access`.
5. `message` is built exactly as the copy table in 2.1 (furnish mode, step 5). Centimetres are `round(m * 100)`.

`snapToWalls(grid, box): Box`, applied on spawn and on drag release:
1. Cast three rays from the back edge (offsets `-0.8h, 0, 0.8h`), max 0.6 m. If all three hit within 0.40 m: let `d1`, `d3` be the outer two distances and `L = 1.6h`. Rotate the box about its centre by `atan2(d3 - d1, L)` (sign chosen so the back edge becomes parallel to the wall) when that angle is at most 20°. Recast, then translate along `-a` by `min(distances) - 0.02`.
2. Then for `left` and `right`: if that side's clearance (three rays) is under 0.25 m, translate toward it by `clearance - 0.02`.
3. If the snapped box overlaps (step 2 of `checkPlacement`), return the original box.

### 4.6 Poses (`core/poses.ts`, pure; `approach` is where the character stood)

With `c` = box centre, `a`, `b` the box axes, `H` = body height in metres:
- `liePose(item, H, approach)`: `inner = item.inner ?? { w: box.w, d: box.d }`. `headInset = (box.d - inner.d) / 2 + 0.05`. `lat = 0` when `inner.w < 1.2`, else `sign((approach - c) · b) * inner.w / 4`. `head = c - a * (box.d/2 - headInset) + b * lat`. Returns `feet = head + a * H`, `yawDeg = box.yawDeg`, `surfaceY = item.surfaceHeightM`.
- `seatPose(item, H, approach)`: `lat = clamp((approach - c) · b, -(box.w/2 - 0.35), box.w/2 - 0.35)`. `hip = c + a * (box.d/2 - 0.30) + b * lat`. Returns `root = hip + a * (SIT_HIP_BACK_RATIO * H)`, `rootY = max(-0.02, item.surfaceHeightM - SIT_SEAT_RATIO * H)`, `yawDeg = box.yawDeg`.
- `standPose(item, H, approach)`: same `lat` with margin 0.30. `root = c + a * (box.d/2 + 0.30) + b * lat`, `yawDeg = (box.yawDeg + 180) % 360`.

How the character applies them (`engine/character.ts`). Hierarchy: `root` (Group, world position, `rotation.y = yaw`) > `tilt` (Group) > the GLB scene (uniformly scaled).
- Scale: at load, pose `Idle_Loop` at t = 0, call `skinnedMesh.computeBoundingBox()`, read the height `h0`. Scale for a body height `H` is `H / h0`, so the standing idle figure is exactly `H` tall.
- Lie: freeze `Idle_Loop` at t = 0 (`timeScale 0`). Over 0.6 s (ease in-out) move `root` to `(feet.x, surfaceY + LIE_BACK_RATIO * H, feet.z)`, set `root.rotation.y = yaw`, and rotate `tilt.rotation.x` from 0 to `-Math.PI / 2`. Result: supine, face up, feet at the root, head `H` metres toward `-a`. Get up: reverse over 0.5 s to a free standing spot.
- Sit: over 0.3 s move `root` to `(root.x, rootY, root.z)` and yaw, play `Sitting_Enter` once (clamp), cross-fade to `Sitting_Idle_Loop`. Get up: `Sitting_Exit`, then free.
- Stand pose: move and face, stay in `Idle_Loop`.
- After any pose ends, the character's position becomes `nearestFree(grid, x, z, CHARACTER_RADIUS_M)`.

### 4.7 Checks (`core/checks.ts`, pure, copy exactly as in 2.1)

- `bedFit(sleepLengthM, sleepWidthM, heightM, label, footer): BedFit`. Sleep size = `item.inner ?? box` dims.
- `sofaCheck(widthM, seatHeightM, heightM, label): CheckCard`.
- `counterCheck(topM, heightM, label): CheckCard`.
- `dimensionsCard(item): CheckCard`.

### 4.8 Units (`core/units.ts`)

- `parseLength(text): number | null` in metres. Accepts `4`, `4.0`, `4 m`, `400 cm`, `4000 mm`, `13'1"`, `13' 1"`, `13 ft 1 in`, `13ft`, `13'`, `157"`, `157 in`. Bare number = metres. Curly quotes are normalised.
- `parseSize(text): { w, l } | null` splits on `x`, `×` or `by`.
- `formatFtIn(m)`: `13'1"`, inches rounded, 12 inches carried into feet.
- `formatLength(m)`: `< 1 m` gives `62 cm · 2 ft 0 in`; else `2.43 m · 8 ft 0 in` (feet and inches spelled `ft` / `in` here).
- `formatArea(m2)`: `{ sqft: round(m2 * 10.7639), m2: one decimal, text: '215 sq ft · 20.0 m²' }`.
- `formatHeight(cm)`: `175 cm · 5 ft 9 in`.

### 4.9 Robust colour (`core/color.ts`)

`medianColor(patches: Uint8ClampedArray[]): string`. Pool all RGBA pixels from all patches. Compute luma `0.2126 R + 0.7152 G + 0.0722 B` per pixel, drop the darkest 10% and the brightest 10% (shadows, reflections, blown highlights), take the per-channel median of the rest, return `#rrggbb`. Returns `null` when given no pixels.

### 4.10 Plan scale (`core/plan-scale.ts`)

`scaleFromDimensions(dims: { a: Px; b: Px; lengthM: number }[]): { pxPerM: number; disagreementPct: number }`. Each dimension gives `|b - a| / lengthM`. `pxPerM` = mean. `disagreementPct = (max - min) / mean * 100` (0 for one dimension). `pxToWorld(px, underlay)` and `worldToPx(v, underlay)` per 3.1.

### 4.11 Splat levelling and alignment (`core/splat/*`, overlay only)

`levelSplat(raw: RawCloud, preset: UpPreset, opts?: { minOpacity?: number }): LevelResult`
1. Rotate positions by the preset: `as-is` identity; `flip-x` `[1,0,0,0]`; `z-up` `[-0.70710678, 0, 0, 0.70710678]`. Keep points with opacity `>= minOpacity` (default 0.3, i.e. byte 77). Subsample to at most 400,000 by stride.
2. Histogram of y in 512 bins between the 0.5th and 99.5th percentiles, each point weighted by `opacity/255`. Smooth with a 5-bin box.
3. Floor = the **heaviest** local maximum in the lower 70% of the range, not the lowest. Mirror-image geometry under a glossy floor is fainter than the floor itself, so the strongest low plane is the real floor. `confidence = peak weight / median bin weight`.
4. Refine: take points within 2 bins of the peak, fit a plane by least squares (PCA), three rounds dropping residuals above 2 sigma. Flip the normal to point up. `tiltDeg` = angle to +Y. If over 15°, keep the un-tilted peak and set `lowConfidence`.
5. `rotation` = (shortest rotation taking the normal to +Y) composed after the preset. `floorOffsetRaw` = the plane's height after that rotation. Ceiling: heaviest local maximum in the top 40% whose weight is at least 25% of the floor's; `ceilingRaw` = its height above the floor, else null.

`levelFromThreePoints(a, b, c: Vec3 raw, hint: Vec3 rawAbove): LevelResult`: plane through three picks, normal oriented toward `hint` (the camera position). `confidence = 99`.

Levelled frame: `p_L = rotate(level.rotation, p_raw) - (0, floorOffsetRaw, 0)`. Raw units, Y up, floor at 0.

`alignSplat(level, pairs: [{ scan: Vec2; world: Vec2 }, { scan: Vec2; world: Vec2 }]): SceneTransform`, with `scan` in the levelled frame's XZ:
- `s = |w2 - w1| / |p2 - p1|`. `θ = heading(w2 - w1) - heading(p2 - p1)`. A rotation about +Y by θ maps `(x, z)` to `(x cos θ + z sin θ, -x sin θ + z cos θ)`.
- `rotation = Ry(θ) ∘ level.rotation`, `scale = s`, `position = (w1.x - s * Rx, -s * floorOffsetRaw, w1.z - s * Rz)` where `(Rx, Rz) = Ry(θ) p1`.

`alignSplatByDistance(level, a: Vec2, b: Vec2, realM, centre: Vec2)`: scale only (`θ = 0`), translating `centre` to the world origin. Used by "Trace from the scan instead".

`renderPlanImage(raw, level, pxPerUnit)`: top-down RGBA image of the levelled cloud. For each pixel keep the colour of the highest point whose height is between 2% and 75% of the cloud's height range above the floor (so ceilings are excluded and the floor still shows). Transparent where empty. Returns `{ rgba, width, height, originX, originZ, unitsPerPx }`.

`pickSurfacePoint(positions: Float32Array, opacity: Uint8Array, origin: Vec3, dir: Vec3): Vec3 | null`: brute force. For each point with opacity byte >= 77: `t = (p - o) · d`; skip `t < 0.15`; accept when the perpendicular distance is under `max(0.015, 0.006 * t)` (units of the cloud). Bin accepted `t` in bins of 1% of the scene diagonal; take the nearest bin holding at least 3 points (else the nearest accepted point); return `o + d * median(t in that bin)`.

`core/splat/files.ts`: `parsePly(bytes): RawCloud` (generic header parse, binary little-endian only, reads `x y z opacity f_dc_0..2`; `alpha = sigmoid(opacity)`, `rgb = clamp(0.5 + 0.28209479177387814 * f_dc)`; throws on PlayCanvas compressed PLY, which has an `element chunk`), `parseSplat(bytes): RawCloud` (32 bytes per splat: position f32 × 3, scale f32 × 3, rgba u8 × 4, rotation u8 × 4). For `.spz` or a failed parse the editor falls back to `mesh.forEachSplat`.

---

## 5. The shell (`engine/shell.ts`)

`buildShell(layout): THREE.Group`. Works under Node (no canvas): when `document` is undefined it uses plain-colour materials instead of the tile texture. Children, each with `userData.roomId` where relevant:

- `floor:<roomId>`: the room polygon triangulated with `THREE.ShapeUtils.triangulateShape`, at y = 0, normal up. UVs are world metres: `u = x / tile.wM`, `v = z / tile.lM` (or `u = x, v = z` with no tile). Colour: `room.floorColor ?? finishes.floorColor`. Material roughness 0.35.
- `threshold:<n>`: one floor quad per passable tunnel (`u0..u1` by `0..depth`), same floor material as its room.
- `ceiling:<roomId>`: the polygon at `y = wallHeightM`, normal down, `ceilingColor`. Not for balconies.
- `walls:<roomId>`: every `wall` piece of that room as a box (edge axis `u0..u1`, outward `0..thickness`, `y0..y1`), merged into one geometry. Colour `room.wallColor ?? finishes.wallColor`, roughness 0.9.
- `railings`: every `railing` piece, `railingColor`.
- `frames`: for each `door` opening, a frame in `frameColor`: two posts 0.05 wide and a head 0.05 tall, 0.02 proud of the wall face on the room side and running through the tunnel depth.
- `panes`: for each `window`, one quad in the middle of the tunnel depth with `MeshBasicMaterial('#CFE8FF')`, opaque. It reads as a bright window.

Tile texture (browser only): a 256 px canvas per tile filled with the floor colour and a 2 px border in `groutColor`, `RepeatWrapping`, `colorSpace = SRGBColorSpace`, anisotropy 8. Tiles double as a visual ruler: each one is a real 60 or 80 cm.

`disposeShell(group)` frees geometries, materials and textures. `shellStats(group): { floorAreaM2: Record<roomId, number>; wallFaceAreaM2: number }` sums triangle areas (used by tests).

When `splat.mode === 'replace'` and the scan is shown, the buyer sets `shell.visible = false`. Collision is unaffected.

### 5.5 Layout validation (`core/layout-validate.ts`)

`validateLayout(layout): { errors: string[]; warnings: string[] }`.
Errors (block saving): a room with fewer than 3 points or zero area; a self-intersecting polygon; `edges.length !== polygon.length`; an opening whose interval leaves its edge; an opening on a missing room or edge; two rooms whose interiors overlap by more than 0.05 m².
Warnings (shown, not blocking): a door narrower than 0.6 m or wider than 1.2 m ("Door 1.6 m wide. Check the scale."); a room under 1.5 m² or over 60 m²; a room with no passable way out; wall height outside 2.4 to 3.6 m; plan dimensions disagreeing by more than 3%.

Also here: `normalizeRoom(room)`, `createEmptyProperty(id): PropertyFile`, `validateProperty(json: unknown): PropertyFile` (throws with a readable message).

---

## 6. Synthetic test scenes

No real capture reconstructs, so every numeric check runs against a generated flat with known truth. Script: `scripts/make-test-room.ts`, run with `tsx`. It exports pure builder functions (tests import them and never read files) and, when run directly, writes the scene folders.

### 6.1 The truth flat (metres, world frame)

- **Bedroom** 4.0 × 5.0: x 0..4, z 0..5. 20.00 m² = 215 sq ft.
- **Balcony** 3.0 × 1.5: x 0.5..3.5, z -1.62..-0.12. 4.50 m² = 48 sq ft. Three railing edges, one wall edge (facing the bedroom).
- **Passage** 4.0 × 1.2: x 0..4, z 5.12..6.32. 4.80 m² = 52 sq ft.
- Carpet area excluding balcony: 24.80 m² = 267 sq ft.
- Wall height 2.6, wall thickness 0.12 (the gaps between rooms), railing 1.1.
- Openings: bedroom door x 0.4..1.3 on z = 5 (0.9 wide, head 2.1); sliding opening x 1.2..2.8 on z = 0 (1.6 wide, head 2.2); window z 3.4..4.6 on x = 0 (sill 0.9, head 2.1); main door z 5.27..6.17 on x = 4 of the passage (leads nowhere).
- Furnished variant only: **bed** 150 × 200 × 55 cm, x 0..2.0, z 1.5..3.0, head on x = 0. **Sofa** 200 × 90 cm, x 3.1..4.0, z 2.5..4.5, seat 0.42, back to 0.85, back on x = 4.
- Spawn (2.6, 0.8), yaw 0.

Exact polygons, edges, openings and furniture boxes are the JSON in 3.3.

Two scene folders are written:
- `public/scenes/test-flat-empty/`: layout only. `furniture: []`, no `splat`. This is the typical Indian case and the default buyer scene.
- `public/scenes/test-flat/`: layout + the real bed and sofa + the splat overlay.

Both get `plan.svg`, `plan-truth.json` and `truth.json`.

### 6.2 The generated floor-plan image

`plan.svg`, 364 × 571 px, at a deliberately odd **53 px per metre**, with a 60 px margin: `px.x = 60 + (x + 0.3) * 53`, `px.y = 60 + (z + 1.9) * 53`. (So the image centre (182, 285.5) is world (2.0, 2.35) in plan terms; the editor's world origin will differ from the truth frame by that translation, which is fine: every check is translation-invariant or uses `plan-truth.json`.)

Drawn like a brochure plan: white background, walls as 0.12 m thick dark bands (`#222`) around every room with gaps at doors and the sliding opening, a thin double line for the window, a dashed line for the balcony railing, room names, and dimension labels in feet and inches the way Indian brochures print them: `BEDROOM 13'1" x 16'5"`, `BALCONY 9'10" x 4'11"`, `PASSAGE 13'1" x 3'11"`. Two explicit dimension lines with end ticks: one horizontal along the bedroom's north wall labelled `13'1"` (truth 4.0 m), one vertical along the bedroom's east wall labelled `16'5"` (truth 5.0 m).

`plan-truth.json`:
```ts
interface PlanTruth {
  pxPerM: 53;
  dimensions: { a: Px; b: Px; label: string; lengthM: number }[];   // the two dimension lines; lengthM is the true value
  rooms: { id: string; label: string; roomType: RoomType; cornersPx: Px[]; areaM2: number }[];
  openings: { id: string; roomId: string; edge: number; type: OpeningType; centrePx: Px; widthM: number }[];
}
```
A headless test "traces" by feeding these pixel coordinates (with seeded click jitter) through the same functions the editor uses. Note the printed labels are rounded to the inch, as on real plans: typing `13'1"` gives 3.988 m, a 0.3% scale error that the tolerances allow for.

### 6.3 The synthetic splat (the fragment that "reconstructed")

Only the bedroom and balcony, as if the passage failed to reconstruct. Surfaces sampled on a 2.5 cm lattice with seeded jitter of ±0.4 cm (PRNG `mulberry32`, seed 1):

| Surface | Where | Colour (linear 0..1 rgb) |
|---|---|---|
| Floor | y = 0, bedroom rectangle, plus the threshold strip x 1.2..2.8, z -0.12..0 | 0.72, 0.58, 0.42 |
| Balcony floor | y = 0, balcony rectangle | 0.60, 0.60, 0.62 |
| Ceiling | y = 2.6, bedroom, on a 3.5 cm lattice | 0.97, 0.97, 0.97 |
| Walls | x = 0, x = 4, z = 0, z = 5, y 0..2.6, minus the door (y < 2.1), the sliding opening (y < 2.2) and the window (0.9 < y < 2.1) | 0.92, 0.90, 0.86 |
| Railing | x = 0.5, x = 3.5, z = -1.62, y 0..1.1 | 0.20, 0.20, 0.22 |
| Bed | top y = 0.55 and the three free sides | 0.25, 0.40, 0.70 |
| Sofa | seat top y = 0.42 over x 3.1..3.75; backrest x 3.75..4.0 to y = 0.85; visible faces | 0.30, 0.55, 0.40 |

About 160,000 splats, about 11 MB. Each splat is a flat disc: in-plane sigma 1.1 cm, normal sigma 0.2 cm, alpha 0.95.

**Deliberately awkward raw frame**, so alignment has something to recover: `p_raw = R0 * p_true / 0.37 + o`, with `R0 = Rx(180°) * Rz(3°)` (the Rz applied first) and `o = (5, -2, 7)`. So 1 raw unit = 0.37 m, the file is upside down the way raw 3DGS output is, and the floor is tilted 3°. The exact inverse (`rotation = R0⁻¹`, `scale = 0.37`, `position = -0.37 * R0⁻¹ * o`) is written into `test-flat/property.json` as `splat.transform`.

`--degraded` (used by tests in memory, not written by default) imitates the reference video's failure modes:
- two wall holes with every point removed: wall x = 4, z 0.4..1.6, y 0.3..2.3; wall z = 5, x 2.0..3.4, y 0.2..2.4;
- three floor holes, discs of radius 0.35 m at (1.0, 0.8), (2.8, 3.6), (2.0, -0.8);
- reflections: every wall and ceiling point is mirrored to `(x, -y, z)` with probability 0.3 and alpha uniform in 0.1..0.6;
- floaters: 400 points uniform in the room volume with alpha 0.05..0.25, and 60 with alpha 0.5..0.9.

### 6.4 Exact PLY format (standard 3DGS layout, spherical-harmonics degree 0)

ASCII header, lines ending `\n`, then `N` records of 17 little-endian float32 (68 bytes each):

```
ply
format binary_little_endian 1.0
element vertex <N>
property float x
property float y
property float z
property float nx
property float ny
property float nz
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
```

Encoding per splat:
- `x y z`: raw position. `nx ny nz`: 0.
- `f_dc_k = (rgb_k - 0.5) / 0.28209479177387814`.
- `opacity = ln(alpha / (1 - alpha))` (logit).
- `scale_k = ln(sigma_k in raw units)`. Sigmas are in metres above, so divide by 0.37 first. `scale_2` is the thin axis.
- `rot_0..3 = (w, x, y, z)`, unit quaternion = `R0 ∘ q_surface`, where `q_surface` turns local +Z onto the surface normal.

If Spark rejects a degree-0 file (see risks), add `--sh1`, which appends `property float f_rest_0` to `f_rest_8` (all zero) between `f_dc_2` and `opacity`.

### 6.5 What the script exports

```ts
export const TRUTH: { scale: 0.37; tiltDeg: 3; rawOffset: Vec3; wallHeightM: 2.6; doorJambs: [Vec3, Vec3];  // (0.4,1,5) and (1.3,1,5)
                      landmarks: Vec3[] };                         // 6 room corners and jambs, world
export function buildTruthProperty(variant: 'empty' | 'furnished'): PropertyFile;
/** Independent oracle: hand-written rectangle logic, NOT a call to rasterizeLayout. */
export function truthGrid(variant: 'empty' | 'furnished'): Grid;
/** 'edge' = within 0.10 m of any boundary; tests skip those samples. */
export function classifyTruth(x: number, z: number, variant: 'empty' | 'furnished'): 'free' | 'obstacle' | 'void' | 'edge';
export function rawFromTruth(p: Vec3): Vec3;
export function buildSplatFragment(opts?: { degraded?: boolean; seed?: number }): { cloud: RawCloud; scales: Float32Array; rotations: Float32Array };
export function encodePly(f: ReturnType<typeof buildSplatFragment>, opts?: { sh1?: boolean }): Uint8Array;
export function buildPlan(): { svg: string; truth: PlanTruth };
```
CLI: `tsx scripts/make-test-room.ts` writes both scene folders. `npm run make:room` runs it.

### 6.6 A real-world sample splat (second test for the overlay path)

`https://huggingface.co/cakewalk/splat-data/resolve/main/room.splat`: verified reachable on 12 Nov 2026, 50,988,032 bytes = 1,593,376 splats in `.splat` format. It is the Mip-NeRF 360 "room" scene (a furnished living room) as used by the antimatter15 web viewer. It is COLMAP-oriented (not gravity-aligned) and in arbitrary units, so it is a hard, honest test of levelling and pinning. The repo states no licence: use it for local testing only, never commit or redistribute it. `npm run fetch:sample` saves it to `public/scenes/sample-room/scene.splat` (git-ignored).

---

## 7. Module structure

```
walkthru/
  SPEC.md  package.json  tsconfig.json  vite.config.ts  vitest.config.ts  .gitignore
  index.html                      buyer entry            (C3)
  editor.html                     editor entry           (C5)
  scripts/
    make-test-room.ts             C0
    fetch-assets.ts               C0
  public/
    characters/                   mannequin.glb, LICENSE.txt (fetched, git-ignored)
    scenes/                       test scenes are generated by make:room; splat files are git-ignored
  src/
    types.ts                      C0
    core/                         pure TypeScript: no DOM, no three (except where noted), no Spark
      geometry.ts                 C0
      grid-codec.ts               C0
      catalog.ts                  C0
      units.ts                    C0
      layout-geom.ts              C1
      layout-raster.ts            C1
      layout-validate.ts          C1
      plan-scale.ts               C1
      grid-query.ts               C2
      placement.ts                C2
      poses.ts                    C2
      checks.ts                   C2
      color.ts                    C6
      splat/files.ts floor.ts align.ts plan-image.ts pick.ts    C7
    engine/                       three.js
      shell.ts                    C1   (three only; must run under Node)
      viewer.ts                   C2
      character.ts                C2
      controls.ts                 C2
      camera.ts                   C2
      locomotion.ts               C2
      furniture.ts                C2
    buyer/
      main.ts context.ts hud.ts overlays.ts interactions.ts measure.ts rooms.ts store.ts buyer.css   C3
      furnish.ts furnish.css      C4
    editor/
      main.ts context.ts plan-canvas.ts preview.ts save.ts editor.css                                 C5
      steps/media.ts steps/scale.ts steps/rooms.ts steps/openings.ts                                  C5
      frames.ts steps/finishes.ts steps/furniture.ts steps/spawn.ts                                   C6
      steps/scan.ts               C7
  tests/
    <name>.test.ts                one per module, owned by the module's chunk
```

**Stub rule.** C0 creates every file above. Files owned by later chunks export the exact signatures below with bodies that `throw new Error('not implemented: <name>')` (step modules export a step whose panel says "Coming soon"). `npm run typecheck` must pass from C0 onward and after every chunk. A chunk edits only its own files. If a contract in another chunk's file is wrong, report it; do not edit it.

### 7.1 Signatures

```ts
// ===== core/geometry.ts (C0) =====
export function polygonArea(p: Vec2[]): number;                 // signed, per 3.1
export function pointInPolygon(pt: Vec2, p: Vec2[]): boolean;
export function distanceToSegment(pt: Vec2, a: Vec2, b: Vec2): number;
export function distanceToPolygon(pt: Vec2, p: Vec2[]): number; // 0 when inside
export function polygonSelfIntersects(p: Vec2[]): boolean;
export function boxAxes(box: Box): { a: Vec2; b: Vec2 };
export function boxCorners(box: Box): [Vec2, Vec2, Vec2, Vec2]; // back-left, back-right, front-right, front-left
export function boxFromBackEdge(p1: Vec2, p2: Vec2, frontPoint: Vec2): Box;  // the 3-click tag
export function pointInBox(pt: Vec2, box: Box, shrink?: number): boolean;
export function sideEdge(box: Box, side: Side): { mid: Vec2; along: Vec2; normal: Vec2; half: number };
export function rotateY(q: Quat, v: Vec3): Vec3;                // plus quatMul, quatFromAxisAngle, quatFromUnitVectors, quatInvert
export function mulberry32(seed: number): () => number;

// ===== core/grid-codec.ts (C0) =====
export function createGrid(originX: number, originZ: number, nx: number, nz: number, fill?: number): Grid;
export function cellIndex(grid: Grid, x: number, z: number): number;   // -1 outside
export function cellValue(grid: Grid, x: number, z: number): number;   // GRID_VOID outside
export function cellCentre(grid: Grid, i: number, j: number): Vec2;
export function cloneGrid(grid: Grid): Grid;

// ===== core/catalog.ts (C0) =====
export const CATALOG: CatalogItem[];
export function catalogItem(id: string): CatalogItem;
export function specFor(item: FurnitureItem): CatalogItem;   // catalogue entry, or a synthesised one for real items (4.4)
export function itemFromCatalog(id: string, box: Box, source: 'real' | 'virtual'): FurnitureItem;

// ===== core/units.ts (C0) =====  see 4.8
export function parseLength(text: string): number | null;
export function parseSize(text: string): { w: number; l: number } | null;
export function formatFtIn(m: number): string;
export function formatLength(m: number): string;
export function formatArea(m2: number): { sqft: number; m2: string; text: string };
export function formatHeight(cm: number): string;

// ===== core/layout-geom.ts (C1) =====  see 4.1
export function computeEdgeFrames(layout: Layout): EdgeFrame[];
export function computeTunnels(layout: Layout): Tunnel[];
export function computeWallPieces(layout: Layout): WallPiece[];
export function pieceRect(frame: EdgeFrame, piece: WallPiece): [Vec2, Vec2, Vec2, Vec2];
export function tunnelRect(frame: EdgeFrame, t: Tunnel, pad?: number): [Vec2, Vec2, Vec2, Vec2];
export function roomAt(layout: Layout, pt: Vec2): RoomTag | null;
export function carpetAreaM2(layout: Layout): number;            // rooms except balconies
export function defaultEdges(room: RoomTag, others: RoomTag[]): EdgeKind[];   // the balcony rule in 2.2 E3

// ===== core/layout-raster.ts (C1) =====  see 4.2
export function rasterizeLayout(layout: Layout): Grid;
export function stampFurniture(grid: Grid, items: FurnitureItem[]): Grid;

// ===== core/layout-validate.ts (C1) =====  see 5.5
export function validateLayout(layout: Layout): { errors: string[]; warnings: string[] };
export function normalizeRoom(room: RoomTag): RoomTag;
export function createEmptyProperty(id: string): PropertyFile;
export function validateProperty(json: unknown): PropertyFile;

// ===== core/plan-scale.ts (C1) =====  see 4.10
export function scaleFromDimensions(dims: { a: Px; b: Px; lengthM: number }[]): { pxPerM: number; disagreementPct: number };
export function pxToWorld(px: Px, u: Pick<PlanUnderlay, 'pxPerM' | 'originPx'>): Vec2;
export function worldToPx(v: Vec2, u: Pick<PlanUnderlay, 'pxPerM' | 'originPx'>): Px;

// ===== engine/shell.ts (C1) =====  see 5
export function buildShell(layout: Layout): THREE.Group;
export function disposeShell(group: THREE.Group): void;
export function shellStats(group: THREE.Group): { floorAreaM2: Record<string, number>; wallFaceAreaM2: number };

// ===== core/grid-query.ts (C2) =====  see 4.3
export function circleFree(grid: Grid, x: number, z: number, r: number): boolean;
export function moveCircle(grid: Grid, from: Vec2, delta: Vec2, r: number): Vec2;
export function nearestFree(grid: Grid, x: number, z: number, r: number, maxM?: number): Vec2 | null;
export function clearance(grid: Grid, origin: Vec2, dir: Vec2, maxM?: number): number;
export function boomDistance(grid: Grid, pivot: Vec3, dir: Vec3, maxDist: number, ceilingM: number): number;

// ===== core/placement.ts (C2) =====  see 4.5
export function checkPlacement(grid: Grid, spec: CatalogItem, box: Box, ceilingM: number): PlacementResult;
export function snapToWalls(grid: Grid, box: Box): Box;
export function placementMessage(spec: CatalogItem, r: Omit<PlacementResult, 'message'>, ceilingM: number): string;

// ===== core/poses.ts (C2) =====  see 4.6
export function liePose(item: FurnitureItem, heightM: number, approach: Vec2): LiePose;
export function seatPose(item: FurnitureItem, heightM: number, approach: Vec2): SeatPose;
export function standPose(item: FurnitureItem, heightM: number, approach: Vec2): StandPose;

// ===== core/checks.ts (C2) =====  see 4.7
export function bedFit(sleepLengthM: number, sleepWidthM: number, heightM: number, label: string, footer: string): BedFit;
export function sofaCheck(widthM: number, seatHeightM: number, heightM: number, label: string): CheckCard;
export function counterCheck(topM: number, heightM: number, label: string): CheckCard;
export function dimensionsCard(item: FurnitureItem): CheckCard;
export function checkFor(item: FurnitureItem, heightM: number): CheckCard;   // dispatches on kind

// ===== engine/viewer.ts (C2) =====
export interface Viewer {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement;
  /** returns an unsubscribe function; dt in seconds, clamped to 0.05 */
  onFrame(cb: (dt: number) => void): () => void;
  /** creates the SparkRenderer on first use */
  loadSplat(url: string, transform: SceneTransform, onProgress?: (fraction: number) => void): Promise<SplatHandle>;
  fps: number;
  dispose(): void;
}
export interface SplatHandle { object: THREE.Object3D; setVisible(v: boolean): void; setTransform(t: SceneTransform): void;
                               /** for the editor: iterate centres, any format */ readCloud(): RawCloud; dispose(): void }
export function createViewer(container: HTMLElement, opts: { hasSplat: boolean }): Viewer;

// ===== engine/character.ts (C2) =====
export type CharacterState = 'idle' | 'walk' | 'jog' | 'sitting' | 'lying' | 'standing-at' | 'transition';
export class Character {
  static load(url?: string): Promise<Character>;
  readonly object: THREE.Group;
  readonly state: CharacterState;
  heightM: number;
  position: Vec2;            // get/set, world
  yawDeg: number;            // get/set
  setHeight(m: number, tint: string): void;
  /** speed in m/s; 0 = idle. Ignored while posed. */
  setLocomotion(speed: number, jog: boolean): void;
  lie(pose: LiePose): Promise<void>;
  sit(pose: SeatPose): Promise<void>;
  standAt(pose: StandPose): Promise<void>;
  /** leave any pose, ending at `to` */
  release(to: Vec2): Promise<void>;
  setVisible(v: boolean): void;
  update(dt: number): void;
}

// ===== engine/controls.ts (C2) =====
export interface PointerEvt { type: 'down' | 'move' | 'up'; ndcX: number; ndcY: number; clientX: number; clientY: number }
export interface Input {
  /** -1..1; moveY +1 = forward */
  moveX: number; moveY: number; jog: boolean;
  /** consume accumulated look drag (px) and zoom (wheel notches / pinch) since the last call */
  takeLook(): { dx: number; dy: number; zoom: number };
  on(evt: 'interact' | 'cancel' | 'measure' | 'furnish' | 'rotate-left' | 'rotate-right' | 'rotate-90', cb: () => void): () => void;
  onTap(cb: (e: PointerEvt) => void): () => void;
  /** claimant returns true on 'down' to receive that pointer's moves and up instead of the look drag */
  claimPointer(fn: ((e: PointerEvt) => boolean) | null): void;
  /** in 'rotate' mode the E key emits 'rotate-right' instead of 'interact' (furnish mode) */
  setInteractKeyMode(mode: 'interact' | 'rotate'): void;
  dispose(): void;
}
export function createInput(el: HTMLElement): Input;

// ===== engine/camera.ts (C2) =====
export class FollowCamera {
  constructor(camera: THREE.PerspectiveCamera, getGrid: () => Grid, ceilingM: number);
  yawDeg: number; pitchDeg: number; distance: number;
  setTarget(pos: Vec2, heightM: number): void;
  focusOn(centre: Vec3, distance: number, pitchDeg: number, yawDeg?: number): void;
  releaseFocus(): void;
  /** current boom length after collision; the buyer hides the character below 0.7 */
  readonly boom: number;
  update(dt: number, look: { dx: number; dy: number; zoom: number }): void;
}

// ===== engine/locomotion.ts (C2) =====
/** moves and turns the character from input, returns the speed actually achieved */
export function stepLocomotion(ch: Character, input: Input, cameraYawDeg: number, grid: Grid, dt: number): number;

// ===== engine/furniture.ts (C2) =====
export function buildFurnitureMesh(item: FurnitureItem): THREE.Group;   // positioned and rotated from item.box
export function setFurnitureTint(group: THREE.Group, tone: Tone | null): void;

// ===== buyer/context.ts (C3) =====
export type BuyerModeId = 'walk' | 'measure' | 'furnish' | 'pose';
export interface BuyerMode { id: BuyerModeId; enter(): void; exit(): void; update(dt: number): void }
export interface FurnitureStore {
  all(): FurnitureItem[];
  add(item: FurnitureItem): void;                 // virtual only
  update(id: string, box: Box): void;
  remove(id: string): void;
  clearBuyerItems(): void;
  mesh(id: string): THREE.Group | undefined;
  onChange(cb: () => void): () => void;
}
export interface Hud {
  setPrompt(text: string | null, onActivate?: () => void): void;
  showCard(card: CheckCard): void; hideCard(): void;
  setRoomChip(text: string | null): void;
  setModeBar(text: string | null, onClose?: () => void): void;
  toast(text: string): void;
  /** slot for a mode's own UI (the furnish tray) */
  mount(el: HTMLElement, slot: 'bottom'): () => void;
}
export interface OverlayHandle { remove(): void }
export interface Overlays {
  outlineBox(box: Box, y: number, color: string): OverlayHandle;
  line(a: Vec3, b: Vec3, label: string, color: string): OverlayHandle;
  clear(tag?: string): void;
}
export interface BuyerContext {
  viewer: Viewer; property: PropertyFile; character: Character; input: Input; camera: FollowCamera;
  hud: Hud; overlays: Overlays; furniture: FurnitureStore;
  /** layout + all furniture */ grid(): Grid;
  /** layout + all furniture except the given ids */ gridWithout(ids: string[]): Grid;
  heightM(): number;
  setMode(id: BuyerModeId): void; mode(): BuyerModeId;
  /** ray from a pointer event against shell + furniture meshes */
  raycast(e: PointerEvt): { point: Vec3; object: THREE.Object3D } | null;
  /** ray against the floor plane y = 0 */
  raycastFloor(e: PointerEvt): Vec2 | null;
}

// ===== buyer/furnish.ts (C4) =====
export function createFurnishMode(ctx: BuyerContext): BuyerMode;

// ===== editor/context.ts (C5) =====
export interface PlanCanvas {
  /** redraw everything from the draft */
  refresh(): void;
  screenToWorld(clientX: number, clientY: number): Vec2;
  worldToScreen(v: Vec2): Px;
  /** one active tool at a time; null restores pan/select */
  setTool(tool: PlanTool | null): void;
  /** extra drawing on top (pins, ghosts) */
  addLayer(draw: (g: CanvasRenderingContext2D, c: PlanCanvas) => void): () => void;
  setUnderlayImage(img: CanvasImageSource | null, placement?: { pxPerM: number; originPx: Px; opacity?: number }): void;
  pxPerMetreOnScreen(): number;
}
export interface PlanTool {
  cursor?: string;
  onDown?(w: Vec2, e: PointerEvent): void; onMove?(w: Vec2, e: PointerEvent): void; onUp?(w: Vec2, e: PointerEvent): void;
  onKey?(e: KeyboardEvent): void; draw?(g: CanvasRenderingContext2D, c: PlanCanvas): void; cancel?(): void;
}
export interface FrameStore { frames: ImageBitmap[]; onChange(cb: () => void): () => void; addVideo(f: File): Promise<void>; addImages(f: File[]): Promise<void> }
export interface EditorContext {
  sceneId: string;
  /** the mutable draft; call commit() after changing it */
  draft: PropertyFile;
  /** re-validate, re-rasterise, redraw the plan, rebuild the 3D preview, refresh step ticks */
  commit(): void;
  grid(): Grid;
  plan: PlanCanvas;
  frames: FrameStore;
  /** the 3D preview's viewer, for the scan step */
  viewer: Viewer;
  api: { saveProperty(p: PropertyFile): Promise<void>; saveFile(name: string, data: Blob): Promise<void>; exists(name: string): Promise<boolean> };
}
export interface EditorStep {
  id: string; title: string; optional?: boolean;
  mount(panel: HTMLElement, ctx: EditorContext): void;
  unmount(): void;
  isDone(ctx: EditorContext): boolean;
}
// each editor/steps/<name>.ts exports:  export const step: EditorStep

// ===== core/color.ts (C6) =====
export function medianColor(patches: Uint8ClampedArray[]): string | null;

// ===== core/splat/* (C7) =====  see 4.11
export function parsePly(bytes: Uint8Array): RawCloud;
export function parseSplat(bytes: Uint8Array): RawCloud;
export function levelSplat(raw: RawCloud, preset: UpPreset, opts?: { minOpacity?: number }): LevelResult;
export function levelFromThreePoints(a: Vec3, b: Vec3, c: Vec3, hint: Vec3): LevelResult;
export function toLevelled(raw: RawCloud, level: LevelResult): Float32Array;
export function alignSplat(level: LevelResult, pairs: [{ scan: Vec2; world: Vec2 }, { scan: Vec2; world: Vec2 }]): SceneTransform;
export function alignSplatByDistance(level: LevelResult, a: Vec2, b: Vec2, realM: number, centre: Vec2): SceneTransform;
export function renderPlanImage(raw: RawCloud, level: LevelResult, pxPerUnit: number):
  { rgba: Uint8ClampedArray; width: number; height: number; originX: number; originZ: number; unitsPerPx: number };
export function pickSurfacePoint(positions: Float32Array, opacity: Uint8Array, origin: Vec3, dir: Vec3): Vec3 | null;
```

### 7.2 Dependencies

`types` ← everything. `core/*` imports only `types` and other `core/*` (never `engine`, `buyer`, `editor`, DOM or Spark). `engine/shell.ts` imports `three` and `core`. `engine/*` imports `three`, `core`; only `engine/viewer.ts` imports Spark. `buyer/*` and `editor/*` import `engine` and `core`; they never import each other.

---

## 8. Project plumbing (C0)

### 8.1 `package.json`

```json
{
  "name": "walkthru", "private": true, "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "make:room": "tsx scripts/make-test-room.ts",
    "fetch:assets": "tsx scripts/fetch-assets.ts",
    "fetch:sample": "tsx scripts/fetch-assets.ts --sample",
    "setup": "npm run fetch:assets && npm run make:room"
  },
  "dependencies": { "three": "0.186.1", "@sparkjsdev/spark": "2.4.0" },
  "devDependencies": { "typescript": "6.0.3", "vite": "8.3.5", "vitest": "5.0.5", "tsx": "4.23.15",
                       "@types/three": "0.186.0", "@types/node": "24.19.2" }
}
```

`tsconfig.json` (this exact shape type-checked against the pinned set): `target ES2022`, `module ESNext`, `moduleResolution bundler`, `strict true`, `noEmit true`, `skipLibCheck true`, `lib ["ES2022","DOM","DOM.Iterable"]`, `types ["node"]`, `include ["src","scripts","tests","vite.config.ts","vitest.config.ts"]`. Import three addons as `three/addons/...`.

`vitest.config.ts`: `environment: 'node'`, `include: ['tests/**/*.test.ts']`.

`.gitignore`: `node_modules`, `dist`, `.cache`, `public/characters/*.glb`, `public/scenes/*/scene.*`, `public/scenes/sample-room`.

### 8.2 `vite.config.ts`

Two pages: `build.rollupOptions.input = { index: 'index.html', editor: 'editor.html' }` (if Vite 8 warns that `rollupOptions` is deprecated, use `rolldownOptions`). Plus a dev-only plugin `walkthruDevApi` (`configureServer`):
- `GET /api/scenes` → `string[]` of folder names under `public/scenes`.
- `GET /api/scenes/:id/files` → `string[]` of file names in that folder.
- `PUT /api/scenes/:id/property` (JSON body) → writes `property.json`, pretty-printed. Creates the folder.
- `PUT /api/scenes/:id/file/:name` (raw body) → writes the file. `:name` must match `^plan\.(png|jpe?g|webp|svg)$`.
- `:id` must match `^[a-z0-9-]{1,40}$`. Anything else is a 400.

### 8.3 `scripts/fetch-assets.ts`

Downloads the Quaternius zip to `.cache/`, checks the SHA-256, extracts with the system `unzip` (`execFileSync('unzip', ['-o', zip, '-d', dir])`; macOS has it), copies the GLB and licence into `public/characters/`, and checks the GLB's SHA-256. Skips work already done. `--sample` also downloads `room.splat` (6.6).

---

## 9. Build chunks

Ten chunks in four waves (C8 and C9 are specified in sections 13 and 14). A wave starts when the previous one is merged and `npm run typecheck && npm test` is green.

| Wave | Chunk | Depends on | Parallel with |
|---|---|---|---|
| 0 | **C0 Foundations** | none | none |
| 1 | **C1 Layout core and shell** | C0 | C2 |
| 1 | **C2 Character engine and body checks** | C0 | C1 |
| 2 | **C3 Buyer walk-through** | C1, C2 | C5 |
| 2 | **C5 Layout editor** | C1, C2 | C3 |
| 3 | **C4 Furnish mode** | C3 | C6, C7 |
| 3 | **C6 Editor: finishes, furniture, spawn** | C5 | C4, C7 |
| 3 | **C7 Scan overlay** | C5 | C4, C6 |
| 2 | **C8 Drawing import** (section 13) | C0, C1 | C3, C5 |
| 2 | **C9 Media pipeline** (section 14) | C0, C1 | C2, C3, C5, C8 |
| 3 | **C10 ML upgrades** (section 15) | C9 (and C1 for validation) | C4, C6, C7 |
| 4 | **C11 Look** (section 16: C11a, then C11b and C11c in parallel) | C0 to C8 (all built) | C9, C10 |
| 5 | **C12 Generic drawing-set understanding** (section 17: C12a first, then C12b to C12f) | C8, C11b (the `designs.json` consumer) | C9, C10 |

Rules for every chunk: own files only; all exported signatures exactly as in 7.1; `npm run typecheck` and `npm test` green before reporting; report anything not verified in a browser as "not browser-verified" rather than assuming it works. No agent has a browser; the integrator does section 10.

### C0 Foundations
**Files:** everything in section 8, `src/types.ts` (verbatim from 3.2), `core/geometry.ts`, `core/grid-codec.ts`, `core/catalog.ts`, `core/units.ts`, `scripts/make-test-room.ts`, `scripts/fetch-assets.ts`, stub versions of every other file in section 7, and placeholder `index.html` / `editor.html`. The buyer placeholder is the "empty app shell": it creates the viewer inline (a few lines of three + Spark, replaced later by C2/C3), and if the scene has a `splat` it loads and shows it with an `OrbitControls` camera; otherwise it shows a grid helper and the text "walkthru scaffold".
**Acceptance:**
- `npm install`, `npm run setup`, `npm run typecheck`, `npm test`, `npm run build` all succeed.
- `public/characters/mannequin.glb` exists with the right hash. Both scene folders exist with the files in 6.1.
- `tests/geometry.test.ts`: bedroom area 20, balcony 4.5; `boxCorners` of the truth bed are (0,3.0), (0,1.5), (2,1.5), (2,3.0) in the order back-left, back-right, front-right, front-left; `boxFromBackEdge((0,1.5),(0,3.0),(1.2,2))` gives a box with `w = 1.5`, `d = 1.2`, yaw 90 (mod 360), centre (0.6, 2.25).
- `tests/units.test.ts`: `parseLength("13'1\"")` = 3.9878 ± 0.0005; `"4 m"`, `"400cm"`, `"4000 mm"`, `"4"` = 4; `"13 ft 1 in"` = `"13'1\""`; `parseLength("abc")` = null; `formatFtIn(4)` = `13'1"`; `formatArea(20).text` = `215 sq ft · 20.0 m²`; `formatLength(0.62)` starts `62 cm`; `formatHeight(175)` = `175 cm · 5 ft 9 in`.
- `tests/test-room.test.ts`: `encodePly` output starts with the exact header in 6.4 and has length `header + 68 * N`; `N` between 140,000 and 190,000; the two door jambs are 0.9 / 0.37 = 2.4324 raw units apart (± 0.0005); applying the written `splat.transform` to `rawFromTruth(p)` returns `p` within 1e-4 for every landmark; `truthGrid('empty')` agrees with `classifyTruth` on 5,000 seeded samples (edge samples skipped); the SVG contains the three room labels; `plan-truth.json` room pixel polygons, converted at 53 px/m, have areas 20, 4.5 and 4.8 within 0.1%.
- Catalogue matches the table in 4.4 exactly.

### C1 Layout core and shell
**Files:** `core/layout-geom.ts`, `core/layout-raster.ts`, `core/layout-validate.ts`, `core/plan-scale.ts`, `engine/shell.ts`, and their tests.
**Acceptance (vitest, against the truth flat):**
- Edge frames: the bedroom's edge 0 and the balcony's edge 2 are partners with gap 0.12 and thickness 0.06 each; the bedroom's edge 1 has no partner and thickness 0.12.
- Tunnels: `door-bed` has depth 0.12; `door-main` has depth 0.12 (its own thickness, no partner).
- `rasterizeLayout(truth)` matches `classifyTruth` on at least 99.5% of 20,000 seeded samples (edge samples skipped), for both variants once `stampFurniture` is applied for the furnished one. Specifically: (0.85, 5.06) is free (the doorway), (2.0, -0.06) is free (the sliding opening), (2.0, 5.03) is 250, (0.2, -0.03) is 250, (2.0, -1.63) is 110 (railing), (-0.03, 4.0) is 90 (window sill), (4.3, 5.7) is void (beyond the main door's stub).
- A flood fill of free cells from the spawn point reaches the balcony centre and the passage centre.
- `carpetAreaM2` = 24.8; `roomAt((2, -1))` is the balcony; `roomAt((0.85, 5.06))` is null.
- Plan tracing, headless: `scaleFromDimensions` on the two truth dimension lines with the typed labels `13'1"` and `16'5"` gives 53 px/m within 0.6% and disagreement under 1%. Rooms built from `plan-truth.json` corners with seeded click jitter of ±1.5 px give areas within 2% (bedroom), 5% (balcony), 6% (passage) of truth.
- Validation: the truth layout has no errors; an opening pushed off its edge, a bow-tie polygon and two overlapping rooms each produce an error; a 1.6 m door produces a warning.
- Shell (Node, no canvas): `shellStats` floor areas equal 20, 4.5, 4.8 within 0.5%; there is a `ceiling:` child for bedroom and passage and none for the balcony; the group's bounding box spans y 0 to 2.6; one `frames` child with geometry for 2 doors; one `panes` child.
- An L-shaped room (6 corners, one reflex) rasterises with no wall cells inside its polygon.

### C2 Character engine and body checks
**Files:** `core/grid-query.ts`, `core/placement.ts`, `core/poses.ts`, `core/checks.ts`, all of `engine/` except `shell.ts`, and tests for the four core files. Test grids come from `truthGrid(...)` (C0), so this chunk does not wait for C1.
**Acceptance (vitest):**
- `moveCircle` on `truthGrid('empty')`: walking from (2, 2.5) by (+5, 0) stops at x = 4 - 0.22 within 0.06; by (+5, +5) it slides and ends within 0.1 of (3.78, 4.78); walking from (0.85, 4.5) by (0, +1.5) passes the door and ends at z > 5.5; from (2.0, 0.5) by (0, -3) passes the sliding opening and stops at the railing, z = -1.62 + 0.22 within 0.06. The path never enters a non-free cell.
- `boomDistance`: from pivot (2, 1.5, 2.5) toward +x with max 3 returns 2.0 - 0.20 within 0.06; over the furnished grid from (2.5, 1.5, 2.25) toward -x with max 3 (over the bed, y 1.5) returns more than 2.0; the same ray at y 0.4 returns under 0.5 (the bed blocks it).
- `checkPlacement` on `truthGrid('empty')`, king bed, box `{ cx: 1.06, cz: 3.415, w: 1.93, d: 2.08, yawDeg: 90 }`, ceiling 2.6: verdict `fits`; clearance left 0.62, right 2.45, front 1.90 (each ± 0.06), back under 0.06; message exactly `King bed fits. 62 cm walking space on the left.` when the rounded left is 62 (front 190 is over the 150 cm cut-off, so it is not listed).
- Same bed at `cz = 4.3`: `blocked` / `collides`, message `King bed does not fit here.` At `cz = 3.9` (left 0.135): `tight` only if right < 0.60; here right is large, so it is `fits`. Single bed in the passage (`cx 2, cz 5.72, yaw 90`): `tight`, since both sides are under 0.60. Wardrobe with ceiling 2.0: `blocked` / `too-tall`, message `2-door wardrobe is too tall for this ceiling (2.0 m).`
- `snapToWalls`: a king bed box 0.20 m off the wall x = 0, rotated 8° off square, comes back with its back edge within 1.5° of the wall and 0.02 ± 0.03 m from it.
- `bedFit`: (2.00, 1.50) with 1.60 / 1.75 / 1.90 gives fits +40, fits +25, tight +10; (1.83, 0.91, 1.90) gives too-short -7, `sleeps` 1; (1.98, 1.83, 1.90) gives tight +8, `sleeps` 2; boundaries: spare 15 is fits, 14 is tight, 0 is tight, -1 is too-short. Card copy matches 2.1 character for character.
- `sofaCheck(2.0, 0.42, …)`: 1.60 and 1.75 good, 1.90 warn (low); seats 3. `counterCheck(0.90, …)`: 1.60 and 1.75 good, 1.90 warn (low).
- `liePose` for the truth bed, H = 1.75, approach (2.5, 1.0): head at x = 0.05, feet at x = 1.80, z = 2.25 - 0.375 = 1.875 (approach is on the +b side, which is -Z), yaw 90. `seatPose` for the truth sofa, approach (2.5, 3.0): root faces yaw 270, hip at x = 3.55 - (0.45 - 0.30) = 3.40.
**Not headless (report as not browser-verified):** `Character` loads the GLB, measures `h0`, plays the six clips, and implements lie / sit / stand as in 4.6; `createInput`; `FollowCamera` as in 2.4; `createViewer`; `buildFurnitureMesh`. Provide `engine-demo.html` at the project root (owned by C2, not in the build inputs): the truth-flat grid drawn as boxes, the character walking with full controls and camera, and keys 1 / 2 / 3 to lie / sit / stand on hard-coded items. This is what the integrator opens to judge feel.

### C3 Buyer walk-through
**Files:** `index.html`, `src/buyer/*` except `furnish.*`.
**Scope:** screens B1 to B3, height picker, HUD, room chip, rooms sheet, interaction prompts, the three poses with cards and camera focus, measure mode, the scan toggle (load `property.splat` through `viewer.loadSplat`; `replace` mode hides the shell while the scan is shown), `FurnitureStore` (real + staged from `property.json`, buyer items from `localStorage`; builds and disposes meshes; rebuilds the grid), `BuyerContext`, mode switching, and a registration of `createFurnishMode(ctx)` behind the sofa button (a stub until C4).
**Debug:** `window.__walkthru = { ctx, teleport(x, z), state() }` where `state()` returns `{ pos, yawDeg, mode, room, fps, boom }`. With `?debug=1`: an fps counter and a flat overlay of the grid on the floor.
**Acceptance:** `npm run build` passes; `tests/buyer-store.test.ts` (pure parts only: nearest-interactable selection within 1.0 m, room chip text for a point, `localStorage` round-trip with an injected storage object). Everything visual is for the integrator; list what could not be verified.

### C4 Furnish mode
**Files:** `src/buyer/furnish.ts`, `furnish.css`, `tests/furnish.test.ts`.
**Scope:** 2.1 furnish mode, entirely through `BuyerContext`: tray, spawn with `snapToWalls`, drag via `input.claimPointer` + `ctx.raycastFloor`, rotation, live `checkPlacement` against `ctx.gridWithout([id])`, tint, footprint outline and clearance lines via `ctx.overlays`, verdict bar, Place / Cancel / Move / Remove / Clear all, persistence via `ctx.furniture`. After placing, if the character overlaps the item, move it with `nearestFree`.
**Acceptance:** pure helpers tested headless: spawn box for a character at (2, 2.5) facing yaw 0 in the empty truth grid; clearance-line endpoints for the king bed case in C2 (left line length 0.62 ± 0.06); rotate steps wrap at 360.

### C5 Layout editor
**Files:** `editor.html`, `src/editor/main.ts`, `context.ts`, `plan-canvas.ts`, `preview.ts`, `save.ts`, `editor.css`, `steps/media.ts`, `steps/scale.ts`, `steps/rooms.ts`, `steps/openings.ts`.
**Scope:** the page frame and step registry (all eight steps registered in the order E1 to E8; steps owned by C6 and C7 are stubs for now), the plan canvas (underlay image, grid lines, rooms filled by type, edges styled by kind, wall thickness drawn from `computeWallPieces`, openings, furniture boxes, spawn arrow, pan and zoom, snapping), steps E1 to E4 including plan-image upload through the dev API, `FrameStore` creation from a dropped video or images (C6 uses it), "Load proposal", the live 3D preview (`buildShell` + `buildFurnitureMesh` + `OrbitControls`, rebuilt on `commit()`), validation messages, Save and "Open as buyer".
**Acceptance:** `npm run build` passes. Headless tests of pure helpers the chunk must factor out: snapping (a point 5 px from a corner snaps to it; otherwise to the 5 cm grid when there is no underlay), rectangle resize from a typed size about the first corner, opening placement from a click (nearest edge, `centreM` clamped so the opening stays on the edge), dev-API body for save equals `validateProperty` round-trip of the draft. Also a scripted trace: feeding `plan-truth.json` clicks through the same helpers reproduces a layout whose `rasterizeLayout` matches the truth classification on at least 98% of samples.

### C6 Editor: finishes, furniture, spawn
**Files:** `core/color.ts`, `src/editor/frames.ts`, `steps/finishes.ts`, `steps/furniture.ts`, `steps/spawn.ts`, tests.
**Scope:** E5, E6, E8 as in 2.2.
**Acceptance:** `medianColor`: 1,000 pixels of `#E8E4DA` plus 150 pure-white and 100 near-black outliers returns `#E8E4DA` within 2 per channel; empty input returns null. Three-click tagging uses `boxFromBackEdge`. Spawn must be on a free cell with `circleFree(…, CHARACTER_RADIUS_M)`; otherwise the step is not done and says "Pick a spot on the floor, away from walls."

### C7 Scan overlay
**Files:** `core/splat/*`, `src/editor/steps/scan.ts`, tests.
**Scope:** E7 as in 2.2 and 4.11.
**Acceptance (vitest, on `buildSplatFragment()` and its PLY bytes):**
- `parsePly(encodePly(f))` returns the same count and positions (float-exact), opacity byte 242 ± 1, floor colour within 2 per channel.
- `levelSplat(cloud, 'flip-x')`: `tiltDeg` 3.0 ± 0.3; after levelling, the floor points' heights have a median within 0.04 raw units of 0 (1.5 cm); `ceilingRaw * 0.37` = 2.60 ± 0.03; `lowConfidence` false.
- Degraded cloud: the same floor is found (within 0.06 raw units), not the mirrored ceiling; `tiltDeg` 3.0 ± 0.5.
- `levelSplat(cloud, 'as-is')` (wrong preset) must not silently pass as a good floor at the same height: either `lowConfidence` is true or the test documents the returned plane. Record what happens in the chunk report.
- `alignSplat` with the two door jambs as pins (scan side = their levelled XZ, world side = truth): scale 0.37 ± 0.5%; every `TRUTH.landmarks` point maps within 0.03 m of its truth position.
- `pickSurfacePoint` along a ray from the room centre toward the middle of the wall x = 4 returns a point within 0.03 m of the wall.
- `renderPlanImage`: a pixel at the bed centre is closer to the bed colour than to the floor colour; a pixel outside the room is transparent.

---

## 10. Verification checklist (integrator)

Setup: `export PATH="$HOME/.local/node/bin:$PATH" && cd ~/walkthru && npm install && npm run setup && npm run typecheck && npm test && npm run dev`.

### 10.1 Numeric, automated (`npm test` must cover all of these)

| # | Check | Expected |
|---|---|---|
| 1 | Plan scale from the two typed dimensions | 53 px/m ± 0.6% |
| 2 | Traced areas from jittered plan clicks | bedroom 20.0 m² ± 2%, balcony 4.5 ± 5%, passage 4.8 ± 6% |
| 3 | Exact layout areas | 215 / 48 / 52 sq ft, carpet 267 sq ft · 24.8 m² |
| 4 | Grid vs truth classification | >= 99.5% |
| 5 | Reachability | spawn reaches balcony and passage |
| 6 | Shell floor areas | within 0.5% of 20 / 4.5 / 4.8 |
| 7 | King bed at (1.06, 3.415) yaw 90 | fits; left 0.62, right 2.45, front 1.90 (± 0.06) |
| 8 | Bed fit tiers on a 200 cm bed | 160 fits +40, 175 fits +25, 190 tight +10 |
| 9 | Single bed, 190 cm person | too short, -7 cm |
| 10 | Splat levelling | tilt 3.0° ± 0.3, floor within 1.5 cm, ceiling 2.60 ± 0.03 m |
| 11 | Splat pinning | scale 0.37 ± 0.5%, landmarks within 3 cm |
| 12 | Degraded splat | same floor found, not the mirrored ceiling |

### 10.2 Manual, desktop browser

Buyer, `/?scene=test-flat-empty&debug=1`:
1. Height picker appears; 160 / 175 / 190 visibly change the figure against the 2.1 m door frame. The 190 cm figure's head is 20 cm under the frame.
2. WASD walks; the character slides along walls and cannot pass them, exits through the bedroom door into the passage and through the sliding opening onto the balcony, and is stopped by the railing.
3. Room chip reads "Bedroom 1 · 215 sq ft · 20.0 m²", "Balcony · 48 sq ft · 4.5 m²", "Passage · 52 sq ft · 4.8 m²". Rooms sheet carpet area "267 sq ft · 24.8 m²".
4. Back the camera into a corner: it never shows the outside of the flat; the character hides when the boom is very short.
5. Measure the bedroom door: 0.90 m ± 0.03. Measure wall to wall: 4.00 m ± 0.03. Floor tiles: count 6 and two-thirds across the 4 m side.
6. Furnish: place a king bed with its head on the west wall. It squares to the wall on release. The verdict names the smallest side clearance and matches a measure-tool reading within 5 cm. Push it into a wall: red, "does not fit here", Place disabled.
7. Lie on the placed king bed at 190 cm: "Tight fit. Only 8 cm to spare." At 175 cm: "You fit. 23 cm to spare". Place a single bed, 190 cm: feet visibly overhang, "Too short for you."
8. Place the sofa, sit: the sitting figure's hips are on the seat, not floating or sunk by more than about 5 cm.
9. Reload: placed items are still there. "Clear all" removes them.
10. `window.__walkthru.state().fps` is 55 or more.

Buyer, `/?scene=test-flat`:
11. The splat fragment sits inside the shell: its walls and floor coincide with the shell's within a few centimetres; the splat's bed and sofa sit where the tagged boxes are. The Scan toggle hides and shows it.
12. Lie on the scanned bed: "Bed · 150 × 200 cm", 190 cm gives "Tight fit. Only 10 cm to spare."
13. Character composites correctly: it is hidden behind splat geometry that is nearer the camera, and the contact shadow does not show through walls. If the shadow misbehaves against the splat, remove the shadow (do not try to fix sorting).

Editor, `/editor.html?scene=my-test`:
14. Drop `public/scenes/test-flat/plan.svg` as the floor plan. Click the two dimension lines and type `13'1"` and `16'5"`: about 53 px/m, agreement under 1%.
15. Trace the three rooms with the rectangle tool; areas within 2 to 6% of 215 / 48 / 52 sq ft. Balcony edges default to railing except the one facing the bedroom.
16. Add the four openings. The 3D preview shows door holes with dark frames, a bright window, a railing.
17. Drop the reference WhatsApp video: a frame strip appears within a few seconds. Sample wall and floor colours from three frames each; the shell updates live.
18. Stage a queen bed, set a spawn, save. `public/scenes/my-test/property.json` exists and "Open as buyer" walks it.
19. Scan step on `test-flat`: choose "Upside down", see "Tilt corrected 3.0°", pin the two door jambs, and the fragment snaps onto the layout. Repeat on `sample-room` (after `npm run fetch:sample`) to see how a real, non-gravity-aligned splat behaves; three-point floor fallback must work there.

### 10.3 Manual, phone over the LAN (`npm run dev` prints the address)

20. Joystick under the left thumb, look with the right, pinch to zoom. No page scroll, zoom or pull-to-refresh fights the gestures.
21. Shell-only scene holds 50+ fps; `test-flat` with the splat holds 30+ fps.
22. Furnish by touch: drag a bed, tap Rotate, Place. Lie on it.

---

## 11. Capture guide for brokers (nothing here is required)

The product works from a WhatsApp video and a floor plan. Each item below just makes the result better. Put this text on the editor's E1 step under a "Tips" disclosure.

1. **Send the floor plan.** The brochure plan with room dimensions is the single most useful thing. A photo of it is fine.
2. **Send the video as a file, not as a WhatsApp video.** In WhatsApp choose Document, then the video. That keeps the original quality. A normal WhatsApp video is shrunk to 720p and loses most of the detail.
3. **Shoot at the phone's normal resolution**, 1080p or 4K, 30 fps. Hold the phone upright or sideways, but keep it the same way throughout.
4. **Walk slowly.** One to two minutes per room, not 35 seconds for the flat.
5. **Sweep gently up and down** as you go, so the floor, the walls and the ceiling line all appear. Go round each room once along the walls.
6. **Lock exposure and focus** (press and hold on the screen until AE/AF lock shows), so colours do not shift between rooms.
7. **Keep something with detail in view.** A blank white wall filling the frame gives nothing to track. Include a door frame, a window, a switchboard or the floor tiles.
8. **Switch on the lights and open the curtains.** Avoid pointing straight at a bright window.
9. **Mention anything you know:** tile size (2 × 2 ft or 600 × 600 mm), ceiling height, which room is which.

---

## 12. Risks and open points

1. **Spark reading a degree-0 PLY is unverified.** Spark parses PLY in WASM inside a Worker, so it could not be run under Node. Degree-0 3DGS PLYs are common, so it should work. Fallback is the `--sh1` flag (6.4).
2. **Contact shadow against a splat.** The shadow is the only alpha-blended mesh. It may sort wrongly against a splat. The instruction is to drop it in splat scenes rather than fight it.
3. **Sitting alignment constants** (`SIT_HIP_BACK_RATIO`, `SIT_SEAT_RATIO`, `LIE_BACK_RATIO`) come from reading the GLB's keyframes and bounds, not from seeing it rendered. Expect to nudge them by a few centimetres in 10.2 step 8.
4. **The procedural lying pose is stiff** (a standing pose laid flat). It is correct for the length check. If it looks wrong on screen, the cheap improvement is blending toward the last frame of the GLB's `Death01` clip, which ends supine.
5. **`room.splat` has no stated licence.** Local testing only.
6. **Vite 8 `rollupOptions` vs `rolldownOptions`** for the two-page build was not run, only installed.
7. **Layout quality depends on the floor plan.** With no plan and no tile count, sizes are the tracer's guess. The editor's warnings (door widths, room sizes) catch gross errors only. This is the gap Phase 2's depth models are meant to close.
8. **Shared-edge rooms.** Rooms traced with no gap between them get a 3 cm wall on each side, taking 3 cm of floor from each. Acceptable for the prototype.

---

## 13. C8 Drawing import

Additive chunk. It changes nothing in sections 3.2 or 7.1 and edits no file owned by C0 to C7. Wave 2, needs only C0 and C1, runs alongside C3 and C5.

### 13.1 What it is for

The ideal input is an interior designer's or architect's drawing set as a vector PDF: a plan page plus elevation pages. The reference file is `~/Downloads/SON BEDROOM-Binder1.pdf` (6 pages: plan, then five elevations). **That file stays outside the repo** (it carries the designer's contact details). Never copy it, its text, or renders of it into `walkthru/`.

Facts checked on the reference file with pdf.js 6.4.299 under Node 24:
- Page 1 has no raster images: 2,381 `constructPath` operators, 52 text runs. Pages 2, 5 and 6 contain a few small images (material swatches) on top of vector linework.
- Wall fills are greys: `#666666` (structure), `#b3b3b3` and `#8d8d8d` (partitions). Black fills are glyph outlines, hatching and arrowheads.
- Real text exists only for labels: `SON ROOM`, `11'0"X12'6"`, `150 SQFT`, `MASTER ROOM`, `12'0"X9'0"`, `106 SQFT`, `BED`, `5'0"X6'0"`, `SIDE TABLE`, `1'6"X1'9"`, `STUDY`, `2'0"X4'0"`, `WARDROBE=9'0"RFT`, and the title block.
- **Dimension-line strings are not text.** `12'-3"`, `2'-10"`, the elevation's `8'-6"` and `14'-11"` are drawn as vector strokes (an exploded CAD font). So scale must come from labels and geometry, and the ceiling height from elevation geometry. Do not plan on reading dimension strings.
- All content is rotated 90° on the A4 page (text matrices are `[0, s, -s, 0, x, y]`).
- On this drawing the son room's label `11'0"X12'6"` (137.5 sq ft) and `150 SQFT` disagree by 9%: the drawn room is about 11'0" by 14'11" wall to wall, and elevation 1 is dimensioned 14'-11" overall. Labels are nominal. This is why scale is decided by voting (13.5), not by one label.

Order of preference across drawing styles:
1. **Vector PDF** (this chunk): geometry and text through pdf.js.
2. **Raster plans** (brochure scans, phone photos): no geometry to read. An interface for a vision-model step is defined (13.9) and **not implemented**. Until then these go through the editor's manual trace (E1 to E4).
3. **Always:** the output is a proposal. The broker reviews and edits it in the existing editor before publishing.

### 13.2 Dependency

`pdfjs-dist` `6.4.299` (published 3 Oct 2026; `6.5.438` is under two weeks old). Verified to load the reference PDF in Node 24 via `pdfjs-dist/legacy/build/pdf.mjs` with `getDocument({ data })`, `page.getTextContent()` and `page.getOperatorList()`. The integrator adds one line to `devDependencies` in `package.json`; C8 does not edit that file. It is used only by the Node script and tests, never bundled into the buyer or editor pages.

### 13.3 Files (all new, all owned by C8)

```
src/import/
  types.ts            C8's own types (below). Imports from ../types, exports nothing back into it.
  vector-page.ts      the neutral page model + normalisation (rotation, y flip)
  pdfjs-adapter.ts    pdf.js operator list + text -> VectorPage   (the only file importing pdfjs-dist)
  labels.ts           text grouping and label parsing
  walls.ts            wall-fill selection, wall thickness, gap bridging
  regions.ts          room regions by flood fill, contour to polygon
  scale.ts            scale voting
  openings.ts         doors, windows, open gaps
  furniture.ts        labelled furniture -> FurnitureItem
  elevation.ts        ceiling height (and sill / head when text allows)
  propose.ts          orchestration: VectorPage[] -> ImportResult
  vision.ts           interface only, for raster plans
scripts/
  import-drawing.ts   CLI
  make-test-drawing.ts   synthetic fixture generator (VectorPage objects and a real PDF)
tests/
  import-*.test.ts    synthetic, always run
  import-real.local.test.ts   runs only when the real PDF is present
```

`src/import/*` except `pdfjs-adapter.ts` is pure TypeScript (no DOM, no three, no pdf.js) so it can later run in the browser unchanged. It may import `core/geometry`, `core/units`, `core/grid-codec`, `core/layout-geom`, `core/layout-validate` and `core/layout-raster` (C0 and C1). It must not import `core/grid-query` (C2, same wave), so spawn selection uses its own small search (13.8).

### 13.4 Types (`src/import/types.ts`)

```ts
import type { Vec2, Px, LayoutProposal, FurnitureItem, PropertyFile, RoomType, OpeningType } from '../types';

/** Page units: PDF points after normalisation. x right, y DOWN, text reads left to right. */
export interface VFill   { color: string; /** closed rings, first is the outer */ rings: Px[][]; area: number; bbox: [number, number, number, number] }
export interface VStroke { color: string; width: number; /** polyline; curves flattened to <= 0.5 pt error */ points: Px[]; closed: boolean; hasCurve: boolean }
export interface VText   { str: string; x: number; y: number; width: number; size: number; /** degrees, 0 after normalisation for the dominant direction */ angle: number }
export interface VectorPage {
  index: number; width: number; height: number;
  fills: VFill[]; strokes: VStroke[]; texts: VText[];
  /** fraction of the page covered by raster images */ imageCoverage: number;
}
export type PageKind = 'plan' | 'elevation' | 'raster' | 'other';

export interface ScaleVote { source: string; ptPerM: number }       // e.g. 'furniture BED 5\'0"X6\'0" width'
export interface RoomFinding { id: string; label: string; roomType: RoomType; method: 'walls' | 'walls+strokes' | 'label-rect';
                               confidence: number; labelDims?: { w: number; l: number }; labelAreaM2?: number; areaM2: number }
export interface CeilingFinding { heightM: number; method: 'text' | 'geometry' | 'default'; page: number | null;
                                  candidatesM: number[]; confidence: number }

/** Sidecar for everything LayoutProposal cannot carry. File: public/scenes/<id>/proposal-extras.json */
export interface ProposalExtras {
  version: 1;
  sourceFile: string;                 // file name only, never a path
  planPage: number;
  scale: { ptPerM: number; votes: ScaleVote[]; agreeing: number; disagreementPct: number };
  rooms: RoomFinding[];
  ceiling: CeilingFinding;
  /** designed furniture found on the plan, world metres */
  furniture: FurnitureItem[];
  /** labels we recognised but could not turn into a box */
  unmapped: { label: string; sizeM?: { w: number; l: number }; at: Vec2; reason: string }[];
  windowHeights?: { openingId: string; sillM: number; headM: number }[];
  spawn: { x: number; z: number; yawDeg: number } | null;
  warnings: string[];
}
export interface ImportResult { proposal: LayoutProposal; extras: ProposalExtras }
```

**How the extras reach the editor without changing C5 or `types.ts`:**
- Ceiling height goes in `LayoutProposal.wallHeightM`, which already exists.
- Furniture, spawn and diagnostics go in `proposal-extras.json`.
- The CLI also writes a **draft `property.json`** when the scene has none (or with `--force`). It is built only from existing fields: `createEmptyProperty(id)`, then `layout.rooms` / `layout.openings` / `layout.wallHeightM` from the proposal, `layout.scaleSource = 'plan-dimensions'`, `furniture` from the extras, `spawn` from the extras. The editor's E1 "Load" already opens an existing `property.json`, so the broker lands straight in the review with rooms, openings, ceiling and furniture in place. `proposal.json` is still written, so "Load proposal" also works on a scene that already has a property.

Designed furniture is saved with `source: 'real'` (it is what the room will contain, so the buyer cannot move it), `label` from the drawing, `box` at the drawn position, and `inner` = the labelled size for beds.

### 13.5 Pipeline (`propose.ts`: `proposeFromPages(pages: VectorPage[], sourceFile: string, sceneId: string): ImportResult`)

All thresholds are in units of `t`, the wall thickness in page points, until the scale is known. That keeps the import independent of the drawing's scale.

**Step 0. Normalise** (`vector-page.ts`, `normalizePage`). Flip y so it points down. Find the dominant text angle (mode of text angles, weighted by string length, snapped to 0 / 90 / 180 / 270) and rotate the whole page so that text reads left to right. Rotation only, never a mirror.

**Step 1. Classify pages** (`classifyPage`). `raster` when `imageCoverage > 0.5` and there are fewer than 200 strokes plus fills. `plan` when a text matches `/\bPLAN\b/i` outside any "ELEVATION" string, or failing that the page with the most room labels. `elevation` when a text matches `/ELEVATION|ELEV\.?|SECTION/i`. Use the first `plan` page. No plan page: throw `ImportError('no-plan-page')`; a raster-only document throws `ImportError('raster-plan')` with the message "This plan is an image. Trace it in the editor."

**Step 2. Labels** (`labels.ts`). Group text runs into blocks: same angle, vertical gap under 1.6 × text size, horizontal overlap or gap under 2 × size. Parse each block:
- Room label: contains one of `ROOM, BEDROOM, BED ROOM, MASTER, LIVING, HALL, DRAWING, DINING, KITCHEN, TOILET, BATH, WC, WASH, BALCONY, TERRACE, UTILITY, PASSAGE, LOBBY, FOYER, STUDY ROOM, POOJA, PUJA, STORE`. Type mapping: bedroom words → `bedroom`; living / hall / drawing / dining → `living`; kitchen → `kitchen`; toilet / bath / wc / wash → `bathroom`; balcony / terrace / utility → `balcony`; the rest → `other`. Dimensions from `parseSize` on any `a'b"Xc'd"` (or metric) token; area from `(\d+(\.\d+)?)\s*(SQ\.?\s*FT|SQFT|SFT)` or `SQ\.?\s*M`.
- Furniture label: starts with `BED` (not followed by ROOM), `SOFA`, `DINING TABLE`, `WARDROBE`, `STUDY` (not followed by ROOM), `DESK`, `SIDE TABLE`, `TV UNIT`, with an optional size. `WARDROBE=9'0"RFT` gives a running length only.
- Label text is title-cased for display: `SON ROOM` → "Son Room".

**Step 3. Walls** (`walls.ts`). Candidate fills: area at least 0.01% of the page, bbox short side at least 2 pt, and rectilinear (at least 80% of the perimeter lies along two orthogonal directions, within 3°). Group candidates by colour. A colour group is a wall group when its total area is at least 0.3% of the page and its shapes are elongated (median long side / short side at least 3) or large. All wall groups are used; if several qualify, none is dropped (structure and partitions are both walls). `t` = median of the short sides of the wall polygons' long thin parts (edges under `3 × median short edge`). Typical result: 0.115 to 0.23 m.

**Step 4. Gap bridging** (`bridgeGaps`). A wall end face is a wall-polygon edge of length at most `2.5 t`. Two end faces form a gap when their outward normals are opposite (within 10°), their centres are collinear along that normal within `0.5 t`, the distance is between `2 t` and `14 t`, and no wall lies between. Each gap becomes a barrier segment for step 5 and an opening candidate for step 7.

**Step 5. Room regions** (`regions.ts`). Rasterise barriers into a bitmap at `t / 3` per pixel.
- Pass 1 barriers: wall fills + gap bridges. Flood fill from each room label's centre. A fill "leaks" when it touches the bitmap border or contains another room's label.
- Pass 2, for leaking rooms only: add every stroke segment at least `8 t` long as a barrier (railings, sliding-door tracks, drawing borders), flood again.
- Still leaking: **label rectangle**. Build a rectangle of the labelled size (needs the scale, so this is done after step 6) centred on the label block, long side along the label's longer extent of free space, then shift it by up to 0.5 m per axis so its edges meet the nearest wall faces. No labelled size: drop the room and add a warning.
- Region to polygon: trace the outer contour, simplify (Douglas-Peucker, tolerance `0.5 t`), snap edges within 8° of the two dominant wall directions onto them, merge collinear edges, remove vertices closer than `0.5 t`.
- `method` and `confidence`: `walls` 0.9, `walls+strokes` 0.7, `label-rect` 0.4.

**Step 6. Scale by voting** (`scale.ts`, `voteScale`). Collect `ptPerM` votes:
- Furniture: for each furniture label with a size, find the smallest closed stroke (or fill) whose bbox contains the label centre or lies within `6 t` of it and whose side ratio matches the labelled ratio within 10%. Two votes: short side / short label dimension, long side / long label dimension.
- Rooms with a closed region (not label-rect): `sqrt(areaPt2 / labelAreaM2)` when an area is labelled; `min bbox side / min label dim` and `max bbox side / max label dim` when dimensions are labelled.
- Result: the largest set of votes that agree within 3% of their own median; `ptPerM` = that median; `agreeing` = its size; `disagreementPct` = spread of all votes as `(max - min) / median * 100`. Ties go to the set containing more furniture votes (furniture outlines are drawn exactly; room labels are nominal). Fewer than 2 agreeing votes: keep the single best vote and add the warning "Scale rests on one label. Check a door width." No votes at all: assume `t = 0.23 m` (a 9 inch wall), `confidence 0.2`, warning "No dimensions found. Scale guessed from wall thickness."
- World coordinates: `x = (px.x - cx) / ptPerM`, `z = (px.y - cy) / ptPerM`, with `(cx, cy)` the centre of the wall bbox.

**Step 7. Openings** (`openings.ts`). For each bridged gap, find the room polygon edge it lies on (distance under `1.5 t`, parallel within 10°); if two rooms share it, attach it to the room listed first. Classify:
- `window`: at least two straight strokes run across the gap parallel to the wall, each spanning at least 80% of it. Sill 0.9, head 2.1 unless step 9 found better.
- `door`: a stroke with a curve whose flattened points fit a circle of radius within 20% of the gap width, centred within `1.5 t` of one gap end (the swing). Sill 0, head 2.1.
- otherwise `opening` (archway or sliding door). Sill 0, head 2.1.
- `widthM` = gap length; gaps wider than 2.0 m or narrower than 0.55 m are dropped with a warning. `centreM` measured along the room edge per 3.1.
- Edges: `defaultEdges(room, others)` from C1; an edge closed only by pass-2 strokes on a balcony stays `railing`.

**Step 8. Furniture** (`furniture.ts`). For each furniture label with a matched outline (step 6): `Box` from the outline's oriented bbox; the back is the side nearest a wall face (ties: the side opposite the label's reading direction). Mapping: `BED` → `bed`, `heightM 0.9`, `surfaceHeightM 0.5`, `inner` = labelled size; `SOFA` → `sofa` (0.85 / 0.43); `DINING TABLE` → `dining` (0.95 / 0.75); `STUDY`, `DESK` → `counter` with `heightM 0.75`, `surfaceHeightM 0.75`; `WARDROBE` → `wardrobe` (2.10 / 2.10) when a closed outline at least 0.45 m deep contains or touches the label, else `unmapped` with its running length. `SIDE TABLE`, `TV UNIT` and anything else → `unmapped` (the furniture kinds in `types.ts` have no slot for them).

**Step 9. Elevations** (`elevation.ts`, `findCeiling(pages, planRooms, ptPerM)`).
1. **Text**, when the designer's dimensions are real text: on elevation pages, a length token next to `CEILING|CLG|C\.?H\.?|HEIGHT|HT|FFL|SLAB` within 3 lines, or a length token between 2.3 and 3.6 m that is the largest vertical dimension on the page. `method: 'text'`, confidence 0.9. Same pass for `SILL` and `LINTEL` tokens → `windowHeights` when exactly one window exists in that room.
2. **Geometry**, for exploded-font drawings like the reference: on each elevation page find the room box: the floor line (the longest horizontal stroke or the bottom edge of the wall fills), the slab underside (the lower edge of the widest horizontal wall-colour fill above it), and the inside faces of the two outermost vertical wall-colour fills. `aspect = clearWidthPt / clearHeightPt`. Candidate ceiling heights = `d / aspect` for every distinct wall-to-wall extent `d` of the plan's rooms (both bbox sides of every room region, in metres). Keep candidates between 2.3 and 3.4 m. One left: that is the height, confidence 0.7. Several: prefer the candidate that other elevation pages also produce (within 3%); still several: take the one nearest 2.75 m, confidence 0.3, and warn "Ceiling height is a guess between {list}. Confirm it." `method: 'geometry'`.
3. Neither: 2.75 m, `method: 'default'`, confidence 0.1, with a warning.
Deeper elevation parsing (wardrobe internals, wall finishes) is out of scope.

**Step 10. Assemble.** `LayoutProposal { version: 1, source: 'drawing-import@1', rooms (normalised with normalizeRoom), openings, wallHeightM: ceiling.heightM, confidence: min over rooms and scale, notes: warnings }`. Run `validateLayout`; errors become warnings in the extras (the editor will show them again). Spawn (13.8).

### 13.6 pdf.js adapter (`pdfjs-adapter.ts`: `loadVectorPages(data: Uint8Array): Promise<VectorPage[]>`)

- `getOperatorList()`: walk `fnArray` / `argsArray`, tracking a graphics-state stack for `save`, `restore`, `transform` (CTM), `setFillRGBColor` and `setStrokeRGBColor` (argument is a `'#rrggbb'` string in 6.4), `setLineWidth`.
- `constructPath` arguments in 6.4 are `[paintOp, [Float32Array], minMax]`. The array is a stream of draw codes: `0 x y` moveTo, `1 x y` lineTo, `2 x1 y1 x2 y2 x y` cubic, `3 x1 y1 x y` quadratic, `4` closePath. `paintOp` is the `OPS` code of the paint operator: `fill`, `eoFill` → a `VFill`; `stroke`, `closeStroke` → a `VStroke`; the fill-and-stroke variants → both; `endPath` (clip paths) → skip. Compare against `pdfjs.OPS`, never against literal numbers.
- Apply the CTM to every point. Flatten curves. Compute fill area by the shoelace formula (outer ring minus holes).
- `paintImageXObject`: add the CTM's unit-square area to `imageCoverage`.
- `getTextContent()`: each item gives `str`, `transform` (position `e, f`; angle `atan2(b, a)`; size `hypot(a, b)`) and `width`.
- Keep this file thin and defensive: if an operator's argument shape is not as described, throw `ImportError('pdfjs-shape')` naming the operator, rather than guessing. The other pdf.js versions changed these shapes.

### 13.7 CLI (`scripts/import-drawing.ts`)

`tsx scripts/import-drawing.ts <file.pdf> --scene <id> [--force] [--page <n>]`
Writes into `public/scenes/<id>/`: `proposal.json`, `proposal-extras.json`, and the draft `property.json` (13.4). Prints a review summary: scale and how many votes agreed, each room with method and area, openings by type, ceiling with method, furniture, every warning. Exit code 2 with the message from 13.5 step 1 for raster plans. It never copies the source PDF into the repo.

`npm` script (the integrator adds it): `"import:drawing": "tsx scripts/import-drawing.ts"`.

### 13.8 Spawn

The centre of the largest room's polygon bbox; if that point is inside a furniture box, step outward on a 0.25 m lattice (nearest first) to the first point at least 0.3 m from every wall cell and furniture box, tested on `stampFurniture(rasterizeLayout(layout), furniture)` with `cellValue`. Yaw 0. None found: `spawn: null` and a warning; the editor's E8 step then asks for one.

### 13.9 Raster plans: interface only (`vision.ts`)

```ts
export interface PlanVisionInput { image: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/webp';
                                   hints?: { knownDimensions?: { label: string; lengthM: number }[]; ceilingM?: number } }
export interface PlanVisionProvider {
  readonly name: string;
  /** must return the same shapes the vector path returns, in world metres */
  propose(input: PlanVisionInput): Promise<ImportResult>;
}
export class VisionNotConfigured implements PlanVisionProvider { /* propose() throws ImportError('vision-not-configured') */ }
```
The intended implementation later is a vision model called with the user's own API key (model to be chosen then), prompted to return `ImportResult` JSON, followed by `validateLayout`. Nothing here calls a model. No key handling, no network code in this chunk.

### 13.10 Synthetic fixture (`scripts/make-test-drawing.ts`)

Draws the truth flat (6.1, furnished variant) in the reference drawing's style, so every number is checkable:
- Scale 31.7 pt per metre (deliberately odd), all content rotated 90° on an A4 page, like the reference.
- Walls as filled polygons: outer walls `#666666`, 0.23 m thick, outside the room rectangles; the bedroom / balcony and bedroom / passage walls `#b3b3b3`, 0.12 m thick, filling the gaps. Gaps at the two doors, the sliding opening and the window.
- Door swings as quarter-circle strokes; the window as three parallel strokes across its gap; the balcony railing as a single stroke on three sides; a rectangular drawing border and a title block with the word `PLAN`.
- Text: `BEDROOM 1` / `13'1"X16'5"` / `215 SQFT`; `BALCONY` / `9'10"X4'11"`; `PASSAGE` / `13'1"X3'11"`; furniture outlines with `BED` / `4'11"X6'7"` and `SOFA` / `6'7"X2'11"`; a 60 × 45 cm outline labelled `SIDE TABLE` / `2'0"X1'6"`.
- Noise the importer must ignore: 300 small black filled glyph-like shapes, a hatch of 200 short strokes, six dimension lines with tick marks outside the walls.
- Page 2, titled `ELEVATION-1`: the bedroom's 5.0 m wall. Side walls and a slab band in `#666666`, a floor line, clear width 5.0 m, clear height 2.6 m, at a **different** scale (27.3 pt per metre). Variant A carries the text `CLG HT 8'6"`. Variant B has no height text (geometry path).

Exports: `buildDrawingPages(variant: 'A' | 'B'): VectorPage[]` (already-parsed pages, for fast tests) and `buildDrawingPdf(variant): Uint8Array` (a real, minimal PDF 1.4 written by hand: one content stream per page using `re`, `m`, `l`, `c`, `h`, `f`, `S`, `rg`, `RG`, `w`, `cm`, and `BT /F1 … Tf … Tm (…) Tj ET` with the standard Helvetica font; correct xref table and trailer) for the adapter test. No PDF library.

### 13.11 Acceptance

Synthetic, always run (`npm test`):
1. Adapter: `loadVectorPages(buildDrawingPdf('A'))` returns 2 pages; page 1 has the same number of fills per colour as `buildDrawingPages('A')[0]` and every text string; fill areas agree within 0.5%.
2. Normalisation: after `normalizePage`, every label's angle is 0 and the bedroom label is not mirrored (the balcony label lies on the side of the bedroom label that the truth says, i.e. toward -z).
3. Classification: page 1 `plan`, page 2 `elevation`. A page with one full-page image and no paths is `raster`, and `proposeFromPages` throws `ImportError('raster-plan')`.
4. Walls: exactly the two grey groups are chosen; none of the 300 black shapes; `t` between 0.11 and 0.24 m at the true scale.
5. Gaps: exactly 4 bridged gaps, widths 0.90, 1.60, 1.20, 0.90 m (± 0.03).
6. Scale: `ptPerM` = 31.7 ± 0.5%; at least 4 agreeing votes; furniture votes included.
7. Rooms: 3 rooms. Areas: bedroom 20.0 m² ± 1.5%, passage 4.8 ± 3%, balcony 4.5 ± 4%. Methods: bedroom and passage `walls`, balcony `walls+strokes`. Types `bedroom`, `other`, `balcony`. Labels "Bedroom 1", "Passage", "Balcony".
8. Openings: 2 `door` (0.90 m), 1 `opening` (1.60 m), 1 `window` (1.20 m, sill 0.9, head 2.1), each on the right room edge with `centreM` within 0.05 m of the truth in 3.3.
9. Balcony edges: three `railing`, one `wall`.
10. Furniture: bed box within 0.04 m of `{ cx 1.0, cz 2.25, w 1.5, d 2.0 }` after translating by the import's origin offset, back side on the wall (yaw equivalent to the truth's 90°), `inner` = 1.50 × 2.01 m (the labelled 4'11" × 6'7"); sofa likewise with its back on the wall; `SIDE TABLE` in `unmapped`.
11. Ceiling: variant A `2.59 m` (8'6"), `method 'text'`; variant B `2.60 ± 0.05 m`, `method 'geometry'`, the 4.0 m candidate (which would give 2.08 m) rejected as out of range.
12. End to end: `rasterizeLayout` of the draft property's layout, compared with `classifyTruth` after translating by the origin offset, agrees on at least 98% of 10,000 seeded samples (edge samples skipped). A flood fill from the spawn reaches the balcony and the passage. `validateLayout` has no errors.
13. Robustness: with all furniture labels removed, scale still lands within 1.5% (room votes only). With all text removed, the import returns 0 rooms, the wall-thickness scale guess, and the two warnings, without throwing.

Real file, local only (`tests/import-real.local.test.ts`): path from `WALKTHRU_REAL_DRAWING`, default `~/Downloads/SON BEDROOM-Binder1.pdf`; `describe.skipIf(!existsSync(path))`. The test prints the review summary and asserts:
- page 1 is `plan`, pages 2 to 6 are `elevation`;
- wall colours chosen include `#666666` and `#b3b3b3`, and exclude `#000000`;
- two rooms, "Son Room" and "Master Room", both `bedroom`;
- Son Room: short wall-to-wall side 3.35 m (11'0") ± 3%, area 13.94 m² (150 sq ft) ± 3%;
- Master Room: 3.66 × 2.74 m (12'0" × 9'0") ± 3%. It is cut off by the edge of the drawing, so expect `method 'label-rect'`;
- furniture includes a bed with `inner` 1.52 × 1.83 m (5'0" × 6'0") in the Son Room and one 1.60 × 1.75 m (5'3" × 5'9") in the Master Room; the study as a `counter` 0.61 × 1.22 m; side tables and the wardrobe run in `unmapped` unless outlines matched;
- ceiling 2.59 m ± 0.08, `method 'geometry'`.
These expected values come from the drawing's labels and a rough reading of the rendered pages, not from a run of the algorithm. On the first run, if a value is outside tolerance, report the measured numbers and the review summary; do not widen a tolerance or special-case the file.

### 13.12 Risks specific to C8

1. **Not run end to end.** pdf.js loading, operator shapes, fill colours and text were checked on the real file. The wall, region, scale and ceiling steps are designed from that data but unexecuted.
2. **The reference's room label and area disagree by 9%**, and its long side is 14'11", not 12'6". "Son room = 11'0" × 12'6", 150 sq ft" cannot all hold at once; the test asserts the short side and the area.
3. **Ceiling by geometry** depends on finding the slab and floor lines among hatching. A rough pixel reading of elevation 1 gives about 2.53 to 2.59 m, inside the tolerance but not by much.
4. **Scale votes from rooms are nominal.** Drawings with no furniture labels and loose room labels can be several percent off; the review summary shows the vote spread so the broker can check one door width.
5. **Styles not covered:** walls drawn as two parallel strokes with no fill (common in older CAD exports), hatched walls, and curved walls. These fall through to "no walls found" and the manual trace. Stroke-pair walls are the first thing to add if real drawings need it.
6. **The editor has no drop zone for a PDF.** Import is a CLI step for now. Wiring it into E1 means touching a C5 file, so it is left for the integrator after wave 2.

---

## 14. C9 Media pipeline

Additive chunk. It changes nothing in sections 3.2 or 7.1 and edits no file owned by C0 to C8. It depends only on C0 (types, the dev-API pattern) and C1 (`validateProperty`, `roomAt`), both committed, so it runs now, alongside C2, C3, C5 and C8. No new npm packages.

### 14.1 What it does

The broker drops a WhatsApp video and/or WhatsApp photos. Assume they are always poor: 720p, heavily compressed, a fast walk, blank walls. Automatically, with no further input:

1. **Frames** for the editor's colour sampling (`FrameStore`): extracted on the server, sharpness-ranked, de-duplicated.
2. **A scan splat** where reconstruction succeeds: `scene.ply` plus a `splat` block in overlay mode, for C7 to level and pin.
3. **Photo pins**: every photo becomes a pin. The broker drops it on the plan (or accepts an auto-suggested spot). The buyer sees a "Real photo" bubble in the walk-through and taps it to see the photo where it was taken.

**Fail soft is the rule.** Reconstruction usually covers only part of the flat and sometimes nothing. No splat is a normal outcome, not an error: the job still ends `done`, frames and pins still arrive, and the shell still ships.

### 14.2 Measured facts this design rests on (Mahir's M2, 8 GB, the reference video: 35.5 s, 720x1280, about 2.7 Mbps)

- Installed: ffmpeg / ffprobe 8 and COLMAP 4.2.1 (Homebrew, CPU only) at `/opt/homebrew/bin`; Brush v0.3.0 at `~/walkthru-tools/brush/brush-app-aarch64-apple-darwin/brush_app`.
- COLMAP's faiss matcher **crashes** in this build. Always pass `--SiftMatching.cpu_brute_force_matcher 1`.
- Best recipe found: 10 fps (355 frames) with the feature, matcher and mapper flags in 14.6. Result: 12 fragments, the largest 133 frames (the first 13 s). At 4 fps with defaults only 23 of 142 frames registered. Features, matching and mapping took a few minutes on CPU.
- Brush with the flags in 14.6 took 11 minutes, 1.5 GB peak. Its PLY (44 MB, SH degree 3, COLMAP's Y-down frame, so `upPreset: 'flip-x'`) rendered correctly in Spark in Chrome.
- COLMAP 4's `global_mapper` is untested. It is not used.

### 14.3 Files (all new, all owned by C9)

```
src/media/
  types.ts              every C9 type (14.4). Imports from ../types only.
  frame-metrics.ts      pure: sharpness, perceptual hash, descriptors, frame selection
  colmap-model.ts       pure: parse COLMAP text models, fragments, coverage, camera poses
  pins.ts               pure: pins file validation, nearest-frame match, pose suggestion
  client.ts             browser: upload, start job, poll, read and write pins (fetch only)
  editor-hook.ts        browser: mountMediaPipeline(panel, ctx)  -> the one line C5 calls
  photo-pins-view.ts    browser: mountPhotoPins(opts)             -> the one call C3 makes
  media.css
  server/               Node only. Never imported by a page.
    media-api.ts        Vite middleware: walkthruMediaApi()
    jobs.ts             queue, job store, events
    pipeline.ts         the stages, in order
    tools.ts            tool discovery, spawn with timeout and abort
    frames.ts           ffprobe, ffmpeg extraction
    backend.ts          ReconstructionBackend + registry
    backends/local-colmap-brush.ts
    backends/fake.ts    canned result, for tests
    backends/cloud.ts   interface-conforming placeholder that reports "not configured"
scripts/
  media-worker.ts       CLI: run the pipeline on files without the dev server
  make-test-video.ts    synthetic test video
tests/
  media-*.test.ts       always run (pure parts, fake backend, ffmpeg-gated parts)
  media-tools.local.test.ts   runs only when colmap is installed
  media-real.local.test.ts    runs only when the reference video is present
```

Nothing in `src/media/` except `server/` may import `node:*`. `server/` may not import three, Spark or anything from `buyer/`, `editor/`, `engine/`.

### 14.4 Types (`src/media/types.ts`)

```ts
import type { Vec2, Vec3, SplatOverlay } from '../types';

// ---------- jobs ----------
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type StageId = 'probe' | 'frames' | 'photos' | 'features' | 'matching' | 'mapping' | 'select' | 'training' | 'publish';
export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'timeout';
export interface StageStatus { id: StageId; state: StageState; fraction: number; message?: string; startedAt?: string; endedAt?: string }
export interface JobEvent {
  seq: number;                       // strictly increasing per job, from 1
  at: string;                        // ISO 8601
  type: 'state' | 'stage-start' | 'progress' | 'stage-end' | 'warning' | 'log';
  stage?: StageId;
  stageState?: StageState;
  fraction?: number;                 // 0..1 within the stage
  message?: string;
}
export interface MediaOptions {
  mode: 'full' | 'tiny';             // tiny = fast settings for tests (14.6)
  backend: 'local' | 'cloud' | 'fake' | 'none';
  /** also train every other fragment with at least this many frames; 0 = only the largest */
  trainExtraFragmentsMin: number;    // default 0; the UI offers 60
  /** write the splat block into an existing property.json on disk */
  patchProperty: boolean;            // CLI default true; the editor sends false and patches its own draft
  /** skip the training stage (COLMAP only) */
  skipTraining: boolean;             // default false
}
export interface JobStatus {
  jobId: string; sceneId: string; state: JobState;
  createdAt: string; updatedAt: string;
  options: MediaOptions;
  stages: StageStatus[];             // always all nine, in order
  overall: number;                   // 0..1, weighted (14.5)
  events: JobEvent[];                // those with seq > ?since=, at most 200
  lastSeq: number;
  result: MediaResult | null;        // set when state is done
  error?: string;                    // set when state is failed
}

// ---------- results ----------
export interface FrameInfo { file: string; timeSec: number; sharpness: number; width: number; height: number }
export interface PhotoInfo { id: string; file: string; thumb: string; width: number; height: number; originalName: string }
export interface Coverage {
  totalFrames: number; registeredFrames: number;     // largest fragment
  secondsTotal: number; secondsCovered: number;
  spans: { fromSec: number; toSec: number }[];
}
export interface FragmentInfo {
  index: number;                     // 0 = largest
  registeredFrames: number;
  coverage: Coverage;
  /** published file name in the scene folder, or null when not trained */
  ply: string | null;
  splatCount: number | null;
  trainState: 'trained' | 'skipped' | 'failed' | 'timeout';
}
/** Camera centre and viewing direction of a registered frame, in the splat's raw frame. */
export interface FrameCamera { frame: string; timeSec: number; centre: Vec3; forward: Vec3 }
export interface MediaResult {
  frames: FrameInfo[];               // editor frames, sharpest first within time order
  photos: PhotoInfo[];
  /** null when there is no splat; reason says why in plain words */
  splat: SplatOverlay | null;
  splatReason: string;
  fragments: FragmentInfo[];
  cameras: FrameCamera[];            // of fragment 0
  warnings: string[];
}
/** public/scenes/<id>/media/manifest.json = the MediaResult of the latest job plus jobId and a timestamp. */
export interface MediaManifest extends MediaResult { version: 1; jobId: string; finishedAt: string }

// ---------- reconstruction backend ----------
export interface ReconInput {
  workDir: string;                   // absolute; the backend may write anywhere inside it
  imagesDir: string;                 // absolute; frame-000001.jpg ...
  frames: { file: string; timeSec: number }[];
  ordered: boolean;                  // true for video frames, false for a photo set
  mode: 'full' | 'tiny';
  trainExtraFragmentsMin: number;
  skipTraining: boolean;
  signal: AbortSignal;
}
export interface ReconHooks {
  stage(id: 'features' | 'matching' | 'mapping' | 'select' | 'training', state: StageState, message?: string): void;
  progress(id: 'features' | 'matching' | 'mapping' | 'training', fraction: number, message?: string): void;
  log(line: string): void;
}
export interface ReconFragment { registered: { file: string; timeSec: number }[]; cameras: FrameCamera[];
                                 plyPath: string | null; splatCount: number | null; trainState: FragmentInfo['trainState'] }
export interface ReconResult { fragments: ReconFragment[]; upPreset: 'flip-x' | 'as-is' | 'z-up'; warnings: string[] }
export interface ReconstructionBackend {
  readonly name: string;
  /** which tools or credentials are missing; ok = false means the pipeline skips reconstruction */
  available(): Promise<{ ok: boolean; missing: string[] }>;
  /** resolves with zero fragments when nothing reconstructs; rejects only on abort */
  reconstruct(input: ReconInput, hooks: ReconHooks): Promise<ReconResult>;
}

// ---------- photo pins ----------
export interface PhotoPin {
  id: string;                        // = PhotoInfo.id
  file: string;                      // 'media/photos/p-001.jpg', relative to the scene folder
  thumb: string;
  width: number; height: number;
  /** where the photo was taken, world metres; null until placed */
  at: Vec2 | null;
  /** which way the camera faced; null when unknown */
  yawDeg: number | null;
  roomId: string | null;
  caption?: string;
  placedBy: 'broker' | 'auto' | null;
  /** the automatic guess, kept so the broker can accept or ignore it */
  suggested?: { at: Vec2 | null; yawDeg: number | null; roomId: string | null; frame: string | null;
                score: number; source: 'frame-pose' | 'frame-only' | 'none' };
}
/** public/scenes/<id>/photo-pins.json */
export interface PhotoPinsFile { version: 1; pins: PhotoPin[] }
```

Photo pins live in the sidecar `photo-pins.json`, not in `property.json`, so `types.ts` and `validateProperty` are untouched. A scene with no such file simply has no pins.

### 14.5 Jobs (`server/jobs.ts`)

- One job runs at a time across all scenes (8 GB machine). Others wait as `queued`, first in first out.
- States: `queued → running → done | failed | cancelled`. `failed` only when the media itself cannot be used (the `probe` or `frames` stage fails, or there is no usable input). Every later stage failing or timing out is recorded on the stage, adds a warning, and the job continues to `done`.
- Each stage moves `pending → running → done | skipped | failed | timeout`. Every transition appends a `JobEvent`. `progress` events are throttled to one per stage per 500 ms.
- `overall` = sum of stage weights times stage fraction, with weights: probe 0.01, frames 0.06, photos 0.02, features 0.12, matching 0.14, mapping 0.14, select 0.01, training 0.48, publish 0.02. Skipped, failed and timed-out stages count as complete.
- Persistence: the full status (all events) is written to `.cache/media/<sceneId>/jobs/<jobId>.json` after every event. On server start, any stored job still `queued` or `running` is rewritten as `failed` with `error: 'The dev server restarted. Run it again.'`
- `jobId`: `j-` + 8 lower-case hex characters. Cancelling aborts the job's `AbortController`; `tools.ts` kills the child process group; the job ends `cancelled`.
- Work directory: `.cache/media/<sceneId>/<jobId>/`. When a job starts, work directories of that scene's older jobs are deleted. `.cache` is already git-ignored.

### 14.6 Pipeline (`server/pipeline.ts`: `runMediaJob(job, hooks)`)

Tools (`server/tools.ts`): `ffmpeg`, `ffprobe`, `colmap` resolved from `WALKTHRU_FFMPEG`, `WALKTHRU_FFPROBE`, `WALKTHRU_COLMAP`, else PATH plus `/opt/homebrew/bin`. Brush from `WALKTHRU_BRUSH`, else `~/walkthru-tools/brush/brush-app-aarch64-apple-darwin/brush_app`. `run(cmd, args, { timeoutMs, signal, onLine })` spawns without a shell, streams stdout and stderr line by line, kills the process group on timeout or abort, and resolves `{ code, timedOut }`. It never throws for a non-zero exit.

| Stage | What | Timeout full / tiny | On failure |
|---|---|---|---|
| `probe` | `ffprobe -v error -print_format json -show_format -show_streams` on each video; image size for each photo | 20 s | job `failed` when no input is readable |
| `frames` | reconstruction frames and editor frames (below) | 180 s / 60 s | job `failed` if a video yields zero frames; skipped when there is no video |
| `photos` | normalise, thumbnail, descriptors, nearest-frame match (below) | 120 s | stage `failed`, warning |
| `features` | COLMAP `feature_extractor` | 10 min / 2 min | no splat |
| `matching` | COLMAP `sequential_matcher` (video) or `exhaustive_matcher` (photo set) | 15 min / 2 min | no splat |
| `mapping` | COLMAP `mapper` | 20 min / 3 min | no splat |
| `select` | read the models, rank fragments, compute coverage | 60 s | no splat |
| `training` | Brush, per chosen fragment | 25 min / 3 min each | that fragment has no PLY |
| `publish` | copy files into the scene folder, write the manifest, seed pins, optionally patch `property.json` | 60 s | warning |

Stages `features` to `training` belong to the backend. When `options.backend` is `none`, or `available()` reports missing tools, they are all `skipped` with the message "Scan tools not installed: {list}" and `splatReason` says the same.

**Reconstruction input.** A video: frames at `fps = min(10, 600 / durationSec)` (so at most 600 frames), native resolution, `ffmpeg -i <video> -vf fps=<fps> -q:v 2 <work>/images/frame-%06d.jpg`. `timeSec = (n - 1) / fps`. Several videos: only the longest is reconstructed; the others contribute editor frames. No video: the photos are the input only when there are **20 or more**; fewer gives `splatReason: 'Only {n} photos. A scan needs a video or at least 20 photos.'` Tiny mode: `fps = min(6, 24 / durationSec)` (at most 24 frames), `-vf fps=<fps>,scale=480:-2`.

**Editor frames** (`frame-metrics.ts`). One extra ffmpeg pass decodes the same frames as 160-pixel-wide 8-bit grey raw video to a pipe (`-vf fps=<fps>,scale=160:-2,format=gray -f rawvideo -`). Per frame:
- `sharpness` = variance of the 3 × 3 Laplacian (`4c - n - s - e - w`) over interior pixels.
- `hash` = 64-bit difference hash: resize to 9 × 8 by box averaging, one bit per horizontal neighbour comparison.
Selection (`selectEditorFrames(metrics, { maxFrames: 60, windowSec: 1, minHamming: 7 })`): take the sharpest frame in each one-second window; walk them in time order and drop any whose hash is within Hamming distance 6 of the previously kept frame; if more than 60 remain, keep the 60 sharpest and restore time order. The chosen frames are re-encoded to `public/scenes/<id>/media/frames/f-0001.jpg` … (longest side at most 1280, `-q:v 3`, `-map_metadata -1`).

**Photos.** Each is re-encoded through ffmpeg to `media/photos/p-001.jpg` (longest side at most 2048, `-map_metadata -1` so EXIF and GPS are stripped) with a `p-001.thumb.jpg` (longest side 320). A 12 × 12 RGB descriptor plus the 64-bit hash is computed for every photo and every editor frame; `nearestFrame(photo, frames)` returns the frame with the smallest `0.5 * hamming/64 + 0.5 * meanAbsRgbDiff/255` and that score. A score above 0.22 means "no match".

**Local backend (`backends/local-colmap-brush.ts`).** Exactly these commands (full mode). Database `<work>/db.db`, output `<work>/sparse`.

```
colmap feature_extractor --database_path db.db --image_path images
  --ImageReader.single_camera 1 --ImageReader.camera_model OPENCV
  --FeatureExtraction.use_gpu 0
  --SiftExtraction.max_num_features 12000 --SiftExtraction.peak_threshold 0.003
  --SiftExtraction.domain_size_pooling 1

colmap sequential_matcher --database_path db.db
  --FeatureMatching.use_gpu 0 --SiftMatching.cpu_brute_force_matcher 1
  --SequentialMatching.overlap 25

colmap mapper --database_path db.db --image_path images --output_path sparse
  --Mapper.init_min_num_inliers 50 --Mapper.abs_pose_min_num_inliers 15
  --Mapper.abs_pose_min_inlier_ratio 0.15 --Mapper.init_min_tri_angle 4
  --Mapper.min_model_size 5
```
- Photo sets (`ordered: false`): `--ImageReader.single_camera 0` and `colmap exhaustive_matcher --database_path db.db --FeatureMatching.use_gpu 0 --SiftMatching.cpu_brute_force_matcher 1`.
- Tiny mode: `max_num_features 3000`, `overlap 8`, everything else the same.
- The brute-force matcher flag is mandatory on every matcher call. Add a comment saying the faiss matcher crashes in COLMAP 4.2.1.
- Progress: `features` and `mapping` fractions from counting COLMAP's per-image log lines against the frame count; if the log format does not match, emit only start and end. Never fail a stage because progress could not be parsed.
- `select`: for each `sparse/<n>`, `colmap model_converter --input_path sparse/<n> --output_path txt/<n> --output_type TXT`, then `parseImagesTxt` (`colmap-model.ts`). Rank models by registered image count. Fragment 0 is the largest. A largest fragment with fewer than 30 frames (8 in tiny mode) yields zero fragments and the warning "Only {n} frames lined up. Not enough for a scan."
- Camera poses: COLMAP stores world-to-camera `q = (qw, qx, qy, qz)`, `t`. Centre `C = -Rᵀ t`. Forward = `Rᵀ (0, 0, 1)`.
- `training`, for fragment 0 and for any other fragment with at least `trainExtraFragmentsMin` frames when that option is above 0: build `<work>/frag-<i>/` with `images` (a symlink to the images directory) and `sparse/0` (a copy of that model's binary files), then

```
brush_app <work>/frag-<i> --total-steps 15000 --max-splats 800000 --max-resolution 720
  --export-every 5000 --export-path <work>/frag-<i>/out --export-name "splat_{iter}.ply"
```
  Tiny mode: `--total-steps 300 --max-splats 20000 --max-resolution 320 --export-every 300`. Progress = the highest `splat_<iter>.ply` present divided by total steps, polled every 5 s. Result = the file with the highest iteration; if the process times out but an earlier export exists, use it and record `trainState: 'timeout'` with that PLY. `splatCount` from the PLY header's `element vertex` line. Brush missing: `trainState: 'skipped'`.
- `upPreset: 'flip-x'`.

**Publish.**
- Fragment 0's PLY → `public/scenes/<id>/scene.ply`. Extra fragments → `scene-2.ply`, `scene-3.ply`, listed in the manifest only (`property.json` holds one splat).
- `MediaResult.splat` = `{ file: 'scene.ply', format: 'ply', upPreset: 'flip-x', mode: 'overlay', transform: { rotation: [0, 0, 0, 1], scale: 1, position: [0, 0, 0] } }`. The transform is deliberately the identity: levelling and pinning are C7's job (E7).
- `media/manifest.json` is written. `photo-pins.json` is created or merged: one pin per photo, existing pins (matched by `id`) keep their `at`, `yawDeg`, `roomId`, `caption`, `placedBy`; new pins get `at: null` and a `suggested` block.
- With `patchProperty` and an existing `property.json` that has no `splat`: add the block, run `validateProperty`, write. An existing `splat` is left alone and a warning says so. No `property.json`: nothing is created.
- `splatReason` in plain words, one of: "Scan made from {registered} of {total} frames ({seconds} s of {totalSeconds} s)." · "The video did not line up well enough for a scan. The room layout still works." · "Scan tools not installed: {list}" · the photo-count message above · "Scan training ran out of time."

**Cloud later.** `backends/cloud.ts` implements `ReconstructionBackend` with `available()` returning `{ ok: false, missing: ['WALKTHRU_MODAL_URL'] }`. A real version uploads `imagesDir`, polls, downloads PLYs into `workDir` and returns the same `ReconResult`. `pipeline.ts`, the API and every caller stay as they are; only `options.backend` changes.

### 14.7 Dev API (`server/media-api.ts`: `walkthruMediaApi(): Plugin`, `apply: 'serve'`)

Scene ids must match `^[a-z0-9-]{1,40}$`. Any route not listed calls `next()`.

| Route | Body | Response |
|---|---|---|
| `POST /api/scenes/:id/media?name=<file name>` | the raw file, **streamed to disk** (never buffered whole), max 300 MB | `{ uploadId, kind: 'video' \| 'photo', bytes }`; 415 for other types, 413 when too large |
| `POST /api/scenes/:id/jobs` | `{ uploadIds: string[], options?: Partial<MediaOptions> }` | `{ jobId }` |
| `GET /api/scenes/:id/jobs/:jobId?since=<seq>` | | `JobStatus` (events after `since`) ; 404 when unknown |
| `GET /api/scenes/:id/jobs` | | `{ jobId, state, createdAt }[]`, newest first |
| `DELETE /api/scenes/:id/jobs/:jobId` | | `{ ok: true }`, cancels |
| `GET /api/scenes/:id/pins` | | `PhotoPinsFile` (empty list when the file is missing) |
| `PUT /api/scenes/:id/pins` | `PhotoPinsFile` | `{ ok: true }` after validation (`validatePinsFile` in `pins.ts`) |

Kind by extension, checked against the first bytes: video `mp4 mov m4v webm`; photo `jpg jpeg png webp heic`. Uploads go to `.cache/media/<sceneId>/uploads/<uploadId>-<sanitised name>`; `uploadId` is `u-` + 8 hex characters. Uploaded originals never enter `public/`.

**Integrator hooks (the only edits to files C9 does not own):**

1. `vite.config.ts`, two lines. The media plugin must come first, because the existing scene middleware answers 404 for `/api/scenes/...` routes it does not know:
   ```ts
   import { walkthruMediaApi } from './src/media/server/media-api';
   // ...
   plugins: [walkthruMediaApi(), walkthruDevApi()],
   ```
2. `src/editor/steps/media.ts` (C5), one line inside `mount(panel, ctx)` plus its import: `mountMediaPipeline(panel, ctx);` from `'../../media/editor-hook'`.
3. `src/buyer/main.ts` (C3), one call after the context exists: `mountPhotoPins({ ... })` (14.9).
4. `package.json`, one script: `"media": "tsx scripts/media-worker.ts"`.

### 14.8 Editor hook (`editor-hook.ts`: `mountMediaPipeline(panel: HTMLElement, ctx: EditorContext): () => void`)

Imports `EditorContext` as a type only. Appends one block to the panel and returns an unmount function. Small UI, three parts:

1. **Drop zone**: "Drop the WhatsApp video and photos here". Uploads each file (`client.uploadMedia`), then starts one job with `patchProperty: false`. A checkbox "Also scan smaller pieces (slower)" sets `trainExtraFragmentsMin: 60`.
2. **Progress**: one bar for `overall`, the running stage's name in plain words (Reading the video · Picking frames · Preparing photos · Finding features · Matching frames · Working out the camera path · Choosing the best piece · Building the scan · Saving), and a Cancel button. Polls `GET …/jobs/:jobId?since=` once a second. A job found `running` on mount (from `GET …/jobs`) is picked up again.
3. **Result**, when `done`:
   - Frames: fetch each `media/frames/*.jpg` as a `File` and call `ctx.frames.addImages(files)`. Line: "{n} frames ready for colour sampling."
   - Scan: `result.splatReason` as the line. When `result.splat` is set and `ctx.draft.splat` is undefined: `ctx.draft.splat = result.splat; ctx.commit();` and add "Go to the Scan step to line it up with the plan."
   - Coverage line: "Scan covers {secondsCovered} s of {secondsTotal} s ({registeredFrames} of {totalFrames} frames)."
   - **Photo pins**: a row of thumbnails. Click a thumbnail, then click the plan to place it; drag from the placed pin to set the direction it faces. A pin with a suggestion shows a dashed marker at the suggested spot and a button "Use suggestion ({room label})". Pins are drawn through `ctx.plan.addLayer` as a camera glyph with a direction wedge; the placing click uses `ctx.plan.setTool`. `roomId` is set from `roomAt(ctx.draft.layout, at)`. Every change is saved with `client.savePins`. A caption field per pin (optional, 60 characters).
   - Failed job: the `error` text and "Try again".

**Auto-suggestion** (`pins.ts`, `suggestPinPose(pin, match, cameras, splat, layout)`), recomputed whenever the panel mounts:
- The photo's nearest editor frame (14.6) gives a frame and a time. No match: `source: 'none'`.
- If that frame's nearest registered camera (within 0.5 s) exists and `ctx.draft.splat` has been pinned (its transform is not the identity): world position = `scale * rotate(rotation, centre) + position`, yaw from the transformed forward vector's heading, `roomId` from `roomAt`. `source: 'frame-pose'`, `at` set.
- Otherwise `source: 'frame-only'`: `at: null`, and the panel shows the matching video frame beside the photo to help the broker place it by eye.

### 14.9 Buyer module (`photo-pins-view.ts`)

Standalone: it takes plain parameters, not `BuyerContext`, so it can be built and tested before C3 lands.

```ts
export interface PhotoPinsOptions {
  sceneId: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** element covering the canvas; bubbles and the lightbox are appended here */
  overlay: HTMLElement;
  /** subscribe to the render loop; returns unsubscribe */
  onFrame(cb: (dt: number) => void): () => void;
  /** where the character is, for showing only nearby pins */
  viewerPosition(): Vec2;
  /** room id at a point, or null (the integrator passes roomAt bound to the layout) */
  roomIdAt(p: Vec2): string | null;
  roomLabel(roomId: string): string;
  /** called when the lightbox opens or closes, so the buyer can pause movement input */
  onLightbox?(open: boolean): void;
}
export interface PhotoPinsHandle { count: number; setVisible(v: boolean): void; dispose(): void }
export function mountPhotoPins(opts: PhotoPinsOptions): Promise<PhotoPinsHandle>;
```

Behaviour:
- Loads `/scenes/<id>/photo-pins.json`; a 404 or an empty list resolves with `count: 0` and renders nothing. Only pins with `at` set are shown.
- Each pin: an opaque floor ring (radius 0.18 m, colour `#2F6BFF`, 1 cm above the floor) with a small wedge toward `yawDeg`, plus an HTML bubble projected from `(x, 1.5, z)` every frame: a 44 px round thumbnail with a 2 px white border and the caption "Real photo" under it. HTML, not a sprite, so nothing alpha-blends against a splat.
- A bubble is shown when the pin is in front of the camera and either in the same room as the viewer or within 4 m. Bubbles fade in over 150 ms. At most 6 bubbles at once, nearest first.
- Tapping a bubble opens a lightbox over the view: the full photo fitted to the screen, the line "Real photo · {room label}" (plus the caption when present), "Photo from the broker" in small text, and a close button; Esc and a tap outside also close it.
- The integrator's call in C3: `mountPhotoPins({ sceneId, scene: viewer.scene, camera: viewer.camera, overlay, onFrame: viewer.onFrame, viewerPosition: () => character.position, roomIdAt: p => roomAt(property.layout, p)?.id ?? null, roomLabel: id => …, onLightbox: open => … })`. The buyer has no floor-plan view in this prototype, so pins appear in 3D only; the plan-view bubbles exist in the editor.

### 14.10 CLI (`scripts/media-worker.ts`)

`tsx scripts/media-worker.ts <files…> --scene <id> [--tiny] [--backend local|fake|none] [--extra-fragments 60] [--skip-training] [--no-patch]`
Runs the same `runMediaJob` in-process, prints events as lines (`[features] 42% …`), ends with the coverage line and `splatReason`. Exit code 0 for `done` (with or without a splat), 1 for `failed`.

### 14.11 Synthetic test video (`scripts/make-test-video.ts`)

- `buildLavfiVideo(outPath, { seconds = 4, size = '360x640', fps = 30 })`: `ffmpeg -f lavfi -i testsrc2=size=…:rate=… -t … -pix_fmt yuv420p`. No parallax, so it exercises probing, frames, hashing and the soft-fail path (COLMAP cannot map it).
- `buildRoomVideo(outPath, { frames = 48, size = [480, 640] })`: a software render of the synthetic splat fragment from `scripts/make-test-room.ts` (`buildSplatFragment()`), so it has real parallax. A pinhole camera (FOV 70°) walks from (3.2, 1.4, 0.8) to (2.2, 1.4, 4.0) looking at (0.8, 0.9, 2.4), in equal steps. Each point is drawn as a square of side `max(1, round(0.03 * f / depth))` pixels with a z-buffer. Because the generated room is flat-coloured (nothing for SIFT to find), each point's colour is multiplied by `0.55 + 0.45 * noise`, where `noise` is a hash of the point's position quantised to 4 cm, which paints a stable speckle on every surface. Frames are piped to ffmpeg as raw RGB and encoded to H.264 at 12 fps.
- `buildTestPhotos(dir, n)`: `n` frames of that render saved as JPEGs, as stand-ins for WhatsApp photos.

### 14.12 Acceptance

Always run (`npm test`; ffmpeg-dependent cases use `describe.skipIf(!hasFfmpeg)`):
1. `laplacianVariance`: a 160 × 120 checkerboard of 8 px squares scores more than 20 times the same image box-blurred with radius 4; a constant image scores 0.
2. `dHash`: identical images have distance 0; the image and its 2-pixel shift at most 10; the image and its inverse exactly 64.
3. `selectEditorFrames`: 100 synthetic metrics at 10 fps (10 s) where each second has one clearly sharpest frame and seconds 3 to 5 share one hash → returns the sharpest frame of each second, with seconds 4 and 5 dropped as duplicates (8 frames), in time order. With 200 distinct seconds it returns exactly 60.
4. `parseImagesTxt` on a hand-written 3-image model: 3 names; a camera with identity rotation and `t = (0, 0, -2)` has centre (0, 0, 2) and forward (0, 0, 1); a 90° yaw case is asserted numerically.
5. `coverage`: registered times {0.0 … 2.9} and {6.0 … 7.4} at 10 fps over a 10 s video → spans [0, 3.0] and [6.0, 7.5], `secondsCovered` 4.5, `registeredFrames` 45, `totalFrames` 100.
6. Job runner with the `fake` backend and the lavfi video: states go `queued`, `running`, `done`; event `seq` values are 1, 2, 3, … with no gaps; all nine stages end `done`; `overall` is 1; the status file on disk equals the final status; a second job enqueued meanwhile stays `queued` until the first ends.
7. Soft fail: a backend whose `reconstruct` returns zero fragments → job `done`, `result.splat` null, `splatReason` is the "did not line up" sentence, frames are still published. A backend that never resolves, with a 200 ms test timeout, → the stage is `timeout`, the job is `done`.
8. Hard fail: a text file renamed `.mp4` → job `failed` at `probe` with a readable `error`.
9. Cancel: `DELETE` during the fake backend's delay → `cancelled`, and the child-process helper reports the process gone.
10. Frames on the lavfi video (4 s): reconstruction frames = 40 ± 1 in full mode; editor frames between 1 and 4; every published frame is a JPEG no larger than 1280 on its longest side; no EXIF block.
11. Photos: 3 test photos → `p-001.jpg` to `p-003.jpg` plus thumbs of longest side 320; `photo-pins.json` has 3 pins with `at: null`; a second job with 2 of the same photos and one new keeps a hand-placed `at` on the first pin.
12. Fewer than 20 photos and no video → reconstruction stages `skipped`, the photo-count `splatReason`, job `done`.
13. `nearestFrame`: a photo that is frame 17 of the room render re-encoded at JPEG quality 40 and scaled to 70% matches frame 17 or a neighbour within 2, with a score under 0.22; a lavfi frame against room frames scores above 0.22.
14. `suggestPinPose`: with a camera at raw (1, 2, 3) facing raw +Z and a splat transform of scale 0.5, yaw 90°, position (10, 0, 20), the suggestion is the transformed point's XZ and a heading of 90° more than the raw heading; with the identity transform the source is `frame-only` and `at` is null.
15. API (the middleware mounted on a bare `node:http` server in the test): upload → `{ uploadId, kind: 'video' }`; a 1 KB `.exe` → 415; a bad scene id → 400; job status `?since=` returns only later events; pins `PUT` then `GET` round-trips; a pins file with a duplicate id → 400.
16. `validatePinsFile` and the publish step never write outside `public/scenes/<id>/` and `.cache/media/<id>/` (a name containing `../` is sanitised).
17. `photo-pins-view` pure helpers (bubble selection): of 10 pins, with the viewer in room A, the result is at most 6, nearest first, all either in room A or within 4 m.

Tool-gated, local only (`media-tools.local.test.ts`, `describe.skipIf(!hasColmap)`, test timeout 8 min):
18. Tiny mode on `buildRoomVideo`: the job ends `done`. Expected: at least 12 of 24 frames registered in the largest fragment, and with Brush present a `scene.ply` whose header parses and holds at least 1,000 splats. If COLMAP cannot map the software render, record the numbers in the chunk report and keep the assertion on `done`; do not tune the renderer for more than an hour.

Real video, local only (`media-real.local.test.ts`; path from `WALKTHRU_REAL_VIDEO`, default `/Users/mahir/Downloads/WhatsApp Video 2026-11-12 at 19.00.04.mp4`; `describe.skipIf` when absent or COLMAP is missing; test timeout 25 min):
19. Full mode with `skipTraining: true`: 355 ± 2 reconstruction frames; the largest fragment has **at least 100 registered frames** (measured: 133); `secondsCovered` at least 9; between 15 and 36 editor frames.
20. Only when `WALKTHRU_TRAIN=1` (adds about 11 minutes): `scene.ply` exists, 10 to 80 MB, `upPreset` `flip-x`, and `splatReason` starts "Scan made from".

Not headless (report as not browser-verified): the editor panel, the plan pins, the buyer bubbles and lightbox.

### 14.13 Risks specific to C9

1. **An unpinned scan sits at the wrong place and size.** The published `splat` block has an identity transform until the broker completes the Scan step (C7). If a property is saved before that, the buyer's Scan toggle shows it misplaced. The integrator should make saving warn when a splat's transform is still the identity; that check lives in C5 or C7 files, so C9 only flags it.
2. **Whether COLMAP maps the synthetic room render is unknown.** The always-run tests therefore use the fake backend, and the tool-gated test asserts completion, with the registration count as an expectation.
3. **Brush's command-line flags and export naming** are taken from the one measured run on v0.3.0. Its dataset loader was only seen working with the `images` + `sparse/0` layout and the OPENCV camera model.
4. **COLMAP log parsing for progress** is best effort and may show only start and end.
5. **Photo to frame matching is appearance-only** (hash plus colour grid). A photo taken from a viewpoint the video never had will get no match; that is the `none` case and the broker places it by hand.
6. **`heic` photos** depend on the installed ffmpeg being able to decode them; if not, the photo is skipped with a warning.
7. **One job at a time** means a second scene waits behind an 11-minute training run.

---

## 15. ML upgrades (C10)

Additive. It changes nothing in sections 3.2 or 7.1 and edits no file owned by C0 to C9. Goal: get more out of low-quality WhatsApp video and photos with open-source models, **measured on the real sample video, not assumed**. Nothing in this section has been run. Every runtime and memory figure below is an estimate to be replaced by a measurement; every "pass bar" is the test that decides whether an experiment's code is kept.

### 15.1 Ground rules

- **Hardware:** M2 MacBook, 8 GB unified memory, PyTorch MPS or CPU, no CUDA. A model is "local" only if its weights are under about 1.5 GB and peak memory stays under 5 GB. Everything else is in the cloud bucket (15.4) and is not to be attempted locally.
- **Licences:** each model has a code licence and a weights licence, recorded in 15.3. Only commercial-OK models may produce files the app ships. Non-commercial models may be run as a yardstick in experiments; their outputs must be written under `ml/experiments/` and never under the paths in 15.6.
- **Heavy jobs run one at a time.** Before any model run or COLMAP / Brush run, wait while `pgrep -f "colmap|brush_app"` prints anything (another agent uses them). `ml/common.py` exposes `wait_for_idle()` doing exactly that with a 30 s poll; every experiment script calls it first.
- **Offline scripts only.** Python writes JSON, PLY and PNG into the scene folder. The TypeScript app only reads those files through one adapter (15.7). The app never spawns Python.
- **Environment:** a venv at `~/walkthru-tools/ml/.venv`. Homebrew's `python3` is 3.15.2, which PyTorch is unlikely to ship wheels for, so `ml/setup.sh` runs `brew install python@3.12` and builds the venv from `/opt/homebrew/bin/python3.12`. Model repos are cloned at pinned commits into `~/walkthru-tools/ml/src/`, weights into `~/walkthru-tools/ml/weights/`. None of that is inside the repo.
- **Python pins** (PyPI, each at least two weeks old on 12 Nov 2026): `torch==2.14.1`, `torchvision==0.29.1`, `numpy==2.5.4`, `opencv-python-headless==4.14.0.94`, `huggingface_hub==2.3.0`. If a model repo cannot import under these, pin what its own requirements file asks for inside a second venv for that model and record it in the report; do not loosen the main venv.

### 15.2 What was verified today

- **COLMAP 4.2.1 on this Mac already has learned features built in.** `--FeatureExtraction.type` exists (default `SIFT`) and `--FeatureMatching.type` exists (default `SIFT_BRUTEFORCE`). The binary contains the enum names `ALIKED_N16ROT`, `ALIKED_N32`, `LOMA`-family names, and matcher names `SIFT_LIGHTGLUE`, `ALIKED_BRUTEFORCE`, `ALIKED_LIGHTGLUE`, `LOMA_BRUTEFORCE` and others. Homebrew has `onnxruntime 1.31.1` installed. The ONNX models download automatically from the COLMAP 3.13.0 release, with these SHA-256 values printed in COLMAP's own help:
  - `sift-lightglue.onnx` `e0500228472b43f92b3d36881a09b3310d3b058b56187b246cc7b9ab6429096e`
  - `aliked-n16rot.onnx` `39c423d0a6f03d39ec89d3d1d61853765c2fb6a8b8381376c703e5758778a547`
  - `aliked-n32.onnx` `a077728a02d2de1a775c66df6de8cfeb7c6b51ca57572c64c680131c988c8b3c`
  - `aliked-lightglue.onnx` `b9a5de7204648b18a8cf5dcac819f9d30de1a5961ef03756803c8b86c2dceb8d`
  Which enum string goes with which option was not confirmed (passing a bad value only says "Unknown string value"). Experiment E1 starts by confirming it.
- **Brush v0.3.0** (Apache-2.0, release of 14 Sep 2025): the README documents a `masks/` folder (black = ignored, `--invert-masks` to flip). It documents no depth prior. So masking is a local experiment and depth-regularised training is cloud-bucket work.
- **Licences and weights** in 15.3 were read from each repo's licence file or README and each Hugging Face model card on 12 Nov 2026. Three corrections to common assumptions: Pi3's code is BSD-3 but its **weights are CC BY-NC 4.0**; Depth Pro's weights are under Apple's research model licence (`apple-amlr`), **not commercial**; SpatialLM 1.1's point encoder (Sonata) weights are **CC BY-NC 4.0**, so both 1.1 models are non-commercial in practice.
- **A find worth the top slot:** Depth Anything 3 (ByteDance, Apache-2.0 code). Its `DA3-SMALL` (137 MB) and `DA3-BASE` (542 MB) checkpoints are **Apache-2.0** and estimate **camera poses and depth from several images in one forward pass**, the same job as VGGT but small enough to try on 8 GB. `DA3METRIC-LARGE` (1.3 GB, Apache-2.0) gives metric depth plus sky segmentation.

### 15.3 Shortlist

Commit = repo head on 12 Nov 2026 (pin it). Weights = Hugging Face repo, revision prefix, file, SHA-256.

| Model | What it would fix | Code licence | Weights licence | Commercial | Runs on M2 8 GB | Expected cost (estimate) |
|---|---|---|---|---|---|---|
| **COLMAP ALIKED + LightGlue** (built into 4.2.1; ALIKED `Shiaoming/ALIKED`, LightGlue `cvg/LightGlue`) | Registration on blank walls | COLMAP BSD; ALIKED BSD-3; LightGlue Apache-2.0 | ONNX exports hosted by COLMAP, same terms | Yes | Yes, CPU via ONNX | 5 to 20 min for 355 frames |
| **COLMAP SIFT + LightGlue** | Same, smaller change | as above | as above | Yes | Yes | 5 to 15 min |
| COLMAP LoMa (`davnords/storage` ONNX) | Same | unverified | unverified | **Unknown, experiment only** | Probably | unknown |
| **Depth Anything 3 Base / Small** (`ByteDance-Seed/Depth-Anything-3` @ `3d835ec1a5802d64a8b8b15f817a1ab54809bfe4`) | Poses + depth for all frames with no tracking; one connected model | Apache-2.0 | Apache-2.0 | Yes | To be tested (E3); 0.08 to 0.12 B parameters | 1 to 5 min for 32 frames |
| **MoGe-2 ViT-S / ViT-B** (`microsoft/MoGe` @ `74fbce054ebed49800de42d0ad0e83495065719a`) | Metric scale, point map and normals per frame | MIT | MIT | Yes | Yes | about 1 s per frame |
| **Depth Anything V2 Metric Indoor Small** (`DepthAnything/Depth-Anything-V2` @ `a561b849ebae10a6f5ef49e26c83cbbcd36c71bf`) | Metric depth, second opinion on scale | Apache-2.0 | Apache-2.0 (Small only; Base and Large are CC BY-NC) | Yes | Yes | under 1 s per frame |
| **DA3 Metric Large** | Metric depth + sky / window mask | Apache-2.0 | Apache-2.0 | Yes | Borderline (1.3 GB weights) | a few s per frame |
| Depth Pro (`apple/ml-depth-pro` @ `9e65e4dbe9568d23c546fcec53302b10445e109e`) | Sharp metric depth, focal length | Apple sample-code licence | `apple-amlr` (research) | **No, yardstick only** | Borderline (1.9 GB weights) | 10 to 30 s per frame |
| UniDepthV2-S (`lpiccinelli-eth/UniDepth` @ `8d8cfe4c7ee15297099983607febf0d4f32eb3d6`) | Metric depth + intrinsics | CC BY-NC 4.0 | CC BY-NC 4.0 | **No, yardstick only** | Yes | about 1 s per frame |
| VGGT-1B-Commercial (`facebookresearch/vggt` @ `a288dd0f14786c93483e45524328726ab7b1b4ce`) | Feed-forward poses + points | VGGT licence (commercial allowed, no military use) | gated, manual approval; commercial allowed | Yes, after approval | **No** (5.0 GB weights) | cloud |
| MapAnything Apache (`facebookresearch/map-anything` v1.1.3) | Feed-forward metric reconstruction | Apache-2.0 | Apache-2.0 (`facebook/map-anything-apache`) | Yes | **No** (4.9 GB weights) | cloud |
| Pi3 (`yyfz/Pi3` @ `9fa3ddb3f8d53041f8b2738df404f62223bbaa7b`) | Feed-forward poses + points | BSD-3 | CC BY-NC 4.0 | **No** | No (3.8 GB) | cloud, yardstick only |
| MASt3R / MASt3R-SfM (`naver/mast3r` @ `f5209afc300cec36239a7ac992263f36847bbba0`), MASt3R-SLAM | Dense matching SfM on low texture | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 | **No** | No (2.8 GB, CUDA-oriented) | cloud, yardstick only |
| Fast3R (`facebookresearch/fast3r` @ `33104d4b5b8df43795ecded236194958bbdac572`) | Many-view feed-forward | FAIR Noncommercial | FAIR Noncommercial | **No** | No | cloud, yardstick only |
| SpatialLM 1.1 (`manycore-research/SpatialLM` @ `8913c44d84a450c53e9340b13317f8cf7144a738`) | Walls, doors, windows, boxes from a point cloud | Llama 3.2 / Apache (by variant) | Sonata encoder CC BY-NC 4.0 | **No** | **No**: needs CUDA 12.4, torchsparse, flash-attn | cloud, yardstick only |
| **RANSAC planes** (own numpy code) | Wall lines → a rough `LayoutProposal` | ours | none | Yes | Yes | seconds |
| **Brush masks** (Brush v0.3.0) | Fewer floaters at windows and glass | Apache-2.0 | none | Yes | Yes | no extra time |
| Depth-regularised splat training (gsplat and similar) | Flatter walls, fewer floaters | Apache-2.0 | none | Yes | **No** (CUDA) | cloud |

Weights to fetch for local experiments (`ml/fetch_weights.py` checks each SHA-256 and refuses a mismatch):

| Hugging Face repo @ revision | File | Size | SHA-256 |
|---|---|---|---|
| `depth-anything/DA3-SMALL` @ `e08cab65ca0e` | `model.safetensors` | 137 MB | `364492e38a3a06d221ac75da7f6621ada3f2361cd24fde11ba79091e9f40efcf` |
| `depth-anything/DA3-BASE` @ `f4a6c9b3c95e` | `model.safetensors` | 542 MB | `e01067dc1659613083d9145a9a2547ccdbe6ccbbf83c4fe7b3e8a4e2bdae78b5` |
| `depth-anything/DA3METRIC-LARGE` @ `4010e39f3634` | `model.safetensors` | 1,337 MB | `bbea5b0b3ee389849cffa7ddae89de064a90abd2b055fc5aa99aac68db324776` |
| `Ruicheng/moge-2-vits-normal` @ `26b477f41595` | `model.pt` | 141 MB | `79a16621928c2bf0ed04659218c55c01075e950507f40bb3332fb4c873d3e1dc` |
| `Ruicheng/moge-2-vitb-normal` @ `ca5f0e07ff01` | `model.pt` | 419 MB | `16b8110e86d5dc5a849db120ca96ef3a223fd30b0c9146d1d81db504073da5f6` |
| `depth-anything/Depth-Anything-V2-Metric-Hypersim-Small` @ `3bc65d4e14a6` | `depth_anything_v2_metric_hypersim_vits.pth` | 99 MB | `b782898d8a3e8be1f639de33837ed85e9b4b73e40f8f5e5cd99067588d722545` |
| yardstick only: `apple/DepthPro` @ `ccd1350a774e` | `depth_pro.pt` | 1,904 MB | `3eb35ca68168ad3d14cb150f8947a4edf85589941661fdb2686259c80685c0ce` |
| yardstick only: `lpiccinelli/unidepth-v2-vits14` @ `038c238f06c8` | `model.safetensors` | 137 MB | `93705cb3295dd7476b44911b8a55f5215bf74e8d5eccd27cecdb1b338270a648` |

Revisions are 12-character prefixes; resolve each to the full commit id with the Hugging Face API when writing `fetch_weights.py`, and confirm it starts with the prefix.

### 15.4 Cloud GPU later (Modal). Do not run these locally.

| Item | Why it is not local | Licence position |
|---|---|---|
| VGGT-1B-Commercial | 5.0 GB weights | commercial OK once Meta approves the access form |
| MapAnything (Apache checkpoint) | 4.9 GB weights | commercial OK |
| DA3 Large / Giant / Nested, DA3-Streaming | 1.6 GB and up; streaming needs about 12 GB | Large is CC BY-NC; check each card |
| Depth-regularised or normal-regularised splat training (gsplat) | CUDA rasteriser | Apache-2.0 |
| SpatialLM | CUDA 12.4, torchsparse, flash-attn | non-commercial (Sonata weights) |
| Pi3, MASt3R-SfM, MASt3R-SLAM, Fast3R | size and CUDA-oriented code | non-commercial, comparison only |

They would sit behind C9's `ReconstructionBackend` (`backend: 'cloud'`) and the `LayoutProposal` plug, so no caller changes.

### 15.5 Experiment plan (in this order; each has one pass bar)

Inputs: the reference video's 355 frames at 10 fps and the baseline COLMAP run (12 fragments, largest 133 frames). All results go to `~/walkthru-tools/scenes/<id>/ml/report.json` (15.6). An experiment that fails its bar is recorded and its production code is not written.

**E0. Environment and baseline (30 min).** Build the venv, fetch weights, confirm `torch.backends.mps.is_available()`. Record the baseline: fragments 12, largest 133 of 355, seconds covered, wall-clock time. Pass: the venv imports torch and MoGe on MPS and runs one frame.

**E1. Learned matching inside COLMAP (CPU, no Python).** First confirm the enum strings by running `feature_extractor` and a matcher on a 5-image folder with each candidate value. Then, on the same 355 frames with the same mapper flags as section 14:
- (a) SIFT features + `SIFT_LIGHTGLUE` matching;
- (b) `ALIKED_N16ROT` features + `ALIKED_LIGHTGLUE` matching (`--AlikedExtraction.max_num_features 4096`);
- (c) the better of (a) and (b), after dropping frames whose sharpness (C9's Laplacian variance) is in the lowest 20% when both neighbours are kept;
- (d) LoMa, only if (a) to (c) fail, and only as an experiment (licence unverified).
Metrics: frames in the largest fragment, number of fragments, seconds covered, minutes taken. **Pass bar: the largest fragment has at least 200 of 355 frames (baseline 133), or at most 6 fragments with the largest still at least 133; in at most 25 minutes on CPU.** Note whether the faiss crash also affects these matcher types.

**E2. Metric scale and ceiling height from single frames.** Models: MoGe-2 ViT-S, MoGe-2 ViT-B, Depth Anything V2 Metric Indoor Small, DA3 Metric Large if it fits; Depth Pro and UniDepthV2-S as yardsticks only. Input: 40 registered frames spread evenly over the largest fragment.
- Scale: for each frame, project its COLMAP sparse points into the image, read the model's metric depth at those pixels, `scale_i = median(metric depth / COLMAP depth)`. The vote is the median over frames; the spread is `IQR / median`.
- Check against things of known size. A small hand-made file `ml/checks.json` lists pixel pairs in named frames with an expected length: a door frame's height (2.1 m), a door's clear width (0.75 to 0.9 m), one floor tile's edge (0.6 or 0.8 m). The script measures each pair in the model's metric point map.
- Ceiling: in each frame's point map, fit the two largest near-parallel planes whose normals are close to the image's vertical; their separation is one ceiling-height sample. Report median and spread. This flat's true height is unknown; Indian flats are about 2.6 to 2.75 m clear, so report rather than judge.
**Pass bar (per model): scale spread at most 10% over at least 30 frames, and the door-height check within 10% of 2.1 m.** Ceiling is kept only if its spread is at most 8% over at least 10 frames. If two commercial-OK models pass, keep the one with the smaller spread and use the other as a cross-check (they must agree within 8%).

**E3. Feed-forward poses without tracking.** DA3-BASE, then DA3-SMALL, on MPS. Start with 16 frames at 336 px on the long side, then 24 and 32 frames at 504 px, sampled evenly over the whole 35 s (so most frames are ones COLMAP never placed). Record peak memory (`/usr/bin/time -l`) and time for each size, stopping at the first size that exceeds 5 GB or swaps.
- Compare with COLMAP on the frames both placed: after a similarity alignment, median relative-rotation error between consecutive shared frames, and median camera-centre error as a fraction of the path length.
- Connectedness: fraction of consecutive sampled frames whose step is under 3 times the median step (no teleports).
- If it passes, chain windows of 32 frames with 8 shared frames, aligning each window to the previous by a similarity fit on the shared cameras, to cover a whole video; then write a COLMAP-format model and train Brush on it.
**Pass bar: runs at 24 frames or more within 5 GB and 10 minutes; median rotation disagreement with COLMAP at most 5°; at least 90% of steps free of teleports.** A pass here is the largest win available: one connected model of the whole flat instead of the first 13 seconds.

**E4. A rough layout from points.** Input: the fused cloud from E3 (or E2 depth on COLMAP poses), scaled by E2. Own numpy code: find the floor plane (largest plane whose normal matches the gravity estimate), level the cloud, keep points 0.3 to 2.0 m above the floor, project to the plan, find wall lines by RANSAC on the 2D density with a Manhattan (two perpendicular directions) prior, close them into rectangles or rectilinear polygons, find gaps as openings.
**Pass bar, two parts.** Synthetic (always testable): on a generated cloud of the truth flat's bedroom with 2 cm noise, 30% of wall points removed and 5% outliers, the recovered room area is within 5% of 20 m² and each wall line within 5 cm. Real video: the output passes `validateLayout` with zero errors, contains at least one room of at least 6 m², and its ceiling agrees with E2 within 10%. The real-video proposal always ships with `confidence` at most 0.4.

**E5. Masks for Brush.** Per-frame masks that black out blown-out windows and glass (pixels over 250 luma in connected regions over 2% of the frame, plus DA3 Metric's sky segmentation when available). First run `brush_app --help` to find whether it can hold out frames for evaluation. Train twice on the same fragment, with and without masks.
**Pass bar: held-out PSNR improves by at least 0.5 dB, or (if Brush cannot hold frames out) a blind side-by-side of three fixed viewpoints is judged better by the reviewer.** Each training run is 11 minutes; run them only when the machine is idle.

**E6. Not planned.** Learned deblurring and super-resolution tend to invent detail, which is the opposite of what a measuring tool should do; skip unless E1 to E3 all fail. Frame selection by sharpness is already in C9 and is variant (c) of E1.

### 15.6 Output files and how they plug into existing contracts

Written by the Python scripts into `public/scenes/<id>/ml/`. Everything is optional; the app must behave exactly as before when the folder is absent.

| File | Shape | Plugs into |
|---|---|---|
| `ml/report.json` | `{ version: 1, generatedAt, experiments: { id, variant, model, licence, commercialOk, metrics: Record<string, number>, passed: boolean, minutes, peakMemoryGb, notes }[] }` | nothing; the record of what was measured |
| `ml/registration.json` | `{ version: 1, recipe: { extractorType, matcherType, extraArgs: string[] }, largestFragmentFrames, fragments, totalFrames }` | C9's reconstruction backend, through a new backend file (15.7) |
| `ml/scale.json` | `{ version: 1, model, licence, metresPerUnit, spreadPct, frames, checks: { label, expectedM, measuredM }[], crossCheck?: { model, metresPerUnit } }` | the splat block: `transform.scale` of an unpinned splat (15.7). Also shown to the broker as a scale vote in the Scan step's hints |
| `ml/ceiling.json` | `{ version: 1, model, heightM, spreadPct, frames }` | `LayoutProposal.wallHeightM` and the editor's wall-height default |
| `ml/layout-proposal.json` | exactly a `LayoutProposal` (3.2), `source: 'ml-planes@1'`, `confidence <= 0.4` | copied to `proposal.json` when no proposal exists, for the editor's "Load proposal" |
| `ml/poses/sparse/0/{cameras,images,points3D}.txt` | a COLMAP text model from E3 | Brush training through C9's backend; `images.txt` also feeds C9's `parseImagesTxt` for photo-pin suggestions |
| `ml/masks/<frame>.png` | 8-bit, white = keep | Brush's `masks/` folder |
| `ml/frames-drop.json` | `{ version: 1, drop: string[] }` | the reconstruction input list |
| `ml/experiments/**` | anything | never read by the app; the only place non-commercial model outputs may go |

`metresPerUnit` is metres per unit of the splat's raw frame, the same meaning as `SceneTransform.scale`. A drawing's or floor plan's scale still outranks it: the layout is the ruler (section 0.1), and C7's pinning overrides any ML scale.

### 15.7 Build chunk C10

Wave 3, after C9. Built only for the experiments that pass; the experiment scripts themselves are written first, since they produce the evidence.

**Files (all new):**
```
ml/                              Python, in the repo
  requirements.txt               the pins in 15.1
  setup.sh                       python@3.12, venv, clone repos at the pinned commits
  fetch_weights.py               downloads + SHA-256 checks (15.3)
  common.py                      wait_for_idle(), COLMAP text-model reader, PLY writer, report writer
  e1_registration.py             drives COLMAP variants, writes registration.json
  e2_scale.py                    scale.json, ceiling.json
  e3_feedforward.py              poses/, fused cloud
  e4_layout.py                   layout-proposal.json   (pure numpy core in layout_planes.py)
  e5_masks.py                    masks/
  layout_planes.py               plane and wall-line fitting, no torch
  tests/test_layout_planes.py    pytest, synthetic cloud (E4's synthetic bar)
  tests/test_scale_fit.py        pytest, synthetic depth vs sparse points
src/ml/
  outputs.ts                     the one TypeScript adapter: types for the files in 15.6, readers, validators
  apply.ts                       pure functions that turn outputs into existing contract values
  recon-backend-learned.ts       a ReconstructionBackend (C9's interface) that runs COLMAP with the recipe in registration.json
scripts/
  ml-apply.ts                    CLI: apply a scene's ml/ outputs
tests/
  ml-outputs.test.ts
```

**`src/ml/apply.ts` (pure):**
```ts
export function splatWithMlScale(splat: SplatOverlay, scale: MlScaleFile): SplatOverlay;       // only when the transform is still the identity
export function proposalFromMl(p: unknown, ceiling: MlCeilingFile | null): LayoutProposal;     // validates, normalises rooms, caps confidence at 0.4
export function mlScaleHint(scale: MlScaleFile): string;                                        // "Depth model suggests 1 unit = 0.41 m (±6%)."
```
`scripts/ml-apply.ts --scene <id> [--force]`: writes `proposal.json` from `ml/layout-proposal.json` when none exists; sets the splat scale in `property.json` when the splat is unpinned; prints what it did and what it skipped. It refuses any file whose `commercialOk` is false or whose path is under `ml/experiments/`.

**Integrator hooks (the only edits outside C10's files):** one line in C9's backend registry to register `'learned'` from `src/ml/recon-backend-learned.ts`; one `package.json` script `"ml:apply": "tsx scripts/ml-apply.ts"`.

**Acceptance:**
1. `tests/ml-outputs.test.ts`: each file in 15.6 round-trips through its validator; a `scale.json` with `spreadPct` over 10 is rejected by `splatWithMlScale` (returns the splat unchanged and a warning); a pinned splat is never rescaled; a proposal with `confidence 0.9` comes back at 0.4; a room with a bow-tie polygon is dropped with a warning; a file marked non-commercial is refused.
2. `ml/tests/test_layout_planes.py`: E4's synthetic bar (area within 5% of 20 m², walls within 5 cm).
3. `ml/tests/test_scale_fit.py`: sparse depths times 0.37 with 5% noise and 10% gross outliers recover 0.37 within 2%.
4. The learned backend, with COLMAP mocked, builds exactly the argument list from `registration.json` and falls back to section 14's recipe when the file is missing.
5. `ml/report.json` exists for the reference video with every experiment that was run, its measured numbers, and pass or fail. No number in it is copied from this spec.

### 15.8 Risks

1. **Nothing here has been run.** Memory fit of DA3 on 8 GB MPS, MPS operator coverage for each repo, and Python 3.12 wheel availability for the pinned torch are all unknown until E0 and E3.
2. **COLMAP's learned features may not be compiled into this Homebrew build** even though the options appear in its help. E1's first step settles it; the fallback is LightGlue from `cvg/LightGlue` (Apache-2.0, with ALIKED or DISK, never SuperPoint, whose weights are non-commercial) writing matches into the COLMAP database.
3. **Monocular metric depth is often 5 to 15% off indoors**, and blank white walls are its worst case. That is why E2's bar is agreement across frames plus a known-size check, and why an ML scale never outranks a floor-plan dimension.
4. **Licence positions can change.** They were read on 12 Nov 2026; re-read each before shipping. LoMa's is unverified. The VGGT commercial checkpoint needs an access approval.
5. **Feed-forward poses drift over long videos.** Window chaining (E3) accumulates error; a 35 s walk through several rooms may bend. Pinning to the layout (C7) bounds how much that matters.
6. **The real flat has no ground truth.** Scale and ceiling can only be checked against door and tile standards, so the report states spreads, not errors.

---

## 16. Look (C11)

Goal: a buyer should feel they are standing in a real Indian flat, not in a grey box model. Today the shell is flat-coloured procedural boxes under one hemisphere light and one directional light, with no tone mapping, an opaque blue quad for each window, nothing outside, box furniture and a two-colour mannequin. Nothing in this section has been built or rendered; every number is a target to be checked in a browser.

Unlike C8 to C10, this chunk **upgrades existing files** (`engine/viewer.ts`, `shell.ts`, `furniture.ts`, `character.ts`). Rule for those edits: every exported signature in 7.1 keeps working unchanged (new parameters are optional, new interface members are additions), `core/` is not touched, `types.ts` is not touched, and `npm test` stays green. New code lives in `src/look/`.

### 16.1 References, and what was actually checked

- **patch.gg/blendi/oil-paint.** Cloned from `https://git.patch.gg/blendi/oil-paint.git` at commit `804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9` ("Release 1.1.3"). `LICENSE` is MIT (Copyright (c) 2026 Patch). `LICENCE-NOTES.md` says: code MIT, art CC0 1.0. Its `package.json` pins `three 0.186.1` and `vite 8.3.5`, exactly ours. The painter is `src/oilpaint/` (855 lines: `common`, `brush`, `dabs`, `ground`, `pins`, `shade`, `finish`); the kit is `src/night/kit.js` (239 lines, `createKit(shared, { palettes, light, origin, seed, … })`, which takes flat faces or any geometry tagged with a palette name and lays strokes along the grain). The demo also vendors Rapier 0.21.0 (Apache-2.0), which we do not need.
- **Patch's starter man.** Per the licence notes: built with MPFB2 from MakeHuman system assets (body, `male_casualsuit06`, `shoes05`, `short01` hair), **rigged onto the Universal Animation Library's skeleton**, CC0 1.0. In this repo its pictures (textures) are removed, because the demo paints him. The two GLBs are Git LFS objects (`starter-man.glb`: oid `sha256:450089ce3fd70c1a30e775cb1454a987cbaf3ff71ca53cf8581e74f9163e637e`, 1,255,588 bytes). `git-lfs` is not installed on this Mac, so **the files were not downloaded or inspected**: bone names, material slots and whether a textured version is obtainable (the notes name its origin as patch-lab, `starter-character-combined`) are unverified.
- **benglooru.com/play.** The page only yielded a logo and "Loading Koramangala". Its look is taken from Mahir's description: warm, atmospheric, late-afternoon light, glowing windows, rich grading. Nothing from it is copied.
- **Poly Haven** (all assets CC0): every asset below was looked up in its API on 12 Nov 2026; URLs, sizes and MD5 values are the API's.
- **npm:** `postprocessing` `6.39.5` (9 Sep 2026, Zlib licence, peer `three >= 0.168 < 0.188`; `6.39.6` is under two weeks old) and `n8ao` `2.0.1` (10 Aug 2026, ISC licence per npm, peers `postprocessing >= 6.30`, `three >= 0.137`).

### 16.2 The honesty rule (Mahir's; it outranks every visual choice here)

Realism must never fake a fact.

1. **Sizes are untouchable.** Every fit check, clearance, area and pose keeps using the layout and each item's `Box`. A furniture model is scaled to its box, never the box to the model. `core/` is not edited.
2. **Sampled colours win.** A wall or floor colour sampled from the video is the mean colour of that surface's material. Textures add only relief and small variation around that mean (16.5). Default finishes are used only where nothing was sampled.
3. **Colour-true lighting is always one tap away.** The default light is warm late afternoon because it looks like a home; a "True colours" switch sets neutral white light at exposure 1 so surfaces show their sampled colours.
4. **Anything decorative is labelled.** Three things in the scene are not facts about the property, and each has a fixed label wherever it is controlled or first seen:
   - the view outside: "Outside the window is a plain sky, not the real view." (16.11; it was "View outside is illustrative." when the view was a picture of a city)
   - the sun: "Sun direction assumed: the drawing has no north arrow." (or "Sun direction is approximate." when the broker has set north, 16.4; 16.11)
   - furniture style: "Furniture style is illustrative. Sizes are exact."
   The character: no label (it is obviously a stand-in), but its height stays exact.
5. With a scan (splat) shown, the look steps back: no tone mapping, no post-processing, exposure 1, exactly as today, so the scan's captured colours are not altered.

### 16.3 Assets (all CC0 unless noted; fetched by `scripts/fetch-look-assets.ts` into `public/look/`, which is committed so Vercel serves it)

The fetch script checks each file's MD5 against this table, refuses a mismatch, and writes `public/look/assets.lock.json` with size, MD5 and SHA-256 of every file it stored. Poly Haven base URL: `https://dl.polyhaven.org/file/ph-assets/`.

**HDRIs** (`HDRIs/hdr/1k/<name>_1k.hdr`; the 2k versions are fetched too, for the high tier only)

| Name | Used for | 1k size | 1k MD5 | 2k size | 2k MD5 |
|---|---|---|---|---|---|
| `rooftop_night` (urban rooftop at dusk) | default "late afternoon / evening" view and light, floors 5 and up | 1,624,479 | `c812bf5033f4b57c0f769a71267471d4` | 6,509,158 | `966095e85f971fbc00aeb67e7d60d1c9` |
| `rooftop_day` (urban rooftop, daytime) | daytime view and light, floors 5 and up | 1,545,499 | `3d6f39e531c024b4951d8cb29ddbed27` | 6,155,760 | `5ea41f53536f1a23741e8adb7d589720` |
| `kloofendal_48d_partly_cloudy_puresky` (sky only) | "True colours" mode, and any floor below 5 (a rooftop skyline would be wrong there) | 1,435,119 | `c69498687e876bf68d2a8b8a62234eb9` | 5,451,493 | `2eba3a4d7eeb23cbfbeca364c97e7980` |

**Textures** (1k JPG, `Textures/jpg/1k/<name>/<file>`; if that path 404s, take the same files from the asset's `Textures/gltf/1k/<name>/textures/` folder, which is where the API lists them)

| Asset | Files used (size, MD5) | Used on |
|---|---|---|
| `marble_01` | `marble_01_nor_gl_1k.jpg` (110,230, `fa073d722cde733c1bd6cc6e8897c8e3`), `marble_01_rough_1k.jpg` (91,848, `59cef1be1b7376c9d0dcc7a64adf7882`), `marble_01_diff_1k.jpg` (305,029, `04325ced5018eb8a2e598a4ef69cb176`) | glossy vitrified floor tiles: faint veining and gloss variation |
| `plastered_wall_04` | `…_nor_gl_1k.jpg` (427,268, `f18e649235bb688732fb0ef1d61a5286`), `…_arm_1k.jpg` (212,525, `4d3c55b7cbb32cce818af5b2a1f18ffa`), `…_diff_1k.jpg` (299,230, `3a45e9e3ff0c6aa179371dff02bded1f`) | painted plaster walls and ceilings |
| `walnut_veneer` | `…_diff_1k.jpg` (496,596, `70e160b3d44d414728a2fb4194fde2a6`), `…_arm_1k.jpg` (641,173, `7db3474a1d0d1ed15e0cc349541ac1e3`) | wood-grain laminate: wardrobes, bed frames, dining table, counters |
| `dark_wood` | `…_diff_1k.jpg` (754,754, `47fa883f1bb33acc5711245f64b75975`), `…_nor_gl_1k.jpg` (344,338, `ca74ffa4c1b7ff5afe7316bbfa87f9a0`), `…_rough_1k.jpg` (574,415, `b1acb7bf90785d3945a85eca408dbc6c`) | door frames |
| `rough_linen` | `…_diff_1k.jpg` (835,801, `663db789fb075462b685c1f740e58930`), `…_nor_gl_1k.jpg` (916,843, `3350269a2e9c472aa406bd3cc1eaf2c8`) | sofa fabric |
| `cotton_jersey` | `…_diff_1k.jpg` (581,360, `d2f4493fdd48634b50d40f810ce9deb7`), `…_nor_gl_1k.jpg` (678,670, `2dcc9dda3b726477f607c808e52f1833`) | bedding, pillows |

White laminate (the other half of the reference wardrobe) and glass need no texture.

**Furniture models** (`Models/gltf/1k/<name>/…`; a `.gltf`, a `.bin` and a `textures/` folder each)

| Model | Real size (W × D × H, m) | Files (size, MD5) | Used for |
|---|---|---|---|
| `sofa_02` | 1.81 × 0.82 × 0.71 | `sofa_02_1k.gltf` (4,183, `ec2590dc8433a523d0fe9e507766c16f`), `sofa_02.bin` (74,864, `024d6f57a7c2ee7915430cd6e1c2651e`), `textures/sofa_02_diff_1k.jpg` (86,514, `0452c7d8dd3ef414d5ed3055085028a1`), `…_nor_gl_1k.jpg` (139,858, `968528a369bced172d34275dba5aebf1`), `…_arm_1k.jpg` (121,752, `78799d978a1117ba83dbffed9af0fa33`) | `sofa` |
| `dining_chair_02` | 0.43 × 0.58 × 0.97 | `dining_chair_02_1k.gltf` (2,723, `5aff75016e0943e84161de89dcc3ceb8`), `dining_chair_02.bin` (544,592, `b7f8a91c0a5249d02de7885f3b242c4e`), `textures/…_diff_1k.jpg` (91,518, `6b7b8e4ac0a3aad9ecdf314a97b0ef75`), `…_nor_gl_1k.jpg` (119,612, `9c0e1003f9c8859a2e5c2c7f92a8f238`), `…_arm_1k.jpg` (162,630, `2b16c9ddb3ea83d200b02de54a4fdcb8`) | the six chairs of `dining` |

Which of a Poly Haven model's three listed dimensions is the height was read as the third; C11b confirms it from the loaded bounding box.

Considered and rejected, with the reason: `sofa_03` (2.73 m wide, would be squeezed to 77%); `dining_table` (2.26 × 1.39 m, would be squeezed to 80% and 65%); `GothicBed_01`, `old_bed_frame`, `vintage_day_bed` (nothing like an Indian storage bed); `modern_wooden_cabinet`, `painted_wooden_cabinet`, `vintage_cabinet_01` (nothing like a floor-to-ceiling laminate wardrobe). **Beds, wardrobes, counters and the dining table therefore stay procedural, with real materials** (16.6). That is also the honest choice: they are the items whose exact size matters most. Kenney's and Quaternius' furniture packs are low-poly game props and would lower realism; not used.

**Character:** Patch's starter man from the oil-paint repo (commit above, `public/figure/starter-man.glb`, LFS oid above, CC0 1.0). See 16.6 for the checks it must pass and the fallback.

**Painterly code:** `src/oilpaint/*.js`, `src/night/kit.js`, `src/world/noise.js` and `LICENSE` from the same commit, MIT, vendored unmodified into `vendor/oilpaint/` (16.7, 16.7.1).

**Asset budget** (bytes fetched beyond today's page): low tier at most 1.8 MB (one 1k HDRI, the tile and plaster normal maps), medium at most 9 MB, high at most 22 MB (adds the 2k HDRIs). Everything loads after first paint, lazily, in that order: HDRI, floor and wall maps, furniture materials, models. The shell appears immediately in today's flat look and gains detail as files arrive.

### 16.4 Per-property settings (sidecar, optional)

`public/scenes/<id>/look.json`. Absent file = all defaults. Types live in `src/look/types.ts`.

```ts
export interface LookFile {
  version: 1;
  /** storey the flat is on; picks the backdrop. Default 8. */
  floorNumber?: number;
  /** compass bearing of the plan's -z direction, degrees clockwise from north. Absent = unknown. */
  northDeg?: number;
  /** default hour for the time slider, 6..21 (16.11). Absent = the Afternoon preset. */
  hour?: number;
  /** default preset, 16.11; `hour` wins when both are set */
  preset?: 'morning' | 'afternoon' | 'evening' | 'night';
  /** broker's choice of backdrop picture; the only way a picture (rather than the plain graded sky) is shown, 16.11 */
  backdrop?: 'rooftop_day' | 'rooftop_night' | 'sky';
}
```
The dev API already serves the scene folder statically; writing `look.json` is by hand for now (a broker UI for it is not in scope).

### 16.5 C11a: lighting, materials, outside

**New files:** `src/look/types.ts`, `quality.ts`, `sun.ts`, `floor-ao.ts`, `materials.ts`, `sky.ts`, `post.ts`, `reflect.ts`, `look.ts`, `look-panel.ts`, `look.css`, `scripts/fetch-look-assets.ts`, tests. **Edited:** `engine/viewer.ts`, `engine/shell.ts`, one mount call in `buyer/main.ts` and in `editor/preview.ts`. **New dependencies (integrator adds):** `"postprocessing": "6.39.5"`, `"n8ao": "2.0.1"`. Both are loaded by dynamic `import()` on the high tier only, so they never reach a phone.

**Tone mapping and colour.** `THREE.NeutralToneMapping` (the Khronos PBR Neutral operator), not ACES or AgX: it leaves base colours under about 0.8 luminance essentially unchanged, which is what rule 2 needs, while still rolling off the sun patch and the window. Exposure 1.0 in "True colours", 1.15 otherwise. `outputColorSpace` stays sRGB. No LUT. The only grading is the light itself.

**Sun and time of day** (`sun.ts`, pure).
- Slider 6:00 to 19:00, default 16:30 ("late afternoon"). Elevation = `max(3°, 62° * sin(π * (h - 6) / 13))`. Colour temperature from 2,200 K at the ends to 5,600 K at 12:30 (converted to linear RGB), intensity `3.0 * sin(elevation)` lux-scaled to three's units, minimum 0.4.
- Azimuth with `northDeg` unknown: find the widest `window` or `opening` on an edge with no partner (an outside wall). The sun comes from outside that opening, 30° to one side of its inward normal, so a sun patch always falls into the main room. The slider sweeps the azimuth ±50° around that across the day. Label: "Light direction is illustrative."
- Azimuth with `northDeg` set: bearing 90° at 6:00 through 180° at 12:30 to 270° at 19:00, rotated into plan space. Label: "Sun direction is approximate."
- "True colours": sun off, hemisphere light white at intensity 1.0, sky backdrop, exposure 1.0.
- One `DirectionalLight` with a shadow camera fitted to the layout's bounds, plus a `HemisphereLight` (sky colour from the time of day, ground colour `#8A8378`) at intensity 0.35, plus image-based light from the HDRI at intensity 0.6 on medium and high.

**Ambient occlusion that needs no ray tracing and runs on every tier** (`floor-ao.ts`, pure and unit-tested).
- **Floor and ceiling:** from the collision grid. Distance transform (in cells) from every cell with value ≥ 20 (walls, furniture) and from void; `ao = 0.62 + 0.38 * smoothstep(0, 0.45 m, distance)`; a 3 × 3 box blur; one `DataTexture` (R8, linear filtering) covering the grid's bounds. Floors and ceilings sample it by world position (`uv = (worldXZ - origin) / size`, injected with `onBeforeCompile`, so no geometry or UV changes). It is rebuilt whenever furniture changes, which gives every placed bed and sofa a soft contact shadow for free. This is the "baked once per property in the browser" pass: a 300 × 300 grid takes a few milliseconds.
- **Walls:** analytic, in the wall material's shader: `ao = mix(0.78, 1.0, smoothstep(0.0, 0.35, min(y, wallHeight - y)))`, darkening the skirting and cornice lines.
- **High tier adds** screen-space N8AO (half resolution, radius 0.6 m, intensity 1.6) for wall-to-wall corners and furniture detail.

**Shadows.** Medium: sun shadow map 1024, `PCFShadowMap`, `autoUpdate = false`, re-rendered only when furniture or the hour changes; the character keeps its blob shadow. High: 2048, `PCFSoftShadowMap`, updated every frame so the character casts too (its blob shadow is hidden). Low: none. `shell.ts` sets `castShadow` on walls, ceilings, frames and railings and `receiveShadow` on floors and walls.

**Materials** (`materials.ts`). One cache, textures loaded once, `RepeatWrapping`, world-scale UVs.
- **Detail-multiply, the mechanism behind rule 2:** an albedo texture is never used as the colour. In the shader the diffuse colour is `baseColor * (texel / meanTexel)`, with `meanTexel` precomputed per texture (stored in `materials.ts` as constants after measuring each file once), clamped to `[0.85, 1.15]`. The surface keeps its sampled mean colour and gains veining or grain. For walls the clamp is `[0.95, 1.05]`.
- **Floor (vitrified tile):** base colour = `room.floorColor ?? finishes.floorColor`; the existing tile-grid canvas stays as the grout layer; `marble_01` normal map at strength 0.15 and its roughness map remapped into 0.08 to 0.22 (glossy); `metalness 0`. Reflections by tier (below). Balcony floors: roughness 0.6, no reflection.
- **Walls and ceilings:** base colour as sampled; `plastered_wall_04` normal at strength 0.35, 3.2 m repeat; roughness 0.9.
- **Door frames:** `dark_wood`, base colour `finishes.frameColor`, roughness from its map.
- **Railings:** `railingColor`, metalness 0.6, roughness 0.4.
- **Glass:** each window pane becomes a transparent `MeshStandardMaterial` (`opacity 0.12`, `roughness 0.05`, `depthWrite false`), so the backdrop is visible and sunlight passes (panes do not cast shadows). When a scan is shown, panes are hidden instead, because alpha-blended meshes sort badly against splats. `opening` gaps have no pane, as now.
- `shell.ts` change: `buildShell(layout, opts?: { materials?: ShellMaterialSet })`. With no `opts` it builds exactly today's materials, so the editor preview, the tests and Node keep working.

**Floor reflections** (`reflect.ts`), the signature of an Indian flat.
- Low: none (roughness only).
- Medium: one static cube map, 128 px, rendered once from 1.2 m above the centre of the largest room after assets load (and again when the hour changes), used as `envMap` on floors only, intensity 0.5.
- High: a planar reflection of the room the viewer is in: mirrored camera, half-resolution target, sampled in the floor shader with a 5-tap blur and Fresnel weighting (0.04 facing down to 0.55 at grazing angles). Other rooms' floors use the medium cube map. If the planar path cannot be made to work with the post-processing chain within the chunk, ship the cube map on high and say so.

**Outside the windows** (`sky.ts`). The HDRI is the scene background and (medium, high) the PMREM environment. Choice: `look.backdrop` if set; else `floorNumber >= 5` gives `rooftop_night` when the hour is 16:00 or later and `rooftop_day` before; below 5 gives the pure sky. "True colours" always uses the pure sky. The backdrop is rotated about Y so its brightest region lines up with the sun azimuth. An HDRI sits at infinity, so the floor number cannot change parallax; it only decides skyline versus sky. Label, shown in the look panel and as a 3-second toast the first time a window fills more than 8% of the screen: "View outside is illustrative."

**Bloom** (high only): threshold 0.9, intensity 0.35, so windows and the sun patch glow slightly. Nothing else blooms.

**Viewer changes** (`engine/viewer.ts`): `toneMapping` and exposure are set by the look, not hard-coded; the frame loop calls `viewer.renderOverride?.(dt)` when one is set, else `renderer.render(scene, camera)`; new members `setRenderOverride(fn | null)` and `lights: { hemi, sun }` so the look can drive the two existing lights instead of adding duplicates. `createViewer`'s signature is unchanged. Antialiasing: the high tier renders through the composer with SMAA; low and medium keep MSAA as today.

**The controller** (`look.ts`):
```ts
export type Tier = 'low' | 'medium' | 'high';
export interface Look {
  readonly tier: Tier;
  setTier(t: Tier): Promise<void>;
  /** 6..19 */ setHour(h: number): void;
  setTrueColours(on: boolean): void;
  /** call after furniture changes; rebuilds the floor AO, the static shadow map and the cube map */
  refresh(grid: Grid): void;
  /** scan shown: tone mapping, post and glass off (rule 5) */
  setScanVisible(v: boolean): void;
  materials(): ShellMaterialSet;
  stats(): { tier: Tier; fps: number; drawCalls: number; triangles: number; textures: number; bytesLoaded: number };
  dispose(): void;
}
export function createLook(viewer: Viewer, layout: Layout, look: LookFile | null, opts?: { tier?: Tier }): Promise<Look>;
```
`look-panel.ts`: `mountLookPanel(host: HTMLElement, look: Look, opts): () => void`. A small sheet behind one new HUD button (a sun icon): the time slider with its label, the "True colours" switch, a quality picker (Auto / Low / Medium / High), the painterly button (C11c), two swatches "Wall colour from the video" and "Floor colour from the video" showing the raw sampled values, and the three illustrative labels. The integrator adds one mount call in `buyer/main.ts`.

**Quality tiers** (`quality.ts`). `?quality=low|medium|high` forces one. Otherwise: read `WEBGL_debug_renderer_info`, `navigator.deviceMemory`, `hardwareConcurrency` and pointer type for a first guess (touch device, or memory ≤ 4 GB, or a renderer string matching `Mali-|Adreno \(TM\) [1-5]|PowerVR|SwiftShader|llvmpipe` → low; touch device otherwise → medium; desktop → high), then time 40 frames of the built scene at that tier and step down while the average frame is slower than the target. During use, if fps stays under the target for 4 seconds, step down one tier, once, and remember it in `localStorage` key `walkthru:tier`.

| | Low | Medium | High |
|---|---|---|---|
| Meant for | mid-range Android | good phones, older laptops | desktop |
| Fps target (section 10) | 30 | 50 on phone | 55 |
| Pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Tone mapping | Neutral | Neutral | Neutral |
| Lights | hemisphere + sun, no shadows | + static 1024 sun shadow | + 2048 soft shadow, every frame |
| Ambient occlusion | grid floor AO + analytic wall AO | same | same + N8AO |
| HDRI | 1k, background only | 1k, background + environment | 2k, background + environment |
| Floor reflection | none | static cube map | planar, blurred |
| Textures | tile grid + plaster and tile normal maps | all 1k maps | all 1k maps, anisotropy 8 |
| Glass | transparent panes | same | same |
| Bloom, SMAA | no | no | yes |
| Furniture | procedural with flat colours | models and materials | models and materials |
| Character | new figure, flat materials | same | same, casts a real shadow |
| Post-processing library loaded | no | no | yes |
| Painterly mode | one still picture | one still picture | live |

### 16.6 C11b: real-looking people and furniture (revised 12 Nov 2026)

This subsection replaces the earlier C11b text. It does not change anything C11a builds: it uses C11a's `Look`, material cache and textures as they are specified in 16.5. Where it differs from the shared parts of section 16, this subsection wins **for C11b only**: the `sofa_02` and `dining_chair_02` models in 16.3 are no longer used (all furniture is procedural at exact size; C11a's fetch script may still download them, harmlessly), and C11b's acceptance is 16.6.6, which supersedes checks 3, 14 and 15 of 16.8. Check 4 of 16.8 (size truth) stands and is tightened here.

**New files:** `src/look/people.ts`, `people-materials.ts`, `retarget.ts`, `furniture-real.ts`, `furniture-parts.ts`, `tools/make_people.py`, `scripts/fetch-people.ts`, tests. **Edited:** `engine/furniture.ts`, `engine/character.ts`, `buyer/height.ts` (the B2 picker), and the one call in `buyer/main.ts` that reads the saved height.

#### 16.6.1 What was checked today

- **Patch's starter man** was downloaded through Git LFS and inspected. `public/figure/starter-man.glb`, 1,255,588 bytes, SHA-256 `450089ce3fd70c1a30e775cb1454a987cbaf3ff71ca53cf8581e74f9163e637e` (matches the LFS oid). CC0 1.0 per the repo's licence notes. It is a clothed adult male, 1.855 m tall, in seven separate meshes with seven materials: `male_generic` (body, material `starter-man.body`), `male_casualsuit06`, `shoes05`, `short01` (hair), `eyebrow001`, `eyelashes01`, `high-poly` (eyes). No textures (0 images): every material is a flat colour or empty.
- **Its skeleton matches ours for retargeting.** 65 joints with Unreal-style names (`pelvis`, `spine_01`, `upperarm_l`, `calf_l`, …). For 18 mapped bones (hips, spine, neck, head, shoulder, arm, hand, thigh, shin, foot, toe, a finger and a thumb) the rest-pose world rotation differs from our mannequin's `DEF-` bones by **0.0°**. Only joint positions differ (pelvis at 0.983 m against 0.917 m), which is proportion, not orientation. So our six clips transfer by renaming tracks and scaling the hips translation.
- **Quaternius Universal Base Characters** (CC0, "Compatible with the Universal Animation Library"). Its itch.io page says the free Standard download (122 MB) has **2 base models and 5 hairstyles, in underwear**; the Source download ($19.99 or more, 600 MB) has the full set, 20 hairstyles and skin-tone shaders. It has no everyday clothes in either. The download is behind itch.io's button, so it was not fetched or inspected: which two bodies are in the free file is unknown.
- **Blender is not installed** on this Mac. MPFB2 (the MakeHuman add-on for Blender) and MakeHuman's system assets are free; the system assets are CC0.
- Nothing non-commercial is used. No MetaHuman, no Mixamo, no Ready Player Me (its avatars' licence restricts redistribution).

#### 16.6.2 People: the decision, and how real it will look

**Both bodies come from MakeHuman's CC0 system assets, so the man and the woman match in style.** Three routes, in order; each later one is the fallback for the one before.

**Route A (target): build both with MPFB2 in headless Blender, with skin textures.** `tools/make_people.py`, run once by the integrator as `blender -b -P tools/make_people.py -- --out public/characters` after `brew install --cask blender` and installing the MPFB2 add-on with its CC0 system asset pack. For each body it:
1. creates a default adult (male: MakeHuman's default male; female: default female), age "young adult", average weight and muscle, proportions untouched (no heroic or teen shapes);
2. applies a MakeHuman system skin with its diffuse texture, system eyes, eyebrows and eyelashes;
3. adds clothes and hair from the **system** asset pack only (never community assets, whose licences vary): male `male_casualsuit06`, `shoes05`, hair `short01` (the same set as the starter man); female `female_casualsuit02`, a flat shoe from the system set, hair `long01` (alternatives `ponytail01`, `bob01`). The script lists the system assets actually present and fails with that list if a named one is missing, so the choice can be corrected rather than guessed;
4. deletes body faces hidden under clothes (MPFB's "delete helpers / hidden faces") so skin never pokes through;
5. adds MPFB's "game engine" rig, whose bones use the same Unreal-style names as the starter man, and exports `person-m.glb` and `person-f.glb` (Y up, +Z forward, metres, feet at the origin, textures at 1024 px, JPEG);
6. writes `public/characters/PEOPLE-LICENCE.txt` naming MakeHuman, MPFB2 and each system asset, all CC0 1.0.
   Budget per body: at most 25,000 triangles, at most 4 MB.

**Route B (fallback, male only is certain): the starter man as downloaded**, copied to `public/characters/person-m.glb` by `scripts/fetch-people.ts` (clone at commit `804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9`, `git lfs pull`, check the SHA-256 above). It has no skin texture, so skin and clothes are flat PBR colours (16.6.3). For the woman under route B: the Universal Base Characters "Regular" female, if it is one of the two free bodies, with clothing painted as material regions: a fitted T-shirt and leggings, chosen because both are skin-tight in real life and so are believable as regions of the body mesh, where a loose kurta would not be. If the free file does not contain a Regular female, the woman needs either route A or the paid Source pack ($19.99, still CC0): that is Mahir's call, not the implementer's.

**Route C (last resort):** the current mannequin for whichever body is missing, with the picker still offering both and the missing one labelled "Coming soon". Never ship a Superhero or Teen body as a stand-in.

**How real, honestly.**
- Route A: a correctly proportioned, clothed adult with a textured face and skin, like a good scale figure in an architectural walkthrough or a current mobile game. Not photoreal: hair is a solid sculpted shape, clothes do not drape or wrinkle as the body moves, faces are generic and do not look specifically Indian, hands are simple. From the third-person camera at 2 m, which is how the buyer sees them, it reads as a real person.
- Route B: the same shape and clothes but with flat-coloured skin and no facial texture: clearly a person, clearly not a mannequin, but stylised.
- Clothes are Western casual (shirt and trousers; top and trousers). MakeHuman's CC0 system assets contain no kurta or saree, and nothing non-CC0 is to be added to get one.
- No route gives photoreal humans with free tools and redistributable assets. Say so in the chunk report; do not oversell it.

#### 16.6.3 People: materials, skin tones, height, poses

- **Skin tones**, five, as sRGB targets for the mean skin colour: `#E3B998` (fair), `#CF9F7B` (wheatish), `#B07F5C` (medium brown, **default**), `#8E5F41` (brown), `#6B4631` (deep brown). Route A: the skin texture is used through C11a's detail-multiply (colour = tone × texel / mean texel, clamp 0.7 to 1.3), so one texture serves all five tones and keeps facial detail. Route B: the body material's colour is the tone. Skin: roughness 0.55, no metalness. Lips and nipples are never tinted separately; route A's texture carries what it carries, under the clothes.
- **Clothes:** the top takes the height preset's tint (teal, orange, violet, 16% desaturated so it looks like fabric), trousers `#3B4252` for him and `#2F3A4A` for her, shoes `#2A2A2A`, hair `#1E1A17`. The starter man's suit is one mesh: split top from trousers in the shader by the vertex's rest height relative to the pelvis joint (above = top). Fabric roughness 0.85, with the `cotton_jersey` normal map on medium and high.
- **Height is exact.** Unchanged rule: at load, pose `Idle_Loop` at t = 0, read the skinned bounding box of all meshes including hair and shoes, `h0` = its height; scale = `H / h0`. Hair volume counts as height (it is the top of the person). Both bodies scale uniformly from 140 to 200 cm; proportions are not altered.
- **Clips** (`retarget.ts`, pure): `retargetClips(clips, nameMap, hipsScale)` returns copies of our six clips with tracks renamed (`DEF-hips` → `pelvis`, `DEF-spine.001..003` → `spine_01..03`, `DEF-neck` → `neck_01`, `DEF-head` → `Head`, `DEF-shoulder.L` → `clavicle_l`, `DEF-upper_arm` → `upperarm`, `DEF-forearm` → `lowerarm`, `DEF-hand` → `hand`, `DEF-thigh` → `thigh`, `DEF-shin` → `calf`, `DEF-foot` → `foot`, `DEF-toe` → `ball`, fingers `DEF-f_index.01.L` → `index_01_l` and so on, `DEF-thumb.01.L` → `thumb_01_l`; `.L` / `.R` → `_l` / `_r`) and the hips position track multiplied by `hipsScale = target pelvis rest height / 0.917`. Tracks with no target bone are dropped. **Gate:** before use, compare rest-pose world rotations of the mapped bones on the loaded body against the mannequin; if any differs by more than 2° (possible on a route A export, whose bone rolls are MPFB's), use `SkeletonUtils.retargetClip` from `three/addons/utils/SkeletonUtils.js` instead of renaming. If that also fails the pose checks in 16.6.6, fall back a route.
- **Pose constants are measured per body at load**, not assumed. `Character` computes, with the body scaled to 1.75 m: hip height and hip setback in `Sitting_Idle_Loop` (from the pelvis bone's world position), and back depth (the rearmost point of the idle skinned bounding box). It compares them with `SIT_SEAT_RATIO`, `SIT_HIP_BACK_RATIO` and `LIE_BACK_RATIO` and stores the differences as a per-body offset applied when posing: the root moves so the pelvis lands where `core/poses.ts` intended. `types.ts` and `core/` are not edited, and the pose maths the tests check does not change.
- `Character.load(url?, opts?: { body?: 'mannequin' | 'male' | 'female'; tone?: number })` and `setAppearance({ body, tone })` (reloads the body, keeps position, yaw, height and state). The mannequin stays as the test rig and route C.

#### 16.6.4 Picker: "Who's walking?"

The B2 screen (`buyer/height.ts`) becomes:
- Heading: "Who's walking?"
- Row 1: two cards, **Male** and **Female**, each a small live render of that body (or a static thumbnail on the low tier). Default: Male.
- Row 2: five round skin-tone swatches, the default ringed.
- Row 3: the existing height chips (`160 cm`, `175 cm`, `190 cm`) and stepper (140 to 200, with feet and inches), unchanged.
- Button: "Start walking".
- Stored in `localStorage` key `walkthru:person` as `{ body: 'male' | 'female', tone: 0..4, heightCm }`. The old key `walkthru:height` is read once as a migration. The HUD person button reopens it; changes apply on the spot.
- **Fit-check copy does not change.** Verdicts depend only on height. The card text, tiers and numbers of section 2.1 are untouched, and the same height gives the same verdict for either body.

#### 16.6.5 Furniture that looks like real furniture, at the exact size

Everything is procedural (`furniture-real.ts`, parts in `furniture-parts.ts`), built from the item's `Box`, `heightM`, `surfaceHeightM` and `inner`, so it is always exactly the catalogue or imported size. `buildFurnitureMesh(item, opts?: { style?: 'plain' | 'real'; look?: Look })`: `plain` is today's output, unchanged. The `real` look is chosen by `furnitureLook(item)`: by `kind`, and for `counter` by label (`/study|desk/i` → study table; `/side|bedside|night/i` → side table; otherwise kitchen counter).

Shared parts (`furniture-parts.ts`): `roundedBox(w, h, d, radius, segments)` (three's `RoundedBoxGeometry`), `puffedCushion(w, h, d, puff, segments)` (a subdivided box whose faces bulge outward on a cosine profile and whose corners pinch in by 15%, so it reads as stuffed), `foldedCloth(w, d, thickness, seed)` (a subdivided slab with low, seeded sine ripples of 1 cm amplitude and one fold ridge), `piping(pathRect, radius)` (a thin tube along a rounded rectangle). All take sizes in metres and return geometry with world-scale UVs. Materials come from C11a's cache: `walnut_veneer`, white laminate (`#F4F2EE`, roughness 0.35), `rough_linen`, `cotton_jersey`.

**Rule for every item:** the built group's world bounding box equals the item's box: footprint `w × d` and height `heightM`, within 1 cm, and nothing sticks out of it. Soft parts (duvet, pillows, cushions) sit inside those bounds. The usable surface (mattress top, seat, table top) is at `surfaceHeightM` within 1 cm; where a soft layer lies on it (duvet, seat cushion crown), it may rise at most 4 cm above, since a body sinks into it.

| Item | Reference look | Parts and dimensions (w = box width, d = box depth, H = `heightM`, S = `surfaceHeightM`, m = mattress or inner size) |
|---|---|---|
| **Bed** (single, double, queen, king, and tagged or imported beds) | An Indian box bed: a wooden storage base on a recessed plinth, an upholstered headboard in a wooden surround, a thick mattress with piped edges, a fitted sheet, a bedcover folded back at the foot end, soft pillows. | Plinth: `(w − 0.10) × (d − 0.10)`, 0 to 0.08 high, dark (`#2E2A27`). Box base: `w × d`, 0.08 to 0.30, `walnut_veneer`, edge radius 1.5 cm, a 3 mm shadow gap line at mid height. Headboard: across the back, `w × 0.05` deep, 0.30 to H; a `walnut_veneer` surround 4 cm wide and an upholstered `rough_linen` panel inside it, with three vertical channels on medium and high. Mattress: `m.w × m.d` (for beds without `inner`: box size less 1.5 cm a side), 0.30 to S, edge radius 5 cm, `cotton_jersey` (the fitted sheet), piping tubes of 6 mm radius along the top and bottom edges on high. Bedcover: `foldedCloth` over the foot-end 60% of the mattress, 3 cm thick, overhanging each side by 3 cm (inside the frame), with a folded band 0.25 deep and 4 cm high at its head edge, `rough_linen` tinted `#C9B8A3`. Pillows: `puffedCushion` 0.65 × 0.14 × 0.42, two side by side when `m.w ≥ 1.2`, one centred otherwise, 4 cm from the headboard, `cotton_jersey` white. |
| **Sofa** | A three-seater with loose seat and back cushions, rounded arms, short wooden legs, woven fabric. | Legs: six (four when `w < 1.6`), 4 × 4 cm, 0 to 0.10, `walnut_veneer`. Frame: `w × d`, 0.10 to 0.26, fabric. Arms: 0.16 wide at each end, full depth, 0.10 to `S + 0.19`, top radius 6 cm. Back: 0.20 deep along the back between the arms, to `H − 0.02`. Seat cushions: `n = max(1, round((w − 0.32) / 0.6))`, each `(w − 0.32)/n × (d − 0.20)`, 0.26 to S, `puffedCushion` crown up to 3 cm. Back cushions: `n`, each 0.16 thick, from S to H, leaning 8°. Fabric `rough_linen` tinted `#8E9AA6`. |
| **Wardrobe** | A floor-standing laminate wardrobe as in the reference flat: brown wood-grain and white shutters, slim bar handles. | Plinth: recessed 3 cm, 0 to 0.08, dark. Carcass: `w × d`, 0.08 to H, `walnut_veneer`. Shutters: `n = max(2, round(w / 0.45))` doors of equal width on the front, 18 mm thick, 3 mm gaps, alternating `walnut_veneer` (grain vertical) and white laminate, starting with wood at the left. Handles: one 0.30 m vertical bar (12 mm, brushed metal `#B8B8B8`, metalness 0.8) per shutter at 1.05 m, on the edge where shutters meet in pairs. If `H > 2.25`: a loft row of shutters above 2.10 m with a 3 mm gap. Shutters and handles stay inside the box: the carcass front is recessed by their 3 cm. |
| **Study table** (counter kind, label matches study or desk) | A laminate study table with a drawer unit on one side. | Top: `w × d × 0.025` at S, `walnut_veneer`, edge radius 3 mm. Drawer pedestal: 0.40 wide on the right, floor to the top, white laminate, three drawer fronts with 3 mm gaps and a small knob each. Left support: an 18 mm side panel. Back panel: 18 mm, from 0.30 to the top. Knee space stays open. |
| **Side table** (counter kind, label matches side, bedside or night) | A small bedside table with one drawer and an open shelf. | Top: `w × d × 0.02` at H. One drawer front 0.14 high below it with a knob. An open shelf 0.12 above the floor. Four legs 3 × 3 cm. `walnut_veneer`, drawer front white laminate. |
| **Kitchen counter** (other counters) | A kitchen platform: base cabinets under a black granite top, the usual Indian finish. | Plinth 0 to 0.10, recessed 5 cm, dark. Base cabinets to `S − 0.04`, shutters every 0.45 to 0.60 m as for the wardrobe, white laminate, bar handles horizontal at the top edge. Top: `w × d × 0.04` at S, `#1F1F21`, roughness 0.15 (polished granite). Cabinet fronts recessed 2 cm so the top's edge is the box edge. |
| **Dining table for six** | A rectangular wooden table with six upholstered chairs tucked in, three a side. | Table: top 1.80 × 0.90 × 0.03 at S (0.75), edge radius 4 mm; four legs 6 × 6 cm, inset 8 cm; apron 8 cm deep under the top; `walnut_veneer`. Chairs: seat 0.42 × 0.42 × 0.05 at 0.45 with a `rough_linen` pad, four legs 3.5 cm, back from 0.45 to 0.95 with a curved top rail and three slats, tilted 6°; placed where the plain version puts them, pushed in so the whole set stays within the 1.80 × 1.70 footprint. |

**Budgets per item** (triangles; textures are the shared 1k maps from C11a's cache, nothing new is downloaded):

| Tier | Bed | Sofa | Wardrobe | Study / side table / counter | Dining set | Textures | People (each) |
|---|---|---|---|---|---|---|---|
| Low | ≤ 1,500: rounded boxes with 1 segment, pillows and cushions as rounded boxes, no cloth ripple, no piping | ≤ 1,500 | ≤ 600 | ≤ 500 | ≤ 2,500 | none: flat colours taken from each texture's mean | ≤ 25,000, no normal maps, static thumbnail in the picker |
| Medium | ≤ 6,000: puffed pillows (8 segments), rippled bedcover (16 × 16) | ≤ 5,000 | ≤ 1,500 | ≤ 1,200 | ≤ 8,000 | colour and normal maps | ≤ 25,000, skin texture (route A), fabric normal map |
| High | ≤ 14,000: 16-segment pillows, 32 × 32 bedcover, piping, headboard channels | ≤ 10,000 | ≤ 2,500 | ≤ 2,000 | ≤ 14,000 | colour, normal and roughness maps, anisotropy 8 | same, casts a real shadow |

`setFurnitureTint` keeps working on both styles. The label "Furniture style is illustrative. Sizes are exact." stays in the furnish tray and on each item's card footer. Broker-tagged and imported items (`source: 'real'`) get the same looks: the drawing gives their size and place, not their finish, so the label covers them too.

#### 16.6.6 Acceptance for C11b

Headless (`npm test`):
1. **Size truth, every item, every tier.** For each catalogue item and for an imported bed (1.52 × 1.83, no `inner`), study table (0.61 × 1.22 × 0.75) and side table (0.46 × 0.53 × 0.55): in `real` style at low, medium and high, the group's world bounding box matches the box footprint and `heightM` within 1 cm, nothing extends outside it, and a downward ray at the centre of the usable surface hits between `surfaceHeightM − 0.01` and `surfaceHeightM + 0.04`. `plain` style output is byte-for-byte what it was (snapshot of part names, sizes and colours).
2. **Budgets:** each item's triangle count is within the table for its tier.
3. `furnitureLook`: "Study", "STUDY 2'0\"X4'0\"" and "Desk" give the study table; "Side Table" and "Bedside" give the side table; a counter with any other label gives the kitchen counter.
4. Pillow count: one for the single bed, two for double, queen and king. Sofa seat cushions: 3 for the 2.10 m sofa, 2 for a 1.5 m one.
5. `retargetClips`: on the starter man's skeleton (bone list checked in as a fixture, not the GLB), all six clips keep every mapped track, the hips position track is scaled by 0.983 / 0.917 within 0.1%, and no track targets a missing bone.
6. Picker state: defaults `{ male, tone 2, 175 }`; a stored `walkthru:height` of 190 migrates to `{ male, 2, 190 }`; values outside 140 to 200 clamp.
7. Every test in `core/` and the existing `checks` tests pass unchanged: `bedFit(1.98, 1.52, …)` still gives fits +38 at 160, fits +23 at 175, tight +8 at 190.

In the browser (CDP script, `test-flat-empty`, screenshots to `shots/people/` and `shots/furniture/`, medium tier unless stated), using `__walkthru` hooks plus two new ones, `__walkthru.person.set({ body, tone, heightCm })` and `__walkthru.person.measure()` returning `{ heightM, pelvis: Vec3, bboxMin: Vec3, bboxMax: Vec3, headToHeelM }`:
8. **Standing, 6 shots:** male and female at 160, 175 and 190 cm beside the 2.1 m door frame. `measure().heightM` equals the chosen height within 1 cm in every case. Each shot shows a clothed person with hair, not the mannequin (asserted by mesh names: no `Mannequin` mesh visible).
9. **Lying on a queen bed, 6 shots:** same six. The body lies within the mattress width; `headToHeelM` equals the height within 2 cm; the lowest point of the body is no more than 3 cm below `surfaceHeightM` and the back is no more than 3 cm above it; the card reads "You fit. 38 cm to spare…", "You fit. 23 cm to spare…", "Tight fit. Only 8 cm to spare…" for 160, 175, 190, identically for both bodies.
10. **Sitting on the 3-seat sofa, 6 shots:** the pelvis is within 5 cm of the seat point horizontally and between 5 and 15 cm above `surfaceHeightM`; feet are within 5 cm of the floor for 175 and 190; no part of the body is below the floor.
11. **Skin tones:** the five tones produce five different mean skin colours on screen, each within 15% per channel of its target under "True colours"; clothes do not change with tone.
12. **Each furniture item, one shot per tier (7 looks × 3 tiers):** the bed shows a headboard, pillows and a folded cover; on-screen footprint corners of every item coincide with the fit-check outline within 2 cm; the king-bed verdict text of section 10 is unchanged.
13. **Fps on the live site**, one of each catalogue item placed in `test-flat-empty` and the person walking: high at least 55 on the desktop; medium at least 50 and low at least 30 under Chrome mobile emulation (412 × 915, 4× CPU throttle). A real mid-range Android phone must also be tried by hand before the low tier is called done.
14. **Weight:** both bodies together add at most 8 MB; a body is fetched only when chosen.

The chunk report must state which route (A, B or C) each body shipped on, with one screenshot of each, and must not describe route B or C as realistic.

#### 16.6.7 Lived-in mode (optional decor)

An empty flat does not read as a home, so a "Lived-in" switch in the look sheet adds everyday Indian-home decor. It is decoration under the honesty rule (16.2 rule 4), so it is labelled, optional and can never change a number.

- **What goes in** (`src/look/lived-in/`, all procedural low-poly, nothing downloaded so nothing to license): accent cushions and a striped throw on sofas and beds; books and a lamp on study tables, a lamp on side tables; a pressure cooker, steel dabbas and a fruit bowl on a kitchen platform; a fruit bowl and a steel jug on a dining table; a dhurrie rug in front of the living-room sofa; a tulsi / money plant by a window or in a corner (living room, one bedroom, the balcony); chappals and shoes beside the entry door; open curtains on bedroom and living-room windows; a wall clock and a framed picture (over the bed's head or the sofa's back when it stands against a wall); and, in a room labelled pooja, puja, mandir or prayer, a small wall temple with a brass diya, a kalash, a bell and a marigold string.
- **Where it may go** (`plan.ts`, pure, deterministic for a given home): never in a `partial` room, nor on furniture standing in one; surface pieces only inside a real item's box at its surface height; floor pieces only on cells the walking grid says are free, inside their own room, at least 0.7 m (plus half the door's width) from any doorway and from any open edge (the shoes sit beside the entry door, out of its doorway), and only where a flood fill of the character-sized floor before and after has the same number of places (a sliver under 0.3 m2 does not count); the rug is flat, may run under its own sofa, never over another item or across a doorway; wall pieces only on a plain wall edge, clear of every door and window and of anything taller than their bottom edge (a curtain meets only its own window, floor length unless something stands under it). Items the buyer places while furnishing are not decor hosts, and floor and wall decor they cover is hidden, never moved.
- **It cannot change a measurement.** Decor is planned on the walking grid and never stamped into it; it sits under the furniture root (so shadows, tiers and the painterly mode follow it) but every mesh has `raycast` switched off, so the measure tool, the furnish picker and every other ray ignore it. It is hidden while a scan is shown and while an AI photo is taken. Nothing is planned or built until the mode is first switched on.
- **Default and memory.** On for made-up sample homes (so the gallery's homes read as homes at first sight), off for a real drawing until the buyer taps it. The viewer's own choice wins everywhere and is remembered in `localStorage` key `walkthru:livedIn` (every access wrapped in try/catch).
- **Label.** "Decor added to show a lived-in home. Not from your drawing." sits under the switch and, while the mode is on, in the rooms sheet.

#### 16.6.7 Revision of 13 Nov 2026: a stylised family replaces the two realistic bodies

The MakeHuman bodies with photographic skin sat in the uncanny middle, and Western T-shirts and jeans did not look like the buyer's family. They are replaced by four stylised people. **This subsection wins over 16.6.2 to 16.6.4 wherever it differs** (two bodies, textured skin, Western clothes, the Male and Female cards).

- **The family:** Man, Woman, Elder (an elderly mother, slightly stooped, walks at 0.62 of the base pace) and Child. Body ids are `man`, `woman`, `elder`, `child`; the stored values `male` and `female` of version 1 read as `man` and `woman`.
- **Source and licence:** the bodies are still MakeHuman base meshes made with MPFB2 (macro age, gender and weight), CC0 (MakeHuman FAQ "What changed regarding the license in 2020": base mesh, targets and proxies are CC0). The only system assets kept are `eyes/high-poly`, `eyebrows/eyebrow001` and `clothes/shoes05` (each file's header: released as CC0 in September 2020). Everything else is made in `tools/make_family.py` from the body's own shape and is CC0 as part of the shipped files: the garments (rings measured from the skin and lofted, skinned from the nearest skin vertices and smoothed), hair, pupils, trim, dupatta and pallu. No textures ship. Quaternius' Ultimate Animated Character Pack (CC0, opengameart.org/content/animated-characters-pack) was inspected and rejected: its characters are chibi (head about a third of the height) with no real eye height or shoulder width, which a measuring product cannot use; the Universal Base Characters have no child, no elder and no clothes in the free download.
- **Look:** flat colours by role (`skin` takes the buyer's tone, `top` the height tint, `bottom`, `wrap`, `trim`, `hair`, `shoes`, `eyes`, `pupil`, `brows`), a head 6 % larger (child 14 %, revised 16 Nov 2026, 16.6.9) than the MakeHuman proportion, a small smile and darker lips (vertex colour), white eyes with dark pupils. Proportions otherwise stay human, so eye height and shoulder width are real.
- **Clothes (replaced by 16.6.11 and 16.6.11b, 16 Nov 2026):** the first version dressed all four in long Indian garments (a knee-length kurta over pyjama, a salwar-kameez with a dupatta, a kurta for the child), which read as a gown from behind. Now: Man, a collared shirt and trousers. Woman, a hip-length top and trousers. Child, a T-shirt and shorts. Elder: a blouse and a saree until 16.6.11b, now a tunic and trousers like the others. (The saree builder stays in `make_family.py` as the outfit `saree`, a skirt of two panels plus a sash over the shoulder, but no one wears it.)
- **Heights:** the rig is scaled so the skinned bounding box at Idle_Loop t = 0 is exactly the chosen height, as before. Each person has a range: man 150 to 200 (default 175), woman 140 to 190 (160), elder 135 to 180 (150), child 90 to 150 (120). Choosing another person resets the height to that person's default. Quick heights per person: man 160/175/190, woman 160/168/176, elder 150/158/166, child 105/120/135. `types.ts` HEIGHT_MIN_CM stays 140 for the old helpers; the person ranges live in `buyer/person-store.ts`.
- **Clips (revised by 16.6.8: more clips, from two libraries):** the six retargeted clips and `Lie_Pose` as before, plus `Look_Around` (the head and neck turn left, then right, after 8 s of standing still) and `Reach_Forward` (right arm lifted and bent, played by `Character.reach()` when a wardrobe is opened). Both are built at load from the retargeted Idle_Loop (`retarget.ts idleVariants`).
- **Sizes:** `person-<id>.glb` 152 to 177 KB, `-low.glb` 111 to 121 KB (budget 600 KB; 16.6.11), no textures. Only the chosen body is fetched; the others load when picked.
- **Picker:** four portrait cards (Man, Woman, Elder, Child; stills rendered in Blender by `make_family.py --thumbs`), five skin tones, the person's quick heights and stepper, "Start walking". Four columns on a 390 px phone.

#### 16.6.8 Motion pass of 15 Nov 2026: free animation libraries, no sliding feet, first person

**Animation source and licence.** All clips come from two Quaternius libraries, CC0 1.0, free Standard downloads (itch.io "name your own price", minimum 0, no login), fetched 15 Nov 2026: Universal Animation Library [Standard] (https://quaternius.itch.io/universal-animation-library) and Universal Animation Library 2 [Standard] (https://quaternius.itch.io/universal-animation-library-2). Both zips carry `License.txt`, "CC0 1.0 Universal Public Domain Dedication"; the packs' pages say "free to use in personal, educational and commercial projects". Zip and glb SHA-256 values are in `public/characters/people.lock.json` and `PEOPLE-LICENCE.txt`. The paid Pro and Source files are not used. Mixamo is not used (it needs an Adobe login, and its terms restrict redistributing the raw clips).

**Build.** `tools/make-clips.mjs <UAL1_Standard.glb> <UAL2_Standard.glb> public/characters/clips.glb` merges the wanted clips of both onto one 65-bone rig with Unreal-style names (the names our bodies carry; root motion off). Rotations of every bone and the position of `pelvis` only, meshopt, no meshes: 197,568 bytes (was 127,672). `retarget.ts` accepts both naming schemes (`ueNameFor`: a `DEF-` name maps as before, an Unreal name maps to itself, `root` is left alone) and still bakes the world-space retarget when the rest poses differ by more than 2 degrees.

| Clip | Source | Used for |
|---|---|---|
| `Idle_Loop` | UAL 1 | standing, breathing |
| `Walk_Loop`, `Jog_Fwd_Loop` | UAL 1 | walking, jogging (Shift, or a joystick pushed past 85 %) |
| `Walk_Formal_Loop` | UAL 1 | the elder's walk, slower and more upright |
| `Sitting_Enter`, `Sitting_Idle_Loop`, `Sitting_Exit` | UAL 1 | sit down, sitting, stand up (as before) |
| `Interact` | UAL 1 | `Reach_Forward`: the arm lifted, held and lowered, played when a door or a wardrobe is opened |
| `Idle_FoldArms_Loop` | UAL 2 | a standing variant: after standing still the walker glances round, then glances again, then folds their arms for 6 s |
| `Look_Around` | made from `Idle_Loop` (head and neck turn left, then right) | the glance |
| `Turn_Step` | made from `Idle_Loop`: left, right, left, right foot lifted, 0.625 s each | feet stepping while the body turns on the spot |
| `Lie_Pose` | made from `Idle_Loop`: legs and pelvis held at the rig's rest pose, the rest of the idle kept | the still lying pose the size checks measure, which breathes once the walker has arrived |

Not available in the free sets: a start or stop step, a turn on the spot, a lie down, a lying idle, a get-up from a bed. `LayToIdle` (UAL 2) is a get-up from the floor and was not used: played on a mattress it stands the walker on the bed. Start and stop are made by the speed ramp below, the turn by `Turn_Step`, lying and getting up keep the 0.6 s and 0.5 s moves of 4.6 with the breathing added.

**No sliding feet.** A gait clip must play at `speed / (its planted-foot speed)`. The old code assumed 1.4 m/s for `Walk_Loop`, whose real pace is about 1.0 m/s, so the feet slid by a third of the body speed (the planted foot moved 22 to 26 cm per step), and `Jog_Fwd_Loop` (5.4 to 5.9 m/s, really a sprint) ran at 2.8 m/s on ice. `Character.measureGait()` now measures, when a body is bound, how fast each gait clip carries the ball of each foot backwards while it is down (frames within 1.15 % of the body's height of the lowest the ball gets, both feet), per metre of model scale, on that body's own legs. `setLocomotion` plays the clip at `speed / (gait * H / h0)`. A sweep of the gait value from 0.6 to 1.25 times the measured one put the minimum slide at exactly 1.0 times.

**Speed, turning, stopping** (`locomotion.ts`): the speed eases up at 4.2 m/s^2 and down at 7 m/s^2 (times height / 1.75), so a start takes a third of a second and a stop a fifth, and a released stick glides on a little along its last heading; the turn rate is 6 rad/s (was 10); the walker walks only where it faces: full speed within 30 degrees of the wanted heading, none beyond 90, so a half turn is done on the spot with `Turn_Step` playing (faster stepping for a faster turn) and the speed builds as the body comes round. Jog is 3.4 m/s (was 2.8; at 2.8 the sprint clip would have had to run at less than half speed). Walk stays 1.4 m/s. The camera follows the character's position, which is now smooth to the second difference (tested), and no clip carries root motion, so the follow camera cannot jitter from it.

**Reach.** `Character.reach()` is called by `interactions.ts` after a door or a wardrobe has been activated; the arm lifts as the leaf swings. A body without the clip (the mannequin) just stands.

**Characters.** Kept. Quaternius' Universal Base Characters [Standard] (CC0) was downloaded and inspected: two adult "Superhero" bodies in underwear (male 1.82 m, female 1.78 m), no child, no elder, no clothes, no Indian garments. The Ultimate Animated Character Pack is chibi (13 Nov). No free CC0 set offers a child and an elder with real proportions and clothes that can be recoloured, so the MakeHuman family stays and nothing about size accuracy changed.

**First person.** The "Who's walking?" sheet has a switch, **See yourself** (the follow camera, the default) and **First person** (no body in shot, the camera at the person's own eyes), and the V key flips it. The choice is remembered per viewer in `localStorage` key `walkthru:view` (`third` or `first`; any access in try/catch, anything else reads as `third`) and never touches `walkthru:person`. First person: vertical field of view 70 degrees (the follow camera keeps its own), drag looks, level at the start, pitch limited to 80 degrees up and down; eye height is measured per body (the centre of its `eyes` part in the head bone's frame, about 0.90 of the height for the adults and 0.87 for the child, so a 160 cm person's eyes are at 1.45 m) and follows the person's height; walking and standing the eyes stand over the body with a third of the head's bob, sitting and lying they follow the head bone; on a bed the view looks up at the ceiling (55 degrees), on a sofa straight ahead, and on sitting or lying the heading turns to the way the seat or bed points. The size checks, the cards and the poses are the same in both views (the body is still posed and measured, it is only not drawn). `__walkthru.view.get()` and `.set('first' | 'third')` are the debug hooks.

**Debug hooks added:** `__walkthru.motion.pause(on, dt)`, `.step(n)`, `.trace(on)` (freeze the simulation and advance it in exact steps, record camera and character per frame, for frame sequences); `Character.gaitSpeed(clip)`, `.eyePosition(out, dt)`, `.eyeHeightM`.

**Tests:** `tests/people-motion.test.ts` (net slide per step under 3 cm at full and half push for all four people, the elder's clip and pace, no jump in speed above 0.15 m/s per frame and no limb moving more than 5 cm between frames through a start and a stop, a half turn done on the spot with a foot lifting, the idle rota look, look, arms folded, idle, reach lifting a hand by more than 20 cm, eye heights between 0.86 and 0.97 of the height), `tests/engine-camera-locomotion.test.ts` (first-person camera, the smooth follow), `tests/person-store.test.ts` (the view key), helpers in `tests/motion-helpers.ts`.

#### 16.6.9 Fit pass of 16 Nov 2026: close-fitting clothes, hair that covers the crown

(The kurta, kameez and pyjama numbers below describe the first long-garment outfits, replaced for the man, the woman and the child by 16.6.11 the same day. Hair, head size, the elder's saree and the method of measuring the fit stand.)

The owner's words: the clothes were "too huge, a little bit out of scale", and "the character has a bald spot on their head". **This subsection wins over 16.6.7 for clothes, hair and head size.**

- **Bald spot, cause.** `hair_cap` lofted the cap from a flat disc at 4 mm below the skull's summit, so the summit (a disc about 7 cm across on a man) came through it. It showed from behind and above, which is the follow camera. It is gone: the cap now closes with a dome (six rings and an apex vertex) that clears the skin by 9 mm or more everywhere, and `optimise-people.mjs` keeps the hair at 100 % of its triangles in the first file and 60 % in the low one. Checked on the shipped geometry (a vertical ray over the crown, 6 cm below the top of the head, both files): before, 91 to 112 of about 570 cells were bare or under 2 mm and the skin stood 3 to 4 mm proud of the hair; after, none are, and the least clearance is 8.5 to 9.2 mm.
- **Head size.** Man, woman, elder 6 % larger than the MakeHuman proportion (was 10 %), child 14 % (was 22 %), and the hair 10 mm thick (was 12). Hair adds to the head, so the old figures read as a head a quarter too big once the hair was on.
- **Clothes, cause.** Offsets were 3 to 7 cm at the chest and hip, a 4 cm flare below the hip, a fitting loop that added up to 4 cm at the hem, a 6 mm elbow bump 14 cm long, and trousers measured through a 9 cm window, so the kurta stood 13 cm off the body at the hem and the trousers were 1.4 to 3 times the leg's girth. Now (metres off the skin's outline): shoulders 0.008 to 0.011, chest 0.011 to 0.014, waist 0.011 to 0.017, hip 0.018 to 0.021, hem 0.022 to 0.026, no flare; sleeves 0.010 to 0.007 (child 0.008 to 0.006) with a 3 mm elbow lump and 5 mm over the deltoid; pyjama 0.021 at the hip tapering to 0.007 at the ankle (the child's 0.85 of that), kameez and salwar a little fuller at the thigh; saree skirt 0.010 at the waist to 0.018 at the ankle, no flare. Sleeves and trouser legs are measured on the skin's surface with rays and a low-order Fourier fit (the skin is a vertex every 1.5 cm there, and an outline of its points cut into it), and a sleeve's first 5 cm grow out of the torso instead of standing proud of the shoulder. A sleeve's weights come from the arm skin under it, not from the torso it is tucked into.
- **Slits instead of volume.** The kurta, kameez and child's kurta have side slits (13, 15 and 4 cm: the hem is raised at the two sides and falls away over the front and back); the fitting loop may add at most 35 mm (kurta, kameez), 20 mm (saree skirt) and 6 mm (trouser legs, which now also fit the seated pose). The man's kurta ends 9 cm above the knee joint.
- **Measured** (`make_family.py` prints a `FITM` line per measure, T-pose, garment against the skin's true section): chest 1.09 to 1.18 times the body's girth (+1.1 to +1.7 cm), waist 1.05 to 1.18, hip 1.07 to 1.12, sleeve 1.22 to 1.28 at the upper arm (+0.8 to +1.1 cm, a larger ratio because an arm is thin), trousers 1.25 to 1.31 at the thigh (child 1.41) and 1.29 to 1.30 at the calf. Before: chest 1.17 to 1.36, hip 1.43 to 1.46, hem 1.7 to 1.9, sleeve 1.55 to 1.95, trouser knee 1.8 to 3.1.
- **Seated hands.** The sitting clip rests the hands on the knees, so fingertips can show through the trousers there; that is the clip, not the cloth.
- **Tools.** `make_family.py` gains `--measure-sleeves`, `--hide <roles>` and the `head` sheet (the head from the top, behind and above); `optimise-people.mjs` caps simplification error at 2 mm of a part's extent (skin) and 4 mm (cloth).
#### 16.6.9a Hang pass of 16 Nov 2026 (follow-up to 16.6.9)

The close fit of 16.6.9 let the buttocks and the cleft show through the kurta from behind and above. Below the waist the kurta, kameez and child's kurta are now built as hanging cloth (`skirted_rings(hang=...)`): the outline is the convex hull of the hips and thighs between 12 cm above and 8 cm below the hip joint (`hull_radii`, no cleft, no gap between the thighs, no waist hollow), eased out by 2.2 / 2.0 / 1.8 cm at the hip (man / woman / child) to 3.2 / 2.8 / 2.8 cm at the hem, and from the waist it opens from the body's outline to that hull. The two leg panels overlap by 0.4 of the ring (was 0.15) with sub-millimetre steps, and their weights follow 55 % of the leg (the rest stays with the pelvis), so the cloth lags a stride instead of tracing it. Side slits, the fitting loop and the saree skirt are unchanged. Default top tint: HEIGHT_TINTS[1] is crimson `#B71C6C` (was orange `#E8823A`, which read as skin next to a light tone); a test keeps every tint at least 40 degrees of hue from every skin tone.

#### 16.6.11 Shirt and trousers, not a gown (16 Nov 2026)

The owner: "Make the person's clothes better, make him wear a shirt and pant, not this gown type nonsense for every one." From behind (the follow camera) the knee-length kurta hung over the legs like a gown. **This subsection wins over 16.6.7 (Clothes), 16.6.9 and 16.6.9a for the man, the woman and the child; the elder followed in 16.6.11b.** Everything is still lofted by `tools/make_family.py` from the body's own measured sections; no clothing asset is bought or downloaded.

- **Man: a collared shirt and trousers.** (Revised by 16.6.11d: the shirt is tucked in.) The shirt is one tube from the neck to just under the waistband (`torso_levels`, hem 0.8 cm below the waist), measured 0.75 to 0.85 cm off the skin at the shoulders and chest and 0.4 cm at the waist, so it follows the body's taper and is not a slab. Sleeves are rolled to the forearm (70 % of the way to the wrist, 0.65 to 0.55 cm off the skin, the last three rings grown 1, 4 and 4 mm into a turned band) and start 3.5 cm inside the shoulder joint with a full-size root so no skin shows at the armpit. Collar (`collar_mesh`): a stand 2.2 cm high round the neck and, over it, a fold built from the stand's own outline grown outward and lowered in four steps (a shallow cone lying on the shoulders), open at the front in a V. The collar is 16 % darker than the shirt (vertex tag `collar`, 16.6.11d). A raised front placket (`ring_strip`, 1.8 to 4.2 mm proud) with five buttons (`buttons_mesh`, role `wrap`), a yoke seam across the upper back (`band_across`, 1.2 mm proud, level with the shoulder blades) and a box pleat down the centre of the back (`ring_strip`, 2.6 mm proud), both 12 to 16 % darker. Trousers are one tube per leg (`leg_levels`) from 0.6 cm above the waist: 1.25 cm off the skin through the waist and hip (the waistband stands over the shirt), 1.05 to 0.85 cm at the knee and calf, opening to 2.4 cm at a hem that ends 4.5 cm below the ankle joint, on the shoe's top. A belt (`trim`, 1.85 cm off the skin, 3.4 cm wide) runs round the waistband with a pearl buckle (`wrap`) at the front.
- **Woman: a hip-length top and trousers.** A kurti-style top (`shirt_rings`, hem at the hip joint less 2 cm, 4 cm vents, round neck with a cream piping band in `trim`, three-quarter sleeves 78 %, a yoke seam across the back; 16.6.11d slimmed it to 0.75 to 1.15 cm off the skin and 0.4 to 0.5 cm of hull ease at the hip, so it does not flare), no dupatta, no skirt; trousers a little closer than the man's. The braid is unchanged.
- **Child: a T-shirt and shorts.** The T-shirt ends at the hip (0.65 to 1.1 cm off the skin since 16.6.11d), short sleeves (25 % of the arm, a turned hem), a crew neck with a rib band in `trim`; shorts are a tube per leg ending 3.5 cm above the knee joint. The pigtails are unchanged.
- **Trousers follow the body above the crotch.** A trouser leg's weights are the body's down to 7 cm above the crotch and each leg's own skin below it (`leg_weights(hand=...)`, `--hand-hi`, `--hand-span`), so the seat and the groin move with the pelvis as the skin does and each leg is weighted to its own leg only below the crotch. The woman's, the elder's and the child's trousers start 0.3 cm outside the skin at the waist (16.6.11d: they were 1.3 cm inside, which let the belly show between a top that had ridden up and the trousers when seated) and reach 0.55 to 1.1 cm at the hip. A trouser leg's weights below the ankle are the calf's, not the foot's (`leg_weights(shoe_free=True)`): the hem hangs from the calf and the shoe moves inside it, so the hem no longer tears open when the foot points. The trousers' weights are smoothed over 6 passes (was 16: the thigh top lagged the skin by a third of the hip's swing and the crease came through the cloth when seated), follow the body down to 17 cm above the crotch and each leg's own skin below that, and the fit loop may grow a trouser leg by 14 mm (was 6). In the sitting pose the least clearance left at the hip crease and the knee is 7 mm below the 4 mm margin for the elder (`--measure --debug-pose sit`).
- **Colours** (`people-materials.ts`). `top` takes the viewer's tint, as before. `bottom` never does (a test). Man: light blue shirt (`#7FA7D8`), charcoal trousers (`#565C68`), dark brown belt, pearl buttons. Woman: muted teal top (`#4FA3A0`), beige trousers (`#CBB994`), cream piping. Child: bright green T-shirt (`#3BAA5C`), denim-blue shorts (`#3F5F8F`), white neck rib. The tint now belongs to the person: `TOP_TINTS[body]` holds the colours of the three quick heights in order, and `tintForPerson` and the height sheet's chips read it. The middle one is the first impression at the default height (man 175 cm and child 120 cm): crimson `#B71C6C` is gone from the default man and child. The woman's default (160 cm) is her first colour, and so is the elder's (16.6.11b). Every older tint is still on offer: teal to the man and the child, crimson to the woman and the elder, violet to all four. `HEIGHT_TINTS` (types.ts) still serves the mannequin and `tintForHeightCm`. The hue rule of 16.6.9a (40 degrees from every skin tone) is tested over every `TOP_TINTS` colour. The stored `person` value and the `?my=2.` field `h` carry body, tone and height only, so every earlier link opens unchanged (the same person, in the new clothes).
- **Fit** (`FITM`, T-pose, garment against the skin's section, chest / waist / hem / thigh / knee / calf): man 1.12 / 1.06 / 1.18 / 1.16 / 1.28 / 1.33, woman 1.14 / 1.11 / 1.02 (hem) 1.13 (hip) / 1.13 / 1.29 / 1.31, child 1.14 / 1.12 / 1.01 / 1.32 (shorts, a child's thigh is thin); sleeves 1.22 at the upper arm. Triangles of the shipped files, medium / low: man 19,696 / 9,564 (was 19,800 / 9,378), woman 18,864 / 9,034 (23,048 / 11,898), child 16,302 / 8,922 (17,312 / 9,010), elder see 16.6.11b. `FIT_CAP['top']` is 2.5 cm (was 3.5): the hem of a hip-length top is the one place the fit loop would otherwise grow it round the thighs of a seated person.
- **Tools.** `tools/dump-clip-samples.ts` replaces the `.mjs`: it samples the clips a body really plays (retargeted by `retargetOnto`, Unreal bone names) for `make_family.py --sheets / --measure`; `make_family.py` gains `--measure-hands` (how deep hands and fingers sit in the trousers, per pose), `--hand-hi`, `--hand-span`.
- **Hands on the knees:** see 16.6.11c (this was a known limit of 16.6.11 until then).
- **Tests:** `tests/people-outfits.test.ts` (no skirted part on the man, woman and child in either tier: the top ends above the crotch, the legs are separate, the bottom never takes the tint, the elder keeps her skirt and pallu, the default tints) and the hue test in `tests/person-store.test.ts`.

#### 16.6.11b The elder in a tunic and trousers (16 Nov 2026, later)

The owner: "Make the elder wear normal clothes too." She stops wearing the saree. **This subsection wins over 16.6.7 (Clothes) and the elder lines of 16.6.11.**

- **Tunic** (`outfit='tunic'`, same builder as the woman's kurti, `shirt_rings`): a little longer and looser, hem 4.5 cm (in her own scale) below the hip joint, 5 cm side vents, round neck with a cream piping band (`trim`), three-quarter sleeves (80 % of the arm), a yoke seam across the back. Offsets are 0.8 to 1.5 cm off the skin (the woman's 0.75 to 1.15; 16.6.11d took 0.4 cm off both), eased 0.5 to 0.7 cm over the hip hull. It is measured on her stooped body (the stoop is baked into the T-pose the garments are lofted on), so the back of the neck, the curve of the upper back and the seat follow her.
- **Trousers:** straight and comfortable, 1.25 cm off the skin at the thigh, 1.05 at the knee, opening to 2.35 cm at a hem on the shoe; the same waist and weighting as the woman's. No wrap, no pallu, no skirt: nothing hangs between the legs (a test).
- **Colours:** a soft lavender top (`#B2A3D1`, her first quick height, 150 cm), navy trousers (`#3E4A6B`), cream piping, grey bun and shoes as before. Her three tops are lavender, crimson and violet.
- **Saree:** the `saree` outfit (blouse, two-panel skirt, pallu strip) is still in `tools/make_family.py` as an option for `PEOPLE[...]['outfit']`, unused.
- **Triangles** (medium / low): 18,692 / 8,796 (was 20,104 / 10,476). The elder GLBs are 167 and 111 KB (were 182 and 128 KB).

#### 16.6.11c Hands that rest on the thigh, not in it (16 Nov 2026, later)

With trousers and shorts on every person the one place skin still showed through the cloth was the knee in the sitting pose: the library's `Sitting_Idle_Loop` rests the hands on the knees, and on our bodies the hands sink 4 to 6 cm into the thigh (`make_family.py --measure-hands --hands-vs-skin`: the deepest hand or finger vertex below the legs' skin, 49 mm for the elder, similar for the others), so patches of hand showed through the trousers. `retarget.ts sitHandsUp` (called by `retargetOnto` on the retargeted clips) bends both elbows 36 degrees more and swings both upper arms 12 degrees forward in `Sitting_Idle_Loop`, grows the same lift over the middle of `Sitting_Enter` and fades it over the first half of `Sitting_Exit`. After it no hand vertex is inside the trousers in the loop pose for any of the four (against the legs' skin it was 43 to 61 mm deep before); one thumb still dips by up to 4 cm for one frame in the middle of sitting down (30 to 40 mm, in the frame where the body is moving). Names and lengths of the clips are unchanged. Test: `tests/people-sit-hands.test.ts`.

#### 16.6.11d The close, high view: tucked shirt, no smock, a bald-spot guard (16 Nov 2026, later)

The owner looked at the live site (the man in the clubhouse foyer, the camera boomed in about 1.2 m behind and 0.6 m above his head because a wall is behind him, looking down about 35 degrees) and said the clothes looked bad: the shirt read as a smock or lab coat (a broad puffy mass widening to a low hem, a vertical fold at the back, puffy sleeves, almost no trouser seen), a dark collar band with two points, and a bald spot on the crown. The earlier checks were from 2 to 4 m at eye level. **The close, high view is now the one the clothes are judged from** (`__walkthru.freeCam` about 1.2 m behind and 0.6 m above the head, both tiers with `?tier=low`, desktop and phone size).

- **Man, tucked in.** The shirt ends under the waistband; the belt (with a buckle) and the waistband show all round and the trousers are seen from the waist down including the seat. The torso is 1.08 times the body at the chest (FITM chest, 1.12 before) and follows the waist; the upper-arm sleeve is 1.16 (was 1.22), with no deltoid puff (bump 2.5 mm, was 5) and a full-size root at the shoulder. The flared hull hem, the side vents and the fit loop's growth of the hem, which made the vertical crease at the back, are gone from his shirt. His shirt has the yoke seam and the centre-back pleat for shape. The woman's, the elder's and the child's tops are not tucked and are slimmer (16.6.11, 16.6.11b).
- **Collar.** Round and flat: the stand and a conical fold, 16 % darker than the shirt, instead of a lofted band with two lowered points (which came out as dark shards from above).
- **Vertex shade.** The `top` mesh carries a vertex colour (`COLOR_0`, grey 0.70 to 0.88, `SHADE` in `make_family.py`) on its collar, placket, yoke and pleat; the page's tint multiplies it, so the details are a little darker than the shirt in every tint. Only the top has one. The loader turns `vertexColors` on by itself.
- **Hair.** The hair's roughness is 0.9 (was 0.62, 0.6 in the file): the crown no longer takes a bright specular patch that can pass for skin under a strong light seen from above. The crown's geometry was re-checked: `tests/people-hair.test.ts` casts rays straight down over a 6 cm disc round the highest point of the skin, at the bind pose and in Idle, Walk (two frames), Jog and Sitting, for the four people and both tiers (the first file and `-low`), and requires the hair above the skin in every cell with at least 4 mm between them (least found: 7.7 mm). No bare cell was found in any pose or tier, so the owner's patch was not reproduced; if it shows again it is not the cap's geometry.
- **Tools.** `ring_strip`, `band_across`, `append_mesh` in `make_family.py`; `tools/refresh-people-lock.mjs`.

#### 16.6.10 More people in the home (16 Nov 2026)

The owner: "Currently only 1 person here, have the ability to add another person as well." A buyer can add people besides the walker. They are for size and space (can two of us pass here, does the grandmother sit comfortably, how does a child lie on this bed), not for company.

**What a buyer can do.** From the HUD person button, the "Who's walking?" sheet has **Add a person**. It opens the same sheet reused ("Add a person": who (man, woman, elder, child), skin tone, exact height, **Place them**). Then one tap places them: the floor stands them there, a sofa or a drawing's chair sits them ("Sit here"), a bed lies them ("Lie here"), the same poses and sizes as the walker (`core/poses.ts`: a 150 cm grandmother sits and lies at her own size). Tapping a person opens their card: who, height, how they are posed and how they fit the piece, with **Stand / Sit / Lie** (the nearest bed, sofa or chair within 2 m, else a line saying to use Move), **Move**, **Change person** (the same sheet, live), **Follow me** (a companion walks after the walker at their own pace, 1.05 to 1.6 m behind; the elder at 0.62 of the man's), **Become this person** (the walker takes their body, height and place; the old walker stays where they stood as an added person; a seated person's replacement stands beside the seat) and **Remove**. Esc closes the card or the placing.

**Placement rules** (`people/model.ts`, pure, tested). A standing person needs free floor for their shoulder width (`SHOULDER_RATIO` 0.245 man, 0.225 woman, 0.235 elder, 0.215 child, times height), nudged at most 30 cm from the tap; not on another person, not within a body of the walker, and not in a door's or wardrobe's swing (the swing sentence of `wardrobe-hooks.swingNoteFor` is the refusal). A second person on a bed or sofa takes the nearest free spot (the other half of a bed 120 cm or wider, the next seat of a sofa, 50 cm apart; a chair or a narrow bed takes one); a full piece says so. A sitting or lying person follows their piece when it is moved, turned or resized (`carryApproach`), and gets up when it is gone.

**Size and space.** A standing person adds a box of shoulder width by chest depth to the walk grid as the temporary obstacle `people` (`store.setTemporary`: not an item, not saved, absent from `drawnGrid()`), so the walker, a door's leaf and a wardrobe's shutters (`wardrobe-hooks.withExtraObstacles`) meet them like a body. Sitting and lying people add nothing of their own (the sofa or bed already blocks). The measure tool hits them (their meshes are `extraTargets` of `ctx.raycast`; the contact disc is not pickable). **Can two people pass:** when the walker comes within 1.15 m of a standing person in a place that is under 1.6 m wide across the line between them (measured on the plan with nobody in it), a card gives "Two people can pass here" (shoulders add up to at least 10 cm less than the passage), "Tight. Two people can just pass" (they fit with less than 10 cm to spare) or "Two people cannot pass here", with the numbers ("Passage 86 cm wide. You 43 cm + Woman 36 cm = 79 cm of shoulders."). When the walking controls (a 44 cm circle) need more floor than two real bodies do, the card says that the walker stops and that in person you would turn sideways. Shoulder widths are typical for each person at their height, and the card says so.

**Behaviour.** Standing people use the walker's idles (breathing, a glance after 8 s, arms folded) and now and then shift their weight (a turn of 22 to 52 degrees with the stepping clip, every 9 to 25 s; the saved heading does not change). Seated and lying people use the seated and lying clips.

**My layout.** People are part of the version 2 overlay of 16.2/16.16, beside the moved originals and the fittings. In this browser they are the `people` list of the one `walkthru:<scene>:mine` value (a layout with only removed pieces and looks is still written as version 1, so nothing else changes). In the link they are the optional field **`h`** ("humans") of a `?my=2.` code: rows `[body, tone, cm, x cm, z cm, yaw x10, pose, host?]`; a person on a piece the viewer added carries `#n`, that piece's place in the link's own `a` list; a host is a piece of the home that is still there, or a drawing's chair (`seat:`) or fixture (`fx-`). (`p` is edit-all's moved originals and `x` its fittings.) A `1.` or `2.` link without `h` opens as before. The chip "Your layout · edited" shows while anyone is added; **Reset to the home as drawn** clears people with everything else. `store.attachPeople` is the whole of the store's part (`initialPeople()` for what the layout opened with, and a notify function that saves and tells the chip). People are never part of the home: the rooms sheet says "N people added by you. Not part of the home." The AI photo is taken without them.

**Tapping.** People go through the page's one hit test (`ctx.pickAt`, 16.16): it returns `person` as well as `item` and `fitting`, and the nearest of the three wins, so a person standing in front of a sofa is the person and the sofa behind them is the sofa. People are picked only while walking, never in Furnish (pieces are edited there, people are not). While placing a person, a tap places.

**On the second catalogue's pieces** (`people/model.ts hostActionOf`, from `core/pieces.ts`): a person sits on a swing (hung, framed, or a hanging chair), a recliner, a sofa bed, a bar stool, an office chair or a balcony chair, and lies on a diwan, a bunk bed, a storage bed or a yoga mat, with the walker's own poses (`swingSeatPose`, `chairPose`, `seatPose`, `liePose` through `piece-actions`). A fridge, a basin or a WC takes nobody. A 2-seater swing has a seat at each end (35 cm off centre), a 3-seater three; a basket or a stool takes one. People on a swing **ride with it**: when only they sit on it the seat and chains rock as a pendulum (`swing-motion.ts`) and each body goes with the seat (`Character.ride`); when the walker sits on it too, the walker's swing drives it and the others follow its angle. A person on a piece that is moved, turned or resized, whether the home's own (edit-all) or one the viewer added, goes with it; on one that is hidden or removed they get up where they were. Their bodies are the rebuilt ones of 16.6.9; a standing person's box still uses the shoulder ratios above.

**Clearance zones.** A zone (a swing's arc, a fridge door, a recliner's footrest) is read in Furnish, where added people are not counted (below), so they never make a piece "blocked". A person standing in a swing's arc is not flagged either: the zone is a statement about the home's floor, and people move.

**Furniture checks ignore them.** While furnishing, people do not block the grid and do not count in a placement check. When a piece lands on someone (or when furnishing ends) they are moved to the nearest free floor ("The woman stepped aside."), or, with no room, the card says a person is standing there.

**Performance.** Each person is a skinned body of their own, so: the **light bodies** (`person-*-low.glb`) on the low and medium tiers, the full ones on high; **caps** of 2 (low), 3 (medium) and 5 (high) added people, the rest staying in the layout and the link and named in the rooms sheet; bodies are loaded only for the people added, the six clips parsed once and shared; a person outside the camera's view, or behind a wall (a grid ray, redone every 0.3 s and at once when the camera moves), is not drawn and updates at 4 Hz, one beyond 7 m updates at 15 Hz. First person works as before: you see the others, not yourself.

**Debug hooks.** `__walkthru.people.model` (`place`, `move`, `setPose`, `change`, `remove`, `become`, `setFollow`, `list`, `stats`, `ready`) and `.ui`.

**Tests:** `tests/people-model.test.ts` (caps, widths, placement, second person on a piece, poses at other heights, pass verdicts and card, the v2 overlay with moves, fittings and people in one link, old links, junk links, the store's part, a person in a wardrobe's swing), `tests/people-manager.test.ts` (real bodies: tiers, poses, Become this person, furniture moved from under people, the new pieces (recliner, stool, office chair, swing riding, diwan, bunks, storage beds), moved and edited originals, My layout kept and reset, following, idling, drawing less, the passing card), `tests/doors.test.ts` (a person in a door's swing).

### 16.7 C11c: painterly mode ("a painting of your future home")

Second priority. **New files:** `vendor/oilpaint/**` (the vendored MIT files, unmodified, plus the upstream `LICENSE` and a `VENDOR.md` naming the commit; moved out of `src/look/painterly/vendor/` by the C11c brief), `painterly/vendor.d.ts` (type shim for the exports we call), `painterly/adapter.ts`, `painterly/palettes.ts`, tests.

- `palettes.ts` (pure): for each surface colour (sampled wall, floor, frame, each furniture material's mean colour) produce the kit's three mixes: light, middle, shadow, as the colour in OKLCH at lightness +0.08, 0 and -0.14 with chroma × 1.1 in the shadow. Sampled colours stay the middle mix (rule 2 holds in the painting too).
- `adapter.ts`: `createPainting(viewer, shell: THREE.Group, furniture: THREE.Group[], palettes): { render(): void; dispose(): void }`. Feeds the shell's floor, wall and ceiling faces and each furniture group's geometry to `createKit`, with grain along the wall's length for walls, along the tile grid for floors and along the long axis for furniture; lights them with a `light` GLSL function driven by the current sun direction and colour; draws through the painter's own frame (`createFrame`). The character is hidden.
- Behaviour: the painterly button freezes the camera where it is and shows the painting. High tier: live, the buyer can orbit. Low and medium: paint **one frame** and show it as a still (the reference measured 4.5 ms a frame on an RTX 4090, far too heavy for a phone to run continuously). "Save picture" downloads a PNG with a one-line caption strip: "A painting of {title}. Illustrative." "Back" returns to the walk-through.
- The implementer must read `kit.js` and `shade.js` first: the exact shape of `shared` (`createShared`) and of the `light` function is defined there and is not restated here.

#### 16.7.1 As built (C11c, 13 Nov 2026)

- **Where things are.** The vendored files are at `vendor/oilpaint/` (not `src/look/painterly/vendor/`): `src/oilpaint/*.js`, `src/night/kit.js`, `src/world/noise.js` (kit.js imports it), `LICENSE` and upstream's `LICENCE-NOTES.md`, byte for byte from commit `804c65fa...` (Release 1.1.3), with `VENDOR.md` (provenance, licence position) and `vendor.lock.json` (SHA-256 of each file; `tests/painterly.test.ts` fails if one changes). MIT code, CC0 art (none of the art is used); commercial use is allowed; the licence text also ships at `/look/OILPAINT-LICENCE.txt`. Our code is `src/look/painterly/`: `palettes.ts` (pure), `caption.ts` (pure), `adapter.ts`, `person.ts`, `index.ts` (session and overlay), `painterly.css`, `vendor.d.ts` (type shim). The only edits outside are `Look.holdFrame(fn)` (look.ts, hands the frame to the painting and back), the lazy `import()` and the debug hooks in `buyer/main.ts`.
- **It is the real renderer**, not a filter: the kit's strokes lie on our own triangles (shell by `kit.tri`, one grain per face: along a wall's length, along the tile grid on floors and ceilings, grout lines as dark strokes; furniture by `kit.add` along each mesh's long axis), the sun is `createShade`'s depth picture of our shell and furniture drawn from the sun (the painted sun patch has the walk-through's shape), window glass is a glowing sky palette ("View outside is illustrative"), `createFrame` gives the canvas. The painter's `light` function (`adapter.ts`) is sun through the shade picture, a window sky-fill, a little ambient, warm light and cool shade tints. Palettes are the sampled colours (finishes, per-room colours, each furniture material's base colour) through `palettes.ts`; strokes are laid at 0.9 of the sampled colour because the painter brightens its own streaks.
- **The person is painted too** (the build brief asked for it; SPEC 16.7 said hidden): a flat underpainting on a `SkinnedMesh` that shares our character's geometry and skeleton, plus `pinDabs` on skin (only where no clothing is near), top, trousers, shoes and hair, in the walk-through's colours; he casts a shadow through the painter's figure-shadow picture. `createPainting(..., { person: false })` leaves him out.
- **Behaviour.** The sun-button panel's "Show as a painting" opens it. The walk camera is never moved: the painting has its own camera copy, the page's walking and HUD are blocked while it is open, "Back" (or Escape) restores everything. High tier: live; drag to look round, wheel to zoom, pixel ratio capped at 1.25. Low and medium: one frame, kept as a 2D canvas, the painter's GPU memory freed at once. "Save picture" downloads `painting-<title>.png` with a caption strip "A painting of {title}. Illustrative."; the same caption chip ("Painting · Illustrative") is on screen. The painting is of the layout model: with a scan shown it still shows the model, not the scan.
- **Weight.** `painterly-*.js` is 49.2 kB (19.7 kB gzip) plus 1.6 kB CSS, a separate chunk fetched only on opening; the main chunk grew by 3 kB for the hooks. Nothing painterly is requested before the button (checked in a production build).
- **Known gaps.** (a) 16.8 check 16's number: mean absolute pixel difference between the realistic frame and the painting is 10 to 18 % (high 10 to 11 %, medium 14 %, low on a 412 x 915 phone 18 %), not above 20 %. Two thirds to 86 % of pixels do differ by more than 10 %. The flats' default finishes are near white, so a painting that keeps the sampled colours is close to the realistic frame in mean colour; the strokes differ, the average does not. (b) Both scenes use the default finishes (nothing in either is sampled yet), so the sampled-colour path is exercised with defaults. (c) Default-wall paintings read pale and chalky; richer finishes read better. (d) The painter's own sun-shaft pass is off (`uShafts = 0`). (e) The hour and tier cannot change while a painting is open; reopen it.

### 16.8 Acceptance (browser-verifiable)

Drive headless Chrome with the existing script `/private/tmp/claude-501/-Users-mahir/10d10097-55f5-4fe7-877e-aab11a5f6ecb/scratchpad/cdp/cdp.mjs` (copy it into `tools/cdp.mjs` first; the scratchpad is temporary). The buyer page gains debug hooks under the existing `window.__walkthru`:

```ts
__walkthru.look = {
  stats(): ReturnType<Look['stats']>;
  setTier(t), setHour(h), setTrueColours(on), paint(on);
  /** mean sRGB of a screen rectangle, read from the canvas */ sample(x0, y0, x1, y1): [number, number, number];
  /** screen position of a world point, or null if off screen */ project(x, y, z): [number, number] | null;
  ready: Promise<void>;   // resolves when the tier's assets are in
}
```

**Always (`npm test`, headless):**
1. `floor-ao`: on the truth grid, AO at 5 cm from a wall is at most 0.72, at 1 m is at least 0.98, and under the furnished variant's bed footprint edge it is under 0.8; values are monotonic with distance.
2. `sun`: at 16:30 the elevation is between 20° and 35°; with north unknown on the truth flat, the sun direction's horizontal part points from outside into the bedroom through the sliding opening (dot product with that opening's inward normal > 0.7); with `northDeg` set, azimuth at 12:30 is 180° ± 1°.
3. `fitModelToBox`: `sofa_02`'s size to the 2.10 × 0.90 × 0.85 catalogue sofa is accepted; `sofa_03`'s and `dining_table`'s sizes are rejected.
4. **Size truth:** for every catalogue item, in both `plain` and `real` styles (with models replaced by boxes of the models' real sizes), the built group's world bounding box matches the item's `Box` footprint within 1 cm and its `heightM` within 1 cm (sofa: seat within 4 cm of `surfaceHeightM`). Every existing test still passes with zero changes to `core/`.
5. `palettes`: the middle mix equals the input colour within 1/255 per channel.
6. `buildShell(layout)` with no options produces the same material types and colours as before (snapshot of names, colours, roughness).
7. `quality`: the renderer strings `Mali-G52`, `Adreno (TM) 506`, `SwiftShader` give low; `Apple M2` with a fine pointer gives high.

**In the browser (local dev server, then the live site), each on `test-flat-empty` unless stated, each scripted through CDP with a screenshot saved to `shots/look/`:**
8. **Sun patch:** at 16:30 on high, the floor just inside the sliding opening (sampled around the projection of (2.0, 0, 0.8)) is at least 1.4 times brighter than the floor at (0.6, 0, 4.4) in the room's far corner.
9. **Contact AO:** on low, with "True colours" on, the floor 5 cm from the west wall is 10% to 40% darker than the floor 1.2 m from it.
10. **A view, not a blue card:** looking out through the window from inside, the pixels inside the window's projected rectangle have a luminance standard deviation above 12 (0 to 255 scale), and are not the old `#CFE8FF`.
11. **Colour truth:** with "True colours" on, the mean colour of a wall region in open view is within 12% per channel of `finishes.wallColor`, and the floor region within 15% of `finishes.floorColor`. Repeat on the `son-bedroom` scene with its sampled finishes.
12. **Glossy floor:** on medium and high, looking toward the window at a low angle, the floor region below the window is at least 15% brighter than the same region on low.
13. **Scan untouched:** on `test-flat` with the scan shown, `renderer.toneMapping` is `NoToneMapping`, no composer is active, and a screenshot of the scan region differs from the pre-C11 build by less than 2% mean absolute pixel difference.
14. **Furniture and labels:** placing a sofa on medium shows the model, its footprint outline coincides with the model's visible base within 2 cm on screen-projected corners, the verdict text is identical to the pre-C11 build for the king-bed case of section 10, and the string "Furniture style is illustrative. Sizes are exact." is in the DOM. "View outside is illustrative." and the light label are in the look panel.
15. **Character:** at 160, 175 and 190 cm the figure's skinned bounding-box height equals the chosen height within 1 cm; sitting on the catalogue sofa, the hips bone is within 5 cm of the seat point; lying on the king bed at 190 cm still reports "Tight fit. Only 8 cm to spare."
16. **Painterly:** the button produces a frame whose pixels differ from the realistic frame by more than 20% mean absolute difference, the saved PNG has the caption strip, and "Back" restores the walk-through with the same camera.
17. **Frame rate, measured on the live site** (`walkthru-ivory.vercel.app`, after deploy) through `__walkthru.look.stats().fps` averaged over 5 seconds of walking: high at least 55 on the desktop; medium at least 50 and low at least 30 under Chrome's mobile emulation at 412 × 915 with 4× CPU throttling. Emulation does not model a phone GPU: a real mid-range Android phone must also be tried by hand before calling the low tier done.
18. **Weight:** network bytes for look assets after `ready`: low at most 1.8 MB, medium at most 9 MB, high at most 22 MB; the `postprocessing` and `n8ao` chunks are not requested on low or medium.
19. **No regressions:** checks 1 to 10 of section 10.2 still pass on each tier.

### 16.9 Chunks

- **C11a** (lighting, materials, HDRI, tiers, look panel): start now. Owns 16.5. Acceptance 1, 2, 6, 7, 8 to 13, 17 to 19.
- **C11b** (real-looking people and furniture): after C11a merges (it uses the material cache and `Look`). Owns 16.6. Acceptance: 16.6.6, plus check 4 of 16.8.
- **C11c** (painterly): after C11a, alongside C11b. Owns 16.7. Acceptance 5, 16.

Integrator edits outside the chunks' files: the two npm dependencies; a `"fetch:look": "tsx scripts/fetch-look-assets.ts"` script; a `Cache-Control` rule for `/look/(.*)` in `vercel.json` (one day, like `/characters/`); the mount calls named above.

### 16.10 Risks

1. **None of this has been rendered.** Light intensities, AO strengths, roughness ranges and the detail-multiply clamps are starting values to tune by eye against checks 8 to 12.
2. **The starter man could not be downloaded here** (Git LFS). Its bone names, material slots and suitability are unknown, and its copy in that repo has no textures. The plan has gates and a fallback to the current mannequin; a realistic human is the least certain item in this section.
3. **Poly Haven texture paths:** the API lists texture JPGs under each asset's glTF folder; the standalone `Textures/jpg/1k/…` path was not fetched. The fetch script tries both. MD5 values are from the API; SHA-256 values are recorded on first fetch, not known in advance.
4. **Planar reflections with the post-processing chain** are fiddly. The fallback (cube map on high) is specified.
5. **`postprocessing` and `n8ao` with Spark** are untested; the look turns both off whenever a scan is visible, which also satisfies the honesty rule.
6. **Warm light changes how colours look.** That is intended and is why "True colours" exists; check 11 is run in that mode. If reviewers find the default too warm to trust, change the default hour, not the tone mapping.
7. **An HDRI cannot show the property's real view** and a rooftop in another city is plainly not Bengaluru or Mumbai. The label covers it; a broker-supplied balcony photo as the backdrop is the obvious next step and is not in scope.
8. **Mobile fps targets under emulation are not proof.** A real mid-range Android phone is needed.
9. **Repo size grows by about 30 MB** of committed CC0 assets (the three 2k HDRIs are 18 MB of that), so the live site can serve them.
10. **Benglooru's look was not seen**, only described.

### 16.11 Kit: the fittings of an Indian flat (look-kit)

Rooms used to be empty white boxes with a generic tile. `src/look/kit/` adds the fixtures that make a space read as an Indian home. It is **decor under 16.2**: the kit lives in its own group (not under the shell or the furniture root), no ray can hit it, nothing in it feeds a measurement, a fit check, a clearance or the collision grid, and the shell's floor meshes keep their geometry (only the material changes), so areas are unchanged. Everything is "typical of Indian flats, not from your drawing": the rooms sheet and the look panel both say "Fan, lights, switches, grills and tiles are typical fittings, not from your drawing." When the drawing gives a finish, it wins (a tile that is not the 600 x 600 default is used as drawn, a drawn plain floor has no grid). **No kit is placed in a `partial` room.** A "Plain" switch in the look panel (and True colours, and a scan shown) removes all of it and restores the old floors and railing.

- `rules.ts` (pure, tested): where things go. Fan: centre of each bedroom and living room of 7 m2 or more, ceiling 2.4 m or more, lowest point 26.5 cm under the ceiling (the follow camera stops about 30 cm under it). Tube: a 1.22 m batten at 2.05 m on the longest wall that has a free stretch (clear of openings and of furniture taller than the batten's height). Switchboards (120 x 200 mm plate, four rockers and a socket) at 1.2 m beside each door on the latch side (the side with more clear wall, ties to the higher side, the other side when there is no room), none inside bathrooms, and one at 1.1 m by each bed head. Grill and mosquito-mesh frame on every window; the balcony's solid railing is replaced by an MS one inside the same footprint. Cove: a 0.45 m wide, 0.3 m deep drop with a hidden LED strip in living rooms and the master bedroom, only where the ceiling minus 0.3 m is still 2.4 m or more (so not under the 2.6 m ceilings of the sample flats). Skirting 100 mm along walls. Floors: square tiles aligned to the room's longest wall and started whole at a corner, 800 mm in rooms of 12 m2 or more with a short side of 3 m or more, 600 mm otherwise, 300 mm anti-skid in bathrooms, 600 mm matt on balconies.
- `build.ts`: low-poly geometry merged by material (about a dozen draw calls for a flat; the fan blades are one instanced mesh that turns slowly, still under reduced motion). `materials.ts`: the kit's few materials. `index.ts`: `mountKit({ viewer, layout, shell, look, store })`, one call from `buyer/main.ts`.
- Floors are a look-material feature (`floorKit` in `look/materials.ts`): the shader draws the room's own grid, a thin grout line at least a pixel wide, a per-tile tone shift of about 6 % around the sampled colour, and the marble detail per tile.
- Lights: the glowing parts carry `userData.walkthruLight = 'tube' | 'cove' | 'fan'` and are off (emissive 0) by default. `mountKit(...).setLit(kind, on)` drives them.

### 16.12 look-light: time of day, grade, plain sky, interior lights (13 Nov 2026)

This section supersedes the parts of 16.5 it names (tone mapping, sun and time of day, "Outside the windows", bloom) and the 16.2 rule 4 wording of the view and sun labels. Everything else in 16.5 stands. Files: `src/look/grade.ts` (pure), `interior.ts`, `sky.ts`, `post.ts`, `look.ts`, `look-panel.ts`, `quality.ts`.

**Presets.** One slider (6:00 to 21:00) and four presets that are four hours of it: Morning 8:30, Afternoon 15:00, Evening 17:48 (golden hour), Night 20:30; plus the neutral "True colours" switch (unchanged: white light, linear, nothing graded, sun and lights off). `grade.ts` holds one table of keyframes (sun colour and strength, sky half and ground half of the ambient light, exposure, window sky, white balance, saturation, contrast, split tone, bloom, vignette, how far the interior lights are on) and a smooth blend between them (`gradeAt(hour)`). The default is **Afternoon** (`DEFAULT_PRESET`), chosen because it is bright enough to read every room and keeps the colours close to the finishes; Evening is one tap away and is the "mood" shot. `look.json` may set `preset` or `hour`; `?preset=evening` overrides both for checking. `Look` gains `setPreset(p)`, `preset` (null between two presets) and `grade()`; `setHour` takes 6 to 21.

**Sun direction.** The importer and the understand step record no north arrow anywhere (checked 13 Nov 2026), so today every flat takes the unknown-north path of 16.5 (the sun enters through the widest outdoor opening, sweeping with the hour). Only `look.json` `northDeg` gives a known north. The look panel therefore shows, whenever north is unknown: "Sun direction assumed: the drawing has no north arrow." (replaces "Light direction is illustrative."). With `northDeg` set it says "Sun direction is approximate." Sunlight comes through the real window openings: the wall boxes cast the sun's shadow map (medium: one static 1024 map re-rendered on change; high: 2048, filter radius 4, every frame; low: none). After 19:06 the sun is off and nothing casts a sun shadow.

**Tone mapping and grade.** ACES filmic (`THREE.ACESFilmicToneMapping`, or `ToneMappingMode.ACES_FILMIC` in the high chain), picked by looking at the same son-bedroom view under all three: AgX was muted and hazy, Neutral turned the golden hour a flat garish orange, ACES kept a warm vivid light with a creamy window. Compare with `?tonemap=agx|aces|neutral`. The high chain is render, N8AO, then one effect pass: exposure and per-preset white balance, bloom (threshold 0.95 with a soft knee, so only windows, lights and the sun patch glow), tone mapping, then a grade effect (saturation, contrast about 18% grey, cool tint in the shadows and warm in the highlights: the ochre and teal of the reference). Medium and low have no post chain, so the same mood comes from the light colours themselves (warm sun, cool sky fill, floor-coloured bounce) and the tone mapper. The vignette is a CSS gradient over the canvas on every tier (free, never touches canvas pixels). Interior bounce: the hemisphere's ground half takes the floor colour (`finishes.floorColor`) mixed with the sun tint, so a red floor warms the walls, and N8AO and the grid AO stay. Sizes, geometry and the sampled finishes are never touched (rule 1 and 2 of 16.2); "True colours" is still the colour-truth mode.

**The view outside (honesty fix).** The invented city picture is gone from the default. The window shows a plain graded sky made in code (`skyPixels`: zenith, mid, horizon, a soft haze below the horizon with no hard line, and a broad glow towards the sun), used as the background and (medium, high) the PMREM environment. It costs no download (the three `view_*` pictures and HDRIs stay in `public/look/` but are only used when `look.json` names a `backdrop`, a broker's own choice). Label: "Outside the window is a plain sky, not the real view." (look panel, and the 3-second toast when a window first fills 8% of the screen).

**Interior lights, the API for fixtures.** A fixture declares itself by scene-graph convention: `object.userData.walkthruLight = 'tube' | 'cove' | 'fan' | 'lamp'` on a Mesh, a Light or a Group (a group's meshes and lights follow its kind unless they declare their own), or with `look.registerInteriorLight(obj, kind)` which sets it for you. `look.refreshInteriorLights()` rescans; `attach()`, `refresh()` and `setLayout()` rescan on their own, so fixtures added to the shell or furniture root before `look.attach({ shell })` are found. What the time of day then does, with `level` 0..1 from `grade.interior` (tube, fan and lamp follow the tube level; cove its own: 0 in the morning and afternoon, about 0.25 tube and 0.5 cove in the evening, 1 at night):
- a Mesh: `material.emissiveIntensity = fullOn * level` (`fullOn` is the value the material had when first seen, so set `emissive` and a full-on `emissiveIntensity` and leave the rest to the look);
- a THREE.Light: `intensity = fullOn * level`, hidden at level 0;
- a small POOL of real point lights (0 on low, 2 on medium, 4 on high) that moves, with a 0.25 s fade, to the fixtures nearest the walker, preferring the walker's own room, so a flat of 30 fixtures costs the same as one of 3. The pooled light sits at the fixture's world bounding-box centre, lowered to just under its bottom face (for a cove at the top of its box); for a long strip or a ring, tag one small empty `Object3D` at the spot you want the light and set `userData.walkthruPool = true` on a THREE.Light you want pooled instead of driven.
With no tagged fixtures at all, each non-balcony room gets one virtual ceiling light so Evening and Night still light the rooms. The low tier has no real lights: it lifts the ambient warm by the lamp level instead. Pooled lights cast no shadow (a wall does not stop their floor pool: acceptable for a stylised view, and they prefer the walker's room).

**Phone cost.** No new download on any tier (the sky is generated, 256 x 128 half-float). Low: no shadows, no post, no real interior lights, CSS vignette. Medium (the usual phone tier): one static shadow map as before (re-rendered only when the hour or furniture changes), up to 2 pooled lights only in Evening and Night, no post. High: the extra grade effect is a handful of ALU per pixel on top of the old exposure pass.

### 16.13 Style generators, packs and the design sheet (14 Nov 2026)

Furniture used to be generic low-poly boxes with flat colours. The look of an interior designer's work is now a **product feature**, not a one-off: parametric generators (`src/look/gen/`), data-only style packs (`src/look/packs/*.json`), and an optional per-home design sheet (`public/scenes/<id>/design.json`). Nothing in it knows any one drawing, and no reference image, crop or client name is in the repository. 16.2 still outranks it: **sizes are untouchable** (a pack, a sheet and a generator have no field that could change one), decor is labelled, "True colours" and "Plain" still show the bare truth.

**Generators** (pure functions `(env, size, params, roles) -> THREE.Group`, metres, in the item's frame; `size` is the item's box and heights, never invented; each mesh carries `userData.walkthruPart`, a stable name, and plain exportable geometry with normals and world-scale UVs, so the GLB export and the baked lighting see ordinary meshes). `furniture-real.ts` calls them when the active pack is not Classic; Classic is today's 16.6.5 builders, unchanged.

| Kind | Params |
|---|---|
| wardrobe | `bays` (0 = from width), `shuttersPerBay`, `loftM`, `plinthM`, `drawerStripM`, `shutterStyle` flat / framed / fluted-strip / louvred, `handle` bar / long-bar / knob / groove, `handleYM`, `handleLenM`, `fluteBand`. One shutter is built by `addLeaf` at its hinge, so the closed wardrobe and the openable model (`wardrobe-model.ts`, one pivot per shutter at the spec's hinge) use the same code: flutes and handle swing with the leaf, hinges, widths and arcs are the drawing's. |
| bed | `base` platform / box / legs, `headboard` panel / upholstered / slatted / none, `baseTopM`, `pillows`, `cushions` (striped), `duvet` quilted / plain / none (draped height field with a turned-down fold). |
| sofa | `seats`, `arms` round / box / none, `legs` wood / metal / plinth, `chaise` auto / none / left / right (an L when the box is 1.3 m deep and 2.2 m wide), `cushions`. |
| bench (window seat, storage bench) | `shape` rect / curved-end / curved-both, `cushion`, `radiusM`, `curveSide`. |
| study, side, dresser (TV unit), counter, dining | top, pedestal, drawers, handle (groove / knob / bar), base, shutter style, chair and leg styles. |
| decor (wall or floor frame, never in the item list) | curtains (sheer + drape on a ceiling track, folds shaded in the vertices), rug (pile height), split AC, recessed downlights and brass bowl wall lights (tagged `walkthruLight = 'lamp'`), wall panelling (raised boards with fine grooves at a pitch), slatted feature wall, ceiling band. |

Edges are chamfered (44 triangles a box, flat normals so a light catches them), fluted strips are real ribs in one strip geometry (62 % rib, flat valley, no normal-map trick), wood grain follows the part's long axis (`grainUV`), repeats are merged by material (one mesh per name and material). Per-piece triangle budgets are in `tests/gen-furniture.test.ts`; a home measured with every group visible: Son Bedroom 19.8k / 47.3k / 59.5k triangles at low / medium / high, the sample 2 BHK 32.0k / 59.4k / 75.7k, so a phone tier home stays far under 150k.

**Materials.** New kinds in `furniture-materials.ts`: `wood` (Poly Haven `oak_veneer_01`, CC0, diff + normal + ARM, used as detail around any tint so one grain serves oak, ash, walnut), `laminate`, `gloss`, `paint`, `weave` (existing `rough_linen`), `quilt` (`cotton_jersey` + a diamond-quilting normal map), `shag` (Poly Haven `curly_teddy_natural`, CC0), `stripe` (cushion ticking), `brass`, `blackMetal`, `sheer`, `drape`, `lamp`. Fetched through `scripts/fetch-look-assets.ts` (MD5 checked against the Poly Haven API, recorded with SHA-256 in `public/look/assets.lock.json`); the two maps no CC0 set gives (`tex/gen/quilt_nor.jpg`, `tex/gen/stripe_diff.jpg`) are drawn from formulas by `scripts/make-gen-textures.ts` and recorded under `derived`. Textures are fetched lazily, only the ones a live material uses, and not at all on the low tier. The floor stays the look shell's glossy marble-detail tile, recoloured per room; glass, paint and laminate need no texture.

**Style packs** (`packs/*.json`, loaded and checked by `loadPack`): `roles` (role name to finish id, `src/look/finishes.ts`), per-kind generator defaults, the room's wall / floor / ceiling finish ids, and which typical decor it adds (`decor.rug`, `decor.curtains`). Shipped: **Light Scandinavian** (the default for a home with no sheet), **Warm Oak & Navy** (matched by eye to the reference look), **Walnut & White**, **Classic** (today's look). Finish ids and colours are one table in `finishes.ts`; furnish-edit's palette merges into it.

**Design sheet** `public/scenes/<id>/design.json`, optional, data only, no sizes, no names:

```json
{ "version": 1, "pack": "warm-oak-navy", "source": "designer-renders",
  "items":   { "wardrobe-1": { "params": { "shutterStyle": "fluted-strip", "handle": "long-bar" }, "roles": { "case": "oak" }, "finish": { "primary": "oak" } } },
  "rooms":   { "son-room": { "wall": "wall-beige", "floor": "tile-beige-gloss" } },
  "fixtures": [ { "kind": "slat-wall", "roomId": "son-room", "edge": 1, "u0": 0, "u1": 2.85 },
                { "kind": "rug", "roomId": "son-room", "aroundItem": "bed-1", "margin": { "foot": 0.75, "side": 0.55 } } ] }
```
Fixture kinds: `curtain`, `rug`, `ac`, `downlights`, `bowl-lights`, `panelling`, `slat-wall`, `ceiling-band`, `window-seat`. Wall fixtures are placed by room, polygon edge and distance along it (`u0`, `u1`), in the wall frame of `computeEdgeFrames`. `parseDesignSheet` reads leniently (unknown finish ids, bad or out-of-range params, sizes and malformed fixtures are dropped, never thrown). `source: "designer-renders"` is what makes the UI say "from the designer's renders"; any other source says "from the design sheet" or "typical". Two sheets ship: `son-bedroom` (Warm Oak & Navy, a generic reading of a designer's renders of that room) and `test-sample-3` (Walnut & White), to show the same generators carrying two different looks.

**Resolution order** (`style.ts`, `resolveLook`), strongest first, one value at a time, with its provenance kept (`drawing`, `viewer`, `sheet`, `pack`, `default`; keys `param:<name>` and `role:<name>`):
1. the drawing / elevation (`designs.json`: bays, shutters per bay, drawer strip, base gap, handle height, base height), for structure only. The fill colours on a drawing (`frontColor`, `handleColor`) are CAD fills, not finishes: they stay with Classic and never reach the generators. The drawn handle height is for the handle the drawing drew (a plain bar): a long bar centres itself on the fluted band instead;
2. the viewer's own per-item choice (`item.finish` from "Change look", look only): it wins over the sheet and the pack. `finishLayer` maps its slots as the palette labels them: bed Frame / Headboard / Bedding (and `style`: panel, upholstered, storage box are real shapes), sofa Legs / Fabric, wardrobe Shutters / Handles, table Top / Legs. A generated piece applies it itself and sets `group.userData.finishApplied`, so `furniture-finish.ts`'s colour pass stands down;
3. the design sheet, while the designer's look is on;
4. the pack; 5. the generator's own default.
The designer's look is on while the active pack is the sheet's pack. Picking another pack in the Style picker puts the sheet's finishes aside (the viewer asked for that pack), the viewer's per-item picks and the drawing's structure stay. Labels: `provLabel`, "from the drawing", "your choice", "from the designer's renders", "typical finish (style pack)"; an item's card footer says them (`finishNote`), the look panel says them for the home.

**One palette.** `finishes.ts` holds the viewer's palette (`wood-oak`, `lam-navy`, `fab-teal`, `metal-brass`, `bed-sage`: stored in layouts and share links) and the style table (`oak`, `navy-matte`...). `finishDef(id)` resolves either to a colour and a material kind, so a pack or a sheet may name any of them. Door panels take their colour from the active pack's `door` role (`doorPanelColour`).

**Runtime.** The look panel gets a Style row (the designer's look when there is a sheet, then the packs; the choice is remembered per home; `?style=<pack id>` forces one for checks). A change rebuilds the furniture, the openable wardrobes' shutters, the decor, the lived-in layer (its curtains and rugs yield to the style's) and the rooms' wall and floor colours (applied only where nothing was sampled and the room has no colour of its own, 16.2 rule 2; the kit's floors are taken off and put back around it). Decor lives in its own group (`design-mount.ts`): no ray can hit it, nothing in it feeds a measurement, a fit check, a clearance or the collision grid, it is hidden by "Plain" and "True colours", and the look panel labels it "Curtains, rugs, wall panelling and lights are typical styling, not from your drawing." (or "...follow the designer's renders, they are not on your drawing."). Fixtures in a `partial` room are skipped.

**Known limits.** The grade (16.12) lights an interior with a single window dimly and cool, so floors read grey and navy reads saturated in the Afternoon preset where the reference render has global illumination; baked lightmaps (the bake pipeline) are the fix, not a texture. Brass has no brushed normal map; the AC and the fan are generic; the window seat is decor (not solid) because a seat that is not on the drawing must not block walking.

### 16.14 Baked lighting: soft bounce light, contact shadows and lamp pools for any home (14 Nov 2026)

Goal (Mahir's, for the product and not for one drawing): any home, on first load, should look close to an interior designer's offline render, whose realism is mostly bounced light and soft contact shadows. Today's light is one sun, one hemisphere and some AO, so rooms read flat. 16.14 adds an **offline bake** (one command, any scene, Blender) and a **runtime** that swaps its result in after first paint. **Baking changes only light.** No size, layout, collision cell, area or measurement reads anything of it (16.2 rule 1 and 2): a test asserts the layout, the collision grid, the carpet area and the shell's geometry are identical with and without baked data, and nothing under `src/core/`, `buyer/measure.ts`, `store.ts` or `rooms.ts` imports it. "True colours" is exactly unbaked and neutral; a scan shown, the Plain look, `?bake=off` and a home with no bake render exactly as before. While a bake is applied the look panel adds: "Lighting is simulated: bounce light and soft shadows are computed for this layout, not measured in the real flat."

**The command.** `npm run bake -- <sceneId> [--quality draft|final] [--presets afternoon,night] [--force] [--gpu] [--url <running dev server>]` (`scripts/bake-scene.ts`). Never part of `npm test` or the Vercel build: the outputs are committed assets in `public/scenes/<id>/baked/` (not ignored by `.gitignore`; `.cache/bake/` is). Needs Blender (`/Applications/Blender.app`, or `BLENDER_BIN`) and Chrome (or `CHROME_BIN`); the Mac now, the same command unchanged on a cloud machine. Steps:
1. **Dump the scene the app builds** (`scripts/bake/page.ts`, `src/look/baked/export.ts`): the real app boots in headless Chrome (`?bake=off&quality=medium`, vite started in-process unless `--url`), then `window.__walkthru.bake.exportScene()` returns every lit mesh of the shell, kit and furniture root in world space, with a stable key (names from the scene root down, `#n` for same-named siblings), the material's albedo (a white material with a canvas map takes the map's mean), per-vertex colours, emitters (`userData.walkthruLight`) and a checksum of its local positions. Not dumped: the walker, overlays, glass, veils, anything whose material writes no colour, instanced rotors, unlit (basic) materials, `userData.walkthruBake = 'skip'`. One source of geometry: nothing is rebuilt for the bake. (A raw dump rather than three's GLTFExporter, so vertex order is exact and the lightmap UVs can be written back to the runtime's own vertices.)
2. **Hash.** `inputsHash` = sha256 over the dump (meshes, buffers), the quality, components, light set-up, sun directions and the source of the pipeline files. Same hash and every file named by the manifest present: "up to date", nothing runs after the 17 s dump. The clock and the machine are not in it.
3. **Parity** (`src/look/baked/parity.ts`). The bake stops, with the mesh named, if a shell floor, ceiling or wall block differs from what the layout says by more than 1 mm, or a drawn furniture group sticks out of its box (plan or height, with the drawing's designs applied). Blender re-checks every mesh after building its bake scene (round trip, worst case recorded in the log).
4. **Lightmap UVs, in code** (`unwrap.ts`, `pack.ts`): triangles are grouped into charts (connected, normal within 25 degrees of the average; kit 80, movable 60), each chart is projected flat, rotated to its tightest rectangle, scaled to a texel density and packed (MaxRects) into one square atlas, 3 texels of padding. Density is tiered: floors and walls 1, ceilings 0.5, kit 0.6, surfaces that face no room 0.1; draft 16 texels per metre, final 40; the atlas is the smallest power of two that fits (density drops 15 % at a time if 2048 is not enough). Meshes made of thousands of tiny faces (window bars, railings, switch plates: mean chart under 3.5 dm2) are **not** lightmapped: they shade and bounce in the bake, and keep the old lighting. Vertices shared by two charts are split (a remap list ships with the UVs); positions are never touched.
5. **Bake in Blender** (`tools/bake/bake_blender.py`, `Blender -b -P`, one process, Cycles, OpenImageDenoise through the compositor): diffuse **direct + indirect irradiance** (no albedo; albedo still colours the bounce), one component per light group, so the runtime can mix them:

| component | what | unit of the stored picture |
|---|---|---|
| `sky` | uniform sky (radiance 1 above the horizon, 0.38 below: the ground's glow), through every window and opening (area-light portals on outdoor openings, only to cut noise) | irradiance of one unit of hemisphere light; then scaled so the 80th percentile of the floor equals 1.0 (the lit part of a room gets what the flat hemisphere gave every surface); the scale is in the file's gain |
| `sun0`, `sun1`, `sun2` | the sun of Morning 8.5, Afternoon 15, Evening 17.8, direction from `sun.ts` for this home (so the sun enters through the same window as the live sun), angle 1.6 degrees for soft edges | three DirectionalLight intensity 1 |
| `lamps` | tube lens, fan light (half), and a grid of recessed **downlights** (spot, 105 degrees, `planDownlights` in `lights.ts`: inset 0.5 m from the walls so each throws a scallop of light up the wall, 1.35 m apart, none in balconies or partial rooms) | scaled so the mean floor irradiance of a lit room is 1.4 |
| `cove` | cove LED strips, when the kit builds them | mean 0.9 |
| `ao` | static ambient occlusion (1.1 m), shades only the ambient fill | 0..1 |

Pictures are 8-bit WebP (lossy 88 or 90), value = gain x (byte/255)^2 (gamma 2 spends the bits on the dark half); `gain` is per file in the manifest. Written for two tiers: `medium` (full size) and `low` (half the texels); `high` uses `medium`.
6. **Probes and per-object AO** (same Blender run). An SH L2 light-probe grid (0.5 m on the plan, three or four layers, 0.75 m and 192 rays at draft): probes inside rooms are baked, the rest copy their neighbours. A probe collects, per component, the radiance of the room from the baked lightmap (rays against the room's triangles; a hit gives texel x albedo / pi, a miss gives the sky) **plus the direct light of every lamp analytically** (a 5 cm tube covers a thousandth of a probe's sphere, rays never find it), with one visibility ray each. The movable pieces get an **AO atlas of their own** (`dyn`): each furniture item (and decor group) is baked alone, on a ground plane, with nothing of the room around it, 0.45 m AO distance, into one shared atlas.
7. **Write** `public/scenes/<id>/baked/`: `manifest.json` (inputs hash, Blender version, samples, denoised, texel density, presets, seconds, sun keys, files with sizes and gains, calibration, fixtures, per-mesh entries `{verts, checksum, atlas, uvOffset, uvCount[, remap]}`, probe grid, totals), `geometry.<hash>.bin` (uint16 UVs, then the remap lists), `probes.<hash>.bin` (half floats), `<tier>-static-<component>.<hash>.webp`, `<tier>-dyn-ao.<hash>.webp`. File names carry a content hash: serve them immutable (`Cache-Control: public, max-age=31536000, immutable`); the manifest is fetched with `no-cache`.

**The static / dynamic split (the hard part).** Buyers remove, replace and recolour furniture and open doors and wardrobes, so the shadow of a loose piece must never be burned into the room.
- **Static** (the lightmap): the shell (floors, ceilings, walls, frames, thresholds) and the kit. The furniture, decor and door leaves are **not in the static bake at all**: the room is baked empty, so a removed bed leaves no ghost on the floor or the wall. A group can be declared fixed with `userData.walkthruBake = 'static'` (a real built-in that cannot be removed): it then lights and shades the room, and is lightmapped like the shell. Nothing is tagged today.
- **Dynamic** (everything under the furniture root, the design sheet's decor group, the door leaves (`door:<id>`, which are baked open: the rooms see each other), `kit:bedhead*`, the walker, and any piece added later; recolouring a piece needs no re-bake because no colour of a movable piece is in the bake): lit by the room's **probes** (the room's bounce, lamp light and sky, at the object's position, interpolated trilinearly), the **real sun** (still live, with its shadow map), and its **own AO** from the dynamic atlas when the mesh is the baked one (same vertex count and checksum; a rebuilt mesh falls back to probes alone). On the floor, a soft **contact shadow** under each piece comes from the collision grid (`floor-ao.ts`, furniture only, range 0.3 m, darkest 0.5): it is rebuilt from the live store, so removing a piece removes its shadow on the next refresh. The grid-AO of walls and the wall-edge darkening step back while a bake is applied (the bake has the real corners).
- Limits: furniture does not shadow or bounce into the walls or the floor beside it in the bake (a bed does not cast a soft shadow on the wall behind it; only the floor shadow and the probes' ambient); a piece next to a wall does not darken the wall; objects far from a probe cell centre get its interpolated light (about 0.5 m resolution), so a small lamp-lit pool on a table is smoother than it would be offline; a mesh the buyer scales or a generated mesh the bake never saw gets probes and no AO until it is baked.

**Runtime** (`src/look/baked/`). `mountBaked` (called from `buyer/main.ts` after the kit and decor exist, not when `?bake=off`, not with a scan) fetches the manifest after first paint (progressive: the current look first). Missing, an index page, broken JSON, another format version, another scene id, a short or undecodable file: state `absent` or `failed`, nothing is touched. Otherwise: UVs are given to meshes **by their stable key** (`assign.ts`; a mesh whose vertex count or checksum differs is rejected and left alone), the baked components are mixed per time of day by **one full-screen draw** into one half-float picture (`composite.ts`; one lightmap sample per pixel at any hour, redone only when the light changes), and two small shader patches (`patch.ts`) make baked surfaces take their diffuse light from it (hemisphere, environment and sun add nothing to their diffuse; the specular, the glossy floor's reflection and the sun's glint stay) and movable objects take their ambient from the probes (per object, set in `onBeforeRender`). A material shared with a mesh the bake leaves alone is cloned for the lit one. The look controller (`look.ts`, `setBaked`) drops the pooled point lights (the bake has their light), uses the furniture-only contact field and softens the high tier's screen-space AO. The weights (`weights.ts`) are the same for the lightmap and the probes: sky = hemisphere colour x intensity (warmed 55 % towards daylight white: a room's bounce is not the sky's blue) x 1.3, suns cross-fade by hour (Morning to Afternoon to Evening), no sun after 19.1, lamps follow `grade.interior.tube`, cove its own level, an ambient fill of 0.6 of the hemisphere light shaded by the static AO (a probe's fill x 0.55 to match). **Time of day:** all four presets and the slider work; a preset that was not baked (`--presets`) takes the nearest baked sun. **Tiers:** low = the half-size pictures + probes, no shadows, no pooled lights, and the real sun is not needed (its patches are in the lightmap); medium (the phone tier) = full pictures, probes, object AO, contact shadows, the static sun shadow for movable pieces; high = medium + the live sun shadow, N8AO at 0.55 strength, the planar floor reflection and bloom on the downlight discs and the tubes (the discs are the visible fixtures of the baked downlights, added at runtime and labelled with the kit's "typical fittings, not from your drawing").

**Sizes, times, how to re-bake.** Measured on the 8-core M2 Mac (8 GB, shared with other jobs: the load average was 15 to 160 during the long bakes, so a quiet machine should be 1.5 to 2 times faster), Blender only; add about 17 s for the scene dump:

| home | rooms | quality | Blender | samples | atlas | on disk (committed) | fetched on medium |
|---|---|---|---|---|---|---|---|
| made-up 2 BHK (`test-sample-3`) | 9 (2 toilets, balcony) | draft, 2 presets | 1.0 min | 48 | 512 px at 16 texels/m | 0.92 MB | 0.69 MB |
| the same | 9 | final, 4 presets | 10.6 min (sky 173 s, suns 3 x 79 s, lamps 154 s, AO 33 s, probes 25 s, object AO 53 s) | 160 | 1024 px at 40 texels/m | 1.50 MB | 1.15 MB (low tier about 0.5 MB) |
| a real single bedroom (one furnished room + two partial) | 1 | draft, 2 presets | 0.2 min | 48 | 512 px | 0.52 MB | 0.39 MB |

Rule of thumb: final is about 1.2 minutes per room per baked sun/lamp group at 160 samples, draft about 6 seconds per room; the cost is set by texels and samples, not by rooms. Each baked home adds 0.5 to 1.5 MB to the repo (webp pictures, 0.37 MB of half-float probes, 0.47 MB of UVs; well under the 3 to 8 MB budget), and the pictures never ship in the Vercel build's code chunks. A home with its geometry unchanged answers "up to date" in 20 to 30 seconds (the dump).

Parity finding on the merged style generators: the wardrobe's shutter handles stand 7 mm proud of the drawn box (an honest handle, but beyond the 1 mm rule): the bake takes `--furniture-tolerance-mm 10` for these homes and the default stays 1. The object-AO atlas matches the geometry of the medium tier only: the low and high tiers build other furniture meshes, so they keep the probes and lose the per-object AO (rejected by checksum, never mis-applied). A home whose design sheet has recessed downlights (`downlight-lens`) is lit from those points; rooms without get the planned ones. Re-bake after the furniture meshes change (a new style pack, `design.json`, a kit change, a layout edit): `npm run bake -- <id> --quality final` again; the hash notices by itself (any mesh change gives a different dump) and an unchanged home answers "up to date". Without a re-bake a changed mesh is simply rejected by name+checksum and falls back to the probes, so a stale bake never lights the wrong thing. `tools/bake/shot.js` is the CDP script used for the before and after pictures (`CDP_OUT=... node tools/cdp.mjs "<url>" tools/bake/shot.js`, env `PRESETS POS YAW NAME`).

**Tests** (`tests/baked-pure.test.ts`, no Blender, no GPU): manifest parsing and rejection of every kind of bad input, the hash and the skip decision, lightmap assignment by key and rejection of a changed mesh, geometry split, fallbacks of the runtime (missing, HTML, truncated, undecodable, ready), probe interpolation and component mixing, the packer and unwrap (no overlap, density, vertex split), parity logic (1 mm), the sun, downlights and portals of a sample home, and the honesty invariants above.

**Known artefacts and limits.** Draft pictures show faint blotches from denoising 48 samples on a 16 texel per metre atlas (final is smoother); the lightmap is bilinear, so the sun's edge is as sharp as one texel (2.5 cm at final); light can leak a texel through a wall corner where two charts meet; the sun patches cross-fade between the three baked hours rather than moving; wall-to-furniture contact (a wardrobe against a wall) darkens only the floor; the floor's gloss is the old reflection, not baked; the bake models a plain sky (16.2 rule 4 labels stay); a home with a partial room bakes it as a void.

### 16.15 The CC0 model library: professionally modelled furniture and props, at the size the home says (15 Nov 2026)

Goal: where a free, professionally modelled piece looks better than a generated one, use it, without ever letting a model decide a size. Nothing is bought: every model is **CC0** and the licence was read on the source's official page (Poly Haven: "Our assets are all licensed as CC0", https://polyhaven.com/license, read 15 Nov 2026; no credit needed, any purpose). 16.2 still outranks it: boxes, heights and surface heights are the home's, a model is decoration, and "True colours" and "Plain" still show the bare truth.

**Pipeline (repeatable).** `scripts/fetch-look-models.ts` (`npx tsx scripts/fetch-look-models.ts`) takes a list of Poly Haven slugs, asks the Poly Haven API for each file's size and MD5, downloads the 1k glTF set into a cache outside the repo (`~/walkthru-tools/look-models-raw`), refuses any file whose size or MD5 differs from the API (or, on a re-run, from the lock), and records source URL, author, licence page, date read and SHA-256 in `public/look/models/models.lock.json` and `public/look/models/LICENCE.txt`. `tools/optimise-look-models.mjs` (dev-only, needs gltf-transform, meshoptimizer and sharp in a scratch install, header says how) bakes node transforms into the vertices, puts the origin where the library expects it (floor models: centre of the footprint on y = 0; wall models: bottom centre of the back face on z = 0; front +Z), splits a model into named **parts** (by material, or by connected piece where the source has one atlas), drops glass, replaces slat-like pieces by boxes, simplifies each part for two tiers with the error bound raised only until the bounding box is still the model's (a part that would shrink is kept bigger, never smaller), resizes textures to WebP, drops the normal and roughness maps on the phone tier, compresses with EXT_meshopt_compression, and writes `<id>.low.glb` (phones, the `low` tier) and `<id>.glb` (medium and high) under `public/look/models/`, the SHA-256 of each into the lock, and `src/look/models/manifest.json` (sizes MEASURED on the shipped geometry, tris, per-part facts). The repo's loader is the existing `GLTFLoader` with `MeshoptDecoder`; there is no KTX2 transcoder in the repo, so textures are WebP. Poly Haven files ship at 1 to 8 MB with 10 000 to 180 000 triangles; the shipped ones are 9 to 135 KB (phone) and 31 to 398 KB (full), 14 models, 0.6 MB (phone) and 1.8 MB (full) if a home used all of them.

**The library** (`src/look/models/`): `fit.ts` (the sizing rule, pure), `library.ts` (families, candidates, part-to-role maps, the pack's say), `load.ts` (lazy fetch, parse, cache, `modelsIdle()`), `instance.ts` (scale, recolour, names), `apply.ts` (furniture), `decor.ts` (lived-in decor).

**Honest sizing.** A model is used for a piece of furniture only when `fitModel` says it fits the piece's drawn box and height within **12 % on every axis** (`FIT_TOL`), with the quarter-turn tried for a squarish table (`turnable`), and when the model's own seat or top height, scaled, lands within **3 cm** of the item's `surfaceHeightM` (`SURFACE_TOL_M`). Otherwise the generator stays. The non-uniform scale is therefore at most 12 %, which is the size of a visible stretch the eye forgives and no more. Further rules, all in `planFurniture`: no model for a piece whose generator params came from the drawing, the design sheet or the viewer's own style choice (a designer's slatted headboard, a "storage box" bed: a model cannot change shape); a recolour never blocks a model; the Classic look and any pack that says `"generator"` for the family use none; `?models=off` turns every model off (before and after pictures, checks). Built-ins dimensioned by a drawing (wardrobes with bays, shutters and hinges, counters, kitchen runs) have no model entry at all. The **dining chairs** are the generator's own chairs replaced one for one: the slot is the chair the generator draws (`CHAIR_SLOT`, 0.44 wide, 0.58 deep, the item's height), the table (top, legs, apron) stays generated at the drawn size, and both rows must leave the middle of the footprint clear (a table drawn under 1.2 m deep keeps its generated chairs).

**What is shipped, and what uses it.**

| Family | Model (Poly Haven, CC0) | Used when |
|---|---|---|
| dining chairs | Dining Chair 02, padded and tufted (James Ray Cock) | the chair slot fits the item's height (about 0.85 to 1.09 m) and the footprint is at least 1.2 m deep |
| bedside / side table | Side Table 01, oak (James Ray Cock) | a drawn side table near 0.55 x 0.45 x 0.55 m (also turned) |
| TV unit / sideboard | Modern Wooden Cabinet, slatted walnut lowboard (Patrik Pangerl) | a unit near 2.44 x 0.52 x 0.68 m |
| plant (decor) | Potted Plant 01, Potted Plant 02 (Rico Cilliers) | every planned plant |
| vase / jug on a table (decor) | Ceramic Vase 01, 02, 04 (James Ray Cock), Jug 01 (Kuutti Siitonen) | packs name their order: Light Scandinavian the white vases, Walnut & White the painted jug |
| fruit bowl (decor) | Wooden Bowl 01 with Apple, Lemon, Pomegranate (Oliver Harries, Kuutti Siitonen) | every planned fruit bowl |
| wall clock (decor) | Wall Clock (PierreB3D) | every planned clock |

Families with no model on purpose: **bed, sofa, study desk, wardrobe, counter** (no free model of that kind looks as good as the generated one, see "rejected"), and decor that stays generated: cushions, throws, lamps, the pressure cooker and steel dabbas, shoes, books, rugs, curtains, the pooja shelf, picture frames.

**Recolour.** A model's parts are named (`fabric`, `legs`, `body`, `slats`, `pot`, `leaves`...) and the library maps each to the palette's roles in order (`dining_chair_02`: `fabric` takes `fabric` then `accent`, `legs` takes `case` then `legs`). `resolveLook`'s roles are the same ones the generators read: the pack's, the sheet's and the viewer's "Change look" choice, so a model recolours exactly as the generated piece it replaces (`finishApplied` stays true). A wood or fabric finish keeps the model's own light and dark as detail around the tint (the kit's detail shader, shown less for a heavily mottled map); a laminate or a metal is a plain colour with its own roughness and metalness. A part with no role keeps the model's own material (terracotta pot, brass, the picture).

**Lazy loading.** The generated piece is built and shown first, always. A model is fetched only when `planFurniture` or `decorChoice` has said yes (a home that fits nothing downloads nothing), the file follows the tier, and the piece swaps its meshes in place when the model arrives; a rebuild (tier, style, finish) starts a new token and a late answer is dropped; a failed fetch or parse keeps the generated piece. The verdict tint a piece wears is put back on the new materials. `window.__walkthru.models` has `stats` (bytes and files fetched), `idle()` and `lived()`.

**Decor** (`lived-in/build.ts`; kinds with a model: plant, jug / vase, fruit bowl, clock) is built generated first and replaced by a model of its kind when one is allowed by the style pack's `models` policy; it is scaled uniformly (never past the planner's height or 1.25 times its footprint), every mesh has its ray switched off and is tagged `decor`, nothing is added to the walking grid, and the plan is made without knowing models exist.

**Packs.** A pack's optional `models` field names, per family (a look kind or a decor kind), `"generator"` or model ids in order of preference; a family it does not mention takes every model that fits. Shipped: Light Scandinavian and Walnut & White allow models (and prefer different vases and pots), **Warm Oak & Navy keeps every furniture family generated** because it is matched by eye to a designer's renders, Classic has no models. The item card says so truthfully: "Shown with a stock 3D model (label, free CC0 asset), scaled to the drawn size: typical styling, not from your drawing."

**Baked lighting.** A model piece is ordinary movable furniture to the bake: plain `MeshStandardMaterial` meshes, normals and UVs, stable unique `walkthruPart` names (`chair-seats` and `chair-legs` for the dining chairs, merged across the set), under `furniture:<id>` (decor under `lived-in`), so the dump classes them `dyn` and they are probe-lit; a mesh whose shape differs from the baked one (another tier's file) falls back to the probe like any generated piece. Parts made of hundreds of separate pieces (the plants' leaves, the cabinet's slats) carry `walkthruBake = 'skip'` (`PartUse.bake`): they stay in the scene as movable meshes and are probe-lit, but are left out of the object-AO atlas, because the first dump with them in (186 movable meshes) did not fit a draft atlas at any density ("the lightmap atlas does not fit even at a very low density"); with them skipped, `npm run bake -- test-sample-3 --quality draft --furniture-tolerance-mm 10` finishes (5.5 min, 184 movable meshes, 42 objects with baked AO; the outputs were discarded, re-baking is the integrator's job). The dump waits for `modelsIdle()` so a re-bake lights what the viewer sees. Parity: every model stays inside its drawn box (the fit rule), so `--furniture-tolerance-mm` is unchanged.

**Rejected, and why.** Poly Haven's `sofa_02` (black Chesterfield leather, 1.81 m; the 16.3 model the earlier look dropped), `sofa_03` (ornate vintage), the whole "bed" category (gothic, rusted, old frame) and every Poly Haven "painted / worn / antique" piece clash with the clean style; no free modern sofa, bed, study desk or kitchen run exists on Poly Haven. Kenney's Furniture Kit (CC0, licence verified on the pack's own page and its `License.txt`, 140 models with beds, sofas, TV cabinets, lamps) is flat-colour toy low-poly, which reads worse than the generated pieces next to the PBR floor and walls. Quaternius packs were not fetched (same flat-colour style, licence not verified). Looked at in the sample homes and **dropped after the before/after pictures**: Brass Pot 01 and Pot Enamel 01 for the pressure cooker on the counter (both read as a dark muddy brown next to the generated steel cooker, which is the more recognisable Indian-kitchen object) and Hanging Picture Frame 02 (a sepia photograph of a European palace clashes with the warm clean room; the generated landscape frame is better). Poly Haven's `plastic_monobloc_chair_01` and the vintage chairs are weathered. `throw_pillows_01` is a loud fixed pattern; the generated cushions take the pack's colours. Models that fit nothing in the sample homes are still shipped and tested, because a real drawing can have the size.

**Tests** (`tests/model-library.test.ts`, headless, 45 tests): the fit rule (accepts 12 %, rejects 13 %, turn, surface height, uniform decor scale), which pieces get a model and which keep the generator (family, size, height, surface, drawing / sheet / viewer shape choices, Classic, `generator`, `?models=off`), the fall back when the fetch fails and the drop of a late answer, sizes and surface heights unchanged with a model in (boxes, table top at `surfaceHeightM`, the item byte for byte), recolour mapping and the viewer's finish reaching the model, decor out of collision and rays, what the bake dump sees (unique keys, normals, UVs, `dyn`), pack parsing, and manifest / files / lock integrity (SHA-256 of every GLB, CC0 recorded with a page, an author and the date, the 150 KB phone budget).

**Known limits.** (a) With a 12 % rule and no free modern sofa or bed, few drawn pieces of the sample homes take a model: the visible lift is the decor (plants, vases, fruit bowl, clock), the dining chairs of a deeper table, and a TV unit or side table of the model's size. More models of other sizes widen it; a stretch rule beyond 12 % was deliberately not added. (b) The fruit bowl is a rough carved wood bowl and reads darker than the generated one; kept because the fruit and the bowl are real shapes. (c) The cabinet's slatted fronts have two curved slats at the middle, as in the source. (d) On a phone the plants (the heaviest, 134 KB each) are fetched only where a plant is planned.

---

#### 16.15.1 Better furniture, 16 Nov 2026: no new model shipped, the generated pieces were rebuilt (route C)

The owner asked for clearly better-looking furniture "by whatever means", free, under the 16.15 licence rule (CC0, or the output of a generator whose code and weights are MIT or Apache with no output restriction) and the 12 % fit rule. Three routes were worked, in order, and the result is recorded in `scripts/look-model-routes.json` (copied into `public/look/models/models.lock.json` under `routes` and into `LICENCE.txt`, with every URL, the wording relied on and the date, 16 Nov 2026).

- **A, more CC0 models: nothing to ship.** Poly Haven re-checked (522 models, 159 furniture, seating, table, bed, shelf, appliance, electronics or lighting; nothing added since the library was built fits a catalogue size within 12 % and looks clean: `chinese_sofa` fits the 3-seat box but is a carved Chinese piece, `modern_arm_chair_01` fits only the recliner box and is not a recliner, the Lighthouse beds and table are weathered or the wrong height). Objaverse's CC0 subset (3 465 of 800 000 objects, licence re-checkable per object on Sketchfab's API) is museum scans only. Kenney and Quaternius stay rejected (flat-colour toy low-poly).
- **B, generated models: cleared but not run, and TRELLIS rejected on licence.** TRELLIS and TRELLIS.2 are MIT in their code and weights, but their GLB texture baking runs the Inria gaussian rasteriser (research and evaluation only) and nvdiffrast ("Nvidia Source Code License (1-Way Commercial)"), and TRELLIS.2 conditions on DINOv3 and removes backgrounds with RMBG-2.0 (non-commercial), so the stack is not MIT or Apache end to end: not used. Hi3DGen / Stable3DGen (Stable-X; README: "we have specifically removed its dependencies on certain NVIDIA libraries (kaolin, nvdiffrast, flexicube) to ensure this adapted version can be used commercially", MIT; weights MIT, normal estimator Apache-2.0) is the cleared generator, shape only, and `scripts/gen3d/hi3dgen.py` is its client (untested). **It could not be run:** an anonymous Hugging Face ZeroGPU account has 2 GPU minutes a day, reset 24 h after the first use, and a call needs its whole requested time free, so three FLUX.1-schnell reference images (Apache-2.0, `scripts/gen3d/refs.py`, `matte.py` cuts the white background with rembg/u2net so no non-commercial remover is needed) and a few TripoSG calls that failed with a bare `RuntimeError` used the day. What it would take: wait 24 h per piece, a free account (5 minutes a day, a login the brief forbids) or PRO (40 minutes a day, extra GPU time USD 1 per 10 minutes, posted on the docs page, nothing bought). Whatever a generator returns must also pass the zoom test below, which image-to-3D baked textures typically fail, so a generated shape would be split into named parts and given the kit's plain materials.
- **C, rebuilt generators: shipped.** The competitor's look (clean smooth-shaded geometry, rounded edges, plain colours, no baked bitmap) is exactly what code can give, and it never blurs on zoom. Changes, all inside `src/look/gen/`:
  - `soft.ts` `softCushion`: one welded rounded-box surface for every cushion, pillow, mattress and seat pad (bevel cells spaced evenly in angle, crowned faces, averaged normals, exact w x h x d). It replaces `puffedCushion` in the generators (the old one cracked at the edges of its faces and looked crumpled). 300 triangles on medium, about 1 000 on high where the budget allows, a plain rounded box on low.
  - sofa, 2-seat, armchair, L-sofa: soft seat and back pads with proper gaps, round tapered wood legs (`taperedLeg`), rounder arms.
  - bed: the draped height-field duvet (which poked a torn flap out at the corner) is a tailored quilt block with hanging sides, thin quilting bands and a turned-down roll; plump separate pillows. Quilt thickness kept at 5 cm so the mattress top probe stays inside the 16.2 height rule.
  - western commode: a lofted pan, a seat and lid, a cistern with a dual-flush plate and hinges, replacing a sphere on a disc. Wash basin: a lofted bowl, a pedestal with a foot, a deck-mounted tap. New helper `loft` (superellipse sections, exact bounds).
  - office chair: seat pan and mechanism, soft seat and back pads, black T-arms and a five-star base, with the back spine behind the pad.
  - washing machine and fridge: rounder bodies and doors, a smooth 64-segment porthole.
  - every board gets a stable pseudo-random UV offset (`boardOffset`), so two boards of one wood never show the same grain side by side (the competitor's trick; world-scale UVs and the grain axis were already there).
  Not changed because they already read crisp at 40 cm: wardrobe, dining table (its chairs are still the Poly Haven chair, which passes the 40 cm look: a mottled padded leather, not mush), coffee table, TV unit, study desk, bedside table, treadmill, park bench, pool lounger frame, billiards table. The generated slat chair beside the model chair is plain and crisp too but less rich, so the model stays.
- **Zoom criterion (new, for any future model).** View it from 40 cm and crop at 100 %: a model whose look depends on a baked 1k texture that turns to mush, or whose mesh is lumpy or has melted edges up close, fails unless its texture is replaced by the kit's per-part materials. `compare-demo.html` renders one catalogue piece in a plain room at about 2.5 m, at 40 cm from its corner and from its front, stretched 12 % wide and recoloured (`?id=sofa-3&stretch=1.12&finish={...}`), and `scripts/compose-compare.py` builds the old-versus-new sheets.
- **Numbers.** Flat 204 of the Sample Tower, medium tier, whole scene: 142 529 triangles before, 135 221 after (furniture 88 724 to 81 416); low tier 71 963 before, 70 379 after (furniture 36 208 to 34 624). Model downloads are unchanged (16 files, 1 050 960 bytes on medium, 8 files, 256 768 bytes on low) because no model was added. `tests/gen-soft.test.ts` pins the soft cushion's exact bounds, welded surface and outward normals, the loft's bounds and the leg and grain-offset helpers; `tests/model-library.test.ts` checks that every route is recorded with a URL, licence wording and result, and that TRELLIS is recorded as not used.

### 16.16 The second catalogue table: swings, more furniture, appliances and bathroom fittings (16 Nov 2026)

`src/core/catalog-more.ts` adds 71 rows after the original fourteen, one row and one rule each (`src/core/pieces.ts`): a tray category (Seating, Beds, Storage & utility, Tables, Kitchen & appliances, Bathroom, Kids, Balcony, Fitness, Swing), search words (jhoola, almirah, mandir), a generator and its variant (`src/look/gen/*`: swing, tvunit, cabinet, tablex, seatx, bedx, appliance, fit, outdoor, bath, plus the existing bed and dining), a finish family (`swing`, `storage`, `appliance`, `pouf`, `bunk`, `plain`, `sanitary` join the original five), what a walker does (lie, sit, sit on a chair or stool, sit on a swing, stand at it, see its size) and its clearance zones. Pieces of the original table have no rule and behave as before. Everything is drawn by the parametric generators (no model was added, so nothing was bought or fetched), at the row's exact footprint and height, with the same part names and triangle budgets as 16.13.

**Honest clearances (`src/core/clearance.ts`).** A zone is the space a piece needs beyond one side: `fits` at the need or more, `tight` from 75 % of it (85 % for a sofa-bed, 70 % for a treadmill, 50 % at a WC's sides), `blocked` below. The sentence says the need, the assumed dimension and what happens ("Swing needs 68 cm clear in front and behind (a 20° swing each way): 42 cm behind, it will hit the wall."; "Fridge, single door needs 60 cm clear in front (the door is 58 cm wide, opened to 90°)..."). The swept areas are drawn as outlines with a line each. Assumptions: a hung jhoola swings 20° each way on chains that run from the ceiling to its arms (its reach is `chain × sin 20°`, so it depends on the ceiling), a free-standing one 12° inside a 125 cm deep frame, a hanging chair 15°; a fridge's door is its width, a washing machine needs 60 cm to load, a recliner is a wall-hugger needing 60 cm for its footrest (about 150 cm long open), a sofa-cum-bed needs 100 cm more than it is deep (opens to 190 × 190), an ironing board 60 cm to stand, a treadmill 1 m to step off, a WC 60 cm in front and 20 cm each side, a basin 60 cm, a shower area 80 × 80 cm. A fridge's 5 cm for air and a washer's 10 cm for hoses are part of its footprint.

**A hung swing and the ceiling.** It needs a ceiling of 2.3 m or more (blocked below, with the chain length said); the chains and four ceiling plates are drawn up to the home's ceiling (`src/look/gen/ceiling.ts`, set by the buyer page), so a hung swing's bounding box is taller than its `heightM` (the part a person can bump into, 95 cm). Its hook position and load are not on the drawing: every verdict and card says "Hanging needs a structural hook: check with your builder." An unconfirmed ceiling height is never printed as a number.

**Sit on the swing.** The walker sits on the plank at the seat spot nearest them; while seated the seat and chains (or the whole basket of a hanging chair) swing as a pendulum at its own period (`src/buyer/swing-motion.ts`, 12° at most, eased in) and the walker rides with them (`Character.ride`); getting up puts everything back to rest at once, and `prefers-reduced-motion` keeps the swing still.

**Rooms and walls.** A fitting that belongs in one kind of room (WC, basin, shower, geyser, sink, fridge, washing machine...) is allowed in any room with a note ("is for a bathroom (it needs a water point and a drain). This room is not a bathroom on the drawing..."), never a hard block. A wall fixture (`wall`) says so when no wall is behind it; a wall-hung piece (`mountY`) clears what stands lower than its underside, so a geyser (base at 190 cm) can hang over a WC. Pieces flat on the floor (a mat, a drain, a squat pan) and those above head height (a geyser, an exhaust fan) do not block a walker.

**With move, resize and remove (16.2 overlay).** A piece of the second table that came with the home, and every drawn fixture, is an original like any other: tappable, movable, hidden in "My layout". Resizing offers only the sizes its parts can honestly stretch (`sizeModeOf`, `src/core/pieces.ts`): none for a swing, a stool or a round table; width and depth (about 80 to 135 % of the catalogue size) for appliances, fittings, wall pieces and the TV unit; also height for storage. Wall pieces and appliances keep their standard height (a basin's rim, a geyser's base), and growing keeps the back edge on its wall. A resized piece reads its zones at its new size: a fridge's door is as wide as the fridge, a sofa-bed opens to a square as wide as it is.

**Fixtures from the drawing.** The symbol reader's WC, basin, shower and sink (17.7) are written to `proposal-extras.json` as `fixtures`, and the buyer page draws each as a `real` item of the matching piece (`fx-<id>`, `src/core/fixtures.ts`) at the drawn place, facing into its room: the box takes the symbol's size when it is within 0.6 to 1.6 times the standard size, otherwise the standard size, and the card says which; heights are always the catalogue's standard. A sink inside a counter the home already has is not drawn twice; a hob has no piece yet.

### 16.17 Shared-space catalogue: gym equipment, lobby and hall pieces, and the catalogue by place (16 Nov 2026)

A builder demos a whole project: a lobby, flats, a clubhouse with a gym and a hall. The owner: "The gym layouts I can give, but the ability to add different instruments and see them in real is important... you can't see it in rooms, only shown when you go to the community centre." This section is stage 2 of buildings (stage 1, the building model, is 18; stage 3, pool water and gardens, is not here). Fewer pieces, at true size, verified by looking.

**Catalogue by place.** Every `CatalogItem` carries `places: SpaceKind[]` (`'home' | 'lobby' | 'corridor' | 'gym' | 'hall' | 'games' | 'pool' | 'garden' | 'other'`, the contract on `PropertyFile.spaceKind`, absent = home; `games` is the games room of SPEC 20). A row that names none is a home piece, plus the few places `EXTRA_PLACES` (`src/core/catalog-spaces.ts`) gives it: sofas, armchairs, side tables, planters and a sideboard also in a lobby, dining tables and chairs also in a hall, a yoga mat in a gym. `src/core/places.ts` is the one place that decides: `allowedIn(id, kind)`, `rowsFor(kind)`, `categoriesFor(kind)` (a gym shows Cardio, Strength, Free weights, Studio, Amenities; a home never shows them), `categoryIn(id, kind)` (a planter is "Plants & decor" in a lobby and "Balcony" in a flat), `trayWords(kind)`. A space of kind `other` is not a judgement: it offers everything. The Furnish tray, its search ("treadmill" in a flat finds the home treadmill, in a gym the gym one), its category counts and the Replace list (`replacementChoices(item, kind)`: in a shared space the same tray category first) all read it. "Surprise me" is a finish chooser on a piece that has a finish family (a sofa, a bench), not a catalogue row, so it never offers a piece; gym equipment has no finish to choose and no Change look. **A piece already in a scene always renders**: one that arrived by a share link or a stored layout and does not belong here is kept, flagged in the pieces list (an amber chip with a mark) and its bar says "Treadmill, commercial is made for a gym, not a home. It stays in your layout; check it belongs here." (`notHereNote`); the same sentence is on the verdict while placing it. **The override** `?spaceKind=gym` (also lobby, hall, corridor, pool, garden, other, home) sets `property.spaceKind` at load (`main.ts`), so the catalogue can be tried on any scene without a building; the stage-1 hook `setCatalogueFilter` (SPEC 18.9) takes `(kind, item) => allowedIn(item.id, kind)`. `validateProperty` now keeps `spaceKind` (the same line stage 1 adds). The test scenes `public/scenes/test-gym-empty`, `test-lobby-empty`, `test-hall-empty` (8 × 12 m with a rubber floor, 7 × 9 m, 12 × 8.4 m, one door each, `spaceKind` set) and `test-gym-sample`, `test-lobby-sample`, `test-hall-sample` are written by `scripts/make-space-scenes.ts` (identical every run, a test compares the committed files); `test-` keeps them out of the gallery.

**Orientation of a machine.** The BACK of a machine (console, mast, weight stack, backrest) is at -z, so squaring it to a wall puts that end against the wall; the FRONT is the open end where you step on or get in, and is where the use zone is. A treadmill, cross trainer or bike is ridden facing its console, i.e. facing the wall. A bench's head end is its back (like a bed): against a wall a bench press has no room for a spotter, and says so.

**The pieces (67 new rows; sizes are w × d × h in cm; each row's card says the range its size sits in, and these are the sources).** Sizes are typical commercial sizes, not one maker's: the treadmill 90 × 210 × 150 (Life Fitness Aspire 212 × 92 × 147, Activate 206 × 82 × 145, Matrix 201 × 90 × 164, a gym-equipment guide 216 × 97 × 157: the range is 200 to 216 × 82 to 97 × 145 to 164); a rower 61 × 244 (Concept2 RowErg, seat at 36 cm; the monitor top at 100 cm is an assumption); the four-station multi-gym 290 × 210 × 210 (BodyCraft X4 281 × 223 × 212, Xtreme MTSG 290 × 207 × 197, Body-Solid S1000 315 × 343 × 211); the ten-pair, two-tier dumbbell rack 240 × 64 × 84 (Life Fitness 229 × 64 × 84, Gymleco 240 × 64 × 77, Gym Gear 244 × 53 × 84) with twenty dumbbells from 2.5 to 25 kg in 2.5 kg steps, each head sized by its weight; the power rack 220 × 160 × 230 (Body-Solid SPR1000 206 × 135 × 229, Cybex 196 × 166 × 248: the frame is 135 deep, the footprint also holds the 2.2 m bar and the plates, which hang out at the front); the Olympic bench-press station 220 × 160 × 135 (a Cybex-style station 165 × 173 × 122; the 2.2 m Olympic bar is the width). The other rows are in the ranges their cards give (cross trainer 75 × 185 × 170, upright bike 60 × 125 × 135, spin bike 52 × 120 × 115 (Keiser M3i 122 × 53), recumbent bike 68 × 165 × 125, stair climber 85 × 145 × 180; lat pulldown 120 × 140 × 215, seated row 90 × 150 × 150, chest press 105 × 135 × 150, shoulder press 105 × 130 × 165, pec fly 120 × 110 × 155, 45° leg press 142 × 225 × 130 (plates included), leg extension and leg curl 80 × 125 × 120, cable crossover 330 × 100 × 230, Smith machine 215 × 125 × 225; flat bench 56 × 130 × 45, incline 60 × 140 × 105, adjustable 60 × 145 × 115, plate tree 80 × 80 × 130, kettlebell rack 120 × 50 × 89 (4 to 32 kg), preacher curl 68 × 105 × 95; exercise ball 65, plyo box 76 × 61 × 61, battle rope on an anchor 50 × 55, heavy bag 38 across and 120 long hung from the ceiling, wall bars 90 × 12 × 230, suspension frame 240 × 90 × 240; mirror panel 120 × 3 × 200 from 30 cm up, water dispenser 34 × 38 × 110, towel and sanitiser station 60 × 40 × 100, lockers 30 × 45 × 180 a column in two tiers (banks of 6 and 12), changing-room bench 150 × 35 × 45, digital scale, wall fan 65 cm, rubber flooring 2 × 2 and 4 × 2 m of 50 cm tiles, 15 mm). Lobby: reception desks (straight 240 × 80 × 115 and L-shaped 240 × 180), a visitor seating set, large planters, a 30-box letterbox bank, a security desk, a notice board, a name directory board, a lift-lobby bench, a wall art panel, queue stanchions. Hall: a stacking chair 46 × 52 × 82, folding banquet tables (6 ft and 150 cm round), staging platform modules 120 × 240 in 20, 40 and 60 cm (4 × 8 ft decks), a podium, a 3 m projector screen, a PA speaker on a stand, carrom, table-tennis (274 × 152.5, net 15.25 cm, ITTF) and 8 ft pool tables. The existing home treadmill (70 × 140) and yoga mat stay home pieces (the mat also in a gym).

**Generators** (`src/look/gen/cardio.ts`, `strength.ts`, `freew.ts`, `studio.ts`, `lobby.ts`, `hall.ts`; helpers in `gymkit.ts`; kinds `cardio`, `strength`, `freew`, `studio`, `lobby`, `hall`, each with a `variant`). Parametric like the home pieces: a size is the row's footprint and height, exactly (a test draws every row under two packs and every tier within 1.2 cm), parts are plain meshes named by `walkthruPart` (bake-exportable), a piece is a handful of meshes (a stack of plates, a barbell, a dumbbell are merged per material: one mesh per material and name, not an `InstancedMesh`, because the bake exports plain meshes). Triangle budgets per tier are in `tests/space-pieces.test.ts`; a whole treadmill is about 560 / 880 / 1,060 triangles (low / medium / high), a power rack 1,100 / 1,250 / 1,480, a dumbbell rack with twenty dumbbells 1,660 / 2,000 / 2,050, a stacking chair 130 / 360 / 430. The 39-piece sample gym is 15,500 triangles at the low tier, 23,300 at medium and 29,000 at high, 272 meshes; the 70-piece hall 9,300 / 23,500 / 28,000 (344 meshes, 60 of its pieces are chairs); the 13-piece lobby 7,700 / 14,200 / 22,600: all well inside the phone budget of about 150,000 for a whole home. Equipment takes no finish choice; packs colour the wood of the lobby and hall pieces. The one moving part is the treadmill belt (`userData.motion`, ribs on their own mesh `tread-belt-ribs` that slide and wrap; `src/buyer/machine-motion.ts`).

**Honest clearances.** Every machine has use zones drawn like the existing ones, with a verdict and a sentence that states what was assumed and calls it "typical guidance, check your consultant" (no code is claimed): treadmill 2 m clear behind the belt (fits at 2 m, tight from 1 m, which many suppliers give as the least, blocked below) and 50 cm each side; cross trainer 60 cm behind, 50 cm each side; bikes 50 cm to get on and 50 cm between machines (a studio often uses 60); recumbent bike 60 cm at the side; rower 60 cm at the seat end and 50 cm each side; selectorised machines 80 to 90 cm in front and 40 cm between; leg press 80 cm at the seat end and 70 cm each side for plates; cable crossover 1.2 m in front; Smith machine 1.2 m in front and 60 cm at each end of the bar; benches 60 cm each side; Olympic bench press 90 cm behind the head for a spotter and 50 cm beyond each end of the 2.2 m bar; power rack 1.2 m in front and 50 cm at each end of the bar; dumbbell rack 1 m in front; a heavy bag 1 m all round and its swing (a 20° pendulum from the ceiling, plus the hook note: "Hanging needs a structural hook: check with your builder"); battle rope 4 m in front; lockers 90 cm in front; reception desk 1 m on the visitor side and 80 cm for the staff; carrom 80 cm all round; table tennis 1.8 m at each end and 1.1 m at each side (recreational, tournament play needs far more); pool 1.2 m all round (a cue is 1.47 m). The sources behind the treadmill and rack numbers: vendor and consultant guidance varies (0.5 m each side and 1 m behind quoted as ASTM-style minimums in one source, 2 m behind a loaded power rack for a spotter in another, 1 m minimum for machines and 0.5 to 1 m between cardio machines in a third); none is a code, which is why every sentence carries the line. A flat piece (a mat, rubber flooring: under 6 cm) lies under a machine or a bench: only a wall stops it (`checkPlacement` of a flat piece does not collide with furniture).

**The walkway rule and the summary card** (`src/core/space-rules.ts`). A walkway is a path 1 m wide (every cell on its centre line 0.5 m from every wall and standing piece, by an exact distance transform on the 5 cm walk grid) that joins the room's doors and the two ends of its long axis (the most open spot in the outer fifth); a hall, which has no ends to walk to, tests its doors against the open floor. When the nodes lie in separate regions the answer names the two things the nearest cut runs between: "Walkway blocked between Power rack and Power rack 2: there is no 100 cm wide path past them." Flat pieces and pieces hung above 1.7 m do not block it. `spaceSummary` gives the card shown in the tray of a gym or hall: "20 stations: 6 strength, 6 free weights, 5 cardio, 3 studio. Floor used by equipment 28.3 m², about 64.9 m² with the use zones, of 96.2 m²: 67.8 m² (71 %) free. A 100 cm wide walkway is open through the room, door to door and end to end." (a hall: "60 seats."), tone good, warn when the zones cover over 80 % of the floor, bad when the walkway is closed, with the footer "Spacing and walkway widths are typical guidance, check your consultant. They are not a code." It is worked out when the pieces change, not on every frame of a drag.

**Poses.** Done: stand on the treadmill (the walker steps on the belt, `Character.walkOn`, walks in place at the belt's 1 m/s facing the console while the ribs run, three-quarter camera; "Step off" puts them on the room floor; `prefers-reduced-motion` keeps the belt still); sit on an upright, spin or recumbent bike and on the rower (hips on the saddle or seat, facing the console, `machineSeatPose` from the rule's `seat: { z, face }`; a bike's card gives its size and "Seat at 95 cm (the saddle or seat adjusts)", it is not judged as a chair); sit on a flat, incline, adjustable bench and the preacher curl bench; sit on a stacking chair, a lobby or changing-room bench; stand at a reception desk, security desk or podium. **Not done, on purpose:** lying on a flat bench (the straight lying pose would hold the legs out over the end of a 1.3 m bench with nothing under them, which is not how anyone lies on a bench) and any pose on a machine with handles (the walker would sit with its hands in its lap): those pieces show their size card and zones.

**Layout helpers** (`src/core/space-layout.ts`, wired in `furnish.ts`, all through the ordinary overlay so a builder's arrangement is saved and shared by link). With a piece selected in a shared space: **Duplicate** (one more beside it, on the side with room), **Row…** (N more along its width at its own spacing: `rowGapM` is the space its side zones ask plus 4 cm, because the 5 cm walk grid can read a gap of exactly the need 2 cm short; the row stops at the first wall or piece and says so; right or left), and for a seat **a block of seats** (rows × seats a row, an aisle after every k seats, 90 cm from row to row, 1.2 m aisles, 3 cm between chairs; "72 seats: 6 rows of 12, 1 aisle of 120 cm after every 6, 90 cm from row to row, 7.1 × 5.0 m." is on the card and on the toast, and the seat count is on the hall's summary). **Fill area** (`session.fillArea`) lays flooring tiles over a rectangle in whole pieces. **Snap**: on release in a shared space a piece snaps to the piece beside it at its own spacing (same facing, within 30 cm of the ideal gap) and lines up its back edge (within 15 cm), after it has squared to a wall; never into a blocked place. Each piece is a piece of its own; a link carries up to 220 added pieces (`MAX_ADDED`, `MAX_CODE_CHARS` 12,000), so a 72-chair block and its room fit.

**Sample layouts, and how the building generator adopts them.** `sampleLayout(kind, bounds, { doors, idPrefix })` in `src/core/space-samples.ts` returns the pieces (`FurnitureItem[]`, virtual, so their zones and verdicts show) of a furnished `'gym' | 'lobby' | 'hall'` for a room of those bounds `{ x0, z0, x1, z1 }`: the long side is the run of the room (a quarter turn if it runs along x), `doors` (`{ wall, atM, widthM }`) keep 1.4 m of floor inside each clear, and a piece that would not fit a smaller room is left out, never squeezed. It is a pure function of the room: same room, same pieces, ids included. A generator does `property.furniture = sampleLayout('gym', bounds, { doors })` (or imports the committed `test-*-sample` property files); the sample gym is a mirror wall on the west with three treadmills, a cross trainer and an upright bike facing it, six selectorised machines down the east wall, a power rack and a bench press on rubber flooring at the south end, dumbbells, kettlebells, wall bars and two benches at the north, mats, a plyo box, a heavy bag, water, towels, fans: 39 pieces, 20 stations, a 1 m walkway open and every piece's verdict fits or tight, none blocked (a test checks each). The sample hall: a stage of four 40 cm modules with a podium, two speakers and a screen, 60 stacking chairs with a centre aisle, tables, a round table. The sample lobby: a reception desk standing 0.8 m out from the back wall so the staff have room, a security desk, a seating group, planters, letterboxes, a directory, a notice board, art.

**Adopted in the Sample Tower (stage 2 meets stage 1).** The generator's stage-2 part is `scripts/building/furnish-spaces.ts` (kept apart from `spaces.ts` and `make-sample-building.ts`, which carry only a few marked lines): `furnishScene(bare, kind, roomId, { anchors })` runs `sampleLayout` with the scene's real room bounds and its own doors (`doorsOn` reads every door and open passage on the room's walls, so each landing stays clear). In the **full** tower the community hall (60 chairs, a four-module stage, podium, screen, speakers, tables), the gym (39 pieces, 20 stations, the mirror wall on the long west side) and the lobby are furnished; the gym's free-weights area moves aside for the door in the middle of its south wall (`first`: the first free place of a list). The **lobby** pieces stand on `lobbyAnchors`, back edge to the anchor's back edge, turned as the anchor says: reception desk, security desk, visitor seating set in place of the stand-in sofas, two letterbox banks (2 × 1.2 m on the 2.4 m anchor), plus two large planters, a directory board and a wall art panel (the anchors were adjusted to hold what goes on them: the reception anchor stands 0.8 m out from the wall for the staff, the security anchor is 0.75 deep, the seating anchor 2.8 × 2.6 against the west wall). The **empty twin** stays bare: its hall and gym are bare copies under their own scene ids (`test-tower-empty-club-hall`, `-gym`), its lobby was already separate. Every piece of the three rooms is fits or tight, none blocked, and the walkway is open (`tests/building-furnished.test.ts`). The catalogue rule is installed through stage 1's hook: `walk.ts` calls `setCatalogueFilter((kind, item) => allowedIn(item.id, kind))` when a space is mounted and clears it in the space's own dispose, so it never outlives a space; the tray, its counts and the Replace list ask it as well as the rows' own `places` (`offeredIn`, `catalog-tray.ts`); `__walkthruBuilding.catalogue()` says whether it is installed, for which kind and how many pieces it offers. On the built site the lobby offers 27 pieces (Reception & security, Seating, Tables, Storage, Plants & decor, Amenities), the gym 45 (Cardio, Strength, Free weights, Studio, Amenities), the hall 34 (Seating, Tables, Stage & AV, Games, Plants & decor, Amenities), a flat 85 (home categories only). **People:** an added person sits on a bike, the rower, a bench or a chair of the shared-space tables with no new code (`hostActionOf` reads the rule's pose and `hostPose` uses `machineSeatPose`); a person on a treadmill is not offered (it would need a walk-in-place pose for an added person: the walker's own `walkOn` is not in the people hooks), so a treadmill takes only the walker. **Space-swap leak check** on the built site (`vite preview`, 20 hops alternating the furnished gym and hall with the tray opened in each, after a warm-up of 8 spaces; garbage collected before every reading): heap 17.2 / 19.5 / 17.9 / 20.1 MB after +5 / +10 / +15 / +20 (a gym and a hall differ, the same kind repeats), DOM nodes 1,091 / 1,084 / 1,091 / 1,084, JS listeners 266 / 286 / 266 / 286, one canvas and one HUD every time, the filter installed with the right kind in every space and gone with it; the corridor afterwards is back to 506 nodes and 162 listeners (the baseline), so the tray's DOM and listeners go with their space.

**Verification.** `tests/space-pieces.test.ts` (rows; every generator vs its row under two packs and three tiers; part names; triangle budgets), `tests/places.test.ts` (filtering per kind in the tray, search, Replace and counts, the flag, the override, the scenes), `tests/space-layout.test.ts` (zones and verdicts of representative machines, the walkway, row and seat maths, snap, the summary, the samples), `tests/furnish-spaces.test.ts` (the session in the test gym and hall: flagging, zones, the helpers, the summary, a link round trip, poses). Contact sheets are made by `gym-demo.html` (`npx vite`, then `/gym-demo.html?cat=cardio&mode=tiles&views=front,back`; every piece at real size beside a 175 cm stand-in). **Known limits.** A piece that stands ON a stage module (a podium on the stage) is not modelled: the walk grid has no "on top of", so it would collide; put it on the floor beside the stage. The mirror is a shiny panel, not a live reflection. A pool or a garden shows only its few pieces (stage 3 owns them). The hall's walkway test is doors against the open floor, which says little about aisles; the seat-block plan is the number a builder reads. Layouts over 220 pieces cannot be carried in a link. Screenshots from the headless renderer show a green floor tint and red contact shadows that are there in any scene (the same on `test-flat-empty`): they are the software GL, not these pieces.

### 16.18 Crisp: resolution governor, edge quality, and the arm's-length pass on floors, walls and doors (16 Nov 2026)

Complaint (owner, 2x retina laptop): soft picture, beige walls with no detail, doors as flat slabs in thick dark frames, tile joints soft and thick. Cause by cause, and what replaced it. 16.2 still outranks everything here: **no size, hole, leaf, swing, collision cell or measurement changed** (tests: `tests/crisp-shell.test.ts`), and all of it is decor labelled like the rest.

**Resolution and the governor** (`src/look/resolution.ts`, pure, `tests/resolution-governor.test.ts`). The medium tier drew at 1.5x on a 2x screen and upscaled. Now `pixelRatioCap` is 2.0 on medium and high for a device with a mouse; a phone or tablet keeps 1.5 (`PHONE_RATIO_CAP`), low stays 1.0. In auto quality a `ResolutionGovernor` walks the ladder 2 -> 1.75 -> 1.5 -> 1.25 (never below 1.25 on a screen that has it; a 1.5x screen has 1.5 -> 1.25; a 1x screen has nothing to give up) BEFORE the tier steps down: a 2 s window under the tier's fps target (medium 50, high 55, low 30) takes one rung (the first 6 frames after a change are not counted: the resize itself is slow); a window under target at the lowest rung raises `exhausted`, and only that event lets `look.ts` act: on high the 4096 shadow map first drops to 2048, then (once, remembered in `walkthru:tier`) the tier steps down and the ladder starts again from its top. Stepping back up is a probe: 20 s of windows at 1.08x the target in a row take one rung up (a 60 Hz display hides spare time, so it is tried, not predicted); a probe that has to be undone within 40 s doubles the wait (to 160 s), so the ratio settles instead of oscillating. Frames over 0.5 s (hidden tab, upload) are skipped, a hidden tab or a tier load resets the window. A tier forced with `?quality=` or the panel is not governed.

**Edges.** The composer now has real MSAA on its own HalfFloat target (`multisampling` 4, clamped to `MAX_SAMPLES`; the renderer's `antialias` only covers the default framebuffer, which the composer never draws to). SMAA after it only softened the frame, so it is off (`?aa=smaa` puts it back for comparison). A contrast-adaptive sharpening pass (`?sharpen=0.6`, 5 taps, clamped to the neighbourhood's min and max so it cannot ring) exists and is OFF by default: see the comparison in the report. Low keeps the renderer's own MSAA. **Medium now has the composer** (MSAA + a cheap half-resolution N8AO, 6 samples, no bloom, no planar reflection) except on a phone or tablet (`postWanted`); soft shade in every corner is also analytic on all tiers (below). Shadow maps: medium 2048 (static, re-rendered on change), high 4096 (live), tightly fitted to the home's bounds as before. Anisotropy: 16 on medium and high, clamped to the GPU's maximum; low 4.

**Text in the world** is drawn at 4x (pool signs, door number plates), or 2x (door labels and building signboards: 1,280 to 2,200 px a metre), with mipmaps and anisotropy 16.

**Nothing is a stretched photograph any more** (`src/look/procedural.ts`). The shell used to multiply 1k photographs (a travertine tile, a plaster, a dark wood) over metres. They are not fetched now. Everything is computed in the shader from the position in metres, so it is as sharp at 30 cm as at 3 m, and the pixel footprint (`fwidth`) fades the fine terms where a pixel is wider than the grain:
- **Floor tile** (look-kit floors): the room's own grid (pack formats: Clean Contrast asks for 800 x 800 in a room of 12 m2 or more with a short side of 3 m or more, 1200 x 600 along the longest wall in rooms of 5 m2 or more and 1.8 m or more wide, else 600 x 600; a tile the drawing gives always wins), a 2 mm joint (2.5 mm in a toilet) antialiased by derivatives and never darker than the part of the pixel it covers, the joint colour the tile's own colour 26 % deeper, a 1.6 mm bevel at every joint (the normal tips towards the joint, so a glossy tile catches a fine highlight; faded where a pixel is wider than the bevel), a per-tile tone change of 5 %, fine speckle and a soft cloud. The floor's reflection is desaturated 70 % and weaker (a floor reflects the room, not the colour of the sky).
- **Walls and ceilings**: paint grain at two sizes (about 2 % each, in metres), a slow drift of tone across the wall, 0.7 mm of relief (bump from the same noise), an 11 mm shadow line where the wall meets the ceiling and a soft cove of shade over the top 6 cm; corner shading: the shell gives every wall vertex the distance to the room corner at each end of its piece (attribute `lkEnd`, `99 - metres`, 0 where there is no corner), and the wall shader darkens the indirect light up to 0.55 m from a corner (to 74 %) and 0.42 m from the floor and ceiling (to 70 %). This is the version of corner occlusion that every tier has, with no post pass.
- **Frames** are wood grain computed along the member (the UVs of every member of a frame run along its length: the old box mapping put the grain across the posts), or plain paint when the pack's frame finish is not a wood.
- **Door leaf** (`buyer/doors-model.ts`): the colour times a computed vertical grain (laminate and paint finishes turn it off), a thin clear coat, a core with eased 2.5 mm edges over a dark slab of the leaf's exact size (a shadow groove round the face, the leaf's size, thickness and place unchanged), three hinge knuckles on the hinge edge, a lever set a face (round rose, neck, lever, long plate with a key slot; merged: 2 meshes a door instead of 6), hardware in the pack's colour, and number plates and signs drawn at 4x.

**Frames and trim** (`engine/shell.ts`, `look/kit/*`): a lining flush with both wall faces (as wide as the posts the leaf hangs between), a 10 mm door stop on the side the leaf closes against (visible from the other side), an architrave on both faces (a 40 mm board 8 mm proud with a 14 mm bead on its inner edge; a side with less wall than that gets a narrower board or none), a head that stands 6 mm prouder, runs 12 mm past the sides and has a 14 mm cap (a lintel that reads as built); windows get a 40 mm lining and a sill board that stands 25 mm into the room. The skirting is a profile (14 mm board, a bevel in, a lip, a bevel back; 100 mm) and stops 40 mm short of an architrave. The kit draws recessed ceiling downlights as small rings (the same places the bake lights from, `planDownlights`; none in a room whose design sheet draws its own), glass tagged `walkthruLight = 'lamp'`.

**Packs.** `Clean Contrast` (default; `clean-contrast.json`): bright warm-white walls (`wall-bright` #F8F6F1), a light warm-grey ceiling one step darker than the walls (`ceiling-warm-grey`, applied by `applyRoomFinishes` with the walls and floors, nothing sampled is touched), pale stone tile (`tile-stone`), white leaf doors in slim white frames with a built architrave, white skirting, small dark handles (`charcoal-matte`), the Light Scandinavian furniture. `Clean Contrast, charcoal` (`clean-contrast-dark.json`) keeps the room and swaps in charcoal skirting, deep walnut frames and warm oak doors (the wood-door option). New pack fields: `trim` (skirting, frame, handle finish ids) and `tiles` (formats, joint width). Light Scandinavian and every other pack stay selectable; a saved choice and `?style=` win; the eight sample-tower and `test-tower-*` design sheets whose source is `typical` (and were on Light Scandinavian, the old default) now name Clean Contrast (`scripts/building/flats.ts` writes them), keeping the brochure's white laminate doors; `son-bedroom` (designer renders) and `test-sample-3` (Walnut & White) are untouched. Windows (`panes`) are frosted bright glass (unlit, 55 % white): the window glows with daylight and does not pretend to show a real view (the plain-sky label of 16.12 stands for the balcony glass).

**Light.** The Morning and Afternoon presets were warm enough to turn white walls beige and the stone floor blue (the cool shadow tint and the blue sky half lit the floor): exposure 1.26, white balance #FFFBF6, highlight tint #FFF8EE, shadow tint #F6F6F7, saturation 1.04, contrast 1.08 to 1.1, sky half #EEEFEC, ground half #DAD8D4, hemisphere 1.12 to 1.15, and the sun's tint on the bounce down from 25 % to 12 %. Evening, Night and True colours are unchanged. The tower flats face north (`look.json` `northDeg` 180), so no sun enters their living rooms: the picture there is skylight, soft by nature, carried by the fill, the corner and contact shading and the glowing windows.

**First person, the follow camera and the glide** (`engine/camera.ts`, `engine/smooth.ts`, `engine/locomotion.ts`, `viewer.ts`, `buyer/main.ts`). First person: vertical field of view 72 degrees (80 in portrait, where the slice is narrow), asked of the camera by the viewer's resize (`userData.fovFor`; it used to be overwritten with 60 or 70), near plane 0.03 m (a wall at 15 cm does not clip), the eye is the walker's own (`eyePosition`), the body is hidden. **Smoothing** is the exact solution of a critically damped system over the frame (`smooth.ts`: `damp`, `springTo`, `springAngleTo`; a frame is clamped to 0.1 s), so 30 and 120 fps end in the same place and nothing overshoots: the heading and elevation a look drag sets glide with a smooth time of 0.12 s (0.09 s in first person); the third-person pivot follows the walker with a 45 ms time constant; the boom is a spring of its own (shortening 0.14 s, lengthening 0.45 s, about 2 m/s at its fastest) that may pass the collision length (already 0.2 m short of a wall) by 10 cm at most, so it never pops and never enters a wall; in first person the eye follows the walker nearly directly (30 ms) with its height held by a 140 ms filter (a head bob of a centimetre is flattened, a sit or a lie goes through at 50 ms). **Cross-fade:** `firstPerson = on` (or `setView(on)`) blends the two poses and the field of view over 360 ms (`viewBlend`, 0..1), never a cut; `setView(on, { instant: true })` is for start-up and tests. **Third person close to a wall:** when the boom is shorter than 0.95 m the camera glides to the walker's eyes and looks ahead instead of at the back (`fade`, 0..1, continuous, 0 during a bed or sofa focus); the page hides the body above 0.55 and shows it under 0.45. Walking: speed reaches walking pace in 0.25 s and stops in about 0.16 s (5.8 and 8.5 m/s squared), the walker slides along walls (`moveCircle`). **Director API for a driver that is not camera.ts** (the tour): `driveTo(position, lookAt, smoothTimeSec = 0.4)` eases the camera to a pose (position and look point each critically damped, no overshoot) and holds it against the walker and the look drag until `releaseDrive(smoothTimeSec)`; taking over starts from where the camera is (no cut) and `driven` says whether a pose has a say; `setBodyHidden(true | false | null)` forces the body hidden or shown (`null` = automatic) through `fade`, which the page reads; `setFov(deg | null, smoothTimeSec)` is a temporary field of view. The caller must give a pose inside the home: a driven camera does not collide. **The default view** is `DEFAULT_VIEW` in `src/buyer/person-store.ts` (one word); a saved choice and `?view=first|third` win.

**Cost** (renderer.info for one render, `tools/crisp/shots.js`; numbers in the report). Every costly feature is tier-gated: the fine shader detail (`shared.fine`) is medium and high only, the composer is high and desktop medium, 4096 shadows are high only, and the resolution governor and the shadow-size step are the safety net.
**Known limits.** Real-GPU frame rate was not measured (headless Chrome here is SwiftShader); the frame, door and skirting meshes changed, so a baked home's meshes for them no longer match their lightmap checksums and fall back to the probes until it is re-baked (`npm run bake -- <id> --quality final`), as 16.14 says they do; window glass is still the unlit veil.

### 16.19 Daylight, wet rooms and calmer fittings (round 2, 16 Nov 2026)

Round 1 (16.18) left the rooms bright and clean but flat: no light came from the windows, wet rooms were bare boxes, and a few fittings (a black TV slab, saturated sage sofas with orange cushions, black grills, dark signboards) stood out. All of it is productised (no per-scene code) and decor under 16.2.

**Daylight** (`src/look/daylight.ts`, pure, `tests/daylight.test.ts`; shader in `materials.ts`; wiring in `look.ts`). Every window and every glazed (sliding) door of a whole room is a soft area source for the look's shell shader (floors, walls, ceilings, frames), with the nearest 6 to the walker chosen every 0.25 m of walking (`MAX_WINDOW_LIGHTS`). The light is the sky half of the day's grade, a little cool, warmer towards the horizon colour in the evening, a trickle at night and none in True colours; it falls on the room side of the opening only, softly (`area / (d2 + 1.8 + 0.6 area)`, wrapped so a surface turned away still gets some bounce), and on the floor adds a soft skylight patch wider than the glass fading over about 1.6 m. It is added to the indirect (ambient) light before the corner shading, so the shading still sits on top. **It is skylight, never a sun**: nothing here knows a sun direction, so a flat that faces away from the sun gets no sun patch (the tower flats face north: their living rooms have a gradient and no patch; the master bedroom's real sun patch comes from the existing sun and its shadow map). A room with no window or glazed door (a passage, a toilet) is lit by its own downlights: up to 6 soft warm pools (`lampSources`, the same places as the rings and the bake's downlights), on by day too. Cost: one uniform loop of 6 windows and 6 lamps in the shell fragment shader on medium and high only (`winOn` is 0 on low, in Plain, True colours, with a scan and in baked mode), no extra pass, no shadow. A view that replaces the lighting (a dollhouse) sets `materials.shared.winOn.value = 0` and puts it back.
The look's exposure and ambient were pulled back to carry it: Morning and Afternoon exposure 1.16, hemisphere 0.95 to 0.98.

**Wet rooms.** A wall finish whose kind is `tile` (the brochure flats say `tile-grey` for toilets) is a glazed 300 x 600 wall tile with hairline joints, from the floor to the ceiling, with tile-to-tile tone change and a glossier surface (`wall(color, tile)` in `materials.ts`; the same joint maths as the floor, in metres on the wall). A bathroom that has no finish of its own takes the pack's `room.wet` (Clean Contrast: pale glazed wall tile `tile-wet-white`, matt grey floor tile `tile-wet-grey`). Over each wash basin of a whole bathroom the kit hangs a mirror (550 x 700 mm, a 8 mm frame, a vertical gradient from cool grey at the bottom to bright at the top in 24 strips), on the nearest wall, only where no door or window is in the way (`mirrorSites`). The honest-finish labels are unchanged. (The grey rod in a toilet is the drawing's shower riser, not a pendant.)

**Calm fittings in the Clean Contrast packs.** TV: a 5 mm bezel, a glossy screen in four bands from a faint sky reflection to blue-black, a wall bracket behind (all packs). Soft furnishings: greige weave sofas, terracotta cushions, blue-grey accent, white wardrobe shutters with a long thin bar handle; the lived-in decor (cushions, throws) takes a muted palette (terracotta and ochre as the one warm accent, blue-greys and sage-greys; `tones()` in `lived-in/build.ts`). Window grills: thin (8 mm bars, 200 mm apart) and white (`trim.grill`), the kit's black grill stays for every other pack. Signboards (`look/sign-style.ts`): a small light plate with thin dark text (70 % height) instead of the dark plate with the gold rule. The flats' main door is a calmer mid-walnut (#806750) with the same reveal and architrave.

**Baked scenes.** The meshes this and 16.18 changed (frames, skirting, door leaves, the TV, grills, mirrors, rings) no longer match the committed lightmaps' checksums, so they fall back to the probes until re-baked; see the report for which scenes were re-baked.


### 16.20 Warmth, shared spaces and the person (round 3, 17 Nov 2026)

**Wood-look plank floors.** Vitrified flooring is sold in wood-look planks, so the Clean Contrast packs lay one in living rooms, dining areas, bedrooms and passages: 200 x 1200 mm planks in rows along the room's longest wall, each row starting at a random place along its length (a stagger), a 1.2 mm joint, a per-board change of tone and warmth, and a faint grain computed in metres on each board (`uLkPlank` in `materials.ts`), satin (roughness at least 0.42) with the same soft window reflection as the tile. The kitchen keeps the pale stone tile and the wet rooms their tiles. The decision is the floor FINISH (`plank-oak`, kind `plank`): the pack's `room.floorByType` (living, bedroom, other) and, for the brochure flats, `SPEC_FINISHES.dry` in `scripts/building/flats.ts`; a room whose colour is not the finish's keeps its own. Label: the kit's note stays as is, and `PLANK_NOTE` ("Wood-look floors are vitrified planks, an illustrative finish: your drawing does not give the floor.") is added in the look panel and the rooms sheet where a plank floor is drawn. Nothing about a room's size changes.

**Dressing.** One colour accent per room: the room's widest sofa carries the cushion pair and the throw in the room's accent tone, any other sofa one cream cushion (the lived-in palette of the clean packs is muted terracotta and ochre, blue-greys and sage-greys, cream at index 6, which the rule that used to turn cream into red-orange no longer touches). Rugs, plants, lamps, frames, clocks, curtains, books and bowls are the existing lived-in layer (movable and removable as before).

**Shared spaces** (lobby, corridor, clubhouse foyer, gym, banquet hall, games room) now get the kit: skirting, kit floor tiles, ceiling downlight rings (with the daylight pools of 16.19, since `planDownlights` and `lampSources` cover them) and, in a gym, a mirror wall (the longest wall stretch with no opening, 0.45 to 2.15 m up; `gymMirrorSites`); no fan, tube, switchboard, grill, cove or railing (`kitPlan(..., sharedKind)`, `KitOptions.shared`). Floors by kind of space (`room.floorBySpace`, set from `setSpaceKind`): a timber look (`plank-oak`) in a hall and a games room, a polished large-format tile in a lobby and a corridor, a grey rubber floor in a gym. The ground lobby has a design sheet (`public/scenes/test-tower-lobby/design.json`): a timber slat feature wall behind the reception desk, a stone-look desk top, a rug under the visitor seating. Gym equipment is dark-grey painted steel, lighter pads and steel stacks (`gymkit.ts`) instead of near-black high-metalness parts that read as flat silhouettes. Not done: lift surrounds and call buttons, a wall-wash cove in corridors, round tables with cloths, games-table felt, the pool deck's boards, water and loungers, and the trees' canopy.

**Every pack but Classic** now gets the calm trim (white frames and skirting, small dark handles, thin white grills, `DEFAULT_TRIM` in `style.ts`) and the small light signboards; the gallery's Sample 3 opens in Clean Contrast (its design sheet keeps its curtains, rugs and downlights); the other gallery homes have no sheet and take the default pack; uploaded plans (`local-*`) take the default pack.

**The person.** Hair is very dark brown (man #2D2119, woman #2B1F19, child #3A2A20; the elder stays grey) in a `MeshPhysicalMaterial` with a soft sheen band (`sheen` 0.9, roughness 0.5) instead of a flat near-black matte; the ground shadow under the walker is a wider (1.25 m), softer nine-stop pool. A hairline irregular at the nape and sideburns needs a change to `tools/make_family.py` and the rebuilt bodies: not done.

### 16.21 Realistic materials: Off, 1K, 2K (round 3, 17 Nov 2026)

An optional layer of photographed PBR sets over the procedural shell (the competitor's "Realistic materials"). **Off** is the procedural look and is the default on phones and the low tier, and the fallback while a set loads or if a fetch fails; **1K** is the default on a desktop at medium and high; **2K** only when chosen. `look.setRealism('off'|'1k'|'2k')`, persisted per viewer in `walkthru:materials`, `?materials=off|1k|2k` for a check; a "Realistic materials" row with the three choices and a progress line is in the look sheet. The low tier, a shown scan and an open-air space are always Off. The resolution governor gives up 2K before it lowers the pixel ratio: the first slow step down on a 2K home is taken back and the maps drop to 1K (`realismEffective`; never persisted).
**Table** (`src/look/realistic.ts`): one CC0 Poly Haven set per family, with its real-world repeat in metres, a normal strength (at most 0.4: nothing bumpy), a roughness range and how far the map's light and dark may show around the pack's colour: `plank` oak_wood_planks (grain per board; the plank layout and the hairline joints stay procedural), `tile` grey_plaster (surface variation under the joints and bevel of stone and vitrified tile), `wall` painted_plaster_wall (a fine plaster normal on walls and ceilings, +/-2.5 % tone), `veneer` oak_veneer_01 (timber frames; and the furniture kit's timber), plus rough_linen for upholstery through the furniture kit (`setRealism`). Not in this round: leather, rug, quartz or marble counter, brushed metal, deck timber, paving, rubber floor, door leaves (the leaf's grain is its own procedural shader and the flats' doors and frames are white laminate/paint), wet-room wall tile (stays procedural), and 2K for furniture other than oak veneer and linen.
**Mapping:** in world metres, trilinear mipmaps, anisotropy 16 (clamped to the GPU), correct colour spaces; the colour map multiplies the pack's colour as (texel / mean luminance of the map, clamped), so the finish colour is still the mean colour of the surface (16.2 rule 2). **Delivery:** `public/look/tex/realistic/<1k|2k>/<slug>/` (`scripts/fetch-realistic.mjs`: MD5 of every file checked against the Poly Haven API, recorded with SHA-256 in `realistic.lock.json`, licence in `LICENCE.txt`): 10.4 MB at 1K, 29.2 MB at 2K (the roughness map is always the 1K one); lazily loaded per family some material of the current space really uses, never on first paint, kept in the Cache API (`walkthru-realistic-v1`) as well as the HTTP cache (`Cache-Control: immutable` in `vercel.json`), cross-faded in over 0.7 s from procedural (no pop; a 1K set replaced by 2K stays on screen). Finishes remain illustrative and labelled as before; no size changes.

**Round 3 extension (the families that showed no gain).** The same sets, no new downloads: (1) a **door leaf** adopts the furniture kit's `laminate` normal (oak veneer, 0.6 m repeat, grain up the leaf) under its clear coat (`furnitureKit.adopt`), so a window or lamp leaves a soft sheen; (2) the furniture `laminate` key (wardrobe and carcass fronts) gets a faint oak-veneer emboss (colour 14 %, normal 0.22); (3) a new `quartz` key (kitchen worktop, now always stone: a pale quartz unless the pack's `top` role is itself stone) takes `grey_plaster` at 1K at both levels (colour 10 %, polish roughness 0.2); (4) a new `rug` key (woven rug, finer deeper linen, tile 0.22 m, normal 1.0) and a `felt` key (pool cloth, tile 0.09 m); (5) a **tiled wall** (wet rooms) takes the `tile` family as a normal only, confined to the tile (`lkTileIn`), the paint above untouched; (6) a matt floor (balcony, rubber gym floor) never takes the map's gloss range. The tile family's colour clamp was cut to 0.95..1.06 after a first look showed a polished lobby floor reading as dirty concrete at 0.82..1.22. Not covered at any level: leather, metal, glass, deck and paving (outdoor module has its own), rubber grain, the gym mirror.

## 17. C12 Generic drawing-set understanding

Mahir's rule for this section: his drawing was an example. The product must read **any** architect's or interior designer's drawing set, and builder brochure plans, produce everything the walk-through needs, and let the broker confirm it. Nothing may depend on his file.

Today that is not true. C8 reads plan geometry and real PDF text generically, but `public/scenes/son-bedroom/designs.json` (the parametric wardrobe, bed and headboard heights, side tables, study chair, door-swing gaps) was written by an agent reading the PDF by eye. C12 replaces the eye with a pipeline. Nothing in this section has been built or run; the accuracy bars are targets and every cost is an estimate.

### 17.1 Two rules that govern everything here

**Honesty (Mahir's): never present an unverified number as fact.** Every extracted value carries where it came from, how it was read and how sure we are, and has one of five statuses:

| Status | Meaning | May the buyer see it as a fact? |
|---|---|---|
| `verified` | Read as text **and** agrees with the drawing's own geometry (17.5) | Yes |
| `confirmed` | A broker looked at the crop and accepted it | Yes |
| `corrected` | A broker typed a different value | Yes (the broker's value) |
| `unverified` | Read (by OCR, a glyph matcher or a vision model) with nothing to check it against, or measured from geometry with no text | No. It may shape the 3D model, but any card or label that would state it says "Not confirmed" instead of the number |
| `conflict` | Two sources disagree (two sheets, a chain that does not sum, text against geometry) | No. Both values are shown to the broker; nothing is picked silently |

This applies to model output exactly as to OCR: a number read by a vision model is `method: 'vision'`, `status: 'unverified'` until the geometry check or the broker promotes it. `designs.json` and the buyer-facing parts of `proposal-extras.json` are written **only** from `verified`, `confirmed` and `corrected` values, so the existing buyer code cannot show an unverified number even by accident. Everything else stays in `understanding.json` for the review screen.

**Anti-overfit.** No code path may reference a scene id, a label text taken from a particular drawing, a project, a firm or a person. Vocabulary lives in data files of generic words. Thresholds are in drawing-independent units (wall thicknesses, metres after scale). The one real drawing set is a **development** sample only; acceptance is measured on synthetic sets and on held-out real sets the implementer never opens (17.11). A lint test enforces the first sentence (17.12).

### 17.2 What already exists that is tied to one drawing (found by grep on 13 Nov 2026; C12a fixes each)

| # | Where | What | Fix |
|---|---|---|---|
| 1 | `src/import/labels.ts:138` (`BEDROOM_RE`), with the comment on lines 136 to 137 saying it was widened because the reference drawing says "SON ROOM" | Family words `SON`, `DAUGHTER`, `KIDS`, `GUEST`, `PARENTS` hard-coded to make one file's test pass | Replace with the room lexicon (17.4). Rule: a label is a bedroom if it contains a bedroom word **or** is `<any words> ROOM` / `<any words> BED` whose qualifier is not a known non-bedroom word. Family words stay only as lexicon entries, because they are ordinary vocabulary, not because of that file |
| 2 | `src/import/labels.ts:135` (`ROOM_RE`) and `src/import/vector-page.ts:66` (`ROOM_WORDS`) | The same word list duplicated in two regexes | One lexicon, loaded by both |
| 3 | `src/import/furniture.ts:63`, `src/import/labels.ts:169` | `WARDROBE=9'0"RFT` handled as one exact shape | Keep the idea (running feet is a common Indian convention) but accept `WARDROBE 9'0" RFT`, `W/R`, `WARD.`, `R.FT`, `RUNNING FT`, metres, and any furniture word, through the furniture lexicon |
| 4 | `src/look/furniture-real.ts:53` and `:484` (`STUDY_CHAIR`), `src/look/designs.ts` (`DecorDesign.look: 'chair'`) | Per-item designs and a single decor look that exist because one drawing had a wardrobe and a swivel chair | Keep the mechanism; rename nothing; C12 feeds it for any drawing. New decor looks are out of scope (17.7) |
| 5 | `public/scenes/son-bedroom/designs.json` | Hand-written. Its `source` string names the PDF file, the sheet number and the project, which puts identifying details from the designer's drawing into the repo and onto the live site | Regenerate it with the pipeline; `source` becomes the generic "Imported drawing set, {n} pages". Until then, scrub that string |
| 6 | `tests/furniture-real.test.ts`, `tests/wardrobe-swing.test.ts` (both import the son-bedroom `designs.json` and `property.json`), `tests/import-units.test.ts` (fixture text `SON ROOM`) | Always-run tests whose expected numbers come from one real drawing | Point them at the synthetic drawing set's outputs (17.10). The real file may appear only in `*.local.test.ts` |
| 7 | `public/scenes/son-bedroom/` as a whole | A real client drawing's layout shipped as a public demo scene | Mahir's call whether it stays public. Not a code issue |

No scene-id comparison (`=== 'son-bedroom'` or similar) exists in `src/` or `scripts/`. That stays true.

### 17.3 Pipeline overview

```
PDF / image
  │
  ├─ S1  pages: render + classify (plan, elevation, section, detail, title/notes; vector or raster)
  ├─ S2  text: PDF text → stroke-glyph reader → local OCR → vision model   (each read is a candidate)
  ├─ S3  dimensions: find dimension lines, attach candidate reads, fit scale, cross-check   → statuses
  ├─ S4  plan: walls, rooms, openings (C8) + unlabelled symbols
  ├─ S5  elevations: link each to a wall of the plan, then read built-in units and heights
  ├─ S6  reconcile sheets: agreements raise confidence, disagreements become conflicts
  └─ S7  write understanding.json → proposal.json, proposal-extras.json, designs.json
                │
                └─ broker review (17.9) writes review.json → S7 runs again
```

Vector input uses every stage. Raster input (a phone photo of a plan, a brochure JPG) has no geometry of its own, so S2 to S5 run through the vision model and everything starts `unverified` (17.8).

**Files (all new unless listed in 17.2):**
```
src/understand/
  types.ts            Extracted<T>, statuses, UnderstandingFile, ReviewFile (17.6)
  lexicon/rooms.json  furniture.json  fixtures.json  elevation.json  units.json   (generic vocabulary only)
  lexicon.ts          loaders and matchers
  pages.ts            S1
  text-pdf.ts         S2: real text (wraps C8's labels)
  glyphs.ts  hershey.ts   S2: stroke-glyph reader and its public-domain templates
  ocr.ts              S2: adapter that calls the local OCR helper (Node only)
  dimensions.ts       S3: dimension-line detection, attaching reads, chains
  scale-fit.ts        S3: robust scale from many dimensions
  verify.ts           S3 and S6: the checks and the status rules
  symbols.ts          S4: unlabelled plan symbols
  elevation-link.ts   S5: which elevation is which wall
  elevation-read.ts   S5: built-in units, heights
  reconcile.ts        S6
  write.ts            S7: the three output files
  vision/provider.ts  the interface (extends C8's PlanVisionProvider)
  vision/gemini.ts  vision/claude.ts  vision/prompts.ts  vision/recorded.ts
  raster.ts           the raster path
  review-step.ts  review.css          the editor step (17.9)
  server/understand-api.ts            dev middleware: upload, run, page images, review
  photo/              the optional AI photo (17.14)
tools/understand/ocr.py               Tesseract / RapidOCR helper, run in the C10 venv
scripts/understand.ts                 CLI: tsx scripts/understand.ts <file> --scene <id> [--no-vision] [--live]
scripts/make-drawing-sets.ts          the synthetic generator (17.10)
scripts/eval-understand.ts            scores a folder of sets against truth (17.11)
tests/understand-*.test.ts            always run; no network, no real file
tests/understand-real.local.test.ts   only when real samples are present
```
`src/understand/` reuses C8's `VectorPage`, wall, region, opening and scale code. Only `ocr.ts`, `vision/*.ts` (not `recorded.ts`), `server/` and `photo/server` may touch the network or spawn processes.

### 17.4 S1 pages and the lexicons

**Render.** Each page to PNG at 200 dpi with `pdftocairo` (poppler, already installed) into `.cache/understand/<sceneId>/pages/`. The source PDF and its renders never enter `public/` or the repo.

**Vector or raster, per page.** Raster when images cover more than half the page and there are fewer than 200 strokes plus fills (C8's rule). A scanned PDF is raster.

**Kind**, scored from several weak signals, so no single word decides:
- title-block and caption words from `lexicon/elevation.json` (`PLAN`, `LAYOUT`, `FURNITURE LAYOUT`, `ELEVATION`, `ELEV`, `VIEW`, `WALL A`, `SECTION`, `DETAIL`, `INTERNAL`, `NOTES`, `LEGEND`, `SCHEDULE`);
- geometry: a plan has closed wall loops and room labels and no long horizontal ground line; an elevation or section has one dominant ground line, a ceiling or slab band and mostly rectangular content between them; a detail is small and dense; a title or notes page is mostly text;
- result: `plan | elevation | section | detail | notes`, with a confidence. Below 0.6 the page is offered to the vision model for a second opinion (one word answer) and, failing that, to the broker.
A sheet may hold several drawings (a plan and two elevations on one page). Split a page into **views** first: connected groups of linework separated by white gaps wider than 5% of the page, each with its nearest caption. Everything downstream works on views, not pages.

**Lexicons** are JSON data, generic, lower-cased, with common abbreviations and Indian usage:
- `rooms.json`: for each `RoomType`, the words that imply it. Bedroom: `bedroom, bed room, bed, br, mbr, m.bed, master, guest, kids, children, child, son, daughter, parents, grandparents, servant`. Living: `living, hall, drawing, lounge, family, liv, l/d`. Kitchen: `kitchen, kit, pantry`. Bathroom: `toilet, bath, wc, w.c., washroom, powder, c.toilet, m.toilet, att. toilet`. Balcony: `balcony, terrace, deck, sit-out, verandah, utility, dry balcony, wash area`. Other: `passage, lobby, foyer, corridor, store, pooja, puja, mandir, study, dress, dressing, entrance`. Plus a list of non-room words that often sit in rooms (`duct, shaft, lift, stair, ots`).
- `furniture.json`: words to catalogue kinds (`bed, cot` → bed; `sofa, settee, couch` → sofa; `dining` → dining; `wardrobe, w/r, ward., almirah, cupboard` → wardrobe; `study, desk, table, counter, platform, side table, bedside, dresser, tv unit, console` → counter with a sub-look), and the running-length markers.
- `fixtures.json`: `wc, ewc, basin, wb, sink, hob, shower, ref, fridge, wm, ac, sb, db, geyser`.
- `units.json`: patterns for feet and inches (`2'-11"`, `2'11"`, `8'-6"`, `1'-5½"`, `1'-5 1/2"`, `12'0"X9'0"`, `11'0" x 12'6"`), millimetres (`2440`, `900 MM`), metres (`3.05`, `3.05 M`), areas (`150 SQFT`, `150 SQ.FT.`, `14 SQ M`), and the fraction glyphs.
Adding a word needs no code change. A word may be added only if it is ordinary vocabulary; a name, a project or a firm is never a lexicon entry.

**Units.** Decided per string from its format, not from a note: `'` or `"` means feet and inches; a bare integer of 3 to 5 digits on a dimension line means millimetres; a decimal with a metre marker means metres. A notes page saying "all dimensions in mm" while the strings are in feet and inches (which the development sample does) is recorded as a warning, and the strings win.

### 17.5 S2 and S3: reading text, and checking it against geometry

**Candidate reads, cheapest first.** Each text-like region gets every reader that applies; all results are kept as candidates with their method.

1. **PDF text** (`method: 'pdf-text'`): exact where present.
2. **Stroke-glyph reader** (`method: 'glyph'`, local, pure TypeScript): for dimension strings drawn as vector strokes, which is what exploded CAD fonts produce. Group strokes into glyphs (strokes whose boxes touch within a text-height band along the dimension line), normalise each glyph to a unit box, and match against stroke templates of the digits, `'`, `"`, `-`, `.`, `/`, `½`, `X` built from the **Hershey** fonts (public domain; the common CAD stroke fonts descend from them): Simplex, Duplex, Complex. Identical glyph shapes recur throughout a drawing, so cluster them first and label clusters, not instances. A cluster's label is accepted when the template distance is under a threshold **or** when at least three independent dimension lines agree on it; the dimension being verified never counts as its own evidence.
3. **Local OCR** (`method: 'ocr'`): `tools/understand/ocr.py`, run in the C10 Python venv. For each text region: crop from the page render at 600 dpi, rotate it upright (the dimension line's direction is known from geometry, so no skew guessing), and run **Tesseract 5** (`brew install tesseract`, Apache-2.0; not installed yet) in single-line mode with a character whitelist of digits, `'`, `"`, `-`, `.`, `/`, `½¼¾`, `xX`, `mM`, space. **RapidOCR** (the PaddleOCR models on ONNX Runtime, Apache-2.0) is the second local engine if it installs cleanly on the M2; PaddleOCR itself only if RapidOCR does not. Two engines agreeing raises confidence; they never verify each other.
4. **Vision model** (`method: 'vision'`, 17.8): batches of crops, each with an id, returning the string and a box. Used for regions the local readers left empty or disagreed on, and for all text on raster pages.

A parsed length keeps its raw string. `parseLength` (C0) is extended in a new helper, not edited, to accept `2'-11"`, fractions and the fraction glyphs.

**Dimension lines** (`dimensions.ts`). A dimension is a straight stroke with a terminator at each end (a tick crossing it at 30° to 90°, an arrowhead, or a dot), usually with two extension lines leaving it at right angles, and a text region within 1.5 text heights of its middle, parallel to it. Output: the two end points in page units, the direction, and the attached candidate reads. A **chain** is a run of dimensions sharing a line and end points; an **overall** is a dimension spanning a chain.

**Scale** (`scale-fit.ts`). Every dimension with a parsed read gives a pair (length in page units, value in metres). Fit page-units-per-metre per view by RANSAC over those pairs: a pair is an inlier when it is within 2% or 1 inch (25 mm), whichever is larger. The fit needs at least 3 inliers that are not all collinear repeats of one value; otherwise the view falls back to C8's label voting and every value in it stays `unverified`. Report the inlier count and the spread.

**The checks** (`verify.ts`). A value is `verified` only when a text read passes at least one independent check and fails none:
- **Geometry:** the read value equals the dimension's measured length times the view's scale, within the larger of 2% and 1 inch. The read must not have contributed its own pair to the scale fit alone: the fit is redone leaving that dimension out.
- **Chain:** the members of a chain sum to its overall within 1 inch (or 25 mm).
- **Cross-sheet:** the same physical quantity read on two sheets (a wardrobe's width on the plan and on its elevation) agrees within 1 inch.
- **Label area:** a room's labelled area agrees with its traced polygon within 3%.
A read that fails geometry is `conflict` with both numbers kept ("drawing says 2'-11", measures 3'-1""). A length measured from geometry with no readable text is `unverified`, `method: 'vector'`, and is worded "about" wherever the broker sees it. Drawings marked "not to scale" still go through the fit; if fewer than 80% of dimensions are inliers, the view is flagged "not drawn to scale" and geometry checks are replaced by chain and cross-sheet checks only.

`confidence` (0 to 1) is for ordering the review queue, not for deciding facts: 0.99 for verified pdf-text, 0.95 for verified glyph or OCR, 0.6 for an unverified read where two methods agree, 0.4 for one method alone, 0.3 for geometry-only, 0.2 for vision alone on a raster page.

### 17.6 Data: `understanding.json`, `review.json`, and the three outputs

Types in `src/understand/types.ts` (nothing added to `src/types.ts`):

```ts
export type Method = 'pdf-text' | 'glyph' | 'ocr' | 'vision' | 'vector' | 'derived' | 'broker';
export type Status = 'verified' | 'confirmed' | 'corrected' | 'unverified' | 'conflict';
export interface SourceRef { page: number; view: string; sheet: string; /** page units, y down */ bbox: [number, number, number, number]; text?: string }
export interface Check { kind: 'geometry' | 'chain' | 'cross-sheet' | 'label-area'; expected: number; got: number; ok: boolean }
export interface Extracted<T> {
  id: string;                 // stable: hash of field path + source bbox
  value: T; unit?: 'm' | 'm2' | 'deg' | 'count';
  method: Method; status: Status; confidence: number;
  source: SourceRef; alternatives?: { value: T; method: Method; source: SourceRef }[];
  checks: Check[];
  /** for 'derived': the ids it was computed from, and the formula in words */
  derivedFrom?: { ids: string[]; how: string };
}
export interface UnderstandingFile {
  version: 1;
  input: { kind: 'vector-pdf' | 'raster-pdf' | 'image'; pages: number; sha256: string };   // never the file name
  views: { id: string; page: number; kind: string; kindConfidence: number; raster: boolean; scale?: Extracted<number> }[];
  dimensions: { id: string; view: string; a: [number, number]; b: [number, number]; value: Extracted<number>; chain?: string }[];
  rooms: { id: string; label: Extracted<string>; roomType: Extracted<string>; polygonM: [number, number][]; width: Extracted<number>; length: Extracted<number>; area: Extracted<number> }[];
  openings: { id: string; roomId: string; type: Extracted<string>; width: Extracted<number>; sill?: Extracted<number>; head?: Extracted<number> }[];
  items: { id: string; kind: Extracted<string>; label?: Extracted<string>; box: { cx: number; cz: number; w: Extracted<number>; d: Extracted<number>; yawDeg: number };
           height?: Extracted<number>; surfaceHeight?: Extracted<number>; unit?: UnitDesign; elevationView?: string }[];
  symbols: { id: string; view: string; class: Extracted<string>; bbox: [number, number, number, number]; mappedTo?: string }[];
  elevations: { view: string; wall: Extracted<{ roomId: string; edge: number }>; ceiling?: Extracted<number>; levels: Extracted<number>[] }[];
  conflicts: { id: string; field: string; values: string[]; message: string }[];
  warnings: string[];
  cost?: { visionCalls: number; inputTokens: number; outputTokens: number; usd: number; seconds: number };
}
/** A built-in unit read from an elevation: the general form of the wardrobe in designs.json. */
export interface UnitDesign {
  bays: Extracted<number>; bayWidths: Extracted<number>[];
  shuttersPerBay: Extracted<number>[]; hinge: Extracted<'left' | 'right' | 'outer-edges' | 'unknown'>[];
  drawerStrip?: Extracted<number>; baseGap?: Extracted<number>; loft?: Extracted<number>;
  handle?: { y: Extracted<number>; length: Extracted<number> };
  interior?: { bay: number; zonesBottomUp: { kind: string; height: Extracted<number> }[] }[];
}
export interface ReviewFile { version: 1; decisions: Record<string /* Extracted id */, { action: 'confirm' | 'correct' | 'reject'; value?: unknown; at: string }> }
```

**Outputs** (`write.ts`), all under `public/scenes/<id>/`:
- `proposal.json` and `proposal-extras.json`: C8's shapes, unchanged. Rooms whose size is not verified or confirmed keep C8's existing "Not measured" treatment.
- `designs.json`: the existing `DesignsFile` shape that `src/look/designs.ts` already parses. A field is written only if its `Extracted` is `verified`, `confirmed` or `corrected`; its `sources` entry is `{ page, sheet, text }` from the `SourceRef`. `openable.conflicts` and `cardConflict` are filled from `conflicts`. `openable.notInDrawing` lists the fields the unit needed and the drawing did not give. `source` is the generic sentence in 17.2 row 5.
- `understanding.json` and `review.json` live in `.cache/understand/<id>/`, not in `public/`: they contain crops' coordinates and raw label text from someone's drawing.

### 17.7 S4 and S5: symbols, linking elevations, reading units

**Plan symbols with no label** (`symbols.ts`). Two passes.
- *Structure:* drawings place furniture and fixtures as repeated blocks. Group strokes into candidate symbols (connected components not attached to walls, between 0.15 m and 3 m across after scale), compute a shape signature invariant to position, rotation and mirror (sorted normalised segment lengths, turning-angle histogram, counts of arcs and closed loops), and cluster equal signatures.
- *Rules, in metres:* door swing (a quarter arc of radius equal to the gap it starts at, with a leaf line); sliding door (two overlapping thin rectangles in a gap); window (two or more thin parallel lines in a gap); bed (a rectangle at least 0.85 × 1.8 m with one or two smaller rectangles at one short end); sofa (a rectangle 0.75 to 1.0 m deep with end blocks and seat divisions); dining set (a rectangle with four or more chair shapes around it); chair (0.4 to 0.6 m square with one bowed or thickened side), swivel chair (a seat on a star or circle); wardrobe (a rectangle 0.5 to 0.7 m deep against a wall holding a row of repeated short strokes, the hanger symbol, or shutter swing arcs); WC (an oval with a tank rectangle, about 0.38 × 0.7 m); basin (an oval or rounded rectangle 0.4 to 0.6 m at a wall); shower (a square with a diagonal cross or a circle); sink (one or two rounded rectangles inside a counter); hob (two to four circles in a rectangle).
- Symbols the rules cannot name go to the vision model as crops ("what is this plan symbol?", choices from the lexicons plus "other"). A model-named symbol is `unverified` until the broker confirms.
- Mapping: bed, sofa, dining, wardrobe and counter become furniture items (`source: 'real'`), sized from the symbol's box (`method: 'vector'`, so sizes are `unverified` unless a label or elevation dimension verifies them). A chair at a table becomes the existing `chair` decor. Sanitary and kitchen fixtures (WC, basin, shower, sink) are recorded in `symbols` and in `proposal-extras.json` `fixtures`, and the buyer page draws them (16.16); AC units, switchboards and hobs are recorded only, there is no look for them yet.

**Which elevation shows which wall** (`elevation-link.ts`). Three signals, combined into one score per (elevation, wall) pair and solved as an assignment:
1. **The key.** A marker on the plan (a circle, diamond or cross with numbers or letters around it, or arrows tagged 1 2 3 4 / A B C D) gives a view direction per tag; elevation captions carry the tag (`ELEVATION-3`, `ELEVATION C`, `WALL 2`). The tag's position relative to the marker's centre is the direction it looks.
2. **Width.** The elevation's clear width between its end walls, at the elevation's own scale, against the length of each wall run of the room.
3. **Content.** The sequence of things along the wall (window, door, wardrobe, bed head) with their offsets, compared with the plan's sequence along that wall, read left to right as seen from inside the room; the mirrored order is also tried and penalised.
An elevation with no room on the plan (a detail, an internal view of a unit) links to its parent elevation by caption (`1A` under `1`, `INTERNAL`) and matching width. A link under 0.6 confidence is `unverified` and goes to the broker as one question: "Which wall is this?" with the plan beside it.

**Reading an elevation** (`elevation-read.ts`).
- **Levels:** the floor line, the ceiling or slab soffit, and every long horizontal line between them, each with the vertical dimensions that end on it. Named by nearby words or by typical height: skirting, sill, lintel or door head, loft line, ceiling.
- **Openings:** window sill and head, door height, matched to the plan's openings on that wall.
- **Built-in units** (wardrobes, kitchen runs, TV units, study units), as a `UnitDesign`: the unit is the rectangular region from the floor (or a base gap) upward that the plan shows as a built-in on that wall. Bays are separated by full-height vertical lines; shutters by vertical lines inside a bay; drawers are wide short rectangles, usually stacked; a loft is a row above about 2.1 m. **Hinge side:** from the handle (a small bar or dot near one vertical edge of a shutter: the hinge is the other edge) and from the opening mark (thin or dashed lines meeting in a point on the shutter: the point is at the hinge side by drafting convention). The two signals must agree or the hinge is `conflict`; neither present gives `unknown`, and the walk-through then does not open that shutter. Notes such as "2 SHUTTER OPENABLE", "SLIDING", "DRAWER", "LOFT", "HANGING", "SHELF" are matched through the lexicon.
- **Internal layouts** on a linked internal view: zones bottom-up per bay with their heights.
- **Loose furniture in elevation:** bed base, mattress and headboard heights, side-table and study-table heights, from the vertical dimension stacks beside them and words like "MATTRESS".
- **Services:** AC, switchboard and socket positions are recorded with heights, for later use.
Every number goes through 17.5: a height is `verified` when its string matches the elevation's geometry at the elevation's scale, and more so when a stack sums to the ceiling height.

**Reconciling sheets** (`reconcile.ts`). The same quantity seen twice is merged when the two agree (confidence up, a `cross-sheet` check recorded). When they disagree the item gets a `conflict` naming both, for example plan bays 2'-11", 2'-11", 3'-1" against an elevation showing three bays of 2'-11". The 3D model uses the value from the sheet that dimensions the thing most directly (an elevation for heights and bay widths, the plan for depths and positions), the card for that item carries the conflict sentence, and nothing is called a fact until the broker chooses.

### 17.8 The vision path, models and keys

**Interface.** `vision/provider.ts` extends C8's `PlanVisionProvider` with crop-level calls, so the pipeline can ask small questions cheaply:
```ts
export interface VisionProvider {
  readonly name: string; readonly model: string;
  readStrings(crops: { id: string; png: Uint8Array; hint?: 'dimension' | 'label' | 'note' }[]): Promise<{ id: string; text: string; box?: [number, number, number, number]; confidence: number }[]>;
  classify(crops: { id: string; png: Uint8Array }[], choices: string[]): Promise<{ id: string; choice: string; confidence: number }[]>;
  /** whole page or view: rooms, labels, dimensions, symbols, each with a box in image pixels */
  readView(png: Uint8Array, kind: 'plan' | 'elevation', schema: object): Promise<unknown>;
  usage(): { calls: number; inputTokens: number; outputTokens: number; usd: number };
}
```
Every answer must carry a box; an answer without one is dropped. Boxes let the pipeline attach a model's read to a dimension line or a symbol and run the same checks as for any other reader.

**Which model reads drawings.** Nano Banana is an image generator, not a reader; it is used only for the optional photo (17.14). For reading:
- **Default: Google Gemini**, on Mahir's own AI Studio key, in two sizes: `gemini-3.8-flash` for the many small crop reads and symbol classifications, and `gemini-3.1-pro-preview` for whole-view reads of raster plans and for regions where readers disagree. Reasons: Mahir has offered that key; the Flash model is cheap enough to send every unread dimension crop; and one provider covers both sizes. Prices on Google's pricing page on 13 Nov 2026: 3.8 Flash $0.75 in / $3.75 out per million tokens (doubling on 1 Jan 2027), 3.1 Pro $2 / $12, batch 50% off. `gemini-4-carbon` is listed as the top model at $2 / $10 until 30 Nov 2026 and $4 / $20 after; it is a third option to compare in the evaluation, not the default. The 2.5 models are deprecated on 1 Dec 2026, so they are not used. Whether these models return usable boxes on drawings is not confirmed from documentation; it is the first thing the evaluation measures.
- **Alternate: Claude**, behind the same interface, on Mahir's own Anthropic key if he supplies one: `claude-opus-5-5` ($4 / $20 per million tokens) for whole views, with structured outputs. Written with the official `@anthropic-ai/sdk`.
- The choice between them is made by the evaluation's numbers (17.11), not here.

**Keys.**
- Local: `~/walkthru-tools/.gemini-key` and, optionally, `~/walkthru-tools/.anthropic-key`. On Vercel: env vars `WALKTHRU_GEMINI_KEY` and `WALKTHRU_ANTHROPIC_KEY`, read only inside serverless functions.
- Never in the client bundle, never in the repo, never logged.
- **The GTM Console's Anthropic key is never used.** The Claude client is always constructed with the key passed explicitly from the walkthru key file or `WALKTHRU_ANTHROPIC_KEY`; the SDK's default lookup of `ANTHROPIC_API_KEY` is not relied on, and the code refuses to start a vision run if the only key it can find is that generic variable.
- **No test calls a live model.** Tests use `vision/recorded.ts`, which replays saved answers for the synthetic sets. A live run happens only through `scripts/understand.ts --live` or `scripts/eval-understand.ts --live`, which first print the number of calls and an estimated cost and need `--yes`.

**Raster input** (`raster.ts`). The page image goes to `readView` once per view; the answer is turned into the same `UnderstandingFile`. Walls come from the model's room boxes and corner points, refined by snapping to dark line pixels in the image; dimension strings are read from crops; scale comes from labelled room sizes and any dimension lines the model boxed, fitted as in 17.5 but against measured pixel lengths. Everything starts `unverified` at confidence 0.2 to 0.4; a value becomes `verified` only where a boxed dimension line's pixel length agrees with the fitted scale and a chain or label area backs it up. In practice a raster plan gives a layout to correct and confirm in the editor, not facts.

### 17.9 Broker review in the editor

A new step, **"Check the drawing"**, registered once in the editor's step list (one line in `src/editor/main.ts`, added by the integrator) and shown whenever `.cache/understand/<id>/understanding.json` exists.

- Left: the drawing page, zoomable, with the current value's source box outlined. Right: a queue of values, lowest confidence first, conflicts at the top.
- Each row: what it is ("Wardrobe · bay 2 width"), the value, how it was read ("read from the drawing and matches its scale" / "read by OCR, not checked" / "measured from the drawing, no dimension printed" / "read by AI, not checked"), and a tight crop of the source.
- Actions per row: **Confirm** (one click or Enter), **Correct** (type a value; feet and inches or metric), **Not in the drawing** (reject). Conflicts show both crops side by side with "Use this one" under each.
- Colour: verified values are collapsed under "Checked against the drawing ({n})" and need no action; unverified are amber; conflicts red.
- "Confirm all on this page that match the drawing's scale" is offered only for rows that are already `verified`; there is deliberately no bulk confirm for unverified values.
- A counter: "{k} of {n} values need a look". Saving writes `review.json` and reruns `write.ts`, so the 3D preview and `designs.json` update at once.
- The step is done when no `conflict` remains. Unverified values may remain; they simply stay out of buyer-facing facts.
- Server (`server/understand-api.ts`, registered beside the media plugin with one line in `vite.config.ts`): `POST /api/scenes/:id/understand` (upload a PDF or image, streamed to `.cache`), `POST …/understand/run`, `GET …/understand/status`, `GET …/understand/page/:n.png`, `GET` and `PUT …/understand/review`.

### 17.10 Synthetic drawing sets

`scripts/make-drawing-sets.ts` generates whole sets with exact truth, as real PDFs (the hand-written PDF writer from C8's fixture, extended) and as rasterised JPGs of the same pages. Each set is drawn from a seeded description, so any failing set can be regenerated from its seed.

**What varies, independently:**
- **Flat:** 1 to 4 rooms from templates (studio, 1 BHK, 2 BHK, 3 BHK, a single bedroom like an interior designer's sheet), room sizes drawn from realistic ranges, optional balcony, toilet with fixtures, kitchen with counter, passage.
- **Wall style:** solid fill (dark, grey, or two greys), double lines with no fill, hatched fill.
- **Text:** real PDF text or stroke text (Hershey Simplex, Duplex or Complex, with random slant and width); upper or mixed case.
- **Units:** feet and inches in four formats (`2'-11"`, `2'11"`, `2' 11"`, with and without fractions) or millimetres or metres; areas in sq ft or sq m.
- **Labels:** builder-brochure style (`BED ROOM 11'0"X12'0"`, `TOILET 5'0"X8'0"`, `KITCHEN`, `BALCONY`, `LIVING/DINING 10'0"X18'6"`) or designer style (room name, separate dimension chains, furniture labels with sizes), or no room labels at all.
- **Dimensions:** chains and overalls on some walls; tick, arrow or dot terminators; a configurable share of dimension strings rounded so that geometry and text differ by up to 2 inches (to exercise conflicts), and one deliberately wrong string in some sets.
- **Symbols:** door swings or sliding doors, windows as 2 or 3 lines, beds, sofa, dining set, chairs, wardrobe with hanger strokes, WC, basin, shower, sink, hob; each from two or three drawing variants; labelled or not.
- **Sheets:** plan only (brochure), or plan plus 2 to 5 elevations with a key marker (numbers or letters), captions in three styles, each elevation at its own scale; some elevations on the same page as the plan.
- **Elevation content:** a wardrobe with 2 to 5 bays, 1 or 2 shutters a bay, handles and opening marks (sometimes only one of the two, sometimes neither, sometimes disagreeing), a drawer strip, a loft, a base gap; a bed with base, mattress and headboard heights; windows with sill and head; an optional internal view.
- **Page:** A4 or A3, rotation 0 / 90 / 180 / 270, a title block with invented generic text, optional hatching and noise glyphs, "not to scale" in some sets.
- **Raster variants:** the pages rendered at 100 to 200 dpi, JPEG quality 40 to 90, and a "phone photo" variant with a perspective warp of up to 8°, uneven lighting and blur.

**Truth** for each set: the layout, every dimension's value and position, every symbol's class and box, the elevation-to-wall links, each unit's full `UnitDesign`, and which strings were made deliberately inconsistent. Recorded vision answers for these sets are generated from truth with seeded noise (a share of misreads and missing boxes), so the recorded provider behaves like an imperfect model without any network call.

Sizes: `npm test` uses 24 fixed sets (seeds 1 to 24, covering every option at least twice); `scripts/eval-understand.ts --synthetic 300` runs a larger sweep on demand.

### 17.11 Evaluation: real samples, metrics, bars

**What is needed from Mahir.** One real set cannot show generality. The minimum for a meaningful measure is **20 real drawing sets**, kept outside the repo in `~/walkthru-tools/eval/real/`:

| Group | How many | Variety wanted |
|---|---|---|
| Interior-designer or architect sets (plan plus elevations), vector PDF | 8 | at least 5 different firms; bedrooms, a living room, a kitchen; feet-and-inches and millimetre drawings |
| Builder brochure floor plans | 8 | at least 6 builders; 1, 2 and 3 BHK; about half as PDF and half as JPG or PNG from a website or WhatsApp |
| Phone photos of a printed plan | 4 | different lighting and angles |

For each, ten facts someone has checked by hand (for example two room sizes, the ceiling height, a wardrobe's bay count and one bay width, a door width, a bed size), entered through the review screen and saved as that set's truth. Split: **6 development sets** (including the existing one) that the implementer may look at, **14 held-out sets** that are only ever scored by the script. A firm's drawings never sit on both sides of the split.

**Metrics and bars** (a field counts as right when within the tolerance; bars are for vector sets / raster sets):

| Field | Tolerance | Bar: vector | Bar: raster |
|---|---|---|---|
| Rooms found and typed (F1) | type must match | ≥ 0.92 | ≥ 0.80 |
| Room width and length | 2% | ≥ 90% right | ≥ 70% |
| Room area | 3% | ≥ 90% | ≥ 70% |
| Openings (F1), and width | 5 cm | ≥ 0.85, ≥ 85% | ≥ 0.65, ≥ 60% |
| Dimension strings read (exact string) | exact | ≥ 95% of those present | ≥ 85% |
| Labelled or symbol furniture found (F1), size | 5 cm | ≥ 0.85, ≥ 85% | ≥ 0.65, ≥ 60% |
| Fixtures and chairs classified (F1) | class | ≥ 0.80 | ≥ 0.65 |
| Elevation linked to the right wall | exact | ≥ 90% | not applicable |
| Ceiling, sill, head, bed and table heights | 2 cm | ≥ 90% | not applicable |
| Unit bays and shutters per bay | exact | ≥ 85% | not applicable |
| Hinge side, where the drawing shows it | exact | ≥ 85%, and never a wrong side marked verified | not applicable |
| **Verified values that are wrong** (the honesty metric) | as above | **≤ 0.5%** | **≤ 0.5%** |
| Conflicts planted in synthetic sets that were surfaced | flagged | ≥ 95% | ≥ 80% |
| Share of values the broker must look at | count | ≤ 30% | ≤ 100% |
| Broker review time per set (measured with Mahir or a colleague) | minutes | ≤ 10 | ≤ 20 |

The honesty bar is the one that may never be traded for the others: if making more values `verified` raises the wrong-verified rate above 0.5%, the checks are tightened and coverage is allowed to fall. Each bar is reported three ways: synthetic, real development, real held-out. A gap of more than 10 points between development and held-out on any field is itself a failure (it means the code learned the development files).

### 17.12 Acceptance for the build

Always run (`npm test`, no network, no real file):
1. **Lint against overfitting** (`tests/no-overfit.test.ts`): no file under `src/` or `scripts/` contains the name of any folder in `public/scenes/` other than those starting `test-`; none compares a scene id to a string literal; lexicon files contain only lower-case words of at most 3 tokens and none of the entries in the optional local file `~/walkthru-tools/eval/denylist.txt` (names of firms, projects and people from real samples, kept outside the repo); the regexes `BEDROOM_RE`, `ROOM_RE` and `ROOM_WORDS` no longer exist.
2. The findings in 17.2 rows 1 to 6 are fixed: `SON ROOM`, `KIDS BEDROOM`, `BED-2`, `M.BED`, `GUEST ROOM` and `GRANDPARENTS ROOM` all type as bedroom through the lexicon; `STORE ROOM`, `POOJA ROOM` and `STUDY ROOM` do not; the three previously file-bound tests run on synthetic outputs with unchanged assertions about behaviour.
3. `units`: `2'-11"` = 0.889 m, `8'-6"` = 2.591 m, `1'-5½"` and `1'-5 1/2"` = 0.4445 m, `12'0"X9'0"` = 3.658 × 2.743 m, `2440` on a dimension line = 2.44 m, `3.05 M` = 3.05 m; each within 0.5 mm.
4. **Glyph reader:** on stroke-text synthetic sets in all three Hershey fonts with slant up to 15°, at least 97% of dimension strings are read exactly; on a font the templates do not include (a seeded distortion of Simplex), reads fall back to clusters confirmed by three dimensions, and no wrong read becomes `verified`.
5. **Dimension detection:** at least 97% of truth dimensions found, with end points within 1.5 pt; chains and overalls identified.
6. **Scale fit:** within 0.5% of truth on every vector set with at least 3 dimensions; sets marked "not to scale" are flagged as such.
7. **Statuses:** every planted wrong string ends as `conflict`, never `verified`; every correct string with a matching dimension line ends `verified`; reads from the recorded vision provider are `unverified` unless a geometry check passes; no `unverified` or `conflict` value appears in any generated `designs.json`.
8. **The 24 synthetic sets** meet every vector bar in 17.11, and their rasterised twins meet every raster bar, using the recorded vision provider.
9. **Elevation link:** correct for at least 90% of elevations across the 24 sets, including sets with no key marker (width and content only).
10. **Units:** bays, shutters per bay, drawer strip, loft and base gap exact for at least 85% of synthetic units; hinge side right wherever a handle or an opening mark is drawn; `unknown` when neither is; `conflict` when the two disagree.
11. **Generated `designs.json`** for a synthetic set with a three-bay wardrobe loads through `parseDesigns`, drives the existing openable-wardrobe code, and its door-swing clearance equals the truth within 1 cm.
12. **Review:** applying a `ReviewFile` that confirms one value, corrects one and rejects one changes exactly those three in the regenerated outputs, and the corrected value carries `method: 'broker'`.
13. **Keys:** with only `ANTHROPIC_API_KEY` set in the environment, the Claude provider refuses to run and says why; no test opens a network socket (asserted by stubbing `fetch` and the SDK transport to throw).

Local only (`tests/understand-real.local.test.ts`, skipped when `~/walkthru-tools/eval/real/` is absent): runs `scripts/eval-understand.ts` on the development sets and prints the table of 17.11; it asserts only the honesty bar (wrong-verified ≤ 0.5%) and that no crash occurs. The held-out sets are scored by the integrator, not by the chunk's agent.

In the browser: the "Check the drawing" step on a synthetic set: the queue orders conflicts first, a click confirms, a correction updates the 3D preview within a second, and the page crop matches the row.

### 17.13 Cost, latency, and where things run

| Stage | Where | Time per set (estimate) | Cost |
|---|---|---|---|
| Render, classify, vector parse, glyph reader, dimensions, scale, symbols, elevations | the Mac (Node), later any server | 20 to 60 s | none |
| Local OCR (Tesseract, about 150 crops) | the Mac (Python helper) | 20 to 60 s | none |
| Vision reads of leftover crops (Flash) | Google API | 20 to 60 s, in parallel | about $0.05 to $0.15 |
| Whole-view reads (Pro), only for raster pages and disagreements | Google API | 30 to 90 s | about $0.05 to $0.15 per page |

- A vector designer set like the development sample (6 pages) should cost **about $0.10 to $0.40** and take **2 to 4 minutes**, most of it local. A brochure JPG (one page, all vision) about $0.10 to $0.30 and 1 to 2 minutes. With `gemini-4-carbon` or `claude-opus-5-5` for the whole-view reads, roughly double the vision part. With `--no-vision` the cost is zero and unread strings simply stay unverified.
- These are estimates from the published prices and guessed token counts (the price page does not state how these models count image tokens). `understanding.json` records actual calls, tokens and dollars for every run, and the evaluation reports cost per set.
- The pipeline is a queue job like C9's and can move to a cloud worker unchanged; the vision calls already are remote. Nothing here needs a GPU.

### 17.14 Optional: "AI photo" of the current view (Nano Banana)

Where an image model does belong. A buyer taps "AI photo" and gets one photoreal still of what they are looking at.

- **Flow:** the client sends the current canvas frame (1024 px on the long side, JPEG) and a **guide image** of the same view (white walls, each furniture item and wall edge drawn as dark lines, rendered by the app) to a server function. The function calls an image model with both and a fixed prompt: keep the exact room shape, openings and furniture positions and sizes; make it look like a photograph; do not add or remove furniture. It returns one image.
- **Model:** `gemini-nano-banana-2.1` (listed at about $0.034 per 1K image) by default; `gemini-3-pro-image` (about $0.13) as the quality option. Mahir's Google key, server side only: the local dev middleware reads `~/walkthru-tools/.gemini-key`; on Vercel a serverless function `api/photo.ts` reads `WALKTHRU_GEMINI_KEY`.
- **Size sanity check, before the buyer sees it:** the app knows where every furniture box's and every wall corner's edges project on screen. Sample points along those projected edges and require, in the returned image, an image edge within 1.5% of the diagonal for at least 80% of the points on each item and at least 85% overall; also require the two images' edge maps to agree (mean nearest-edge distance under 1% of the diagonal). A failing image is discarded and one retry is made; a second failure shows "Could not make a faithful photo of this view." and nothing else.
- **Label,** drawn into the image itself and shown under it: "AI photo · illustrative, sizes not guaranteed". The walk-through stays the source of truth; no measurement is ever taken from the photo; the photo never replaces the 3D view.
- **Limits:** lazy (nothing loads until tapped), at most 3 per visit and a daily cap from an env var, the feature off unless `WALKTHRU_PHOTO_ENABLED` is set. Each image costs a few cents and takes roughly 5 to 15 seconds (estimate).
- **Acceptance:** with a stubbed image model, an output shifted by 5% of the width or with one item erased is rejected, and an output that is the input with noise passes; the label is present in the pixels; no key appears in the built client bundle (grep of `dist/`).

**As built (C12f).** Files: `src/photo/` (`config.ts`, `geometry.ts`, `edges.ts`, `label.ts`, `mount.ts`, `session.ts`, `photo.css`), `src/photo/server/` (`handler.ts`, `gemini.ts`, `plugin.ts`), `api/photo.ts`. The buyer page makes one call, `mountAiPhoto`; the session is a lazy chunk. Details the spec above leaves open:

- **API:** Google serves these image models through the Interactions API, `POST https://generativelanguage.googleapis.com/v1beta/interactions` with the key in `x-goog-api-key` and `Api-Revision: 2026-05-20`; the answer is a `model_output` step holding an `image` block (base64). `store: false`, image size `1K`, aspect from the nearest supported ratio. Both ids are on Google's model and price list (checked 13 Nov 2026): `gemini-nano-banana-2.1` ($0.0336 per 1K image) and `gemini-3-pro-image` ($0.134).
- **Env vars:** `WALKTHRU_PHOTO_ENABLED` (any value but `0`/`false`), `WALKTHRU_GEMINI_KEY` (Vercel only; dev reads `~/walkthru-tools/.gemini-key`), `WALKTHRU_PHOTO_MODEL` (default `gemini-nano-banana-2.1`; set `gemini-3-pro-image` for quality), `WALKTHRU_PHOTO_DAILY_CAP` (default 50 calls per UTC day, held in memory, so on Vercel per warm instance). The button appears only when `GET /api/photo` says enabled and configured.
- **Capture:** the frame and guide are cropped (centred) to the nearest aspect ratio the model returns, so the answer has the same framing, and the walking figure is hidden for the capture. The guide is drawn from the same wall pieces and furniture boxes the check samples, with hidden lines removed by a ray test.
- **Check, two changes from the wording above:** a sampled point counts only where the frame itself shows an edge (a corner between two walls of one tone is invisible in the render too), and the image edge near a point must run within 25 degrees of the projected edge. A view with fewer than 30 checkable points is refused before the model is called. The thresholds (1.5%, 80%, 85%, 1%) are as specified; they are checked on synthetic frames only until a key exists.
- **Dev only:** `WALKTHRU_PHOTO_FAKE=echo|unrelated` stands in for the model (the first returns the frame, the second a different picture); it is not in the Vercel function.

### 17.15 Chunks

- **C12a** Generalise and measure: the fixes in 17.2, the lexicons, the lint, the synthetic set generator with truth, the scoring script. Start first; everything else is judged with it.
- **C12b** Text and dimensions: `text-pdf`, `glyphs`, `ocr`, `dimensions`, `scale-fit`, `verify`. After C12a.
- **C12c** Plan symbols, elevation linking, elevation reading, reconcile, the writers. After C12b.
- **C12d** Vision providers and the raster path. After C12a, alongside C12b.
- **C12e** Review step and its server. After C12b, alongside C12c.
- **C12f** AI photo. Independent; any time after C11.

**C12c remainder (built 13 Nov 2026, branch `elevations`):** `elevation-view.ts` (views, floor, soffit, end walls, blocks), `elevation-link.ts` (captions, key marker, three-signal link, assignment), `elevation-read.ts` (level graph, openings, `UnitDesign`, hinge from handle and mark, internal view), `elevations.ts` (stage), `reconcile.ts` (units, openings, beds, ceilings, cross-sheet), `write.ts` (symbols become items, elevation data enters the understanding file; `designs.json` is still written only by `designForItem` from facts). Rules worth knowing: a printed height is `verified` only when it agrees with the elevation's geometry on a scale it does not own (the view's own dimension fit, or the linked wall's length when the plan's scale has agreeing votes or another view confirmed it); where a printed height and the measure disagree the measure is the number the model uses and both are shown; the hinge is `verified` only when handle and mark agree; the ceiling carries `verified` and its sheet in `proposal-extras.json`, and the buyer verdict says "not confirmed" instead of quoting a ceiling no printed dimension checked (`core/room-trust.ts`). Not done: elevations drawn as shaded, partly cropped views (the one real sample) are not recognised, so a real set still gets no elevation data and an unverified ceiling.

Integrator edits outside the chunk's files: the lines in `src/editor/main.ts` and `vite.config.ts`; npm scripts `understand` and `eval:understand`; `brew install tesseract`; and, only if the Claude alternate is built, the dependency `@anthropic-ai/sdk` at a version at least two weeks old.

### 17.16 Risks

1. **One real sample.** Every bar on real drawings is a hope until the 20 sets exist. Synthetic sets can be made to pass; they prove the checks work, not that architects draw the way the generator does.
2. **The stroke-glyph reader may not match real CAD fonts** closely enough. That is why OCR and the vision model sit behind it and why no reader's output is a fact without the geometry check.
3. **Tesseract on rotated, tiny, slashed dimension strings** is unproven here; it is not installed yet. RapidOCR may do better; the evaluation decides.
4. **Whether Gemini returns reliable boxes on line drawings** is unverified. Without boxes a model's read cannot be attached to a dimension and stays unverified, which is safe but less useful.
5. **Drawings "not to scale"**, common in brochures, remove the geometry check. Those plans will produce mostly unverified values and lean on the broker.
6. **Elevation linking without a key marker** depends on widths and content; symmetrical rooms will be ambiguous and will ask the broker.
7. **Hinge conventions differ** between offices (some draw the opening mark's point at the handle side). The rule needs the handle to agree, or it reports a conflict; expect many `unknown`s.
8. **Model prices change** (3.8 Flash doubles on 1 Jan 2027; Gemini 4 Carbon doubles on 1 Dec 2026). The cost table is a snapshot of 13 Nov 2026.
9. **The AI photo can still mislead** even when edges line up (materials, light, clutter it invents). The label is the mitigation; the feature is optional and off by default.
10. **Privacy:** real drawings carry firm names and phone numbers. Uploads, renders, crops and `understanding.json` stay in `.cache/`, outputs carry no file names, and crops sent to a vision model are the minimum needed; brokers should still be told drawings are sent to a model provider when vision is on.

### 17.17 Local picture reading, and what the first real-plan evaluation changed

The first evaluation on 20 public builder plans (label-transcribed truth, `scripts/eval-real.ts`) found that pictures of plans were refused outright with no vision key, a plan placed as a picture inside a PDF read as "ok, 0 rooms", and brochure plans were built from their labels alone with the scale "guessed from wall thickness". Changes, all generic:

- **Local picture path** (`src/understand/raster-local.ts`, `src/understand/local/*`). Used by `readRasterPages` when the provider is null; needs a local text reader (PP-OCR, SPEC 17.21; Tesseract is the fallback and the run says so). Thin dark marks are grouped into text blocks and read at several sizes (`local/ocr.ts`); a block becomes a room label when it holds a room word (lexicon) and/or a printed size, with repairs for what OCR garbles (`local/sizes.ts`: a lost foot mark, a comma for a point, an x read as K, a size split over lines). Walls are the thick dark structures (threshold found from the picture, `local/ink.ts`); from each label a ray vote over rows and columns across the room gives the walls around it, so doors and windows leave gaps that are outvoted. One scale is fitted to all rooms (`pixels/fit.ts`, RANSAC, 3% inlier band).
- **Honesty.** Everything OCR reads starts `unverified`. A room is `verified` only when its printed size agrees (2%) with the walls around its label on a scale fitted WITHOUT that room from at least three other rooms that agree with each other, and the printed sizes pass an outside plausibility check by room kind (a unit misread for the whole plan fails it). A printed size the walls contradict by more than 5% is a `conflict` with both numbers kept. A reading chosen from several because the walls agree with it, and a size matched to a room only by how well it fits (area-statement tables), are never verified. With no scale the rooms still appear as rectangles of their printed sizes and the notes say the scale is a guess.
- **Picture inside a PDF.** `isPictureOfPlan` (`import/vector-page.ts`): a page whose pictures cover at least 12% of it and that has under 60 strokes is a picture of a plan; the server and the eval render it and send it down the local path.
- **Vector brochures.** Wall colour choice no longer takes a large light floor fill for the walls when a dark fill qualifies (`import/walls.ts`). Printed room sizes against the drawn walls (`understand/label-geometry.ts`, `label-apply.ts`) give a scale where the importer had only a guess, verified statuses, and conflicts; a traced room more than 5% off its printed size is flagged, and one holding 25% more or 20% less area than the printed size is drawn at the printed size instead (`RoomFinding.drawnDims` keeps what the walls measured).
- **Lexicon and labels.** More room words and abbreviations (m.bedroom forms, walk-in wardrobe, dry terr./bal., toilet and dressing, angan/courtyard, servant, utility, foyer), "inclusive of / with" cuts a label (a bedroom including an enclosed balcony is a bedroom), services and notes are not rooms; mm sizes split over lines join (an x is the evidence), no dimension text rides in a name, a bed or study label with a room-sized size is the room, two bare numbers over 8 are feet.
- **Several flats on one sheet.** `understand/flat-units.ts` groups rooms into flats (touching rooms; lobbies and passages shared), records them in `ProposalExtras.units` and warns, so the broker keeps one flat.

### 17.18 Rooms that are only partly on the drawing

A drawing can show a room that runs off the sheet (its far wall is never drawn) and a passage can end at the sheet border. The importer still builds a shape for them, so without a mark they read as invented space. `RoomTag.partial?: { reason: string }` marks them: **the shape is a guess and the room is never a start point.**

- **Set by** `import/propose.ts` with the pure helpers in `import/partial.ts`: a room drawn as a rectangle of its printed size (`label-rect`) whose rectangle sticks out past the sheet by more than one wall thickness (the sheet is the drawn border rectangle when there is one, else the page), and a passage the importer found running into the border (`leaksAtBorder`). The reason is plain English and names the side that is on the drawing ("Only its 9'0" width is on your drawing. Its far wall is off the sheet, so the rest of this room is a guess."). `parseRoom` keeps the field; a broker typing a size in review takes the guess over and clears it.
- **In 3D** (`engine/shell.ts`, `PARTIAL_LOOK`): a hatched neutral floor (no tile, no finish colour, no ruler), a 0.30 m solid footing with a faint ghost panel above it in place of walls, no ceiling. Collision is unchanged, so the room stays walkable. An open doorway the importer added between a whole room and a partial room gets a translucent panel across it and a hatched threshold instead of a frame: where the drawing ends, not a door. Materials are the shell's own, so the look's finishes and the True colours switch do not apply.
- **In the interface:** the room chip says "<name> · shape guessed"; a badge "Not on your drawing · shape guessed" shows while the walker is in a partial room or looking into one along a doorway (`buyer/partial-badge.ts`); the rooms sheet lists them with a hatched swatch, the reason, and a carpet line that says it cannot be confirmed; distances and fit cards that touch one say "Not measured"; the editor's plan canvas labels them "not on your drawing".

### 17.19 Sample homes for the gallery

`scripts/make-sample-homes.ts` turns six synthetic drawing sets into scenes `public/scenes/test-sample-<n>/`. Each goes through the broker upload job (`understand/server/run.ts`) and the editor's `applyProposal`, never the generator's truth, so the gallery shows what the reader makes. `--eval <seeds>` prints reader against truth; `--write` rebuilds the six. Seeds were picked for a reader result with every room found and named, no layout errors and no console errors; seeds where the reader made a mess were passed over. The outputs are committed (`.gitignore` only drops `scene.*`) and Vercel ships `public/` as is.

### 17.20 Upload your floor plan (the public site, 15 Nov 2026)

Anyone can read a plan on the live site with nothing installed. The owner's rule: **only one kind of plan is accepted**, and the page says which. Everything runs in the visitor's browser; the file is never sent anywhere ("Your plan stays on this device").

- **Supported (v1):** a vector PDF floor plan saved from drawing software, one flat, real lines and typed room names. Limits (`src/upload/problems.ts` `LIMITS`): 30 MB, 12 pages, 1.5 million drawing operations on a page, 150 s of reading.
- **Where it runs.** `src/upload/card.ts` is the card on the start page (lazy `flow.ts` after a file is chosen). `reader.worker.ts` is a module Web Worker: it loads pdf.js (`pdfjs-adapter.ts`, with its worker module in the same thread) and runs `readPlanPdf` (`read-core.ts`), which is the existing reader unchanged: `loadVectorPages`, `understandVector`, `applyReview`, then `buildHome` (`home.ts`, also used by `scripts/make-sample-homes.ts`). The only edits to reader files are a pure SHA-1 (`understand/hash.ts`) in place of `node:crypto`, optional page and operator limits and a progress callback in `loadVectorPages`, and a build-time stub for the `node:zlib` import in `pixels/image.ts` (`browserShims` in `vite.config.ts`, the vector path never calls it). `tests/upload-bundle.test.ts` fails if any worker chunk imports a Node built-in or if pdf.js leaks into the start or buyer chunks.
- **Preflight before long work** (`problems.ts`): not a PDF, a photo, empty, too big, damaged, locked, too many pages, too complex; then after opening: a picture of a plan (`isPictureOfPlan`: "This PDF is a picture of a plan. For now Walkthru reads plans saved from drawing software. Photo and image plans are coming."), a letter, a blank page; after reading: no rooms, or several flats (refused only on strong evidence, three groups or two holding 14 or more rooms, because the flat splitter also cuts one big flat in two). Every failure is a titled box with what to try; the worker is terminated on cancel and at the time limit.
- **The home.** Saved in IndexedDB (`store.ts`; memory and sessionStorage fallback), id `local-<10 chars>`, opened by the normal buyer page: `main.ts` installs `local-fetch.ts` for `local-*` ids, which answers `/scenes/<id>/property.json`, `proposal-extras.json` and `designs.json` from the store and 404s the optional files (standard lighting, default style pack). Uploaded homes are real drawings for the built-in rules (`isBuiltIn`) and never mount the AI photo (a picture of the view would leave the device).
- **Honesty (17.1, 16.2).** Tag everywhere: "Read automatically from your upload · not checked by a person" (the made-up sample says so too; "N values checked by you" after Check the drawing). Rooms the reader could not verify show "not measured" through `proposal-extras.json` exactly as in shipped scenes; "What we could not read" lists the reader's warnings (broker wording removed), unmeasured and partial rooms and an assumed ceiling; printed size against drawn walls is listed where they disagree. "Check the drawing" (`check.ts`, skippable) reuses `review-model.ts` rows and parsers and `applyReview`: Looks right, Fix size, rename a room, rename the home; nothing is confirmed on the visitor's behalf.
- **Start page.** Card at the top, "Try a sample plan" (`public/upload/sample-plan.pdf`, a made-up flat from `scripts/make-upload-sample.ts`, written by `npm run make:room`), "Your uploads" with delete.
- **Not built:** sharing an uploaded home by link (needs server storage: a Vercel Blob or R2 object per home, a short random id, an `api/` function to put and get it with a size cap and expiry, and `local-fetch.ts` replaced by a fetch of `/scenes/<id>/...` from that store); image and photo plans; several flats per sheet.

### 17.21 The picture reader's text engine: PP-OCR instead of Tesseract

Tesseract read 28% of printed room sizes on real brochure plans, so text was the ceiling of the local picture path (17.17). The engine is now PP-OCR (detection, orientation, recognition) run by **RapidOCR on ONNX Runtime**, behind an interface with no Python in it.

**Choice, by measurement on the development sets only** (5 raster sets, 47 printed sizes; whole-page text scored by digits, as `scripts/eval/ocr-floor.ts` does; `tools/understand/bench-ocr.py` refuses held-out sets):

| Engine (det + rec + cls files) | Sizes read | Names read | Time per plan, CPU | Peak RAM | Models |
| --- | --- | --- | --- | --- | --- |
| Tesseract 5, two page modes | 26 of 47 | 27 of 39 | 1.5 to 9 s | 0.1 GB | system |
| PP-OCRv6 **tiny** | 42 | 34 | 1.4 to 5 s | 0.9 GB | 1.8 + 4.5 + 0.6 = **6.9 MB** |
| PP-OCRv6 small | 42 | 35 | 4 to 24 s | 1.1 GB | 9.9 + 21.2 + 0.6 = 31.7 MB |
| PP-OCRv6 medium | 43 | 35 | 19 to 94 s | 1.3 GB | 62 + 77 + 0.6 = 140 MB |
| PP-OCRv5 mobile | 44 | 34 | 5 to 25 s | 0.8 GB | 4.8 + 16.6 + 0.6 = 22 MB |
| PP-OCRv5 server | 43 | 35 | minutes | 2.1 GB | 88 + 85 + 0.6 = 174 MB |

(Times were taken on a machine under heavy shared load, so read them as ordering, not as absolutes.) Whole-page recall is a tie among the PP-OCR models, so the pipeline decided: on the same 5 sets, printed size read through the full local path was 51% with tiny, 47% with small, 40% with mobile, and tiny used a third of the CPU. **PP-OCRv6 tiny is the default.** Surya (weights restricted for commercial use above 5 M USD), EasyOCR and docTR (PyTorch only, no ONNX weights) were not run; see `tools/understand/LICENCE-ocr.md`, which also records the Apache-2.0 terms of RapidOCR and of the PaddlePaddle model cards.

**Install.** `sh tools/understand/setup-ocr.sh` (the only step that downloads anything: a venv under `~/walkthru-tools/ocr` or `$WALKTHRU_OCR_HOME`, RapidOCR 3.10.0, the models copied to `<home>/models`, `active.json` naming them). `WALKTHRU_OCR_MODEL=v6-small|v5-mobile|v5-server` picks another set. Without it the reader uses Tesseract when present and puts a warning in the run's notes ("the stronger local text reader is not installed ... Run tools/understand/setup-ocr.sh"); with neither it refuses in words. `WALKTHRU_OCR=tesseract` forces the fallback. Tests and evaluations never download and never need the engine.

**Shape.** `local/ocr-backend.ts` defines `OcrBackend { page(gray) -> lines with corners and confidence; lines(grays[]) -> reads; stats(); close() }` and the Python worker (`tools/understand/rapid-worker.py`, JSON lines over stdio, reads model files from the model folder only). `local/ocr-rapid.ts` is pure TypeScript over that interface: the page is scaled to lines of about 20 px and a long side of 1600 to 2400 px (measured: 14 px/2000 found 26 of 47 sizes, 20 px/2400 found 30, 30 px/3200 found 31 for a third more CPU), the engine finds and reads every line, the two halves of a table row split by a wide gap are re-joined, lines are stacked into blocks (a name over its size), and each line is re-read from crops of the unscaled page at three sizes (recognition only) as second opinions that count only when the engine is as sure of them as of the page read. Text running up the page is read from the crop turned both ways. Ink the detector missed is read from its crop. A page with fewer than two readable rooms is read turned a quarter each way and the turn with the most labels wins (`turnedCw` on the view). The result is the same `BlockRead` the Tesseract reader produced, so nothing after it changed.

**Repairs** (`local/sizes.ts`): dashes, primes, curly quotes and multiplication signs normalised; a digit read as a letter (O, l, I, S, B) only beside digits or marks, a zero inside a word is an O; a fraction glued to its digit ("01/2"); a trailing foot or inch mark of either kind; an inch mark read as one more digit ("10-22" is 10'-2"), only when the inch value read is above eleven. A primary read counts for more than a second opinion; the name comes from the first reading that is a room word.

**Honesty is unchanged.** Every read is `unverified` until the geometry check passes (17.5); a repaired reading never verifies itself; a table row is matched to the plan label of the same name only when the name is unique on the plan, and that match now works when the walls around the label cannot be measured (a size from a table is then never verified by geometry either). Wrong-verified stays 0.

**Running the same reader in the browser or on Vercel** (not built): the models are 6.9 MB, the interface returns plain arrays, and the pixel work (`pixels/*`, `local/ink.ts`, `fit.ts`) is pure TypeScript. What is missing is a TypeScript backend: the detector's pre- and post-processing (resize to a multiple of 32, DB thresholding, contours and box unclipping, which RapidOCR does with OpenCV and pyclipper), the orientation and recognition batching and the CTC decode with the dictionary stored in the model file, run by `onnxruntime-web` (WASM or WebGPU) or `onnxruntime-node`. Node-only today: `local/ocr.ts` and `ocr-backend.ts` (child processes), `raster-local.ts` imports `node:crypto` for a page hash, and the eval's `sips` image fallback. Expect about 7 s of CPU per plan natively and 700 MB to 1.1 GB peak; in a browser tab expect two to four times that on WASM without GPU.

---

## 18. Buildings: walk a whole residential building (stage 1, 16 Nov 2026)

A builder demos a project to buyers on any computer: the lobby, the lift, the corridor, then any flat, then the amenities. Everything runs from the deployed static site; there is no access control. Stage 1 is the structure: levels, spaces, portals, the map, the lift and the sample tower. **Not in stage 1** (stages 2 and 3, other work): gym equipment, pool water, gardens and other outdoor looks. The pool and the garden of the sample are plain empty rooms until then, and say so (18.8).

### 18.1 The idea in four lines

- A **building** is a list of **levels**; a level has **spaces**; a space is an ordinary scene (`public/scenes/<sceneId>/`, 3.4) with a `kind` and a name. Nothing about a scene changes: a space opens by `?scene=<sceneId>` as any home does.
- **Portals** join a door opening in one space to a door opening in another (the two sides name their own opening), or a lift door to the set of levels the lift serves.
- **One space is loaded at a time.** Going through a portal takes the current space down completely and builds the next in the same page (18.5).
- Flats of one design are **stored once**: a flat type is a scene; placing it on many floors adds spaces that name the same scene (18.2). A mirror image is a second scene, generated at build time.

### 18.2 Files and data (`src/building/types.ts`, parsed by `parse.ts`)

`public/buildings/<id>/building.json` (id: lower-case letters, digits, hyphens, up to 40). `public/buildings/index.json` is the list the start page shows (`npm run make:index`, part of `npm run make:room`).

| Field | Meaning |
| --- | --- |
| `version` | 1 |
| `id`, `name`, `subtitle?` | the project; shown on the start page and the map |
| `sample` | true: made up for the demonstration; says so wherever it appears (18.11). `note` is the one-line "Sample layout for demonstration" |
| `floorToFloorM` | default floor to floor height; a level may set its own |
| `flatTypes` | `{ typeId: { name, sceneId, mirrorSceneId? } }`: the designs. `mirrorSceneId` is the design's mirror image when a plan needed one |
| `lifts` | `{ id, name, car: { widthM, depthM, doorM }, serves: levelId[] }`. The car is 1.1 x 1.4 m with a 0.9 m door in the sample; the lift door opening on each level must be exactly `doorM` wide |
| `levels` | lowest first: `{ id, label, short, summary, floorToFloorM?, spaces[] }`. `short` is the lift button, `summary` the words in the lift panel ("Flats 201 to 204") |
| `startSpace?`, `unlisted?`, `bare?` | where the entry page starts; keep out of the list (it opens by its link); no added decor in any space (a builder starting from nothing) |

A **space**: `{ id, kind, name, sceneId, type?, mirrored?, placement, portals[], lobbyAnchors?, comingNext?, notes?, outdoor?, pack? }`.

- `kind`: `home | lobby | corridor | gym | hall | games | pool | garden | other` (the `SpaceKind` of `src/types.ts`; a flat is a `home`). The scene says the same of itself in `property.json` `spaceKind` (written by the generator for every space, kept by `validateProperty`), so what loads after a swap carries its kind and the catalogue can filter by it. A home names its `type`; `mirrored: true` means `sceneId` is the type's `mirrorSceneId`.
- `id` is unique in the building and is the `space=` of the URL: short names for places that exist once (`lobby`, `clubhouse`, `hall`, `gym`, `pool`, `garden`) and `f<level>-<number>` for the typical floors (`f2-corridor`, `f2-203`). The scene behind it is `sceneId`; a scene shared by several spaces (the same flat on two floors, the same corridor plate) is named by each of them. The sample's scenes are `test-tower-*`: the `test-` prefix is the repo's mark for made-up scenes (they stay out of the gallery, and the anti-overfit lint of 17.12 allows their names in code and tests). My layout and the style pick are kept per scene (`walkthru:<sceneId>:...`), so Flat 203 and Flat 303 share one layout: they are one design.
- `placement: { x, z, rotDeg }` puts the scene's own frame on its level's plan: turned `rotDeg` (0, 90, 180, 270, clockwise on the plan, x towards z) about the scene origin, then moved by (x, z). Only the map and the plate checks read it; the walk never does.
- `lobbyAnchors` (a `lobby` space only): marked empty positions for the pieces a lobby needs, `{ id, role: 'reception' | 'security' | 'seating' | 'letterboxes', at: {x, z}, yawDeg, footprint: {w, d}, note? }` in the lobby scene's own frame. The sample draws no desks; it leaves these four spots and a later stage drops its reception desk, security desk, seating and letterbox wall into them. `validateBuilding` checks that each anchor lies inside a room and that no two overlap.
- `comingNext`: a placeholder for a later stage, enterable as an empty room and labelled "Coming in the next stage" on the map. `notes`: lines shown on the space's map card.
- A **portal**: `{ id, kind, opening, ... }` where `opening` is a door opening of the space's own scene. `kind: 'door'` has `to: { space, portal }`, a `label`, an optional `prompt` ("Enter Flat 302", "To the corridor"), a `look` (`main` heavy flat door with a number plate, `glass`, `plain`) and `plate` (the number). `kind: 'lift'` names a `lift`. `kind: 'stairs'` is a staircase door marked "Stairs (not walkable yet)". `kind: 'outside'` is a door to somewhere the sample does not model (the street): it says so. The first portal of a space is its entry: the "Start here" of the map lands there.

`parseBuilding` rejects with a message naming the place (`building.json: levels[2].spaces[1].portals[0].to space "f9-nowhere" ...`) for: not an object, wrong version, bad id, numbers out of range, unknown kind, bad rotation, unknown portal kind, duplicate ids, a door whose far side is missing or does not lead back, a flat of an undefined type or in another type's scene, a mirrored flat with no mirror scene, a lift that serves an unknown level or has not exactly one door on a level it serves, a start space that is not there.

### 18.3 The plate and the mirror (`scripts/building/plate.ts`, `src/building/geom.ts`)

A typical floor is composed from the flats' real footprints, not drawn: each flat (18.8, authored from printed room sizes, 18.13) is turned by 0, 90, 180 or 270 degrees and, only where a plan needs it, mirrored (`PlateInput.mirror` forces a mirror; the sample's four flats are **not** mirrored, their plans stay as printed), so that its **main door faces the corridor and its balcony faces outside**. A flat is placed on the **east or west side** of the corridor (`side: 'E' | 'W'`, stacked from the north end) or **across the corridor's north end** (`side: 'N'`: the corridor runs into the flat's own entrance recess, and the side flats stack south of whatever of that flat stands out beside its door). The search is depth first, unmirrored turns before mirrored, and takes the first set that overlaps nothing, with one more rule: two main doors on opposite sides of the corridor are at least 2.2 m apart along it (`DOOR_STAGGER_M`), so nobody opens a door onto another. Walls between a flat and the corridor and between neighbours are 0.30 m (two 0.12 m walls and a little more).

**Recessed doors.** A real plan's entrance often sits behind the flat's face (a block of rooms stands out beside the door). `PlacedFlat.recessM` is how far the door is behind the face; when it is more than 6 cm the corridor gets a **bay** (`PlacedFlat.bay`, 1.9 m wide, wide enough for the door's signboard) out to the door, as one room with the corridor (`typical-floor.ts`), so a walker landing at the door is in the corridor. **Checks** (`plateProblems`, run by the composer and a test): no two flats overlap, no flat runs into the corridor or the lift lobby, every main door faces the corridor, and no window or balcony railing of a flat sees another flat, the corridor, a bay or the lobby within 1.2 m (a flat's own recess does not count). The corridor scene is then drawn from where the doors fell: its door is at the plan position of the flat's door (on a bay's end wall, the corridor's side wall or its north end), with the same width and **the same hinge post** (the leaf hangs from the same physical side; from the corridor it swings out, into the flat).

A **mirror image** (`mirrorProperty`) is x to -x on the whole scene: each room's polygon reversed to keep its winding and its edge kinds remapped (the rule of `normalizeRoom`), each opening's edge and `centreM` remapped, each leaf's `hinge` swapped start/end (the edge now runs the other way, so the leaf hangs on the mirror image of its post, and `swing` still names the same room), furniture boxes mirrored with `yawDeg` negated, the spawn mirrored. Areas, widths and heights are untouched. `designs.json` passes through where it carries only sizes; a decor offset changes sign; an openable wardrobe is refused rather than guessed (`mirrorDesigns`). The mirror is stored once, next to the design, as its own scene (`<sceneId>-m`): it is generated at build time, so the site never mirrors anything at run time.

### 18.4 Checks (`src/building/validate.ts`)

`validateBuilding(building, scene)` returns `{ errors, warnings }`. Errors: a scene missing or with `validateLayout` errors; a scene of a sample building not labelled a sample; a portal on an opening that is not there or is not a door; **door widths differing** between the two sides (more than 1 cm); on one level, the two doors **more than 0.36 m apart on the plan**, not facing each other, or **hinged on opposite posts**; **two spaces overlapping** on a level (more than 0.05 m2); a corridor under 1.5 m wide; a portal with **no clear landing** just inside its door; a portal **not reachable on foot** from the space's first portal (the corridor reaches every flat door and the lift); a lift door that is not the car's door width. The checks run in `scripts/building/make-sample-building.ts` (`--check`, and before `--write`) and in `tests/building-validate.test.ts`, which also breaks each rule on purpose and expects the error.

### 18.5 One space at a time (`src/building/walk.ts`, `src/building/guard.ts`, `src/buyer/main.ts`)

**Choice: swap in the page.** `?building=<id>&space=<id>` loads the walk chunk once; a portal builds the next space in the same page and the address follows (`pushState`; the browser's Back and Forward walk back and forth through the spaces). A page navigation per space would reload three.js, the walker's body and every shader each time and lose the view, the time of day and the loading treatment; the swap keeps all of that. The fallback, a URL navigation, is exactly what a shared link does.

- **The seam.** `main.ts` exports `boot(sceneId, room, host)`. Without a `host` it is the lone home it always was. With one (`SpaceHost`, `space-host.ts`) it lands the walker where the host says, shows no height picker after the first space, styles the building's doors (18.6), keeps the style the viewer picked per building, and returns a `SpaceSession` whose `dispose` takes the space down and whose `carry()` hands over the time of day and colour mode. The person (body, tone, height) and the view (see yourself or eyes) already live in storage and carry over.
- **Taking a space down.** Every disposer `boot` registers runs newest first: the mode left open closes, the doors, wardrobes, kit, design, lived-in decor, baked lighting, look (post, reflections, sky), store (it saves a pending My layout first), overlays, input, HUD; the shell, the furniture and the decor are disposed (`disposeTree`, `src/building/dispose.ts`: geometry, materials, every texture, skeletons); the character; then anything still hanging in the scene. A **guard** (`guard.ts`) is the safety net for what a module forgets or a later change adds: while a space is up it records every listener added to `window` or `document`, every timer and animation frame, and every element added to the body, and `release` removes them. Elements the building made on purpose (the curtain) are marked `data-wt-keep`.
- **One renderer.** The WebGL renderer and the canvas are made once and handed to each space's viewer (`createViewer(..., { shared: true })`); each space gets its own scene, camera, lights and frame loop. (A renderer per space was tried first: a texture or geometry shared by two spaces keeps a `dispose` listener on every renderer that drew it, so each old renderer, its context and its canvas stayed alive. The heap snapshot showed it, 18.10.)
- **Never blank.** The next space is built behind a screen that takes the place of the loading screen: through a door it is the walk's own loading screen (the plan drawing itself, the progress bar, the light lines) named for where you are going (`createLoadingCurtain`); in a lift (`curtain.ts`) the steel doors close, the floor display counts and they open on the new level. A failure (a missing scene, a layout with no rooms) shows the ordinary error screen with its button; a second tap on a portal while one is in progress is ignored.
- **People.** The people a buyer adds (`src/buyer/people`) belong to a scene's layout, like My layout: they are made when the space is, torn down with it (their bodies, sheets and timers are in the cleanup list, their records stay in the scene's My layout) and are back when the space is opened again, whichever flat of that design it is. A person set to **follow** the walker comes through the portal: `takeFollowers` takes them out of the old space's layout, `setDownFollowers` sets them down behind the walker in the new one and tells them to follow again. A cramped foyer where a person may not stand (they may not block a door's swing) is searched in a ring around the walker; if there is still no room a toast says so and the companion is tried again every 1.5 s for a minute as the walker moves on, so nobody is dropped.
- **Per space.** My layout overlays, placed pieces and the "lived in" and Plain switches are kept per scene id, so nothing of one space shows in the next. `window.__walkthru` (the debug hooks) is the current space's; `window.__walkthruBuilding` has `current()`, `go(spaceId)`, `travel(lift, level)`, `portal(id)`, `openMap()` and `metrics()`.

### 18.6 Portals in the world (`portals.ts`, `portal-looks.ts`, `curtain.ts`, `lift-panel.ts`)

- **Looks** (`doors-model.ts` takes a style per opening): a flat's main door is a 45 mm slab in dark walnut with a brass plate carrying the number on the **corridor** face (the room's side in the corridor, the other side seen from inside a flat; the model knows which local face is which from the leaf's hinge); the glass lobby door is a slim aluminium frame (45 mm stiles, a head rail and a low kick rail) round a tinted, slightly reflective pane, with a vertical pull handle on standoffs on the opening side; lift doors are two steel leaves with a joint; the stairs door is a painted fire door with a vision panel and a STAIRS sign. The style's door finish applies to ordinary doors only.
- **Rules.** A portal door is an ordinary door in every other way: the leaf is solid, the walk grid is untouched, the swing is checked against furniture and the walker. In the corridor the leaf stays shut (it opens onto space the sample does not show); inside a flat the arriving walker sees the main door open behind them, like any door of the room they start in.
- **Prompts.** Within 1.4 m of a portal doorway, in sight of it and on the room's side, the pill says where it goes ("Enter Flat 203", "To the corridor", "Call lift", "Stairs (not walkable yet)", "To the street"). Where two doors face each other across a metre the one in front of the walker wins. E, a tap on the pill, or a tap on the door itself (from 3.2 m; further away it says to walk up first) goes through. Portal prompts sit in front of "Open door" (`door-hooks.ts`).
- **Lift.** The prompt opens the **floor panel**: every level the lift serves, top first, each with its button, label and summary ("2 · Level 2 · Flats 201 to 204"), the current one marked "You are here". Choosing a level plays the ride (doors close, the display counts the levels passed in order, they open) while the target lobby is built behind it, and lands the walker 1.5 m in front of that level's lift door, facing into the lobby. The walk is held still while the panel is open.
- **Stairs** are a door marked "Stairs (not walkable yet)": the prompt and a toast say so. Nothing walkable is faked.
- **Landing** (`arrival.ts`): just inside the matching door, **facing in** along the inward normal of the doorway, at least 1.9 m in where the room is deep enough (the walking camera behind the walker is then inside the room, not in the doorway; a narrow corridor lands as near as it allows), 0.45 m clear on the walk grid, and out of every door's leaf and the whole floor it can sweep (`inDoorSweep`).

### 18.7 The building map (`map.ts`, `level-plan.ts`, `start-section.ts`)

- **Entry page** `/?building=<id>`: the name and the sample tag, a **side elevation of the levels** (top first, each as tall as its floor to floor height; the one picked is highlighted), the **plan of that level** drawn with the home plan code (`start/plan-svg.ts`: the walls with their doorways cut out, windows, doors) from every space's own layout placed on the plate, each space outlined and named (a flat: name, type, carpet area; an amenity: name; a placeholder: "Coming in the next stage"), and a card for the space picked with **Walk in** (a flat lands at its main door). Tapping a space on the plan or in the list picks it.
- **In the walk** a "Building map" HUD button (first in the column) opens the same screen over the walk with **You are here** on the level and a dot where the walker stands, and **Walk there** on the card.
- **The start page** lists the buildings above the homes (`Pick a building`); the card is a small drawing of the tower from its level count, the name, the levels and flat types, the amenities.
- **Honesty.** A flat's carpet area is the sum of its own rooms without balconies, **and is not stated when any of those rooms was not measured** ("area not confirmed", the rule of the rooms sheet, 16.2); a placeholder says it is one; room names are not drawn on the building plan (too small), the walk and the rooms sheet carry them. On a phone the plan scrolls sideways at a readable scale.

### 18.8 The sample tower (`scripts/building/*`, `npm run make:building`)

`public/buildings/sample-tower` ("Sample Tower") and `sample-tower-empty` ("Sample Tower, empty": every space unfurnished, `bare: true`, no designer sheets, no added decor). The output is committed, like the sample homes, and is identical on every run (a test builds it again and compares).

| Level | Spaces |
| --- | --- |
| Ground (4.2 m) | Entrance lobby (lobby, 63 m2 with a 25 m2 lift lobby, ceiling 3.6 m): a glass street door, a glass door to the clubhouse, two lifts, the stairs door. Four `lobbyAnchors` (reception, security, seating, letterboxes) mark where the pieces go; in the full tower stage 2 puts a reception desk, a security desk, a visitor seating set and two letterbox banks on them (16.17), in the empty twin they stay marked and empty. |
| Level 1 (4.2 m) | The clubhouse level, drawn after the amenity-level plan of a published builder brochure and scaled from the one dimension that plan prints, the 25 m lap pool: twelve spaces (the foyer and passages, the indoor games area, the gym with two changing rooms, three banquet rooms with their deck, the aqua-play court and the pool wing). Section 20 is the whole account; the made-up hall, gym, 20 x 14 m pool area and garden of the first sample are gone from the tower (their generators stay in `scripts/building/outdoor-spaces.ts` for other buildings). |
| Levels 2 and 3 (3.1 m) | One corridor scene (1.8 m wide, about 23 m long, with a bay out to each recessed door, a 6 x 4.2 m lift lobby with two lifts and the stairs door; the corridor ends at the door of Flat 204) and four flats a floor, numbered 201 to 204 and 301 to 304, in four different designs: **the flats' plans follow a published builder brochure, the floor arrangement around the lift lobby is ours** (the building's subtitle and the corridor's card say so). |

The four flat types are **two 3 BHKs and two 2 BHKs whose plans follow a published builder brochure**: every room is built to the size the brochure prints on its plan (or in its table, in feet and inches), by the authoring tool of 18.13 (`scripts/building/flat-spec.ts`, one data file per flat in `scripts/building/brochure-flats/`). A flat's type name carries the brochure's RERA carpet area, which is what a buyer is quoted (the signboard over a door prints it):

| Flat (typeId) | Plan | Stated RERA carpet | Rooms the brochure counts | Walls between all rooms | Rooms + walls | Against stated |
| --- | --- | --- | --- | --- | --- | --- |
| 3 BHK · 1,117 sq ft (`3bhk-a`, flat x04) | 16 rooms, servant room and toilet, utility, powder toilet, deck, a recess in the floor outline | 103.76 m2 | 94.98 m2 | 5.93 m2 | 100.91 m2 | -2.75 % |
| 3 BHK · 930 sq ft (`3bhk-b`, flat x03) | 12 rooms, two passages, balcony | 86.40 m2 | 81.78 m2 | 3.53 m2 | 85.31 m2 | -1.26 % |
| 2 BHK · 589 sq ft (`2bhk-b2`, flat x02) | foyer, utility, two passages, deck | 54.74 m2 | 51.83 m2 | 2.33 m2 | 54.15 m2 | -1.07 % |
| 2 BHK · 644 sq ft (`2bhk-b4`, flat x01) | foyer (a part of the living room), cupboard niche, utility, two passages, deck | 59.85 m2 | 56.49 m2 | 2.28 m2 | 58.77 m2 | -1.80 % |

The rooms alone are 5 to 9 % short of the stated carpet area (the brochure's own table does not add up to its figure): RERA carpet area **counts the walls between rooms**, so the check of 18.13 adds them (as built, gaps between rooms), and holds the sum to the brochure's own stated tolerance of 3 %. The map's carpet line is `carpetAreaM2` of the scene (every room but a balcony, the utility included), smaller than the stated figure; each flat's card says so (`Space.notes`). The balcony and the utility are outside the stated carpet area, as in the brochure. A balcony has solid piers on its west side as the plans draw them, and railings only where nothing faces it. A wall between two rooms of a flat is one wall of at most 230 mm (the check warns beyond that: two walls with a void between): the largest left is 0.23 m (1,117 sq ft: the kitchen between the servant room and the dining room, 3.10 m of printed kitchen plus two walls fill the 3.56 m the plan allows; 644 sq ft: utility and deck), 0.20 m (930), 0.17 m (589). A sliding leaf is drawn as the balcony's glazed door (aluminium frame, tinted glass). The brochure has no built-up area; none is invented. Each page's compass puts north to the left (1,117 and 930 sq ft) or to the right (589 and 644 sq ft) of the page, and the floor arrangement is ours, so each flat's `look.json` north follows its place on our plate (18.13), not its page. The flats carry the brochure's artist's-conception furniture as sample furniture (`source: 'real'`, movable and removable like any original), the room finishes of its internal specification as a design sheet (18.13), and every scene says "Sample building" and "furniture illustrative" in its subtitle. On the typical floor Flat x01 and x02 (2 BHKs) sit on the east side, x03 (3 BHK) on the west, and x04 (the 3 BHK of 1,117 sq ft) across the corridor's north end: none is mirrored, so **no mirror scene is stored** (the mirror is still exercised on every flat by `tests/building-mirror.test.ts`).

Common spaces (lobby, corridor, clubhouse rooms) open with the **plain kit**: no added decor, so a later stage's pieces are not mixed with the sample's own.

Regenerate: `npm run make:building` (needs the drawing reader: a few seconds; not part of the Vercel build, which only rewrites the two indexes). Add a building of your own by writing a `building.json` and its scenes; `npx tsx scripts/building/make-sample-building.ts --check` shows what the checks make of the sample, `validateBuilding` is the same function for yours.

### 18.9 Extension points for stages 2 and 3 (`src/building/extension.ts`)

- **Which space, which kind.** `getSpaceContext()` returns `{ buildingId, spaceId, kind, outdoor, pack }` while a space of a building is up (null otherwise); `SpaceHost.space` carries the same into `boot`.
- **Catalogue by kind.** `setCatalogueFilter(fn)` installs `fn(spaceKind, { id, kind }) -> boolean`; `catalogueAllowedIn(item)` asks it for the space the walker is in. The default allows every piece anywhere; Furnish and the catalogue are not changed in stage 1 (they belong to other work) and call `catalogueAllowedIn` when a later stage wants a gym to offer equipment and no beds.
- **Outdoor.** `outdoor: true` on a space is read and handed to the walk; what draws it open-air is the scene's own `outdoor.json` (stage 3, section 19: no ceiling, the sky, the sun, water, planting).
- **Look and pack.** `pack` is the style pack a space opens in unless the viewer has picked one (`src/look/packs` ids). A per-space `look.json` already works because a space is a scene.
- **Gym and pool.** The gym and the pool are scenes of kind `gym` and `pool` with their real room sizes and no furniture: equipment goes in as furniture or decor in those scenes, water as the stage-3 surface of section 19.3.

### 18.10 Verification (16 Nov 2026)

On the built site (`npx vite build`, `npx vite preview`), driven by headless Chrome (`tools/cdp.mjs`, software GL: SwiftShader, about 6 frames a second, so every time below is slower than on a GPU), at 1440 x 900 and at 390 x 844 as a phone. The whole path was walked and every step looked at: start page with the Buildings section, building map (each level, a plan, a space picked), lobby, lift prompt, floor panel, the ride, the typical-floor corridor, a flat's door with its plate, into Flat 201, the living room, out through the main door, into Flat 203 (a different design, a mirror image), the lift to Level 1, the foyer, the hall, the gym, the pool placeholder, the map with "You are here". Back and Forward, a direct link to a space, a bad building and a bad home were checked too.

**The leak check** (`window.__walkthruBuilding.go(space)` 20 times in one page on the build with main and the people merged in, alternating the corridor and the flats, after a warm-up that opened one space of every kind) **with people**: before the cycle, two people were added in Flat 201 (a woman and a child, kept in that scene's My layout) and the woman set to follow, so she came through every portal of the 20 hops and the child was rebuilt each time 201 was opened:

| After | JS heap | DOM elements | JS listeners | canvases / HUDs |
| --- | --- | --- | --- | --- |
| warm-up (8 spaces, people placed) | 16.5 MB | 552 | 162 | 1 / 1 |
| +5, +10, +15, +20 spaces | 16.2, 14.0, 16.9, 14.7 MB | 550, 516, 550, 516 | 162, 162, 162, 162 | 1 / 1 |

The elements, the listeners and the canvas count are identical every time the same kind of space is up (the people add nothing that stays). The heap moves with the kind of space (a flat is bigger than the corridor) and does not climb; two **heap snapshots** (full garbage collection each, taken before main was merged in) after 14 and after 34 spaces differ by 1.25 MB in total, all of it compiled code and the browser's own performance-entry buffers; one WebGL2 context, one canvas, 37 WebGLTexture, 267 WebGLBuffer and 13 WebGLProgram objects in both. `renderer.info` of the live renderer at the end of each teardown (after every explicit dispose, before the renderer is handed on): geometries 235 down to 1, programs 17 down to 3, textures about 30 down to 10 to 12, the same every time (those are textures the furniture kit and the model library cache for the next space). The first version made a renderer per space and the snapshot showed 9 alive after 8 spaces (a shared texture keeps a `dispose` listener per renderer that drew it): that is why the renderer is shared (18.5).

**Time per space** (from the portal to "ready", `lastBootMs`): 348 to 2,131 ms, mean 1,278 ms over 20 spaces, people included (the first hops after a warm-up are the slow ones), in the software-GL harness; the whole transition including the loading screen's fade or the lift ride is about 3 s there. A GPU was not measured.

**Taps.** A tap on a portal door, an open doorway or the lift door in the walk goes to the portal (`SpaceHost.tapClaim`, asked first by the walk's tap-to-select, and only when no wall or nearer piece is in front of the door); a tap on a piece of furniture still opens Furnish. Checked with real mouse events on the built site: the lift door opened the floor panel, a flat door and a flat's open main door went through, a sofa opened Furnish.

**Carried over** (checked): body height 188 cm, time of day 19:00 and the first-person view stayed through three spaces, the height picker did not open again, a sofa placed in Flat 201 was not in the corridor or in a different flat and was back in Flat 301 (the same design: My layout is per scene).

**Tests** (`tests/building-*.test.ts`, 160+ cases; whole suite on the merged build 2,782 passed, 1 skipped in 103 files): `building.json` parsing with every rejection and its message; the sample validates clean; each validation rule broken on purpose (door width on one side, a door moved, hinged on the wrong post, a missing scene, a portal on a window, two spaces overlapping, a narrow corridor, a blocked corridor, a lift door of the wrong width, a scene not labelled a sample); portal pairing and the landing of every portal of both buildings (inside the matching door, facing in, clear of the leaf and its sweep); the mirror (areas equal, hinge and swing flipped, `validateLayout` clean, mirror twice is the identity, furniture, designs); plate consistency; the generator is deterministic and the committed files are what it writes; the URL round trip; the guard removes every listener, timer and element a space added and keeps what is marked kept; `disposeTree` disposes each geometry, material and texture once; the map's plan, its areas and the "not measured" rule; portal looks and prompts; the list of buildings; the extension points.

### 18.11 Honesty, and what stage 1 does not do

- A sample building says so, and says where its plans come from: the tag "Sample building . plans from a published brochure" on the start page card and the map (it used to read "made-up", before the flats and the clubhouse level followed a builder's plans; the floor arrangement, the lobby and the lifts are still ours, and the subtitle says it), "Flat 203 . 2 BHK (A) . Level 2. Sample building, not a real home." under the room chip in the walk, "Sample layout for demonstration" on the map, "Sample" in every scene's subtitle (a test makes it an error to leave it out). Nothing about the plans implies structural or regulatory correctness.
- Areas on the map come from the scenes' own rooms and follow the "not measured" rule (18.7). All four flat types are built in full, so each shows a carpet area (the sum of its rooms); there is no built-up area because the brochure's flat plans do not carry one.
- The four flats follow a builder's printed plans, but the building is made up: the arrangement of the typical floor (one corridor, one lift lobby, the flats on its sides and across its end) is ours, not the brochure's, and so are the lobby, the lifts and the clubhouse level. The brochure gives no ceiling height, door or window widths, sill heights or wall thicknesses: those are scaled off its pictures or typical, and the scenes say so (18.13).
- Stairs are not walkable, the street is not modelled, the letterbox wall and the reception and security desks are not drawn (marked as `lobbyAnchors` for stage 2), the pool and the garden were empty rooms in stage 1 and are open-air spaces since stage 3 (section 19). The lift is a ride, not a car you stand in.
- Furnish, the catalogue and the look are not changed; `catalogueAllowedIn` and `pack` are in place for the stages that need them (18.9).

### 18.12 Signboards over doors (`src/building/signs.ts`, `portal-looks.signText`)

Every shared space (anything but a home) carries a dark board above each portal door, on its own side of the wall, 7 cm over the door head, 20 cm high, sized by its words. The words come from the building file only: a door shows its `label` without the article ("Community hall", "Pool area", "Clubhouse foyer"), a lift "Lift", a street door "Exit". Over a flat's door the board reads the flat and its type from `flatTypes` ("Flat 204 · 2 BHK (B)"); the number plate stays on the leaf. The stairs door keeps its own sign; a door with a plate and no known type gets no board; a door with no wall above its head gets none. Inside a home there are no boards. Boards are fixed (not selectable, not movable) and are freed with the space.

### 18.13 Authoring a flat from printed room sizes (`scripts/building/flat-spec.ts`, `brochure-flats/*`, 16 Nov 2026)

A builder's brochure prints every room's inside size on its plan ("LIVING 3.81 X 5.55", in metres) and again in a table (in feet and inches), with the RERA carpet area beside it. That is not a drawing to read, it is a list of facts to build from. `flat-spec.ts` is the small, documented way to do it, and it **refuses to build a flat that contradicts its own numbers**.

**The spec** (`AuthoredFlat`, one TypeScript data file per flat): `rooms` (`RoomSpec`: an `id`, a label, a room type, one or more **rectangles** in metres in the flat's frame, x east and z south, `x`, `z` the north-west inside corner, `w` east-west, `d` north-south, each with the size the source prints for it, `printedPlan(a, b)` for the plan's metres or `printedTable([ft, in], [ft, in])` for the table; several touching rectangles make one rectilinear room, an L; `openTo` names rooms with no wall between them on the stretch they face; `solidSides` keeps a balcony's pier walls solid; `finish` picks the finish group of the specification), `openings` (`OpeningSpec`: a room, the compass side of its wall, the plan coordinate of the middle along that wall, a width, a kind `door | opening | window | sliding`, the compass side of the hinge post and the room the leaf swings into), `pieces` (furniture by the catalogue piece and the compass side its front faces, or by drawn size), `ac` points, the `mainDoor`, the stated `carpetAreaM2` and its tolerance, `northDeg`, and `notes` (readings of an ambiguous plan and what the plan shows that the scene does not draw, word for word into the scene's extras). `buildLayout` turns it into rooms and openings in the scene's own format (edges of an L split where rooms are open to each other, openings found by wall and coordinate), `buildFlatScene` into a `PropertyFile`.

**The checks** (`checkFlat`; a failing one throws, so `npm run make:building` fails; `tests/flat-spec.test.ts` breaks each):
1. every rectangle of every room is built to its printed size, either order, **within 2 cm**;
2. no two rooms overlap (they may touch);
3. every room can be reached from the main door, through doors, openings and open stretches; a window must look outside, not into another room; no two openings overlap on one wall; an opening must lie on its wall; the main door is a door on an outside wall;
4. every piece lies inside the rooms;
5. **the rooms the source counts plus the walls between them are within the source's stated tolerance (3 %) of the stated RERA carpet area.** The rooms alone are 5 to 9 % short in all four flats, because RERA carpet area counts the area under internal partition walls (the utility's walls too; a balcony's wall is an outside wall). The walls are taken as built (gaps between rooms, 6 to 36 cm, from the plan's own wall lines), so this is a check on the layout, not a fudge: a room moved or a room missing breaks it. The usable area (adds the balcony and the utility) is held to the same tolerance in a test.

**What is a fact and what is not** (16.2). Printed: the size of every room. Scaled off the picture (the plan is drawn to a scale of its own, 121 to 162 px per metre in the four): where a room sits (to about 10 cm: where the picture and the printed sizes disagree, the printed sizes win and walls take up the difference, never less than 6 cm), where a door or window is, its width, and the hinge and swing of a leaf the plan draws (a leaf without a drawn arc is marked `assumed`). **Typical, not given by the source**: wall thickness (the gaps as the plan draws them), sill 0.9 m (toilets 1.5 m) and head 2.1 m of windows, door height, and the ceiling, 2.75 m, which `proposal-extras.json` marks **not confirmed** (`ceiling.verified: false`: it is never printed as a number). The extras say all this in `assumptions`. Furniture is the plan's own "artist's conception": the same pieces in the same places (beds, wardrobes, sofa, centre table, TV units, dining table with its chairs, kitchen platform with sink, fridge, washing machine, WC, basin and shower head in each toilet, the deck chairs), at the catalogue's size (a drawn size where the catalogue has no such piece or the plan's is smaller: a bed 1.9 m long in a room 2.75 m wide), as `real` sample pieces a viewer can move or delete; the flat's subtitle says "furniture illustrative".

**Where the picture and the numbers had to be reconciled** (each flat's `notes`, shown in its extras): in every flat some rooms are drawn a few percent off the printed sizes; the printed size is built. A walkable plan is also needed (`validateBuilding`: a landing 0.8 m inside the door, every room reachable on the walk grid), so a fixture was moved along its wall where the plan put it across a toilet's only way in (the master toilet of the 644 sq ft flat: the WC 19 cm north of where it is drawn), and a bed was drawn at the plan's length, not the catalogue's, where the catalogue's would leave 26 cm beside the TV unit. A foyer 0.60 m deep (the 644 sq ft flat) cannot hold a landing, so it is built as a part of the living room (two printed rectangles). Doorless openings were read where the plan shows a pale line or a gap between two rooms (kitchen and utility, a master bedroom and its passage).

**Compass.** On each page the letter N sits on one side of the compass rose and that side is north (it agrees with the page's "facing" label read as the side the balcony and the main windows, at the bottom of the page, look to): north is to the **left** of the page for the 1,117 and the 930 sq ft flats (so east is up the page and the plan faces west) and to the **right** for the 589 and the 644 sq ft flats (west up the page, the plan faces east). Each spec carries that as `northDeg` (bearing of the plan's -z, 90 and 270) and `brochureFacing`. **In the building the sun follows OUR plate, not the page**: the floor arrangement is ours, and four flats whose pages orient them differently share one floor. The typical floor's north is up its plan (`PLATE_NORTH_DEG = 0` in `make-sample-building.ts`), and each flat scene's `look.json` `northDeg` is its plan's -z turned by the flat's placement (a flat's scene is shared by every floor and every floor has the same plate; rotation 0, 90, 180, 270 gives 0, 90, 180, 270), so the sun comes from the same side of the floor for every flat. Each flat's card on the map says what the brochure's own plan faces ("information only") and which way this flat's balcony side faces in the tower. Of the four, the 930, 589 and 644 sq ft flats face the way their pages say (west, east, east); the 1,117 sq ft flat, which closes the corridor's north end, has its balcony side to the north. Tested in `tests/building-brochure-flats.test.ts` ("north").

**The internal specification** (the source's list), as the scene format can say it, in each flat's `design.json` (a sheet on the Light Scandinavian pack, `source: "typical"`, 16.13): vitrified flooring in the living, dining, bedrooms, kitchen and passages = floor finish `tile-ivory-gloss` (the kit's tile size rule gives 600 or 800 mm squares, which is what vitrified comes in); premium tiles in the utility, the balcony and the toilets = `tile-sand` and `tile-grey`; the toilets' walls take the tile colour `tile-grey` **whole, because a room has no dado height** (the specification's dado to the beam bottom cannot be said); the quartz kitchen platform = the counters' `top` role `white-stone`, and the steel sink is the catalogue's steel sink; flush doors with a laminate finish = the sheet's door role `white-laminate` (the colour is not specified, a light neutral is typical); provisions for AC in the living room and bedrooms = a split AC (`ac` fixtures, decor, "typical styling") on the wall at the TV in the bedrooms and the living room, **the provision's real place is not given**; ceiling fans in the living, dining, kitchen and bedrooms = the kit's fans, which it places in the living room and bedrooms of 7 m2 or more (**not in the dining or kitchen**); railings at windows = the kit's window grills. Not expressible: the fire-rated main door (the main door keeps the portal look of 18.6), the glass partitions in toilets (the catalogue has one, the brochure gives no place for it: none is placed), a hob (no piece), a dado height. The empty twin keeps the specification (room finishes, the door finish) and none of the decor (no AC, no counter finish).

**Tests.** `tests/flat-spec.test.ts` (the validator, break by break, on a small flat); `tests/building-brochure-flats.test.ts` (each flat: printed against built size per room, the area against the stated figure, every room reachable bare and furnished, the main door on an outside wall, the specification and the unconfirmed ceiling in the extras, the empty twin, and the typical floor: doors meet, no flat on another, no balcony or window facing a wall, one corridor 1.8 m wide).

**Inside a home (`src/buyer/door-labels.ts`, 16 Nov 2026).** Every door of a home carries a smaller board (13 cm high) on both sides, 6 cm over the head, naming the room it leads to: from the passage the master bedroom's door reads "Master bedroom", from inside it reads "Passage". The words are the rooms' own labels; the door onto the outside reads "Exit". A shared space keeps the building's boards for its outside doors and gets these only for doors between its own rooms. Boards are fixed and freed with the scene.

### 18.14 The Flats switcher and the building page, for a showroom (`src/building/flats.ts`, `map.ts`, 16 Nov 2026)

- **Flats** is a tool in the bar of every space of a building that has flats. It opens a glass panel under the bar (the walker stands still, Escape or a tap outside closes it): one card per flat of a level, each with the flat's name ("Flat 201") and what it is as the building file states it ("2 BHK · 644 sq ft", from `flatTypes`), the one you are in marked "You are here"; level tabs when more than one level has flats. A choice goes to that flat's main door through `BuildingWalk.go`, behind the same loading screen as a door, so the view, the style, the time of day and the person carry over exactly as for a portal. Nothing about a space is changed. Tested on the real building file (`tests/ux-pure.test.ts`).
- **The building page** (`/?building=<id>`, and the map over the walk): the name, its first sentence, one quiet line ("Sample building. Plans follow a published brochure.", the rest of the disclosure is the note at the foot), the levels as a side elevation (top first, each as tall as its floor to floor height), the plan of the level with each space outlined, a card for the space picked (its kind, name, carpet area, notes) with one primary action ("Walk in" on the page, "Walk there" over the walk), and the list of spaces on the level. The start page lists buildings first, then homes, then the upload.


### 18.15 A builder's brand on a building: white label (`src/brand/builder-brand.ts`, `parse.ts`, 17 Nov 2026)

A building can carry the builder's own brand, so what a sales room shows is the builder's and not ours.

- **The file.** `brand` in `building.json`, optional: `name` (1 to 60 characters), `logo?` (the name of an `.svg` or `.png` file in the building's own folder, `public/buildings/<id>/`: lower-case letters, digits, dots, hyphens, no path), `accent?` (`#RRGGBB`), `tagline?` (1 to 80 characters), `hideCredit?` (boolean). `parseBrand` checks every field and a wrong one is an error that names it (`brand.accent ...`): a building never opens with half a brand.
- **Where it shows.** The walk's identity card: the logo in the tile where the generic icon was, the brand's name in small capitals over the place, and "powered by walkthru" as the card's last quiet line (`hud.setBrand`, `showIdentityBrand`). The building's map page: logo, name and tagline over the project's name, the credit at the right, and the page's own walkthru wordmark steps aside; the tab title is "<project> · <brand>". The loading screen and the door curtain: logo and name over the title, the credit at the foot. The lift ride: a small pill at the foot. A logo that is missing or fails to load is replaced by the brand's initials.
- **The colour.** `brandAccent(hex)` decides. The colour is used as the accent when white text on it reaches 4.5 (it is the fill of the primary buttons) and it reaches 3 against the paper; on the glass panels the same hue is lifted towards white in steps until it reaches 4.5 against the panel (`#1A1513`). A colour that cannot do that (a yellow, a pale tint, nonsense) is not used and the default terracotta stays: a wrong colour never makes a word unreadable. A usable colour sets `--wt-clay`, `--wt-clay-dark`, `--wt-clay-soft`, `--wt-accent`, `--wt-accent-dark` and `--wt-accent-on-glass` at the building's scope: on `<html>` for the walk (one building a page), on the map's own root on the start page, so the next page is not tinted.
- **The credit.** "powered by walkthru", small, on by default; `hideCredit: true` takes it off everywhere.
- **The samples.** Sample Tower carries a demonstration brand written by the generator (`SAMPLE_BRAND` in `scripts/building/make-sample-building.ts`: the invented name "Sample Developers", a mark of three rising blocks drawn there as `brand.svg`, a green accent `#1F6F5C`). Sample Tower, empty carries none: it is the product without a brand.
- Tests: `tests/builder-brand.test.ts` (the parser, the contrast rule and its fallback, the identity card with and without a brand).

## 19. Outdoor spaces: the pool area, the garden and other open-air spaces (stage 3, 16 Nov 2026)

A residential project is sold on its clubhouse as much as its flats, and a clubhouse is a pool, a lawn and a play area. Stage 3 makes the open-air space a first-class kind of space: a scene with an `outdoor.json` has no ceiling, a real sky and a sun that casts real shadows from its walls, trees and roofs, a ground that is paving, timber, lawn, gravel or soil instead of a floor, a boundary on each edge, water that reads as water, and planting that moves. The sample tower's pool area and garden (18.8) are finished examples; the empty tower has both bare. Nothing here is built on a drawing: an open-air space is an authored scene, like a lobby.

### 19.1 What "outdoor" means (`src/outdoor/`, three hooks in the shared code)

- **A scene is open-air when `public/scenes/<id>/outdoor.json` exists** (read in `boot`, `src/outdoor/load.ts`; missing, HTML or broken means an ordinary room, with a console warning for a broken one). A building's space may also say `outdoor: true` (18.2) for the map and the host; the scene's own file is what builds it.
- **No ceiling, no floor mesh, no indoor kit.** `buildShell(layout, { outdoor: { skipEdges } })` builds no ceiling and no floor, and no wall on the edges the module draws itself (every boundary that is not the `facade`); collision does not change, the layout's walls still stop the walker. `mountKit({ outdoor: true })` plans nothing (`kitPlan(..., true)`: no fan, tube, switchboard, grill, cove, skirting or tiled floor), whatever the Plain switch says. Lived-in decor and the baked lighting are off. The room's `wallHeightM` is the building's face (10.6 m in the sample), so no ceiling-height check can arise: nothing is "too tall" and `setCeilingTrust({ known: true })` keeps the "ceiling not measured" note away.
- **Sky and sun.** The plain graded sky of 16.12 is the sky (no picture, no neighbour: honesty rule 16.2.4, "Outside the window is a plain sky, not the real view" stands). `outdoor.json` says `northDeg` (the compass bearing of the plan's -z; a `look.json` of its own wins), so the sun has the path of 16.12 across the space; the four presets work unchanged. The look is told it is outdoors (`createLook(..., { outdoor: true })`, `src/outdoor/exposure.ts`): the exposure comes down by up to 30 % in full sun (`outdoorExposure`), the hemisphere is lifted so that shade is lit by the sky (x1.3 by day, 1.8 at sunset, 2.2 at night: `outdoorHemiBoost`), the low tier keeps most of its sun (`outdoorSunScale`: indoors it turns it down to 0.1 because no shadow map stops it), the room-lamp lift and the virtual ceiling light are off, the floor reflection is off, and the screen-space AO of the high tier is held to 0.4. A lamp post's pooled light is 30 cd reaching 12 m (a room's is 6 cd and 6.5 m).
- **Shadows.** Walls, piers, the facade, roofs, columns, trees, palms, hedges and every piece cast and receive the sun's shadow map (medium: one static 1024 map; high: 2048, live; low: none), so a compound wall shades a deck in the evening and a tree dapples a lawn. Leaf cards are alpha-tested so their shadows are leaf-shaped. The shadow frustum is fitted to the room and the facade's height.
- **Camera.** `FollowCamera.setOpenAir(true)`: the boom is up to 6.5 m (3.5 indoors), the steepest look-down 72 degrees (60), the start 3.8 m back at 22 degrees (2 m at 12), and the boom stops at the edge of the space (`boomDistance(..., blockVoid)`): it does not pass out through the doorway or over a railing into nothing. First person is unchanged.
- **Honesty.** What is beyond the boundary is not drawn: no neighbours, no street, no horizon of buildings; below the sky's horizon the plain sky's soft haze is all there is. The building's face is drawn (cornice, storeys of windows) and is decor, like a lobby's finishes. Plants, water and finishes are a model of a typical Indian clubhouse; sizes of pieces and of the basins are exact, everything else is "typical".

### 19.2 The data (`src/outdoor/types.ts`, parsed by `parseOutdoor`, checked by `validateOutdoor`)

`public/scenes/<id>/outdoor.json`, scene frame, metres. The scene's own `property.json` still carries the room (polygon and the walls that stop the walker, `spaceKind` `pool` or `garden`), the door and the pieces. `parseOutdoor` rejects with the place named (`outdoor.json: pools[0].profile positions must increase`).

| Field | Meaning |
| --- | --- |
| `version` 1, `note?`, `northDeg?`, `seed` | sample note; the sun's compass; seeds the small variations so the same file always looks the same |
| `areas[]` | ground patches `{ id, finish, polygon, holes?, colour?, stripes?, edgingM? }`. `finish`: `paving` (stone deck), `deck` (timber), `lawn`, `gravel`, `bed` (soil and mulch), `path` (interlocking pavers), `rubber` (safety surfacing, `colour` per area), `track` (rubberised running track). Later areas draw over earlier ones (a finish lifts a few mm, an overlap of one finish 1.5 mm per area, so nothing z-fights); `holes` are left open (a pool); `edgingM` (0.05 to 0.3) is a kerb along the edge (a bed's raised border) |
| `pools[]` | basins (19.3): `{ id, rect, shallowEnd N/E/S/W, profile [[0..1, depth m]...], waterBelowDeckM, copingM, steps[], ladders[], lanes, markers, kids?, tile }` |
| `boundary[]` | one entry per layout edge: `{ room, edge, kind, heightM?, colour? }`, `kind`: `compound` (plastered wall with piers and a cap, 2.1 m), `parapet` (low wall and steel railing, 1.1 m), `hedge` (a clipped ficus hedge, 1.8 m, instanced), `glass` (glass balustrade with a handrail, 1.1 m), `facade` (the wall of the building the space attaches to: the shell draws it with the door; this adds its cornice and windows). Only a facade edge may have a door in it (checked) |
| `trees[]`, `beds[]`, `rows[]` | plants (19.4): single plants `{ species, x, z, scale?, rotDeg? }`; beds planted by a seeded scatter `{ id, polygon, species [{id, weight}], density per m2, seed }`; rows (the "plant a row" helper) `{ from, to, species, style 'row' (a plant every spacingM) or 'hedge' (one clipped mass), widthM?, heightM? }` |
| `roofs[]` | a covered part `{ rect, heightM, kind slab or pergola, columns[] }`: the semi-outdoor verandah; the slab and its columns cast shadow and count against the pool walkway |

`validateOutdoor(file, layout)`: everything inside the room (within 2 cm of its edge), pools and their coping inside it and not overlapping, steps and ladders within their edge and not more than halfway across, a boundary naming a real edge, a door only in a facade; warnings for an unnamed edge (the plain layout wall stands), a pool nowhere shallower than 1.5 m, a children's pool deeper than 0.7 m. The generator runs it before it writes.

### 19.3 The swimming pool (`pool.ts`, `pool-build.ts`, `water.ts`, `depth-card.ts`, `walkway.ts`, `pool-ui.ts`)

- **A sunken basin, not a blue rectangle.** The deck has a hole the size of the basin plus its coping. The basin is built from the profile: a floor strip per piece of the profile (the sample: 1.2 m flat for 40 %, a slope to 1.7 m by 75 %, flat to the deep end; the children's pool 0.45 to 0.6 m), walls in two bands (a darker waterline band 30 cm deep and mosaic tile below it to the floor), steps (three treads of 30 cm, 0.30, 0.52 and 0.74 m under the water, each with a pale slip band on its nosing), two ladders (stainless handrails curving over the coping, two rungs under the water), coping 30 cm wide and 3 cm proud with the depths printed in it (`markerStations`: 1.2, 1.3 and 1.7 m for the main pool, 0.5 m for the children's), optional lane lines, and pool lights in the long walls that glow at night. The water sits 12 cm under the deck (a skimmer pool). `depthAt(basin, x, z)` is the depth anywhere, steps included (a step never rises above the floor beneath it).
- **Water, per tier.** Two parts. The surface (`makeWaterSurface`) is a transparent shader that adds only what a water surface adds: the plain graded sky and the sun mirrored in it, strongest at a low angle (Schlick Fresnel, F0 0.02), moved by five crossing sine waves (normals only, the surface is flat), flattened beyond 14 m so it does not shimmer, with a tight sun glint kept finite for bloom. It lets everything under it through. The underwater surfaces (the pool's tile, walls, steps, lane lines) are ordinary lit materials patched (`makeUnderwater`) so what is under water is tinted by the water the eye looks through (water takes red first: absorption 0.62, 0.12, 0.07 per metre, scatter 0.42, so shallow tile reads as tile and deep water as turquoise to deep blue), wobbles like a refracted image, and is netted with caustics. **Low:** moving normals and the depth tint only. **Medium:** + the refraction wobble and a 3-pass caustic. **High:** + a 5-pass caustic and a finer ripple. All shaders are GLSL ES 3.0 (WebGL2), no extra textures; at night the pool lights tint the water and the sun's glint and caustics go off. The facade and the planting are not mirrored in it (no planar reflection): the sky is.
- **The walker and the water.** A walker cannot walk on water: the whole rectangle of each basin is a temporary obstacle (`waterObstacles`), so they stop at the coping with deck under their feet. **Wading in at the steps is not built** (SPEC 19.11). A pill near the water says what the water is ("Water 1.3 m deep. See depth", and at the edge "The water's edge: 1.3 m deep. You cannot walk into it").
- **The depth card** (the point of the product for a pool; `depth-card.ts`, `pool-ui.ts`). It opens from the pill. A section drawing of the pool along its length with a figure of the chosen height standing at the shallow end, the middle and the deep end (to scale: a figure is as tall as the water is deep), the water drawn over their legs, and the sentence for the depth under the walker's feet and for the shallow and the deep end: **"Water reaches 1.3 m: chest-deep for a 175 cm adult; over a 120 cm child's head."** The person is "You" (your own height from the person picker), an adult (175), a child (120) or a toddler (90). The words come from fractions of standing height (ankle 0.07, shin 0.18, knee 0.32, thigh 0.45, hip 0.56, waist 0.65, chest 0.78, shoulder 0.84, chin 0.90, eyes 0.97, then "over the head"). Under it, labelled **typical guidance, not code**: a shallow end of about 1.2 m and a deep end of 1.5 to 1.8 m for a residential pool, a children's pool of about 0.6 m or less with its own fence or gate, no diving under about 1.5 m, depth markers on the coping and the wall; and "check your local pool code with your consultant" (fencing, a lifeguard, signs and the drain cover are set by it, not by this model).
- **The walkway check.** The deck needs a clear path round the water. `walkwayReport` walks out from each side of each pool (not the children's, which has its own rule) in 5 cm steps and reads how far the clear deck goes before a wall, another pool or a piece taller than 25 cm (and the roof columns). **1.2 m from the water's edge is an assumption** (typical guidance, not code) and every sentence says so; 0.9 to 1.2 m is "tight", under 0.9 m "blocked". The verdict is a pill that follows the pieces ("Pool walkway clear, 1.2 m (assumed)", "Walkway blocked on the south side") and a line in the depth card with the numbers: "Walkway blocked on the south side: the pool lounger leaves 60 cm, a person cannot get past the water's edge there (1.2 m clear all round the water is assumed (typical guidance, not code))." A lounger has its own zone, 60 cm to each side so a person can step between loungers.

### 19.4 Gardens and planting (`plants.ts`, `species.ts`, `foliage.ts`, `materials.ts`, `build.ts`)

- **Ground.** The lawn is the CC0 Poly Haven `leafy_grass` used as detail around a green tint (`patchGround`: the texture's light and dark around its own mean, so the lawn is the green we pick), with world-space noise at three scales (patches of a few metres, a metre, a hand), a warm dry shift in the bright patches, a noise normal that lumps the surface under a low sun, and mown stripes (3.4 m bands, 0.84 to 1.13) when `stripes` is on. Timber decking (`wood_floor_deck`), sandstone paving (`red_sandstone_pavement`), interlocking pavers for the paths (`interlocking_concrete_pavers`, the dumbbell block of Indian gardens), gravel (`gravel_floor_02`), soil and mulch (`farm_soil`), rubber (`rubber_tiles`) are the same treatment. Textures are 512 px derived from the 1k originals by `scripts/fetch-outdoor-assets.ts` (originals' MD5 checked against the Poly Haven API, mean luminance recorded, 764 KB for all seven sets), arrive after the first paint, and the low tier loads no normal maps.
- **Vegetation is procedural**, so no model file and no licence beyond the ground textures. Species (`species.ts`): royal palm, areca palm (a clump of stems), frangipani (champa), neem, gulmohar, ficus (tree and hedge), bougainvillea, hibiscus, croton. A tree is a tapered trunk with branches and **clumps of leaf cards** (alpha-tested quads carrying a painted leaf spray, drawn on a canvas, with the blossom of the species in it: red gulmohar, cream frangipani, magenta bougainvillea bracts) whose normals point out of the clump (a crown is lit as a soft ball, not as a pile of flat cards). A palm is a ringed trunk and arching pinnate fronds. A hedge is a rounded, lumpy block (a superellipsoid, 752 triangles) with a leaf mat. Everything is **instanced: one mesh per species (two with a trunk)**, with a random scale, turn and tint per plant, so the sample garden's 181 plants and 40 hedge blocks are 16 instanced meshes.
- **Wind** (medium and high): a vertex-shader sway, more the higher the vertex, out of step from plant to plant (instance position as the phase); shadows do not move. **Tiers** (`VEG_TIER`): cards per clump 9 / 22 / 30 and clumps per tree 9 / 18 / 26 (low / medium / high), the low tier draws 55 % of the shrubs (a deterministic share) and no wind; trees and palms are always all drawn. `plantBudget` counts plants, draw calls and triangles per tier (the count of triangles is the geometry's own).
- **Planting helpers.** `scatterBed` (a seeded jittered grid inside a polygon, species by weight: the same file always grows the same bed), `plantRow` ("plant a row": one plant every `spacingM`, both ends included) and `hedgeSegments` ("fill a bed" and hedges).

### 19.5 Pieces (`src/core/catalog-pool.ts`, `catalog-garden.ts`, `src/look/gen/pool.ts`, `garden.ts`)

Catalogue rows with `places`, aggregated by `catalog-spaces.ts`, generators registered as look kinds `pool` and `garden`; every piece is drawn exactly its row's size (`fitToBox`, the rule of 16.2) and the rows are covered by the stage-2 piece tests.

| Pool (`places: ['pool']`) | Size (w x d x h) | Zones and notes |
| --- | --- | --- |
| Pool lounger | 70 x 200 x 80 cm, seat 38 | 60 cm each side so a person can step between (assumed) |
| Parasol on a base | base 55 x 55, canopy 250 across, 240 high | the canopy reaches beyond its footprint and is drawn, not counted (card says so) |
| Pool-side chair, table (90) | 62 x 64 x 85; 90 x 90 x 72 | the table's note: 70 cm round for chairs pulled out |
| Outdoor shower post | 40 x 40 x 230 | 90 cm in front to stand under it |
| Towel rack, lifeguard chair, life-ring post | 120 x 40 x 115; 90 x 110 x 210 (seat 145); 50 x 30 x 150 | |
| Depth sign, changing-room door marker | 50 x 8 x 110 (the numeral is the depth you choose); 45 x 6 plate on a wall at 1.7 m | |
| Deck planter (pool and garden) | 80 x 80 x 110 | |

| Garden (`places: ['garden']`) | Size | Zones and notes |
| --- | --- | --- |
| Park bench 3-seat; senior seating bench | 180 x 62 x 82; 160 x 65 x 95 (seat 50, arm rests) | sit pose |
| Pergola with a bench | 260 x 110 x 250 | solid in the walk |
| Lamp post, bollard light (garden and pool) | 30 x 30 x 360; 22 x 22 x 85 | lit from the evening (`walkthruLight: 'lamp'`) |
| Slide | 80 x 270 x 190, platform 120 | 1.5 m run-out at the foot, 1.5 m to the sides and behind |
| Swing set, two seats | 300 x 180 x 230 | the arc of a jhoola (30 degrees each way from a 220 cm beam, the `arc()` zone of 16.16) with a 1.75 m floor in front and behind; 1.5 m at each end |
| See-saw; climbing frame | 240 x 36 x 72; 200 x 200 x 240 | 1.5 m all round; 1.8 m all round |
| Rubber safety surfacing, jogging track segment, yoga deck with mats | 200 x 200 x 2 cm; 600 x 150 x 1.5 cm; 300 x 300 x 5 cm | walked over (flat pieces) |
| Water feature | 160 x 160 x 110 | needs a pump and a drain (not on a drawing) |

Every fall zone, run-out and walkway is "typical guidance, check your consultant" in its own sentence. The tray shows pool pieces in a pool area and garden pieces in a garden (`places`, 16.17); a lamp post, a bollard and a deck planter are in both.

### 19.6 Portals, walking and the camera

The doors from the clubhouse foyer to the pool deck and the garden are ordinary portals (18.6): the door is the facade's, arrival is 1.9 m in, facing in, 0.45 m clear. The follow camera is the open-air one (19.1) and first person works. A space is built behind the same loading screen; the building's teardown rules apply unchanged.

### 19.7 The building map

The plan of a level draws each open-air space from its `outdoor.json` under its walls (`plan-art.ts`): lawn as lawn, paving, timber, paths, beds with their kerb, the track, rubber in its own colours, the water as water (a gradient from a pale shallow end to a dark deep end, the steps lighter, coping round it), the verandah dashed, trees and palms as crowns and shrubs as dots, hedges as thick lines. No stylesheet is needed (inline colours); the label and the area sit on top as for any space.

### 19.8 The sample spaces (`scripts/building/outdoor-spaces.ts`: kept for other buildings; the Sample Tower no longer uses them, SPEC 20)

The first Sample Tower had a made-up pool area (20 x 14 m, one 11 x 4.5 m pool and a children's pool, `test-tower-club-pool`) and a made-up garden (34 x 20 m with a jogging track and a play area, `test-tower-club-garden`). The tower's clubhouse level now follows a brochure plan (SPEC 20) and has neither: its pool wing, aqua-play court and banquet deck are open-air scenes of the same format (19.2), with the two additions of 20.3 (pools that touch share their water; the deck hole follows the union). The generators of the two first samples, `poolOutdoor`/`poolProperty` and `gardenOutdoor`/`gardenProperty`, and every pool and garden catalogue piece are unchanged and still tested (`tests/outdoor-spaces.test.ts` builds them in memory beside a stand-in foyer, `tests/helpers/legacy-clubhouse.ts`).

### 19.9 Budgets and the leak check (browser: SwiftShader, so the frame rates are not a phone's)

**Budgets** (`renderer.info` of one frame at the view named, headless Chrome with SwiftShader at 1280 x 800; the frame includes the walker, the people, the shadow pass on high and the post chain's passes; the second pair is the open-air module's own meshes):

| Space | Tier | Frame: triangles / draw calls | Open-air parts: triangles / meshes | Plants (drawn) | Downloaded |
| --- | --- | --- | --- | --- | --- |
| Pool area | low | 30.8 k / 171 | 11.7 k / 45 | 44 | 525 KB |
| Pool area | medium | 60.7 k / 171 | 20.1 k / 45 | 70 | 2.8 MB |
| Pool area | high | 147.8 k / 438 | 27.0 k / 45 | 70 | 2.8 MB |
| Garden | low | 47.6 k / 130 | 32.9 k / 30 | 115 + 40 hedge blocks | 525 KB |
| Garden | medium | 93.0 k / 130 | 63.9 k / 30 | 181 + 40 | 2.8 MB |
| Garden | high | 263.5 k / 342 | 98.0 k / 30 | 181 + 40 | 2.8 MB |

The plants are 11 (pool) and 16 (garden) instanced meshes whatever the count of plants; the water is one mesh a basin and about ten draw calls a pool; the ground of the garden is nine. Only the ground textures of the finishes in the space are downloaded (the seven sets are 764 KB together). The low tier has no sun shadow, no wind, a 55 % share of the shrubs, hedge blocks of 188 triangles (416, 752), no caustics and no normal maps. The water shader compiles on WebGL2 (GLSL ES 3.0, no extensions, no float textures); it was compiled and drawn by ANGLE/SwiftShader on all three tiers. No GPU was measured: the budgets are counts, not frame times.

**The leak check** (`__walkthruBuilding.go(space)`, medium tier, one page, after a warm-up that opened a space of every kind twice; the sequence is lobby, pool, garden, clubhouse foyer, hall, gym in a rotation, 20 more spaces, then the pool and the garden again):

| After | Geometries | Programs | DOM elements | Canvases | Textures held by the renderer when a space has just been taken down |
| --- | --- | --- | --- | --- | --- |
| warm-up | 246 (a gym) | 13 | 328 | 1 | 6 |
| +5, +10, +15, +20 spaces | 172, 172, 172, 172 (the pool) | 24, 23, 23, 24 | 326 | 1 | 6, 6, 8, 8 |
| the pool, then the garden again | 172, then 125 | 24, then 19 | 326, then 321 | 1 | 6, 6 |

The geometry, program and element counts are identical every time the same kind of space is up; the textures alive while a pool is up wander between 35 and 41 (images arrive after the first paint), and the count left behind after a teardown is 6 to 8 (a first version of this check found it climbing 8, 11, 14, 17, 19 over a pool-and-garden rotation: the pool's depth-sign canvases were rebuilt and not freed, now one canvas a numeral for the session; and every space's sun shadow map, a render target, was never disposed with its light: `look.dispose` now frees it, which helps the indoor spaces too). A rotation of the hall and the gym alone held 7 throughout. The JS heap moves with the garbage collector between about 35 and 160 MB with no trend.

### 19.10 Verification (16 Nov 2026)

On the built site (`npx vite build`, `npx vite preview --port 5371`), headless Chrome (`tools/cdp.mjs`), at 1440 x 900 and at 390 x 844 as a phone (MOBILE=1), `?quality=low|medium|high` forced and each judged, and every screenshot read: the clubhouse foyer, the door and the walker arriving on the pool deck facing in; the pool from deck level, from above, looking down into the water at the steps and at the deep end, at the shallow end, with the caustics; the depth card for "You" (175 cm), an adult, a child and a toddler on desktop and phone; loungers and parasols with the walkway pill clear and, after a lounger is put 0.7 m from the water, "Walkway blocked on the south side"; the garden from the entrance, along the central path, the play area, a bench under a tree, the facade seen from the lawn, from above; morning, afternoon, evening and night for both spaces; the building map of the clubhouse level (water drawn as water, lawn as lawn, paths, beds, the track, the verandah) on desktop; the empty tower's bare pool and bare lawn; Furnish in the pool area and in the garden with the tray ("Add pool-side pieces", "All pool-side pieces (21)", the sample pieces under "In this pool area"; "Add to the garden", "All garden pieces (18)").

Things the first looks found and the second fixed: the follow camera went out through the doorway and showed the back of the facade (now stops at the edge of the space, 19.1); the pool had a black deck on the high tier (the screen-space AO and the shade fill: 19.1); leaves were the size of plates on the neem (a leaf scale per species); the hedge was a box (a superellipsoid, with three levels of detail); two coloured areas of safety surfacing fought in the depth buffer (an overlapping finish lifts 1.5 mm); the sky was reflected as a dot pattern of pool lights by day (the lights are dark by day); the walkway verdict was wrongly "blocked" by the sample's own shower; the pool-light and the sign canvases leaked (19.9).

**Tests** (`tests/outdoor-*.test.ts`, 48 cases, and the rows are covered by `tests/space-pieces.test.ts`; the whole suite 3,449 passed, 1 skipped in 111 files): parsing and every rejection with its message; the checks (and each broken on purpose); the four sample scenes validate clean and the generator rebuilds them byte for byte; every sample piece fits where it stands (no collision, no blocked fall zone or swing arc); the pool's depth profile, steps, markers, what stops the walker, the nearest water; the depth card's words by height and the section drawing; the walkway verdicts (clear, tight, blocked by a lounger, by a wall, by the other pool, by a roof column; a mat does not block); the planting (a bed grows the same bed, a row, a hedge), the budget per tier equal to the geometry's own triangle count, the instanced meshes one per species with the right counts, wind only where the tier has it; the shell with no ceiling, no floor and no wall on the edges the module draws; the indoor kit planning nothing; the map plan; the exposure, the lamps, the virtual lights and the camera boom.

### 19.11 Honesty, and what stage 3 does not do

- **Wading is not built.** A walker stops at the coping. The depth card is the product's point and is complete; stepping into the pool at the steps with the water level drawn against the body (a walker's height changing with the floor, the camera and the body parts under the surface) is not there, and the card says so.
- The water does not mirror the facade, the trees or the loungers (only the plain sky and the sun), and a person or a piece standing in the water is not tinted by it. It is a pool as a pool looks, not a measured one: the depths, steps and sizes are exact, the colour, the ripples and the caustics are not facts.
- Vegetation is procedural: believable crowns, palms and flowering shrubs of the kinds an Indian society garden has, not botanical models; a tree seen at arm's length shows its cards. Flowers are painted in the leaf sprays. Neighbouring buildings and the street are not drawn; the sky meets a plain hazy ground at the horizon.
- The building's face (cornice, windows) is decor and the same for both spaces. The garden has a pergola but not a free-standing gazebo; a bend of the jogging track and the garden's paths are made of areas, not pieces (they are not movable in Furnish; the pieces are: loungers, benches, play equipment, lamps, planters, signs, the rubber mats, the yoga deck, the track segments, the water feature).
- Every guidance number (the 1.2 m walkway, fall zones of 1.5 and 1.8 m, the swing's 1.75 m, a 0.6 m children's pool, 1.5 m before diving) is "typical guidance, check your consultant". Nothing here claims a code.
- A baked lighting pass for open-air spaces is out of scope (a space without a bake looks as above). The open-air module was not run on a GPU.

## 20. The clubhouse level after a published builder brochure (16 Nov 2026)

The owner: the tower should run only on the configuration of a published builder brochure. Its amenity-level ("4th podium") plan replaces the made-up clubhouse level. The brochure's name, its project, its architect and its file are not written anywhere in the repository (a private lint, `tests/no-overfit.test.ts`, enforces it); nothing of it is copied in, only numbers read off the plan.

### 20.1 Honesty: one printed dimension

The plan prints no dimension except "25 M" for the lap pool. `scripts/building/podium-plan.ts` is the whole record: the pixel positions read off the plan's raster (4165 x 2125 px for the spread), and the scale `PX_PER_M = 642 px / 25 m = 25.68 px per metre`, 642 px being the lap pool's long edge (the one against the east planting strip, from the lawn bay's edge to the south coping). Checks the scale against the plan's own symbols: a car bay is 1.8 m wide and 4.0 m long at it, a gym treadmill 2.1 m. **Everything in metres is scaled from the drawing, not measured**: good to about a metre, carrying the drawing's own distortion; walls are taken at the centre of the drawn wall line. Every scene's subtitle says "scaled from its one printed dimension, not measured", every space's map note says "Scaled from the one printed dimension of the plan (the 25 m lap pool), not measured.", and the building's note says it. Pool depths are not in the brochure: they keep the typical profile (the lap pool 1.2 to 1.7 m, the shallow pool 0.9 to 1.2 m, the ledge 0.45 m, the play pool 0.3 to 0.45 m), labelled typical as before. `northDeg` is -15: the plan's north arrow leans 15 degrees to the right of the page's up.

### 20.2 What the plan shows, and what is built

Legend of the plan: outdoor 1 25 M lap pool with deck, 2 shallow pool with deck, 3 two banquet halls with outdoor deck, 4 aqua play, 5 lawn; indoor 6 gymnasium with changing room, 7 indoor games area (cards, carrom, chess, table tennis, foosball and pool table). It also shows lift lobbies, stairs, a wooden deck walkway, a bridge to the pool wing, and car parking and a ramp (not built).

| Space (`space=`) | Plan | Built |
| --- | --- | --- |
| Clubhouse foyer (`clubhouse`, corridor) | the lift lobby and the passage round the lift core, the passage along the gym | the union of five rectangles round the solid core; lifts A and B on the core's north face, the stairs door, the way to the ground floor, doors to the gym, both changing rooms, the games area, the deck and the bridge |
| Indoor games area (`games`, kind `games`) | 7 | pool table, table tennis, foosball, carrom board with four stools, chess table with two chairs, card table with four chairs and a lounge sofa with its table, placed where the plan draws them |
| Link passage (`link`, corridor) | the passage east of the games area, the second stair core | the spine and the pantry corner; doors to the games area, the lounge and the deck, the stairs door |
| Gymnasium (`gym`) | 6 | treadmills along the west wall (the plan draws seven; seven need 10.3 m of wall at the typical 50 cm each side and the room is about 9.5 m, so six stand), spin bikes along the south, a column of four strength machines, six mats, a dumbbell rack and a bench |
| Changing room 1 and 2 (`changing-1`, `changing-2`, kind `gym`) | the two blocks of cubicles north of the gym ("with changing room") | two rooms off the west passage with lockers and a bench (the plan draws cubicles, not lockers: sample furnishing) |
| Banquet hall 1, banquet lounge, banquet hall 2 (`hall-1`, `lounge`, `hall-2`, kind `hall`) | 3: two halls with round tables and, between them, a room of four café tables | six banquet tables, four café sets, five banquet tables as drawn; hall 2 has the diagonal corner the plan draws; every hall opens onto the deck, the lounge to both halls and the link passage |
| Banquet deck (`deck`, open air) | the timber deck along the three rooms | the deck, a hedge, two benches |
| Aqua play (`aqua`, open air) | 4 and the deck court | the timber court, the shallow play pool (15.2 x 12.8 m, 0.3 to 0.45 m), a water-play tower with a slide, a sun spray, a water mushroom and a row of nine ground jets, deck chairs, hedges; the two palms the plan draws standing in the water stand at the pool's corners (a basin has no island) |
| Pool area (`pool`, open air) | 1, 2, 5, the loungers, the lawns, the trees and the bridge | one L-shaped body of water (20.3), a pale ledge along the lap pool, five loungers on the north deck and ten on the west deck, seven chairs on the south-west deck, three lawns (item 5 is the south one) and nine trees, and the 13 m bridge to the foyer |

**Readings chosen where the plan is ambiguous.** The middle room of the three east rooms has no name in the legend ("2 banquet halls"): it is built as a third room, "Banquet lounge", between the halls. The doors are placed where the plan draws an opening; where it does not (the games area to the deck, for one) there is none. The plan draws light-blue strips in the water: the one along the lap pool's south-west is built as a 0.45 m ledge, the strips inside the shallow pool are not. The lap pool's width is squared to 5 m (the plan narrows to 3.7 m where trees stand over it), the shallow pool's east edge and the lawn's edge are squared to one line. The island with a tree in the shallow pool is not built. The bridge is shifted 1.1 m south to meet the passage, and its hatched spans (a pergola or louvres) are not drawn. The lift core, stairs and shafts are solid: only two lifts exist in the tower, so the second lift pair of the plan is not walkable. The "Garden" of the first sample is gone, as the owner asked.

**What the brochure puts on other levels** (not built): the ground floor plan's legend is 1 lobby water feature, 2 cricket practice net, 3 lounge pavilion, 4 fitness area, 5 children's play area, 6 yoga deck, 7 cricket lawn, 8 reflexology trail, with an "amenity plot to be handed over to the authority, not part of the layout"; the terrace plan's legend is 1 outdoor gym, 2 lawn, 3 barbecue deck, 4 viewing deck, 5 star-gazing deck. So the jogging track and the children's play area of the first sample are ground-floor amenities of the brochure (a play area, a yoga deck, a reflexology trail), and a fitness area is there too; the seniors' area is not named anywhere.

### 20.3 What the format learned

- **A new kind of space, `games`** (`SpaceKind`): a games room. Its tray reads "Add to the games room", its categories are Games, Seating, Tables, Plants & decor and Amenities, and its summary card is the hall's (seats and a walkway between doors; there are no ends to walk to).
- **Basins that touch share their water** (`exposureOf` in `src/outdoor/pool.ts`). An L-shaped pool is drawn as rectangles; where two touch along a stretch there is no coping, wall, light, numeral or walkway on that stretch, and where one is shallower a riser is built from its floor down to the other's. `unionOutline` (`src/outdoor/outline.ts`) gives the deck one hole of the union's shape, grown by the coping; the map draws every coping under every water. `validateOutdoor` lets touching basins touch (only their water must not overlap). The walkway check walks only the edge that meets the deck.
- **Map outlines follow the room**: a space whose room is not a rectangle is outlined and labelled by its own polygon (`labelPoint`), not by its bounding box.

### 20.4 New catalogue pieces (typical sizes, every clearance "typical guidance, check your consultant")

Games room: foosball table 140 x 120 x 90 cm with the rod handles out (cabinet 140 x 76; players 90 cm along each long side, 60 cm at the ends); chess table with two chairs 60 x 144 cm (60 cm square table, a chair at each end; 60 cm each side and 40 cm behind each chair); card table with four chairs 170 x 170 cm (85 cm square table); carrom board with four stools 160 x 160 cm (85 cm board on a stand, stools 34 cm across, seat at 46 cm). The existing table-tennis table (274 x 152.5 x 76 cm, run-back 1.8 m, 1.1 m at each side) and pool table now also serve a games room; **the pool table is now 254 x 142 cm (8 ft, with the rails) with 1.5 m all round (a cue is 1.47 m)**, before 265 x 145 and 1.2 m. Hall: round banquet table with four chairs 170 x 170 cm (120 cm table), café table with two chairs 160 x 70 cm. Pool kind: water-play tower with a slide 240 x 150 x 250 cm, sun spray 210 x 210 x 140, water mushroom 160 x 160 x 210, a row of nine ground jets 1,200 x 30 x 12 cm; the park bench is also offered in a pool area. Each is drawn by its generator at exactly its row's size (`hall.ts`, `pool.ts`; the generic piece tests run every row), is movable and removable in Furnish, and the aqua rows' sources are supplier ranges quoted in their cards.

### 20.5 Verification and what is below the bar

See the report of the day: `npm run make:building` clean (0 errors, 0 warnings, both buildings and all outdoor files), `npx tsc --noEmit`, the whole suite, the production build, and walk screenshots of every space. Below the bar: sizes are scaled (about 1 m); the loungers the plan draws touch the shallow pool, so the furnished wing's walkway reads "blocked" on its west side (the plan's own arrangement, reported rather than moved); six of the seven drawn treadmills; the foyer's core is a void, not drawn; pool depths, the changing rooms' fittings and the finishes are typical.
