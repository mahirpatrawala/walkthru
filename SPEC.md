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

Style (the walkthru brand, `src/brand/brand.css`): full-bleed 3D; warm paper `#F7F0E4` and ink `#2B211C`, cards `#FFFDF8` with 14 px radius and one soft corner; terracotta `#B2472B` is the action colour, teal `#1E6B73` the colour of "measured" (measure lines, the mode bar), ochre `#E3A33A` the warmth; Bricolage Grotesque (Google Fonts) for display (wordmark, headings, chips, buttons) and the system font for anything you read. All text pairs checked at WCAG AA (white on terracotta 5.5, on teal 6.2, ink on paper 13.9, muted on paper 5.5). Verdict colours unchanged: good `#1E9E5A`, warn `#E0A100`, bad `#D64545`. Touch targets at least 44 px. The start page opens with a hero (name, "Walk through a flat before you visit it", an inline-SVG isometric flat in warm light, no image file and no three.js); the loading screens draw a small floor plan and rotate light lines ("Measuring twice, cutting never…") under the factual status line.

Rendering: `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping`, `antialias: true` when the scene has no splat and `false` when it has one (Spark's requirement), pixel ratio `min(devicePixelRatio, 2)` on desktop and `min(devicePixelRatio, 1.5)` on touch devices. One `HemisphereLight(0xffffff, 0xb8b0a8, 1.0)` and one `DirectionalLight(0xffffff, 0.6)` from (3, 6, 2). No shadow maps.

### 2.1 Buyer flow

**B0 Start page** (`/` with no `?scene=`; `src/start/`, no three.js). A gallery of homes, each a card with the floor plan redrawn from `property.json` (walls, doorways, windows, room names and sizes; never the source drawing), the title, the room count and a tag: "Your drawing" (real input), "Sample drawing · made-up" (`test-*`, or a subtitle that says synthetic or sample) or "From a phone video" (`video-*`, or any other scene with a scan); see `sceneOrigin` in `buyer/scene-tag.ts`. Real drawings first. The list comes from `public/scenes/index.json`, written by `scripts/make-scene-index.ts` (`npm run make:room`, the Vite build, and fresh on every dev request) by scanning `public/scenes/*/property.json`, so a new scene folder needs no code change. A room that is not measured (`proposal-extras.json`) shows "not measured" instead of a size, and a `partial` room is drawn dashed and hatched, shows "partly on the drawing" and is never a start point. A card opens "Where do you want to start?" (`/?home=<id>[&room=<id>]`): the plan large, every whole room tappable (not partial, not passage, bathroom or balcony unless nothing else is left), the largest measured bedroom or living room preselected, button "Start walking in <Room>". That goes to `/?scene=<id>&room=<id>`, then B2 and B3 as below. `?scene=<id>` alone still works and starts in the default room.

**Spawn.** `core/spawn.ts` `chooseSpawn`: inside the chosen room, just in from its main door (a door or opening that leads to another room, else the widest), or with no door near the wall whose middle is farthest from the room's centre; at least 0.6 m clear of walls and furniture on the walking grid (relaxed only when the room has no such point); facing the room's centroid; the first camera must not end outside the room. Never a `partial` room. `property.spawn` is only the fallback when no room has a place to stand. The buyer HUD has a small "All homes" link back to `/`.

**B1 Loading.** Property title and subtitle, a progress bar, and "Walk around. Try a bed. Check the sizes." Under it, small: "Sizes from the floor plan. Colours approximate (from phone video)." If `property.json` is missing: "This home is not set up yet." with a link to the editor.

**B2 Pick your height.** Shown once the shell is built, over the live view.
- Heading: "How tall are you?"
- Three chips: `160 cm`, `175 cm` (default), `190 cm`, each showing its tint (teal `#1FA3A3`, orange `#E8823A`, violet `#7A5AF0`).
- Stepper row: `-` `175 cm · 5 ft 9 in` `+`, 1 cm steps, 140 to 200. A preset sets the stepper. A custom height takes the tint of the nearest preset.
- Button "Start walking". Stored in `localStorage` key `walkthru:height`.
- Reopen any time from the HUD person button. Changing height rescales the character and refreshes any open verdict card.

**B3 Walking (main screen).**
- Third-person camera behind the character, who spawns at `property.spawn`.
- Top left: room chip, e.g. "Bedroom 1 · 215 sq ft · 20.0 m²", updating as the character crosses room polygons. Hidden in a doorway.
- Top right: round buttons: person (height), ruler (measure), sofa (furnish), list (rooms sheet). If the property has a splat, a fifth "Scan" toggle shows or hides it.
- Bottom centre: the interaction prompt pill.
- First visit, 4 s hint. Desktop: "WASD to walk · drag to look · E to interact". Touch: "Left thumb to walk · right thumb to look".

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

Speeds: walk 1.4 m/s, jog 2.8 m/s, both times `height / 1.75`. The character turns toward its movement direction at 10 rad/s. Animation `timeScale = speed / (1.4 * height / 1.75)` for walk and `speed / (2.8 * height / 1.75)` for jog. Cross-fade 0.2 s.

### 2.4 Camera indoors

- Pivot: character position at `0.85 * height`, shifted 0.20 m to the camera's right (over the shoulder).
- Defaults: boom 2.0 m, pitch 12° down, FOV 60° (70° in portrait), near 0.05, far 200. Limits: pitch -5° to 60°, boom 1.0 to 3.5 m.
- **No clipping through walls.** Each frame, march from the pivot toward the wanted camera position through the grid (`boomDistance`, 4.3). The boom stops 0.20 m short of the first blocking cell. Full-height cells (walls, wardrobes) always block. Lower cells (beds, sofas, railings, window sills) block only if the camera would pass below their top plus 15 cm. The camera stays below `wallHeight - 0.15` and above 0.15 m.
- Shorten instantly, lengthen at 2 m/s.
- Below a 0.7 m boom the character is hidden (reads as first person in a tight passage) and reappears above 0.8 m.
- `focusOn(centre, distance, pitchDeg)` swings in 0.5 s to look at a point. Bed: distance `max(2.2, 1.2 * length)`, pitch 50°. Sofa: 2.4 m, pitch 20°, from the front. Furnish mode does not change the camera. The boom rule always applies.

---

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
}
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
export const HEIGHT_TINTS = ['#1FA3A3', '#E8823A', '#7A5AF0'] as const;
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

---

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
- Mapping: bed, sofa, dining, wardrobe and counter become furniture items (`source: 'real'`), sized from the symbol's box (`method: 'vector'`, so sizes are `unverified` unless a label or elevation dimension verifies them). A chair at a table becomes the existing `chair` decor. Sanitary and kitchen fixtures, AC units and switchboards are recorded in `symbols` and `proposal-extras.json` only: there is no look for them yet, and adding looks is not part of C12.

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

- **Local picture path** (`src/understand/raster-local.ts`, `src/understand/local/*`). Used by `readRasterPages` when the provider is null; needs Tesseract, says so when it is missing. Thin dark marks are grouped into text blocks and read with Tesseract at several sizes (`local/ocr.ts`); a block becomes a room label when it holds a room word (lexicon) and/or a printed size, with repairs for what OCR garbles (`local/sizes.ts`: a lost foot mark, a comma for a point, an x read as K, a size split over lines). Walls are the thick dark structures (threshold found from the picture, `local/ink.ts`); from each label a ray vote over rows and columns across the room gives the walls around it, so doors and windows leave gaps that are outvoted. One scale is fitted to all rooms (`pixels/fit.ts`, RANSAC, 3% inlier band).
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
