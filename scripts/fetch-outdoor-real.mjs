// SPEC 19.12 (22 Nov 2026): the raw files behind the photographic outdoor look (leaf photos for the crowns, grass blades, deck timber, bark,
// the pool's glass mosaic, a coconut palm model). Downloads ONLY model, texture and image files into a cache outside the repo
// (~/walkthru-tools/outdoor-raw/real, override with OUTDOOR_RAW), checks each one, and writes public/look/outdoor/sources.lock.json with the
// source URL, author, licence, the page the licence was read on, the date it was read, the size and the SHA-256 of every raw file.
//   - Poly Haven (CC0): size and MD5 must equal what the Poly Haven API lists for the file, or the file is refused.
//   - ambientCG (CC0) and Objaverse (CC-BY 4.0): the SHA-256 must equal the one pinned below (read on 22 Nov 2026), or the file is refused.
// Nothing downloaded is executed. The ambientCG zip also holds a .blend, a .usdc and a .tres: only the two JPGs named below are extracted.
// tools/optimise-outdoor-real.mjs then turns these into the small files the app ships (public/look/outdoor/) and records their SHA-256.
// Run: node scripts/fetch-outdoor-real.mjs   (safe to re-run: files already in the cache are re-checked, not re-downloaded)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = process.env.OUTDOOR_RAW || path.join(os.homedir(), 'walkthru-tools/outdoor-raw/real');
const LOCK = path.join(ROOT, 'public/look/outdoor/sources.lock.json');
const UA = 'walkthru-asset-fetch/1.0 (+https://walkthru-ivory.vercel.app)';
const READ_ON = '2026-11-22';

const PH_LICENCE = { licence: 'CC0 1.0', licencePage: 'https://polyhaven.com/license' };
const ACG_LICENCE = { licence: 'CC0 1.0', licencePage: 'https://docs.ambientcg.com/license/' };

/** Poly Haven assets: slug, the map keys used (as the API names them), and the authors the API lists */
export const POLYHAVEN = [
  { slug: 'jacaranda_tree', maps: ['leaves_diff', 'leaves_alpha'], kind: 'models', authors: 'Rico Cilliers; Rob Tuytel (guidance)', use: 'compound-leaf photos for the neem and gulmohar crowns' },
  { slug: 'island_tree_02', maps: ['leaves_diff', 'leaves_alpha'], kind: 'models', authors: 'Rob Tuytel (scanning, processing); Rico Cilliers (cleanup, processing)', use: 'broad-leaf photos for frangipani, ficus, croton, petals and bracts' },
  { slug: 'shrub_01', maps: ['Diffuse', 'Alpha'], kind: 'models', authors: 'Rico Cilliers', use: 'serrated-leaf photos for hibiscus and bougainvillea' },
  { slug: 'grass_bermuda_01', maps: ['Diffuse', 'Alpha'], kind: 'models', authors: 'Rico Cilliers', use: 'grass-blade tufts on the lawns' },
  { slug: 'wooden_planks', maps: ['Diffuse', 'nor_gl'], kind: 'textures', authors: 'Charlotte Baglioni (photography); Dario Barresi (processing)', use: 'timber decking with open joints' },
  { slug: 'bark_platanus', maps: ['Diffuse'], kind: 'textures', authors: 'Dimitrios Savva', use: 'tree bark' },
];

/** pinned files from sources without a checksum API */
export const PINNED = [
  {
    id: 'Tiles132A', file: 'Tiles132A_1K-JPG.zip', url: 'https://ambientcg.com/get?file=Tiles132A_1K-JPG.zip', page: 'https://ambientcg.com/view?id=Tiles132A',
    author: 'Lennart Demes (ambientCG)', ...ACG_LICENCE, bytes: 5331847, sha256: '6e70e35a0df83de344c717eb6cdc7dcc3f38bbefab6e89449cefaff5f38228d1',
    extract: ['Tiles132A_1K-JPG_Color.jpg', 'Tiles132A_1K-JPG_NormalGL.jpg'], use: 'glass mosaic of the pool basins',
  },
  {
    id: 'coconut-palm', file: '26e787f2ff2e4c0fb004c3b0210805a3.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-004/26e787f2ff2e4c0fb004c3b0210805a3.glb',
    page: 'https://sketchfab.com/3d-models/26e787f2ff2e4c0fb004c3b0210805a3', title: 'Coconut Palm', author: 'evolveduk (https://sketchfab.com/evolveduk)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-004.json.gz: "license": "by" (Sketchfab, published 2022-05-08)',
    bytes: 14630204, sha256: 'df749a540d2766dd10cc822b0017eeb03166a46e91c573c13c2d9f8f44a912d3', use: 'the coconut palms (two trunks a plant), and the frond picture of the procedural palms',
  },
  // SPEC 19.13 (22 Nov 2026): the models of tools/optimise-outdoor-models.mjs (read on the date above; every one CC-BY 4.0 in the Objaverse metadata and on its Sketchfab page)
  {
    id: 'objaverse', file: '4b186052228d43d8b3fbb63213677de8.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-022/4b186052228d43d8b3fbb63213677de8.glb',
    page: 'https://sketchfab.com/3d-models/4b186052228d43d8b3fbb63213677de8', title: 'Mango Tree', author: 'stealth86 (https://sketchfab.com/stealth86)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-022.json.gz: "license": "by" (Sketchfab, published 2022-02-28)',
    bytes: 10982240, sha256: '055e4cb9b5c1edb12830d21d1f74d1bbeb8db39054751e7793b8e918e2ac9683', use: 'the neem (SPEC 19.13): its trunk, branches and leaf sprays; the fruit is left out',
  },
  {
    id: 'objaverse', file: '85ac276a8d34487b9521ca5db1f7654f.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-109/85ac276a8d34487b9521ca5db1f7654f.glb',
    page: 'https://sketchfab.com/3d-models/85ac276a8d34487b9521ca5db1f7654f', title: 'Acai Palm', author: 'evolveduk (https://sketchfab.com/evolveduk)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-109.json.gz: "license": "by" (Sketchfab, published 2022-04-21)',
    bytes: 6946828, sha256: 'b8d6296aae8c46571ece4d47d96a42612d59fa457f4587bbbd1f2be72bb27351', use: 'the areca palm (SPEC 19.13): four of its stems from one foot make the clump',
  },
  {
    id: 'objaverse', file: '706fe87e98c341c79c6978b2cdc5d10d.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-136/706fe87e98c341c79c6978b2cdc5d10d.glb',
    page: 'https://sketchfab.com/3d-models/706fe87e98c341c79c6978b2cdc5d10d', title: 'Garden Chair', author: 'Medhatelo (https://sketchfab.com/Medhatelo)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-136.json.gz: "license": "by" (Sketchfab, published 2019-06-03)',
    bytes: 1086096, sha256: 'e1064d7fe431e7f3e2389e6c9d998fbcbd539fe2a84523333f82a832b541bc13', use: 'the pool lounger (SPEC 19.13): teak frame and cushion',
  },
  {
    id: 'objaverse', file: 'd6c9705a4f8e421ea473196ab9910088.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-008/d6c9705a4f8e421ea473196ab9910088.glb',
    page: 'https://sketchfab.com/3d-models/d6c9705a4f8e421ea473196ab9910088', title: 'White outdoor Umbrella', author: 'Ngo.Phuoc.Truong (https://sketchfab.com/Ngo.Phuoc.Truong)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-008.json.gz: "license": "by" (Sketchfab, published 2021-04-25)',
    bytes: 2422864, sha256: 'a3a8606d46fb85ce4e3957f07d50f26436549c7e6ff4fe7dc08a2e53311a057f', use: 'the parasol on a base (SPEC 19.13): centre pole, base and canopy',
  },
  {
    id: 'objaverse', file: '3059668094e847e286d2a95716694b87.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-027/3059668094e847e286d2a95716694b87.glb',
    page: 'https://sketchfab.com/3d-models/3059668094e847e286d2a95716694b87', title: 'Metallic garden table', author: 'anDDDres (https://sketchfab.com/anDDDres)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-027.json.gz: "license": "by" (Sketchfab, published 2020-05-29)',
    bytes: 235076, sha256: '9fdad3c5309232f4b7252c32971e58abd92a166f19b3227490136bb4bafb88eb', use: 'the pool-side chair (one chair of the set) and the pool-side table (SPEC 19.13)',
  },
  {
    id: 'objaverse', file: 'dcb057ffb7e949a7a1ec5523321d965b.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-129/dcb057ffb7e949a7a1ec5523321d965b.glb',
    page: 'https://sketchfab.com/3d-models/dcb057ffb7e949a7a1ec5523321d965b', title: 'Park bench', author: 'SusanKing (https://sketchfab.com/krolzuzannapl)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-129.json.gz: "license": "by" (Sketchfab, published 2020-04-29)',
    bytes: 4004416, sha256: 'd0c39eb478c040e82162068f2af2103b9f5e4b1f4eb516d5cab01e16f71061e7', use: 'the park bench (SPEC 19.13): slats and steel frame; the screw heads are left out',
  },
  {
    id: 'objaverse', file: '08ccca74a0594fd999acaf4cfbd597e0.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-008/08ccca74a0594fd999acaf4cfbd597e0.glb',
    page: 'https://sketchfab.com/3d-models/08ccca74a0594fd999acaf4cfbd597e0', title: 'Tropical Palm', author: 'Šimon Ustal (https://sketchfab.com/simonustal)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-008.json.gz: "license": "by" (Sketchfab, published 2021-11-24)',
    bytes: 1743352, sha256: 'a010bff118c30255f95ac6aad1e15b58c31826f081b9cb109ba18ddbdf7789bb', use: 'the royal palm (SPEC 19.13): a smooth grey trunk under a crown of arching fronds',
  },
];

/** SPEC 19.13: every model looked at for the open-air spaces on the date above (rendered in a test viewer before it was accepted), the verdict and why */
export const CANDIDATES = [
 {
  "piece": "neem",
  "title": "Mango Tree",
  "author": "stealth86",
  "url": "https://sketchfab.com/3d-models/4b186052228d43d8b3fbb63213677de8",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "a dense rounded evergreen crown of real leaf sprays on modelled branches, the size of a garden neem; its fruit is left out and its leaf (a mango's, longer than a neem leaflet) is darkened a little"
 },
 {
  "piece": "neem",
  "title": "Neem Tree",
  "author": "rohit8999",
  "url": "https://sketchfab.com/3d-models/03edef8009d942d3a3db6fa64cecbe56",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "2.27 million triangles and a 160 MB download: cannot be brought to a phone budget and keep its look"
 },
 {
  "piece": "neem",
  "title": "Tree 3D Free",
  "author": "gujjuremix2",
  "url": "https://sketchfab.com/3d-models/0af0540fdcd54961bdd3d75a22b3fa44",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "an untextured white mesh"
 },
 {
  "piece": "neem",
  "title": "Fast Urban Tree",
  "author": "rodrigogelmi",
  "url": "https://sketchfab.com/3d-models/c6c7cebef37544ee8a80780034a03737",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "did not draw in the test viewer (centimetres, 96k triangles); a temperate street tree"
 },
 {
  "piece": "neem",
  "title": "Platano Tree",
  "author": "rodrigogelmi",
  "url": "https://sketchfab.com/3d-models/ef48485b7c534acc905c0d9964c5fe7c",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "its leaves draw white (the leaf picture is missing from the file)"
 },
 {
  "piece": "neem",
  "title": "Bodhi Tree",
  "author": "ashimshakya",
  "url": "https://sketchfab.com/3d-models/943594369dc84239bc140e6e7d07a005",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "no textures in the file: the whole tree draws white"
 },
 {
  "piece": "neem",
  "title": "Realistic Tree Model",
  "author": "aliyeredonarbab",
  "url": "https://sketchfab.com/3d-models/104028c8350a4612b84b5e1c6b409bd4",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a narrow poplar-like crown, pale, not an Indian shade tree"
 },
 {
  "piece": "neem",
  "title": "Realistic Tree Vol.1 and Vol.2",
  "author": "aliyeredon",
  "url": "https://sketchfab.com/3d-models/b2379f57cc414663a4dda4e5261113f9",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "thin, pale, low-detail crowns"
 },
 {
  "piece": "neem",
  "title": "Hill Top Tree",
  "author": "Kadota",
  "url": "https://sketchfab.com/3d-models/25f7a45343724eab93520a966f8c7843",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "broken in the file: leaves scattered, wrong scale"
 },
 {
  "piece": "neem, gulmohar",
  "title": "Jacaranda Tree (Poly Haven)",
  "author": "Rob Tuytel, Rico Cilliers",
  "url": "https://polyhaven.com/a/jacaranda_tree",
  "licence": "CC0 1.0",
  "verdict": "rejected",
  "why": "3.86 million triangles and a 208 MB mesh: far over any phone budget (its leaf pictures already make the cards, SPEC 19.12)"
 },
 {
  "piece": "gulmohar",
  "title": "Acacia tree",
  "author": "evolveduk",
  "url": "https://sketchfab.com/3d-models/bb14c2bb679b4d0bb1c578a27e2ddabf",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "the umbrella form of a gulmohar but a crown of only 576 leaf triangles: reads as a bare winter tree; the gulmohar stays drawn (it is not planted in the sample spaces)"
 },
 {
  "piece": "gulmohar",
  "title": "poinciana",
  "author": "lukejeff99",
  "url": "https://sketchfab.com/3d-models/b713d6d65eae415a9fb2f8615e7f9d69",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a bonsai scan on a stone, not a tree"
 },
 {
  "piece": "gulmohar",
  "title": "Acacia (From \"Tree It\")",
  "author": "paul_sketch",
  "url": "https://sketchfab.com/3d-models/350e77196b424ebc8d28b8e7fc7b509e",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "toy look: flat pink and cream cards"
 },
 {
  "piece": "frangipani",
  "title": "鸡蛋花 Plumeria rubra",
  "author": "zoufuxian",
  "url": "https://sketchfab.com/3d-models/f23b8272cc874b5dae83bfc94dfb935c",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a single flower, not a tree"
 },
 {
  "piece": "frangipani",
  "title": "Plumerias",
  "author": "ashlynnicoleee",
  "url": "https://sketchfab.com/3d-models/1b55ce7662ec48249bf022013943f152",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "one leaf cluster of 219k triangles, not a tree"
 },
 {
  "piece": "frangipani",
  "title": "JN0281_Frangipani - 3D Model",
  "author": "elitesteelframing",
  "url": "https://sketchfab.com/3d-models/5a4d5cc7dade4df79330f585919355b4",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a steel-framed building, not a plant; no free frangipani tree was found, so it stays drawn (photographic cards, SPEC 19.12)"
 },
 {
  "piece": "royal palm",
  "title": "Tropical Palm",
  "author": "Šimon Ustal (simonustal)",
  "url": "https://sketchfab.com/3d-models/08ccca74a0594fd999acaf4cfbd597e0",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "a smooth grey trunk under arching pinnate fronds, the look of a royal palm (it has no crownshaft of its own)"
 },
 {
  "piece": "royal palm",
  "title": "Royal palm tree from Poly by Google",
  "author": "ie-niels",
  "url": "https://sketchfab.com/3d-models/7892188256f649b4b14396a6c38fa471",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "untextured white, toy low-poly"
 },
 {
  "piece": "royal palm",
  "title": "Date Palm",
  "author": "evolveduk",
  "url": "https://sketchfab.com/3d-models/11acf710e6c149daa8d6fb8cdc5d087f",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a date palm's rough, leaf-scarred trunk is not a royal palm's"
 },
 {
  "piece": "royal palm",
  "title": "Date Palm Pack Lod Sample",
  "author": "evolveduk",
  "url": "https://sketchfab.com/3d-models/c91d8ccd724a4628b7dd403bda392f0c",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "pale, washed-out date palms"
 },
 {
  "piece": "royal palm",
  "title": "Palm",
  "author": "Hanabi",
  "url": "https://sketchfab.com/3d-models/62cf6cedf74540229d755b0db3df381d",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a date-palm form with a ringed brown trunk"
 },
 {
  "piece": "coconut palm",
  "title": "Realistic Palm Tree Model vol.1 and vol.2",
  "author": "aliyeredon",
  "url": "https://sketchfab.com/3d-models/24bc514ac5e04e56a97fcb9b555aa67d",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "pale fronds; the coconut palm is already a better model (SPEC 19.12)"
 },
 {
  "piece": "coconut palm",
  "title": "Coconut Tree",
  "author": "rodrigogelmi",
  "url": "https://sketchfab.com/3d-models/2b959f888db340259e0679839cd224e1",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "did not draw in the test viewer (centimetres, 178k triangles)"
 },
 {
  "piece": "areca palm",
  "title": "Acai Palm",
  "author": "evolveduk",
  "url": "https://sketchfab.com/3d-models/85ac276a8d34487b9521ca5db1f7654f",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "a slender pinnate palm with a green crownshaft, an areca's close cousin; four of its stems from one foot make the clump"
 },
 {
  "piece": "bougainvillea",
  "title": "Bougainvillea [Day 26]",
  "author": "keithito",
  "url": "https://sketchfab.com/3d-models/83fa4bf428f7444c80b8ca67d3f43477",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a photogrammetry scene (a wall, two bins and the shrub) of 860k triangles; the shrub cannot be cut out cleanly. Bougainvillea stays drawn (photographic cards)"
 },
 {
  "piece": "bougainvillea",
  "title": "Violet Bush and Pita bush",
  "author": "scadl",
  "url": "https://sketchfab.com/3d-models/705b593a2b1f4c2dba20d68528400e35",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "painted, thistle-like flowers: a toy look"
 },
 {
  "piece": "shrub, hedge",
  "title": "Hazelnut Bush",
  "author": "felix95b",
  "url": "https://sketchfab.com/3d-models/8e8fd14f7f1546b9bcf2f5cfee5c116c",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a temperate shrub of 79k triangles, not one of the species planted"
 },
 {
  "piece": "shrub, hedge",
  "title": "Laurel Bush",
  "author": "scadl",
  "url": "https://sketchfab.com/3d-models/2616665bf38b4ff7b62c5452629bd5b1",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a temperate shrub, not one of the species planted"
 },
 {
  "piece": "hedge",
  "title": "Hedge / green fence",
  "author": "k.che4in",
  "url": "https://sketchfab.com/3d-models/617f53a453ff4eb3be95d0e5bbe6a882",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a hedge in a planter with a fence and lamps on it, 152k triangles; the clipped hedges stay drawn (a leaf-photo mat)"
 },
 {
  "piece": "pool lounger",
  "title": "Garden Chair",
  "author": "Medhatelo",
  "url": "https://sketchfab.com/3d-models/706fe87e98c341c79c6978b2cdc5d10d",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "a teak sun lounger with arms, an adjustable back and a thick cushion; its proportions are within 10 % of the 70 x 200 x 80 cm row"
 },
 {
  "piece": "pool lounger",
  "title": "Garden Chair 2",
  "author": "Medhatelo",
  "url": "https://sketchfab.com/3d-models/0d077097d51e4e42bcf1c2939f7d9485",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "good, but a dark frame: the teak one matches the deck"
 },
 {
  "piece": "pool lounger",
  "title": "Wood pool chair",
  "author": "assetfactory",
  "url": "https://sketchfab.com/3d-models/ef6caa09da0141519a2f461d7d14e96c",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "no cushion, orange varnish"
 },
 {
  "piece": "pool lounger",
  "title": "Pool Lounge Chair",
  "author": "bsishir",
  "url": "https://sketchfab.com/3d-models/2ab5992a50404cd6a7bc33ef346a7be4",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "white and blue vinyl straps: a dated motel look"
 },
 {
  "piece": "pool lounger",
  "title": "Kettal Stackable Deckchair",
  "author": "nazzarenogiannelli",
  "url": "https://sketchfab.com/3d-models/f25cb76a65ea4d88a92dc4d994cf4094",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "named after a furniture brand"
 },
 {
  "piece": "pool lounger",
  "title": "Margot Left Hand Facing Chaise Longue",
  "author": "made-it",
  "url": "https://sketchfab.com/3d-models/5c72e67d96bb46398bb506d4c59af9b4",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a retailer's product and name; an indoor chaise"
 },
 {
  "piece": "pool lounger",
  "title": "aquafun deckchair",
  "author": "aqua.fun",
  "url": "https://sketchfab.com/3d-models/ba348ad8e81845279317ddc441d4a101",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a maker's name"
 },
 {
  "piece": "pool lounger",
  "title": "Summer lounger",
  "author": "3DWorkbench",
  "url": "https://sketchfab.com/3d-models/09f0f9801f354224a9c05b993a78ca0b",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a double swing-bed with a canopy, not a pool lounger"
 },
 {
  "piece": "pool lounger",
  "title": "Sun lounger 3D",
  "author": "rodestrela",
  "url": "https://sketchfab.com/3d-models/974e74f55bbd4dc9a85c4a48fc987a18",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "white plastic"
 },
 {
  "piece": "parasol",
  "title": "White outdoor Umbrella",
  "author": "Ngo.Phuoc.Truong",
  "url": "https://sketchfab.com/3d-models/d6c9705a4f8e421ea473196ab9910088",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "a plain centre-pole parasol on a round weighted base, no print or logo"
 },
 {
  "piece": "parasol",
  "title": "Floating Parasol Sunshade Patio Umbrella",
  "author": "k3v1nc0",
  "url": "https://sketchfab.com/3d-models/280a65bca20b425e96617b0dd78cce21",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a good cantilever parasol, but the catalogue has no cantilever row and none of the sample spaces has a slot for one (no plan fact is invented)"
 },
 {
  "piece": "parasol",
  "title": "Prop Restaurant Umbrella",
  "author": "yorre.detavernier",
  "url": "https://sketchfab.com/3d-models/a6b585d582234ecab447bccfbe522277",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "a square café canopy on a timber pole; the row is a round parasol on a base"
 },
 {
  "piece": "outdoor dining",
  "title": "Metallic garden table",
  "author": "anDDDres",
  "url": "https://sketchfab.com/3d-models/3059668094e847e286d2a95716694b87",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "a black steel table with a glass top and armchairs with seat cushions: one chair is the pool-side chair, the table the pool-side table"
 },
 {
  "piece": "outdoor dining",
  "title": "Patio Set",
  "author": "zhixson",
  "url": "https://sketchfab.com/3d-models/37c3f6ee451f495ba183427a38a804b4",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "untextured white"
 },
 {
  "piece": "park bench",
  "title": "Park bench",
  "author": "SusanKing (krolzuzannapl)",
  "url": "https://sketchfab.com/3d-models/dcb057ffb7e949a7a1ec5523321d965b",
  "licence": "CC-BY 4.0",
  "verdict": "used",
  "why": "dark timber slats on steel legs; its screw heads (12k triangles) are left out"
 },
 {
  "piece": "park bench",
  "title": "Park Bench",
  "author": "RBG_illustrations",
  "url": "https://sketchfab.com/3d-models/2ee2bc87756d4bf0932d83ab860ddb8f",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "60 cm tall with a low back: the 82 cm row would stretch it 37 %"
 },
 {
  "piece": "park bench",
  "title": "Simple Park Bench",
  "author": "Planetrix23",
  "url": "https://sketchfab.com/3d-models/378cd6e6f505493aa8e22f68db1cabec",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "lying on its side in the file at an odd scale; plainer than the one used"
 },
 {
  "piece": "park bench",
  "title": "Park bench (Game ready)",
  "author": "PT34",
  "url": "https://sketchfab.com/3d-models/fd4d821a9e5f46cab786d4530133fc30",
  "licence": "CC-BY 4.0",
  "verdict": "rejected",
  "why": "orange varnish on concrete ends"
 }
];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const md5 = (b) => createHash('md5').update(b).digest('hex');
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const lock = { generatedBy: 'scripts/fetch-outdoor-real.mjs', readOn: READ_ON, raw: '~/walkthru-tools/outdoor-raw/real (not in the repo)', files: {} };
  for (const a of POLYHAVEN) {
    const api = JSON.parse((await get(`https://api.polyhaven.com/files/${a.slug}`)).toString());
    for (const k of a.maps) {
      const ent = api[k]?.['1k']?.jpg ?? api[k]?.['1k']?.png;
      if (!ent) throw new Error(`${a.slug}: no 1k file for ${k}`);
      const name = path.basename(new URL(ent.url).pathname);
      const dest = path.join(RAW, a.slug, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let buf = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      if (!buf || buf.length !== ent.size || md5(buf) !== ent.md5) { buf = await get(ent.url); }
      if (buf.length !== ent.size || md5(buf) !== ent.md5) throw new Error(`${name}: size or MD5 differs from the Poly Haven API, refused`);
      fs.writeFileSync(dest, buf);
      lock.files[`${a.slug}/${name}`] = { source: ent.url, page: `https://polyhaven.com/a/${a.slug}`, author: a.authors, ...PH_LICENCE, bytes: buf.length, md5: ent.md5, sha256: sha256(buf), use: a.use };
      console.log('ok', a.slug, name, buf.length);
    }
  }
  for (const p of PINNED) {
    const dest = path.join(RAW, p.id, p.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let buf = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (!buf || sha256(buf) !== p.sha256) buf = await get(p.url);
    if (buf.length !== p.bytes || sha256(buf) !== p.sha256) throw new Error(`${p.file}: SHA-256 differs from the one pinned on ${READ_ON}, refused`);
    fs.writeFileSync(dest, buf);
    const { extract, bytes: _b, sha256: _s, file: _f, id: _i, ...meta } = p;
    lock.files[`${p.id}/${p.file}`] = { source: p.url, ...meta, bytes: buf.length, sha256: sha256(buf) };
    if (extract) {
      // unzip only the named images (the archive also has a .blend, .usdc, .mtlx and .tres: never extracted, never run)
      execFileSync('unzip', ['-o', '-j', dest, ...extract, '-d', path.dirname(dest)], { stdio: 'ignore' });
      for (const e of extract) {
        const b = fs.readFileSync(path.join(path.dirname(dest), e));
        lock.files[`${p.id}/${e}`] = { source: `${p.url} (extracted)`, page: p.page, author: p.author, licence: p.licence, licencePage: p.licencePage, bytes: b.length, sha256: sha256(b), use: p.use };
      }
    }
    console.log('ok', p.id, p.file, buf.length);
  }
  lock.candidates = CANDIDATES;
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log('wrote', path.relative(ROOT, LOCK));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
