# Vendored: blendi's oil-paint renderer (C11c, SPEC 16.7)

These files are copied **unmodified** from <https://git.patch.gg/blendi/oil-paint.git> (page: <https://patch.gg/blendi/oil-paint>),
commit `804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9` ("Release 1.1.3: both scenes fill the screen when made fullscreen while loading").
Copied on 13 Nov 2026 with `cp`; nothing was edited, renamed or reformatted. `vendor.lock.json` records the SHA-256 of every file
and `tests/painterly.test.ts` fails if one of them changes.

| File here | Upstream path | What it is |
|---|---|---|
| `src/oilpaint/index.js`, `common.js`, `brush.js`, `dabs.js`, `ground.js`, `pins.js`, `shade.js`, `finish.js` | same | the painter: shared uniforms and GLSL, the brush sheet made in code, dabs, pinned dabs, the sun's shade picture, the canvas finish |
| `src/night/kit.js` | same | the kit for painting solid made things (flat faces or any geometry tagged with a palette name) |
| `src/world/noise.js` | same | `rng`, imported by `kit.js`; kept at the same relative path so no import had to change |
| `LICENSE` | same | MIT, Copyright (c) 2026 Patch |
| `LICENCE-NOTES.md` | same | upstream's own notes: code MIT, art CC0 1.0 |

Not vendored: the demo scenes (`src/main.js`, `src/night/*` other than the kit, `src/world/*` other than `noise.js`), Patch's starter man and
its clips (Git LFS, not used here: our people come from MakeHuman system assets, see `public/characters/PEOPLE-LICENCE.txt`), Rapier (Apache-2.0,
not needed) and `lib/patch-block.js`.

## Licence position (checked 13 Nov 2026)

- **Code:** MIT. Commercial use, modification and redistribution are allowed provided the copyright notice and permission notice stay with copies
  of the code. `LICENSE` is kept here and a copy ships with the site at `/look/OILPAINT-LICENCE.txt`.
- **Art:** CC0 1.0 per upstream's `LICENCE-NOTES.md`. Nothing from that art is used here at all: the brush marks are generated in code
  (`brush.js`) and our shell, furniture and person are our own geometry painted with it.
- **three.js 0.186.1:** the same version upstream pins and we already depend on (MIT).
- Mahir asked for this renderer by name ("as realistic like patch.gg/blendi/oil-paint") and approved downloading it.

## How we use it

`src/look/painterly/adapter.ts` feeds our triangles to `createKit(...).tri/add/stroke`, the sun to `createShade`, the canvas to `createFrame`;
`src/look/painterly/person.ts` feeds our character's skinned meshes to `pinDabs`. The whole of `src/look/painterly/` is one lazy chunk, fetched
only when the buyer opens "Show as a painting". To update: copy the new files over, run `shasum -a 256`, regenerate `vendor.lock.json`,
change the commit above, and re-run `npm test` and the painterly checks of SPEC 16.8.
