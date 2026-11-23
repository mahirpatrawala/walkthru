// Fetches the free 3D models of the clubhouse interiors (SPEC 16.17.3): gym machines, games-room tables, lounge and hall pieces, changing-room
// pieces and the sample decor of the shared spaces. Checks every file against what its source publishes and records source, author, licence,
// the date the licence was read and SHA-256 in public/look/club/club.lock.json and public/look/club/LICENCE.txt (the same shape as
// public/look/gym/gym.lock.json, which the in-app credits read). Raw downloads go to a cache outside the repo;
// tools/optimise-club-assets.mjs turns them into what ships under public/look/club/.
//
//   npx tsx scripts/fetch-club-assets.ts [--cache <dir>] [--update]
//
// Licence order: CC0 first (Poly Haven), then CC BY 4.0 with the author credited (Sketchfab models as archived in Objaverse 1.0 on Hugging Face,
// allenai/objaverse, which needs no login; the licence is the Sketchfab API record Objaverse archived with the object). Nothing with no licence,
// NC, ND, SA, editorial or unknown terms. Only model and image files are downloaded; nothing downloaded is run.
// Safe to re-run: a cached file that matches the lock is kept; a hash that differs from the lock aborts (`--update` accepts the new one).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/club');
const READ = '2026-11-22';
const HF = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';
const BY_WORDS = (uid: string): string => `Objaverse 1.0 metadata (allenai/objaverse on Hugging Face, the Sketchfab API v3 record of model ${uid}): license "by", Sketchfab's "CC Attribution": "Author must be credited. Commercial use is allowed."`;
const PH = { licence: 'CC0 1.0' as const, licenceUrl: 'https://polyhaven.com/license', licenceWords: 'Our assets are all licensed as CC0' };
const BY = { licence: 'CC BY 4.0' as const, licenceUrl: 'http://creativecommons.org/licenses/by/4.0/' };

export interface ClubAsset {
  id: string;
  name: string;
  kind: 'model';
  authors: string[];
  page: string;
  licence: 'CC0 1.0' | 'CC BY 4.0';
  licenceUrl: string;
  licenceWords: string;
  use: string;
  /** `polyhaven:<slug>` stands for the model's 1k glTF and every file it includes; an Objaverse file is pinned by its Hugging Face LFS SHA-256 */
  files: { path: string; url: string; sha256?: string }[];
}

const sketchfab = (uid: string, name: string, author: string, slug: string, objPath: string, sha256: string, use: string): ClubAsset => ({
  id: `sketchfab-${uid}`, name, kind: 'model', authors: [author], page: `https://sketchfab.com/3d-models/${slug}-${uid}`, ...BY, licenceWords: BY_WORDS(uid), use,
  files: [{ path: `${uid}.glb`, url: HF + objPath, sha256 }],
});
const polyhaven = (slug: string, name: string, authors: string[], use: string): ClubAsset => ({
  id: slug, name, kind: 'model', authors, page: `https://polyhaven.com/a/${slug}`, ...PH, use, files: [{ path: slug, url: `polyhaven:${slug}` }],
});

/** what is fetched (the choice and every rejection is argued in SPEC 16.17.3 and in REJECTED below) */
export const ASSETS: ClubAsset[] = [
  // ---- gym (CC BY 4.0, re-surfaced with the app's own materials, so no source texture or print ships)
  sketchfab('1d18318c3e81407b8321159fb3424026', 'Weight Room Set 1', 'Tytan (tylerhalterman)', 'weight-room-set-1', 'glbs/000-117/1d18318c3e81407b8321159fb3424026.glb', '', 'the half rack of the power rack (its bench is not used): the frame keeps its map, whose hole rows are cut-outs, under a graphite powder-coat tint; the J-cups are re-surfaced black'),
  sketchfab('8bfa29f8961b40258d5d1dc63d19c9a2', 'Weight Room Set 3', 'Tytan (tylerhalterman)', 'weight-room-set-3', 'glbs/000-062/8bfa29f8961b40258d5d1dc63d19c9a2.glb', '', 'the Olympic bar (its own knurled map) and two plates a side on the power rack (the plates re-surfaced plain black iron: the source\'s printed plate faces do not ship)'),
  sketchfab('11acede7444c4376b8080de4286b0460', 'cycle', 'killer456', 'cycle', 'glbs/000-123/11acede7444c4376b8080de4286b0460.glb', '', 'the recumbent bike, as modelled with its own maps (the maker\'s name printed on its flywheel shrouds painted out)'),
  // ---- games room
  sketchfab('457c34c9297d44a1a5d4e5d093c6a712', 'Table Tennis Table', 'Diccbudd', 'table-tennis-table', 'glbs/000-124/457c34c9297d44a1a5d4e5d093c6a712.glb', '', 'the table-tennis table (its net drawn as a sheer panel, and its posts brought in to the table\'s edge so the piece stays in its 152.5 cm box)'),
  sketchfab('eaf67aa3bfd145289323d91f366e25f4', 'Karambol Carom Board', 'Francesco Coldesina (topfrank2013)', 'karambol-carom-board', 'glbs/000-148/eaf67aa3bfd145289323d91f366e25f4.glb', '', 'the carrom board and its coins on the carrom tables (the generated stand and stools stay)'),
  polyhaven('dartboard', 'Dartboard', ['Satyaki Mandal'], 'a dartboard on a wall of the games room (sample decor, labelled)'),
  // ---- ceilings of the lounge, halls, foyer and lobby (sample decor, labelled)
  polyhaven('modern_ceiling_lamp_01', 'Modern Ceiling Lamp 01', ['James Ray Cock'], 'opal globe pendants over the lounge, games room, foyer and lobby (sample decor, labelled)'),
  polyhaven('Chandelier_01', 'Chandelier 01', ['Kirill Sannikov'], 'chandeliers down the middle of the banquet halls (sample decor, labelled)'),
];

interface LockFile { path: string; url: string; size: number; md5: string; sha256: string }
interface LockEntry extends Omit<ClubAsset, 'files'> { licenceRead: string; fetched: string; files: LockFile[] }
export interface ClubLock { generatedBy: string; read: string; assets: Record<string, LockEntry>; rejected: { what: string; url: string; why: string }[]; outputs?: Record<string, { bytes: number; sha256: string }> }

const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** the SHA-256 Hugging Face publishes for an LFS file of the Objaverse dataset */
async function hfSha(url: string): Promise<string | undefined> {
  const m = url.match(/huggingface\.co\/datasets\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/);
  if (!m) return undefined;
  const res = await fetch(`https://huggingface.co/api/datasets/${m[1]}/paths-info/main`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: [m[2]] }) });
  const j = (await res.json()) as { lfs?: { oid: string } }[];
  return j[0]?.lfs?.oid;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const ci = args.indexOf('--cache');
  const cache = ci >= 0 ? path.resolve(args[ci + 1]) : path.join(os.homedir(), 'walkthru-tools', 'real-club-raw', 'fetch');
  const lockPath = path.join(OUT, 'club.lock.json');
  let prev: ClubLock | null = null;
  try { prev = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as ClubLock; } catch { /* first run */ }
  const lock: ClubLock = { generatedBy: 'scripts/fetch-club-assets.ts', read: READ, assets: {}, rejected: REJECTED, ...(prev?.outputs ? { outputs: prev.outputs } : {}) };

  for (const a of ASSETS) {
    const files: LockFile[] = [];
    const list = (await Promise.all(a.files.map(async (f) => {
      const ph = f.url.match(/^polyhaven:(.+)$/);
      if (!ph) return [{ ...f, sha256: f.sha256 || (await hfSha(f.url)) }];
      const j = (await (await fetch(`https://api.polyhaven.com/files/${ph[1]}`)).json()) as { gltf: { '1k': { gltf: { url: string; md5: string; include: Record<string, { url: string; md5: string }> } } } };
      const g = j.gltf['1k'].gltf;
      return [{ path: `${ph[1]}_1k.gltf`, url: g.url, md5: g.md5 }, ...Object.entries(g.include).map(([rel, x]) => ({ path: rel, url: x.url, md5: x.md5 }))];
    }))).flat() as { path: string; url: string; sha256?: string; md5?: string }[];
    for (const f of list) {
      const dest = path.join(cache, a.id, f.path);
      const locked = prev?.assets[a.id]?.files.find((x) => x.path === f.path);
      let buf: Buffer | null = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      const good = (b: Buffer): boolean => (!f.sha256 || sha256(b) === f.sha256) && (!f.md5 || md5(b) === f.md5) && (!locked || update || sha256(b) === locked.sha256);
      if (!f.sha256 && !f.md5) throw new Error(`${a.id}/${f.path}: the source publishes no hash to check it against`);
      if (buf && !good(buf)) buf = null;
      if (!buf) {
        process.stdout.write(`downloading ${a.id}/${f.path}\n`);
        buf = await download(f.url);
        if (!good(buf)) throw new Error(`${a.id}/${f.path}: the download does not match what the source publishes or the lock (sha256 ${sha256(buf)}). Refusing to store it.`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest + '.part', buf);
        fs.renameSync(dest + '.part', dest);
      }
      files.push({ path: f.path, url: f.url, size: buf.length, md5: md5(buf), sha256: sha256(buf) });
    }
    const { files: _f, ...meta } = a;
    void _f;
    lock.assets[a.id] = { ...meta, licenceRead: READ, fetched: prev?.assets[a.id]?.fetched ?? READ, files };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  writeLicence(lock);
  console.log(`done: ${Object.keys(lock.assets).length} assets, raw cache ${cache}`);
}

/** looked at on READ and not used, with the reason (kept in the lock and the licence file so nobody fetches them again by mistake) */
export const REJECTED: ClubLock['rejected'] = [
  { what: "Pooltable (jdastine), CC BY", url: "https://sketchfab.com/3d-models/pooltable-cc96165eda374800a45f510d98216490", why: "SPEC 16.17.4: shipped on 22 Nov, retired on 23 Nov. Compared at the high tier on the GPU, from 2.5 m: its own maps are a drawn dark wood that rendered as a black mass and a mottled cloth; re-surfaced in the app's walnut and cloth it still had flat rails with no sights, a crude cushion line and no balls (a ball on its cloth would stand above the 0.86 m box), and it was squeezed 11 % in depth. The generated table (rails with pearl sights, felt cushions, leather pocket cups, turned legs, fifteen balls racked inside the box) read more like a real table, so it is back." },
  { what: "Treadmill Machine (sousinho), CC BY", url: "https://sketchfab.com/3d-models/faed3a2a275b4fd68089e1d8bdfb7f89", why: "a maker's logo printed on the deck and worn, blurred textures (also rejected in gym.lock.json)" },
  { what: "Modular Gym and Modular Gym Props (kristnbrown), CC BY", url: "https://sketchfab.com/3d-models/3c5125c0f5544059a22d35ee6670502f", why: "the only commercial-looking treadmill found: 1.29 m wide at its 2.11 m length, a 30 % squeeze into the 0.9 m box; the rest is walls and doors" },
  { what: "Treadmill 3D Model (Jj.Mmhh), Stylized Treadmill (drollShark), Treadmill - Household Props Challenge (Pixel-bit), FREE LowPoly Crossfit treadmills (3dworldvibes), CC BY", url: "https://sketchfab.com/3d-models/1346f077ce5a473ea9715230244907f9", why: "stylised or low-poly game props: a toy look" },
  { what: "Treadmills, a rowing machine and an air bike named after their makers (several authors), CC BY", url: "https://sketchfab.com/3d-models/327b6f6cb02c41df99a8d6f6b0796a74", why: "named after, and printed with, a maker's brand" },
  { what: "Elliptical trainer (r.m.kowalewski), CC BY", url: "https://sketchfab.com/3d-models/ebab27ba3cd14c75a36643919d3c2a71", why: "a good-looking front-drive home elliptical, but at the 1.70 m height of the box it is 1.39 m long: the 1.85 m commercial cross-trainer box would stretch it 33 %" },
  { what: "smart rower (Gweenn.Valdehueza), CC BY", url: "https://sketchfab.com/3d-models/3315143fce474298b8736530ded8b4ef", why: "a compact magnetic rower 2.12 x 0.52 x 1.07 m: 15 to 17 % stretch into the 2.44 x 0.61 x 1.0 m box, a maker's mark on its fan housing, 164 000 triangles" },
  { what: "Stationary Bike (topfrank2013), CC BY", url: "https://sketchfab.com/3d-models/299d993f9eb94d6684562de7dca3514c", why: "an untextured white home bike of an old design, 150 000 triangles; no spin or upright commercial bike was found" },
  { what: "Exercise Bike (pampalusiek), cycle (several), CC BY", url: "https://sketchfab.com/3d-models/6e77b305f7b840b4a6949d7d3ad096e4", why: "cartoon shapes" },
  { what: "Gym Trainer (Gerhald), CC BY", url: "https://sketchfab.com/3d-models/9cb04641558e40dbbee9f61ac55fdcb5", why: "a clean, untextured home multi-gym 1.74 x 1.95 x 0.87 m: no catalogue row has that shape (the lat pulldown is 1.2 x 2.15 x 1.4 m, the multi-gym 2.9 x 2.1 x 2.1 m)" },
  { what: "Gym Multiple (topfrank2013), CC BY", url: "https://sketchfab.com/3d-models/df5e938192244b82a1e59c7145030ee0", why: "an untextured white home multi-gym of the same shape: no catalogue row fits it" },
  { what: "Gym Equipment No.1 (ATD-London), CC BY", url: "https://sketchfab.com/3d-models/edd8005a81aa49aa9916270766927fca", why: "a three-stack multi-gym that would suit the multi-gym row, but at the scale that makes it 2.14 m tall it is 2.41 m deep: a 12.7 % squeeze into the 2.1 m box, over the limit; flat blue and red colours" },
  { what: "Squat Rack With Bar (sousinho), Flat Bench and Incline Bench (sousinho), Bench Press + Stand (bantha), CC BY", url: "https://sketchfab.com/3d-models/8e3109a049274de2941e7a2e014aa10d", why: "worn, scratched and rusty textures: a garage, not a clubhouse" },
  { what: "Simple Squat Rack (carloakuma), PowerRack (daviti_goderdzishvili), CC BY", url: "https://sketchfab.com/3d-models/ea504391882142a99309fc03522f9721", why: "a rough game prop; dimension text modelled into the rack" },
  { what: "Liv 1 Homegym (unrealstudio), CC BY", url: "https://sketchfab.com/3d-models/7badaa740d874b23970dfecd46359834", why: "untextured grey, 150 000 triangles, the plates carry lettering" },
  { what: "Training Station (preslav.petkov0606), CC BY", url: "https://sketchfab.com/3d-models/93658b23bc1d42bab8ccaa9480f066c0", why: "a pull-up tower, which the catalogue has no row for; 198 000 triangles" },
  { what: "Weight Lifting Set (loganrinaldis), Bench Press (MH...), CC BY", url: "https://sketchfab.com/3d-models/9fa5593a7a4042e4b7bbdc84c0375679", why: "home benches with a leg developer or a floor mat: not the Olympic bench-press station of the row" },
  { what: "Bench Press (rameezuddin14), CC BY", url: "https://sketchfab.com/3d-models/c95b90fa1f24468783004cc34bdf7878", why: "untextured white; its uprights stand 1.69 m in the 1.35 m box (20 %)" },
  { what: "Weight Room Set 1 bench (Tytan), CC BY", url: "https://sketchfab.com/3d-models/1d18318c3e81407b8321159fb3424026", why: "the set's flat bench is 32 cm wide: a 75 % stretch into the 56 cm flat-bench box (the set's rack is used)" },
  { what: "Barbell (MH...), Olympic Weightlifting Platform, Weightlifting Bumper Plates (sousinho), Weight Lifting Plates (Dakota.Hinkle), CC BY", url: "https://sketchfab.com/3d-models/8acd766e66b6478a8843f03ebb085ba2", why: "plates printed with a maker's name, a country or large lettering; the bar and plates of Weight Room Set 3 are used, re-surfaced" },
  { what: "Dumbbell Rack (MH...), Rubber Weights in a Barbell (juliorodrigues), CC BY", url: "https://sketchfab.com/3d-models/868439c605cf441e83d54a5fcfd64ab6", why: "a home rack on a floor mat, a pump bar with bright yellow plates: the gym's own rack and dumbbells stay" },
  { what: "Geometric Props: Gym Equipment (CCreations15), CC BY", url: "https://sketchfab.com/3d-models/94aeb9a67a1845e586adfb5ffcc15b37", why: "every part a 12-triangle box, untextured: geometric, not equipment" },
  { what: "TF-DS-GYM, Gym (orangetheshow), Fitness Projekt, Isometric: Gym, Farmhouse Fitness Center (various), CC BY", url: "https://sketchfab.com/3d-models/f3b26bfbb3174562a28bcf01f3b40f44", why: "whole scenes or buildings, stylised" },
  { what: "Changing Room Bench (oparaskos), CC BY", url: "https://sketchfab.com/3d-models/5c70b6b9ab8349388926334daf7fd623", why: "a double-sided bench with a tall slatted screen down its middle on a floor slab: the row is a 45 cm high single bench" },
  { what: "Pooltable (jdastine, the larger file), CC BY", url: "https://sketchfab.com/3d-models/ad4be5b7317a415ba067ede99463d42a", why: "its rails are 0.66 m high at the 2.54 m length: 23 % short of the 0.86 m box" },
  { what: "Pool Table (JesseLyons), CC BY", url: "https://sketchfab.com/3d-models/fdc3b8cfc7df4fe9b1ecd1ae1198270b", why: "1.11 m high at the 2.54 m length: 29 % over the 0.86 m box" },
  { what: "Billiard table (harrimyl), CC BY", url: "https://sketchfab.com/3d-models/411bfab979fc435eb129eef157bdf671", why: "fits the box best (3.5 %) but is flat colour with no grain beside the textured walnut table that was chosen" },
  { what: "Snooker Table (Saketh_gupta), Pool Table (EpicRatt), CC BY", url: "https://sketchfab.com/3d-models/e98f3cd475654539a4d27156b307925e", why: "showroom design tables (lime and black, white and red) with patterned cloths; 16 % low for the box" },
  { what: "Pooltable (jdastine, untextured), CC BY", url: "https://sketchfab.com/3d-models/d53413fd53a74f838dfccc6a034d5c2b", why: "untextured white" },
  { what: "Foosball Table (owestgate), CC BY", url: "https://sketchfab.com/3d-models/1303a318d4584639acef729b9fd296fc", why: "16 % lower than the 90 cm box, over the fit rule (also in gym.lock.json); the generated table stays" },
  { what: "Table Football (Martin_Jel), Mesa de Pimbolim (devilmente), CC BY", url: "https://sketchfab.com/3d-models/4d7456d07eaa4afc9e63441ef286e87b", why: "flat bright colours: a toy look" },
  { what: "Table football (3DDomino), CC BY", url: "https://sketchfab.com/3d-models/d5425d70d5e940708d5faa965f62818c", why: "246 000 triangles; it would not even render in the preview" },
  { what: "TABLE TENNIS Dark (kimtuekp), CC BY", url: "https://sketchfab.com/3d-models/6c8a173604bd4a5eaee830d78df92ce3", why: "a maker's name on the apron; 170 000 triangles" },
  { what: "Ping Pong (LucSales), ALCA Ping Pong (ABritishGameDev), Table Tennis (denis98), CC BY", url: "https://sketchfab.com/3d-models/3c69763602904e7f8c7276b1b8459bd4", why: "a printed purple top (a toy), an arcade cabinet, a table at a third of its length high" },
  { what: "Carrom (mfb64), CC BY", url: "https://sketchfab.com/3d-models/57203e19a1514e57929000c9bb4a10df", why: "each of its 19 coins is 6 600 triangles (also in gym.lock.json); the Karambol board is used, its spec-gloss maps converted" },
  { what: "Casino Poker Table (npowell), Poker Table (Badboy17Aiden, daniel.w.lebreton), CC BY", url: "https://sketchfab.com/3d-models/f36fc75d825148618aa6e5cbfb43f28e", why: "casino felts with printed play areas, or untextured: the generated card table stays" },
  { what: "Sofa 01, Sofa 02, Sofa 03, Arm Chair 01, Green Chair 01 (Poly Haven), CC0", url: "https://polyhaven.com/models/furniture", why: "period pieces (a tufted chesterfield, carved frames): not a modern clubhouse; and the plan's lounge has café tables, not a seating group, so no sofa is added" },
  { what: "Modern Arm Chair 01, Coffee Table Round 01 (Poly Haven), CC0", url: "https://polyhaven.com/a/modern_arm_chair_01", why: "good pieces, not used: no scene in scope has an armchair or a coffee table of these sizes on its plan, and pieces are not added to a plan" },
  { what: "Gallinera Chair, Bar Chair Round 01, Round Wooden Table 02, Metal Stool 02 (Poly Haven), CC0", url: "https://polyhaven.com/a/gallinera_chair", why: "rustic, worn or antique: not a clubhouse café" },
  { what: "Hanging Picture Frame 01 and 02 (Poly Haven), CC0", url: "https://polyhaven.com/a/hanging_picture_frame_01", why: "the picture in the frame is a black panel" },
  { what: "Fancy Picture Frame 01 and 02, Hanging Picture Frame 03 (Poly Haven), CC0", url: "https://polyhaven.com/a/fancy_picture_frame_01", why: "gilt period frames and old paintings: the prints are generated instead (abstract colour fields)" },
  { what: "Chandelier 02 and 03, Hanging Industrial Lamp, Mounted Fluorescent Lights (Poly Haven), CC0", url: "https://polyhaven.com/a/Chandelier_03", why: "candle-style or worn industrial fittings, bare tubes: Chandelier 01 and a globe pendant are used, and the gym's linear lights are drawn" },
];

function writeLicence(lock: ClubLock): void {
  const cc0 = Object.values(lock.assets).filter((a) => a.licence === 'CC0 1.0');
  const by = Object.values(lock.assets).filter((a) => a.licence === 'CC BY 4.0');
  const line = (a: LockEntry): string => `  ${a.name} by ${a.authors.join(', ')}\n    ${a.page}\n    licence: ${a.licence} ${a.licenceUrl} (read ${a.licenceRead}: "${a.licenceWords}")\n    used for: ${a.use}\n`;
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'),
    `Clubhouse assets under public/look/club/ (SPEC 16.17.3). Fetched and checked by scripts/fetch-club-assets.ts; club.lock.json has every source URL, size, MD5 and SHA-256.\n` +
    `The files here are our own conversions (tools/optimise-club-assets.mjs): a model is cut down to the parts used, decimated, re-centred, re-surfaced with the app's own materials where the source carried print or wear, and meshopt-compressed.\n\n` +
    `CREDITS (CC BY 4.0: the author must be credited; the item card of a piece that shows a model also says the credit, see PROP_CREDITS in src/look/gym/props.ts):\n${by.map(line).join('')}\n` +
    `CC0 1.0 (public domain, no credit required, credited anyway):\n${cc0.map(line).join('')}\n` +
    `Looked at on ${lock.read} and NOT used:\n${lock.rejected.map((r) => `  ${r.what}\n    ${r.url}\n    why: ${r.why}\n`).join('')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(String(err)); process.exit(1); });
