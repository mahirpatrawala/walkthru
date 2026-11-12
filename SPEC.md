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

Style: full-bleed 3D, HUD in the system font, white cards with 12 px radius, one accent `#2F6BFF`. Verdict colours: good `#1E9E5A`, warn `#E0A100`, bad `#D64545`. Touch targets at least 44 px.

Rendering: `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping`, `antialias: true` when the scene has no splat and `false` when it has one (Spark's requirement), pixel ratio `min(devicePixelRatio, 2)` on desktop and `min(devicePixelRatio, 1.5)` on touch devices. One `HemisphereLight(0xffffff, 0xb8b0a8, 1.0)` and one `DirectionalLight(0xffffff, 0.6)` from (3, 6, 2). No shadow maps.

### 2.1 Buyer flow

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

Nine chunks in four waves (C8 is specified in section 13). A wave starts when the previous one is merged and `npm run typecheck && npm test` is green.

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
