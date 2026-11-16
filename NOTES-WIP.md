# Walkthru crisp branch: round 3 notes (17 Nov 2026)

Branch `crisp`, worktree `/Users/mahir/walkthru-wt/crisp`. Everything is committed; nothing is pushed.

## What round 3 added

- Warmth: wood-look vitrified plank (`plank-oak`) is the clean pack's floor for living, dining, bedrooms and passages (label stays "vitrified, wood-look, illustrative"); one accent cushion pair per room; calm trim and signs for every pack except Classic.
- Shared spaces: design sheets (`public/scenes/test-tower-*/design.json`) for lobby, corridor, foyer, gym, games room and halls (timber or polished floor, panelling, a pale stepped ceiling band, a slat feature wall in the lobby); a plank floor now wins over a drawn tile in a shared space; rubber gym floor is matt; lift doors get a steel surround and a call plate; round banquet tables are dressed with a cloth; pool felt; mid-tone rails; fuller tree canopies (medium 22 clumps x 26 cards).
- The person: dark brown hair with sheen, an irregular dissolving hairline at the nape and sideburns (alpha hash, lowest 10 % of the cap), softer wide ground shadow for all four people.
- Realistic materials (SPEC 16.21): Off / 1K / 2K, see the SPEC. Extension: door leaf normal, laminate emboss, quartz worktop, rug pile, felt, wet-room wall tile normal.
- Wardrobe handles: long bar is now 0.5 m at most (was up to 0.95 m), 11 mm (was 17 mm), two posts, and the clean pack's handle role is brushed steel (a mid-tone), door handles are steel too.
- Default dressing: a TYPICAL design sheet keeps the pack's sheer curtains and rugs for rooms it does not dress itself (`activeFixtures`); pictures hang in pairs.
- Sample homes: `test-sample-1` has a clean-pack design sheet and is re-baked (final, furniture tolerance 10 mm, parity worst 0.0002 mm). `test-sample-3` is on the clean pack. Samples 2, 4, 5, 6 were NOT re-baked (owner's scope cut); they open by link and their stale lightmaps fall back to the live lighting.

## Open items and known limits

- Software GL only: every capture was SwiftShader. Anisotropic filtering and the real cost of 2K are not measured on a GPU.
- The wet-room tile normal and the door leaf normal are subtle under the soft daylight; the sheet shows little difference. They matter more under a low window light.
- Not done: round tables with individually draped cloths (a straight skirt is drawn), lift car interior, a rubber grain texture, deck-board texture on the pool deck (the outdoor module has its own wood texture), loungers, a real hairline mesh (the hairline is a shader dissolve).
- Re-baking is needed again if the kit, door or counter geometry changes: `npm run bake -- <id> --quality final --furniture-tolerance-mm 10 --url http://localhost:<vite port>`.
