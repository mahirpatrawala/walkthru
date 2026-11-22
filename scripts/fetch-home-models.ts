// Fetches the free 3D models of the flats' furniture, fittings and appliances (SPEC 16.15.4), checks every file, and records source, author,
// licence, the date the licence was read and SHA-256 in public/look/home/home.lock.json and public/look/home/LICENCE.txt. Raw downloads go to
// a cache outside the repo; tools/optimise-home-models.mjs turns them into what ships under public/look/home/models/.
//
//   npx tsx scripts/fetch-home-models.ts [--cache <dir>] [--update]
//
// Source: the Objaverse 1.0 archive of Sketchfab on Hugging Face (allenai/objaverse), which needs no login. Each object's licence and author
// are read from the archive's own metadata shard (metadata/<group>.json.gz, itself checked against its published SHA-256) and, when Sketchfab's
// public API answers, from https://api.sketchfab.com/v3/models/<uid>. Licence rule (owner, 22 Nov 2026): CC0 or CC BY 4.0 only; nothing NC,
// ND, SA, editorial or without a licence; no brand names or logos. Only GLB files are downloaded and they are parsed as data, never run.
// Safe to re-run: a cached file that matches the lock is kept; a hash that differs from the archive or the lock aborts (`--update` accepts it).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/home');
const UA = 'walkthru-fetch/1.0 (asset licence check)';
const READ = '2026-11-22';
const HF = 'https://huggingface.co/datasets/allenai/objaverse';
const BY_URL = 'http://creativecommons.org/licenses/by/4.0/';

interface Asset {
  id: string;
  uid: string;
  name: string;
  authors: string[];
  use: string;
}

/** what ships. `name` and `authors` are as the archive's metadata gives them (Sketchfab title and display name) */
export const ASSETS: Asset[] = [
  { id: 'sofa_3s_midcentury', uid: '1f9f52ae17d642b582d0c5ccf9dd64b3', name: 'Mid Century Modern Sofa', authors: ['Tom Seddon'], use: '3-seat sofa (210 x 90 x 85 cm, and drawn sofas within 12 % of it): the whole piece, recoloured by the style' },
  { id: 'sofa_2s_grey', uid: '03550a3529c24611a12aa158747374e0', name: 'Sofa', authors: ['katjagricishina'], use: '2-seat sofa (150 x 85 x 85 cm): the whole piece, recoloured by the style' },
  { id: 'armchair_tub', uid: 'ec62634ebb5a41f491bbb9da04cd9dd1', name: 'Arm chair / Furniture', authors: ['maxsbond.work'], use: 'armchair (80 x 85 x 85 cm): upholstered tub chair on four legs, recoloured by the style' },
  { id: 'wc_floor', uid: 'adb3b931f3ef4941830eea9705657a3d', name: 'Toilet', authors: ['Urpo'], use: 'western commode, floor-mounted: pan, cistern and seat in plain glazed ceramic (the open lid left out)' },
  { id: 'basin_wall', uid: '6f5a66deecf348c1a6ebed0ce38b810d', name: 'Unseen: Bathroom Sink', authors: ['JmCVoyager'], use: 'wall-hung wash basin with its tap and trap, rim at the drawn height' },
  { id: 'bed_frame_soho', uid: '97e361e8beda4112ac5b1b5bcd388cdf', name: 'Soho bed - 3D Model', authors: ['BertO'], use: 'the upholstered base and headboard of queen and king beds; its own bedding is left out, the generated mattress, quilt and pillows go on it' },
  { id: 'hob_4_glass', uid: '0a9441fbe4bd47b990e17dab99267d40', name: 'Gas Stove No.1', authors: ['lutz_westerfeld'], use: 'four-burner glass-top gas hob on the kitchen counter (lived-in decor)' },
  { id: 'hood_chimney', uid: 'e846cb48e88446808af55976ff76b1da', name: 'Range Hood (Kitchen Hood)', authors: ['govindu94'], use: 'stainless chimney hood over the hob (lived-in decor), its flue stretched to the ceiling' },
];

/** looked at on READ and not used, with the reason (in the lock and LICENCE.txt so nobody fetches them again by mistake) */
export const REJECTED: { what: string; url: string; why: string }[] = [
  { what: 'Modern Sofa (3dimentionalben), CC BY', url: 'https://sketchfab.com/3d-models/ac92f6e97eaa43c4ad6cb8f7c65ac43f', why: 'a low lounge sofa 60 cm high: a 35 % stretch to the 85 cm back of the catalogue sofa (over the 12 % rule)' },
  { what: 'Sofa Couch (jimbogies), CC BY', url: 'https://sketchfab.com/3d-models/1485031bb7904bed9590234137a58539', why: 'a checked throw and cushions modelled onto the seat and back (SPEC 16.23: nothing loose on a seat), and 58 000 triangles' },
  { what: 'Sofa (GreenG), CC BY', url: 'https://sketchfab.com/3d-models/c7a0c35f4f0b49f8b4fea273f9014001', why: 'a green leather L with a throw and nine cushions piled on it: busy, and the throw lies on the seat' },
  { what: 'Armchair pack (Elbolillo), CC BY', url: 'https://sketchfab.com/3d-models/675cc978e5d74bcea7ef28d13a63a3da', why: 'flat-colour toy low-poly pieces (the Kenney look SPEC 16.15 already rejected)' },
  { what: 'Armchair (Yury Misiyuk), CC BY', url: 'https://sketchfab.com/3d-models/4c85231b2a5349efaa7e9d6b0c2f0b8e', why: 'its scene does not load in three.js r186 (renders empty); not worth repairing with a good alternative in hand' },
  { what: 'A sofa titled with a furniture retailer\'s product name (Filipe.Soares), CC BY', url: 'https://sketchfab.com/3d-models/db5d6bbf7f34482ca1be89456fcc4070', why: 'named after a retailer\'s product (brand name): not fetched' },
  { what: 'Bed 06 (Doaa Sheha), CC BY', url: 'https://sketchfab.com/3d-models/30a491ca2dab4b61adc04bd51d3f45c1', why: 'the bed is one mesh with its two bedside tables and lamps: they cannot be taken off without cutting the headboard' },
  { what: 'Queen-bed (lugher3d.com), CC BY', url: 'https://sketchfab.com/3d-models/39d113d5868d473caf71e928d1d313a6', why: '302 000 triangles, a rumpled duvet modelled into the frame, and the source carries a studio\'s web address as its author name' },
  { what: 'Bed (rerwandi), CC BY', url: 'https://sketchfab.com/3d-models/352f853f03194e9dac551e2c8afe7d1a', why: 'an orange varnished wood texture that is blurred and stretched; reads as a game prop' },
  { what: 'Toilet (Xill), CC BY', url: 'https://sketchfab.com/3d-models/24d1b493899d407780140688abae19bc', why: 'its proportions miss the 40 x 72 x 80 cm box by 13 % (taller lid and deeper pan) and it has 57 000 triangles' },
  { what: 'Sofa (Urpo), CC BY', url: 'https://sketchfab.com/3d-models/80edec2de8c04a4fb335a48b550a2336', why: 'a low-backed sofa: with its back stretched to the 85 cm box its seat lands at 47 cm, 4 cm over the 43 cm seat (SPEC 16.15 allows 3)' },
  { what: 'Gray L-Shaped Couch (AleixoAlonso), CC BY', url: 'https://sketchfab.com/3d-models/f3a71dc05afb46f8a2fae64eba0acc64', why: 'a fine L sofa, but its seat is 38 cm high: 5 cm under the 43 cm seat a person is posed on' },
  { what: '366 Armchair (hectopod), CC BY', url: 'https://sketchfab.com/3d-models/97e53f749df14e8c9de7a22bf99be753', why: 'its seat is 58 % of its height: fitted to the 85 cm box the seat lands at 50 cm (7 cm over)' },
  { what: 'Modern Couch (Sinematic3D), Couch (Da_Fne), max SOFA.unity (kendra024), CC BY', url: 'https://sketchfab.com/3d-models/9b1e09abe5e34d6397937ebf59901898', why: 'four-seat sofas 2.6 to 2.75 m long (a 24 % squeeze into 2.1 m), or with a chaise' },
  { what: 'Couch Gameready (elijahorama), Couch (MSatriaR), CC BY', url: 'https://sketchfab.com/3d-models/42da0122f2134a189767d0911b401c1c', why: 'low lounge seats (26 to 30 cm) and backs 65 to 70 cm: 20 % under the 85 cm box' },
  { what: 'Toilet (HippoStance), CC BY', url: 'https://sketchfab.com/3d-models/132a8ee2af3a40d39d270fbed3d3666c', why: 'a compact pan 59 cm deep: 22 % short of the 72 cm box, with a hose beside it' },
  { what: 'A toilet titled with a bathroom company\'s name (5Life), CC BY', url: 'https://sketchfab.com/3d-models/5b18711616054a44b025d9272b745a6a', why: 'named after a bathroom company (brand name): not fetched' },
  { what: 'Simple Toilet | Inodoro (Josean_3dev), CC BY', url: 'https://sketchfab.com/3d-models/71e1bc91750d41b38f87eb2bd3e67974', why: 'a tall square cistern on a dated pan, and 17 % shallower than the 72 cm box' },
  { what: 'Simple Sink (Andrew.Mischenko), CC BY', url: 'https://sketchfab.com/3d-models/73bda35b6e7a499a80427fc1b049b192', why: 'its tap stands 17 cm above the rim: with the rim at 85 cm it would reach past the 95 cm box (a 42 % squeeze)' },
  { what: 'Washbasin (Stakler), Sink with Faucet (blendffnike), CC BY', url: 'https://sketchfab.com/3d-models/e6113364a9ce4495876a15af3e021606', why: 'vanity units with a cupboard below: a different catalogue piece from the wall-hung basin (no vanity piece is in the sample flats)' },
  { what: 'Refrigerator - Grey Polished Metal (Glowbox 3D), House Props : Fridge (Whitend), CC BY', url: 'https://sketchfab.com/3d-models/2071bda681b642218b6829b82e4fd93b', why: 'both are double-door fridges with 1 100 to 2 100 triangles and smeared maps; the patrakeevasveta fridge is cleaner' },
  { what: 'Refrigerator (patrakeevasveta), CC BY', url: 'https://sketchfab.com/3d-models/38a739d5361547b7b8b7d87ab73c9fa3', why: 'a clean steel fridge-freezer, but 2.03 m tall in its own metres: a 19 % squeeze into the 1.65 m double-door box' },
  { what: 'Fridge - Refrigerator - Freezer (re1monsen), CC BY', url: 'https://sketchfab.com/3d-models/f9fd65542a414ef4b8b5227d49e87d87', why: 'a scene (a cooler box on a picnic rug), not a fridge' },
  { what: 'Every single-door fridge found', url: 'https://api.sketchfab.com/v3/search?type=models&q=fridge', why: 'none clean: retro or Soviet styling, stylised, open-door, or a brand on the door; the sample flats\' "Fridge, single door" stays generated (a double-door model would misstate the piece)' },
  { what: 'Gas Stove Kitchen (Yousof Hajizeinali), CC BY', url: 'https://sketchfab.com/3d-models/f82172b787854191a55b3a5dfd5ede0b', why: 'a five-burner hob 1.83 m wide in the source\'s units with burners spaced for 90 cm: wider than the 60 cm hob the planner puts on the counter' },
  { what: 'Five cooktops titled with appliance makers\' names (several authors), CC BY', url: 'https://api.sketchfab.com/v3/search?type=models&q=cooktop', why: 'named after a maker (brand names): not fetched' },
  { what: 'Kitchen Hood Model 3D fbx (a hood maker\'s own account), CC BY', url: 'https://sketchfab.com/3d-models/f2de7240cfe64ebebff8f6d78f7f7879', why: 'published by a hood maker under its brand; also loads as a bare flue' },
  { what: 'FREE Rectangular Cooker Hood 60 X 40 cm (marcin_malcherek), CC BY', url: 'https://sketchfab.com/3d-models/a3ec10632d83426aaa5dad54422a6aec', why: 'a plain black box: reads worse than the stainless chimney' },
  { what: 'Kitchen sink (atori657), Kitchen Sink (HippoStance), Mixer (GeneGrad), CC BY', url: 'https://sketchfab.com/3d-models/7f0192b9afed4b569b80f5031b9ea598', why: 'good sinks, but the catalogue sink is a whole unit (cabinet, worktop, bowl, drainboard, tap) whose generated bowl and tap already read as steel; swapping only the bowl is not supported yet' },
  { what: 'Ceiling fans and split AC units (Sketchfab search), CC BY', url: 'https://api.sketchfab.com/v3/search?type=models&q=ceiling%20fan', why: 'the fans are part of the kit\'s baked static fixtures with instanced, turning blades (a model would need the bake and the rotor redone); the AC units found carry a maker\'s logo or are flat boxes. Left generated' },
  { what: 'TV units (Sketchfab search), CC BY', url: 'https://api.sketchfab.com/v3/search?type=models&q=tv%20unit', why: 'the catalogue TV unit includes the television in its box (1.48 to 1.62 m high); the free stands are the cabinet alone, mostly low-poly or reclaimed wood' },
  { what: 'Objaverse LVIS lists (sofa 81, toilet 111, refrigerator 55, washbasin 48, bed 53)', url: `${HF}/blob/main/lvis-annotations.json.gz`, why: 'browsed through Sketchfab\'s public search instead (sorted by likes, downloadable, CC BY or CC0, then kept only what the archive holds); the per-object API was rate-limited (HTTP 429) part way' },
];

interface LockFile { path: string; url: string; size: number; sha256: string }
interface LockEntry {
  id: string; uid: string; name: string; authors: string[]; page: string; licence: 'CC BY 4.0'; licenceUrl: string; licenceWords: string; use: string;
  licenceRead: string; fetched: string; files: LockFile[];
}
interface Lock { generatedBy: string; read: string; assets: Record<string, LockEntry>; rejected: typeof REJECTED; outputs?: Record<string, { bytes: number; sha256: string }> }

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function hfInfo(rel: string): Promise<{ sha256: string; size: number }> {
  const res = await fetch(`https://huggingface.co/api/datasets/allenai/objaverse/paths-info/main`, { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ paths: [rel] }) });
  const j = (await res.json()) as { lfs?: { oid: string; size: number } }[];
  if (!j[0]?.lfs) throw new Error(`no published hash for ${rel}`);
  return { sha256: j[0].lfs.oid, size: j[0].lfs.size };
}
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
/** a file of the archive, from the cache when it matches the published SHA-256, else downloaded and checked */
async function archived(cache: string, rel: string, locked?: string, update = false): Promise<{ buf: Buffer; sha: string }> {
  const pub = await hfInfo(rel);
  const dest = path.join(cache, rel);
  let buf: Buffer | null = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  const good = (b: Buffer): boolean => sha256(b) === pub.sha256 && b.length === pub.size && (!locked || update || sha256(b) === locked);
  if (buf && !good(buf)) buf = null;
  if (!buf) {
    process.stdout.write(`downloading ${rel}\n`);
    const got = await download(`${HF}/resolve/main/${rel}`);
    if (!good(got)) throw new Error(`${rel}: does not match the archive's SHA-256 or the lock (${sha256(got)}). Refusing to store it.`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest + '.part', got);
    buf = got;
    fs.renameSync(dest + '.part', dest);
  }
  return { buf, sha: pub.sha256 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const ci = args.indexOf('--cache');
  const cache = ci >= 0 ? path.resolve(args[ci + 1]) : path.join(os.homedir(), 'walkthru-tools', 'real-home-raw', 'archive');
  const lockPath = path.join(OUT, 'home.lock.json');
  let prev: Lock | null = null;
  try { prev = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Lock; } catch { /* first run */ }
  const lock: Lock = { generatedBy: 'scripts/fetch-home-models.ts', read: READ, assets: {}, rejected: REJECTED, ...(prev?.outputs ? { outputs: prev.outputs } : {}) };
  const paths = JSON.parse(zlib.gunzipSync((await archived(cache, 'object-paths.json.gz')).buf).toString('utf8')) as Record<string, string>;

  for (const a of ASSETS) {
    const rel = paths[a.uid];
    if (!rel) throw new Error(`${a.id}: ${a.uid} is not in the archive`);
    // the licence, from the archive's metadata shard for the object's group
    const group = rel.split('/')[1];
    const meta = (JSON.parse(zlib.gunzipSync((await archived(cache, `metadata/${group}.json.gz`)).buf).toString('utf8')) as Record<string, { license?: string; name?: string; user?: { displayName?: string; username?: string }; viewerUrl?: string }>)[a.uid];
    if (meta?.license !== 'by') throw new Error(`${a.id}: the archive lists licence "${meta?.license}", not CC BY`);
    let words = `Objaverse 1.0 metadata/${group}.json.gz, ${a.uid}: license "by" (Creative Commons Attribution 4.0), user "${meta.user?.username}" (${meta.user?.displayName})`;
    // and, when it answers, Sketchfab's own public API (no login)
    try {
      const res = await fetch(`https://api.sketchfab.com/v3/models/${a.uid}`, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const j = (await res.json()) as { license?: { label?: string; slug?: string; requirements?: string } };
        if (j.license?.slug && j.license.slug !== 'by') throw new Error(`${a.id}: Sketchfab now lists licence "${j.license.slug}"`);
        if (j.license?.slug) words += `; Sketchfab API v3/models/${a.uid}: license "${j.license.label}", "${j.license.requirements}"`;
      }
    } catch (err) { if (err instanceof Error && /now lists/.test(err.message)) throw err; }
    const locked = prev?.assets[a.id]?.uid === a.uid ? prev.assets[a.id].files[0]?.sha256 : undefined;
    const { buf, sha } = await archived(cache, rel, locked, update);
    lock.assets[a.id] = {
      id: a.id, uid: a.uid, name: a.name, authors: a.authors, page: `https://sketchfab.com/3d-models/${a.uid}`,
      licence: 'CC BY 4.0', licenceUrl: BY_URL, licenceWords: words, use: a.use, licenceRead: READ, fetched: prev?.assets[a.id]?.fetched ?? READ,
      files: [{ path: `${a.uid}.glb`, url: `${HF}/resolve/main/${rel}`, size: buf.length, sha256: sha }],
    };
    // the optimiser reads glb/<uid>.glb
    const link = path.join(cache, '..', 'glb', `${a.uid}.glb`);
    if (!fs.existsSync(link)) { fs.mkdirSync(path.dirname(link), { recursive: true }); fs.copyFileSync(path.join(cache, rel), link); }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  writeLicence(lock);
  console.log(`done: ${Object.keys(lock.assets).length} models, raw cache ${cache}`);
}

function writeLicence(lock: Lock): void {
  const line = (a: LockEntry): string => `  "${a.name}" by ${a.authors.join(', ')}\n    ${a.page}\n    licence: ${a.licence} ${a.licenceUrl} (read ${a.licenceRead})\n    used for: ${a.use}\n`;
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'),
    `Models of the flats under public/look/home/ (SPEC 16.15.4). Fetched and checked by scripts/fetch-home-models.ts; home.lock.json has every source URL, size and SHA-256.\n` +
    `The files here are adaptations (tools/optimise-home-models.mjs): turned to face the room, scaled to metres, re-centred, cut to the parts used, simplified, ` +
    `some parts given plain materials, maps re-encoded as WebP, meshopt-compressed. In the app each is further scaled to the drawn size and recoloured.\n\n` +
    `CREDITS (Creative Commons Attribution 4.0: the author must be credited; the buyer page lists them under "3D model credits", src/buyer/credits-panel.ts):\n${Object.values(lock.assets).map(line).join('')}\n` +
    `Looked at on ${lock.read} and NOT used:\n${lock.rejected.map((r) => `  ${r.what}\n    ${r.url}\n    why: ${r.why}\n`).join('')}`);
}

main().catch((err) => { console.error(String(err)); process.exit(1); });
