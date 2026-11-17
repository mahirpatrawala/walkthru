// The people a buyer adds to a home (SPEC 2.1, 16.6.9). Each is a Character of its own (its own body file, the clips parsed once and shared),
// posed with the same poses the walker uses (core/poses.ts), blocking the walk grid like a body, and kept in "My layout" (never in the home).
//
// What lives where: model.ts has the rules (pure), rec.ts the record and the link (storage is the store's `mine` value), ui.ts the sheets and the person card.
// This file owns the bodies: loading them, posing them, idling, following, thinning out what is far or out of sight, and tidying up when
// a piece of furniture is moved from under them.
import * as THREE from 'three';
import { stepLocomotion } from '../../engine/locomotion';
import { Character } from '../../engine/character';
import type { Input } from '../../engine/controls';
import { stampFurniture } from '../../core/layout-raster';
import { cellValue } from '../../core/grid-codec';
import { CHARACTER_URL, GRID_TALL_CM } from '../../types';
import type { Box, CheckCard, FurnitureItem, Grid, Vec2 } from '../../types';
import type { PersonTier } from '../../look/people';
import { BODY_DEFAULT_CM, clampPersonHeight, tintForPerson } from '../person-store';
import type { StorageLike } from '../store';
import type { FurnitureStoreImpl } from '../store';
import type { Seats } from '../seats';
import { setExtraObstacles } from '../wardrobe-hooks';
import { pieceRule } from '../../core/pieces';
import { poseSwingMesh, prefersReducedMotion, restSwingMesh, swingAngle, swingOffsets } from '../swing-motion';
import type { SwingRig } from '../../look/gen/swing';
import {
  carryApproach, fitLine, freeApproach, hostActionOf, hostAt, hostPose, hostSignature, labelOf, nearestHost, nudgeAside, obstaclesOf, passCard,
  hostName, lateralOf, seatKindOf, passageWidth, placeStanding, shoulderWidthM, shownCount, standBox, standingFree, capForTier, spotLateral,
} from './model';
import type { DeviceTier, HostAction, PlaceResult } from './model';
import { PEOPLE_MAX, cloneRec, sanitizeRecs } from './rec';
import type { PersonBodyId, PersonPose, PersonRec } from './rec';

const DEG = Math.PI / 180;
const TEMP_KEY = 'people';
/** a person this far from the camera is updated at 15 Hz, one the camera cannot see (off screen, behind a wall) at 4 Hz and is not drawn */
const FAR_M = 7;
const FAR_STEP_S = 1 / 15;
const HIDDEN_STEP_S = 0.25;
const OCCLUSION_EVERY_S = 0.3;
/** a follower starts walking when the walker is this far, and stops when it is this near */
const FOLLOW_START_M = 1.6;
const FOLLOW_STOP_M = 1.05;
/** a follower left this far behind for this long catches up at once (a door shut between them, a lift of the walker) */
const FOLLOW_LOST_M = 7;
const FOLLOW_LOST_S = 3;
/** the walker this near a standing person, in a narrow place, brings up the passing card */
const PASS_NEAR_M = 1.15;
const PASS_RESET_M = 1.9;
const PASS_CARD_MS = 6000;

export interface WalkerPort {
  position(): Vec2;
  yawDeg(): number;
  heightCm(): number;
  body(): { body: PersonBodyId; tone: number };
  /** the piece the walker is sitting or lying on, if any */
  poseOn(): string | null;
  state(): string;
  getUp(): Promise<void>;
  /** the walker becomes another person: body, tone, exact height, and stands at `at` facing `yawDeg` */
  swapTo(p: { body: PersonBodyId; tone: number; heightCm: number; at: Vec2; yawDeg: number }): Promise<void>;
}

export interface PeopleDeps {
  scene: THREE.Object3D;
  camera: THREE.Camera;
  store: FurnitureStoreImpl;
  seats: Seats;
  walker: WalkerPort;
  sceneId: string;
  storage: StorageLike | null;
  tier: () => DeviceTier;
  /** the swing sentence for a box that sits in a door's or a wardrobe's swing (buyer/wardrobe-hooks.ts swingNoteFor) */
  swingNote?: (box: Box) => string | null;
  toast(text: string): void;
  /** the passing card, or null to take it down */
  passCard?(card: CheckCard | null): void;
  /** bodies came or went: the baked lighting probes the new meshes */
  onBodies?(): void;
  /** the surface height under a point, so a tall person sits with raised knees (the walker's own probe) */
  surfaceProbe?: (x: number, z: number) => number | null;
  /** the walk grid with what only a drawn body has to keep clear of (door frame posts) added: SPEC 4.12. Absent: the walk grid itself. */
  bodyGrid?: (walk: Grid) => Grid;
  /** a clock for tests */
  random?: () => number;
  /** makes the body of a person (tests give it bodies read from disk); the page's own is `Character.load` */
  load?: (who: { body: PersonBodyId; tone: number }, tier: PersonTier) => Promise<Character>;
}

export type Placement =
  | { kind: 'stand'; at: Vec2; yawDeg?: number }
  | { kind: 'host'; item: FurnitureItem; action: HostAction; approach: Vec2 };
export interface PersonSpec { body: PersonBodyId; tone: number; heightCm: number }
export type Outcome = { ok: true; id: string } | { ok: false; message: string };

interface Live {
  rec: PersonRec;
  ch: Character | null;
  loading: boolean;
  follow: boolean;
  chasing: boolean;
  lostFor: number;
  hostBox: Box | null;
  hostSig: string;
  /** seconds to the next shift of weight, and the heading it is turning to (null when not turning) */
  shiftIn: number;
  shiftTo: number | null;
  acc: number;
  occludedFor: number;
  occluded: boolean;
  inView: boolean;
  /** the pose being applied now: a newer request replaces it */
  token: number;
}

export interface People {
  list(): PersonRec[];
  count(): number;
  shown(): number;
  cap(): number;
  maxPeople(): number;
  get(id: string): PersonRec | null;
  bodyOf(id: string): Character | null;
  describe(id: string): { title: string; lines: string[]; pose: PersonPose; follows: boolean } | null;
  place(spec: PersonSpec, at: Placement): Promise<Outcome>;
  move(id: string, at: Placement): Promise<Outcome>;
  /** stand, or sit or lie on the nearest suitable piece within reach */
  setPose(id: string, pose: PersonPose): Promise<Outcome>;
  change(id: string, spec: Partial<PersonSpec>): Promise<void>;
  remove(id: string): void;
  clear(): void;
  become(id: string): Promise<Outcome>;
  setFollow(id: string, on: boolean): void;
  isFollowing(id: string): boolean;
  update(dt: number): void;
  /** the walk grid with the people who are not in the store's grid (followers, on the move) stamped on it */
  walkGrid(g: Grid): Grid;
  /** every person's footprint now, for the wardrobe swing and the walker's own checks */
  footprints(): { box: Box; heightM: number }[];
  objects(): THREE.Object3D[];
  personIdOf(o: THREE.Object3D | null): string | null;
  /** hides or shows every body (the AI photo is taken without people) */
  setSuppressed(on: boolean): void;
  /** while furnishing, people do not block the walk grid and do not count in placement checks; afterwards anyone caught is moved aside */
  setFurnishing(on: boolean): void;
  /** whether a tap at this floor point lands on a standing person or sits on a host: used by the placing flow */
  hostAt(p: Vec2): FurnitureItem | null;
  onChange(cb: () => void): () => void;
  /** every body is settled and loaded (tests, screenshots) */
  ready(): Promise<void>;
  stats(): { added: number; shown: number; drawn: number; updated: number; frames: number };
  dispose(): void;
}

const POSE_WORD: Record<PersonPose, string> = { stand: 'Standing', sit: 'Sitting', lie: 'Lying' };

export function createPeople(deps: PeopleDeps): People {
  const { store, seats, walker } = deps;
  const rnd = deps.random ?? Math.random;
  const lives: Live[] = [];
  const listeners = new Set<() => void>();
  let notifyStore: () => void = () => {};
  let selfChange = 0;
  let suppressed = false;
  let furnishing = false;
  let idCounter = 0;
  let tierSeen = deps.tier();
  let tierClock = 0;
  const stats = { drawn: 0, updated: 0, frames: 0 };
  const pending = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { pending.add(p); const done = (): void => { pending.delete(p); }; p.then(done, done); return p; };

  const recs = (): PersonRec[] => lives.map((l) => l.rec);
  const nextId = (): string => { let id: string; do { id = `pe-${++idCounter}`; } while (lives.some((l) => l.rec.id === id)); return id; };
  const find = (id: string): Live | undefined => lives.find((l) => l.rec.id === id);
  const personTier = (): PersonTier => (deps.tier() === 'high' ? 'medium' : 'low');
  const cap = (): number => capForTier(deps.tier());

  // ---------------------------------------------------------------- grids

  let noPeople: Grid | null = null;
  /** the walk grid without any added person: what a person may stand on, and what a follower walks through */
  const gridNoPeople = (): Grid => (noPeople ??= store.gridExcludingTemporary([TEMP_KEY]));
  store.onChange(() => { if (selfChange === 0) { noPeople = null; scheduleReconcile(); } });

  /** the first `cap` people are bodies; any beyond the device's cap stay in the layout (and the link) but are not drawn, so they must not block either */
  const isActive = (l: Live): boolean => lives.indexOf(l) < shownCount(lives.length, deps.tier());
  const isDynamic = (l: Live): boolean => l.follow && l.rec.pose === 'stand';
  /** the footprint of a person where their body is now (a follower moves; the others stand at their record) */
  function boxNow(l: Live): Box {
    if (isDynamic(l) && l.ch) { const p = l.ch.position; return standBox({ ...l.rec, x: p.x, z: p.z, yawDeg: l.ch.yawDeg }); }
    return standBox(l.rec);
  }
  const footprints = (): { box: Box; heightM: number }[] => lives.filter((l) => l.rec.pose === 'stand' && isActive(l)).map((l) => ({ box: boxNow(l), heightM: l.rec.heightCm / 100 }));
  setExtraObstacles(() => (furnishing ? [] : footprints()));

  let registered = '';
  /** tells the store which standing people block the walk grid (not the followers: they are stamped live by walkGrid) */
  function syncObstacles(): void {
    const list = furnishing ? [] : obstaclesOf(lives.filter((l) => !isDynamic(l) && isActive(l)).map((l) => l.rec));
    const sig = JSON.stringify(list.map((o) => [o.box.cx, o.box.cz, o.box.w, o.box.d, o.box.yawDeg, o.heightM].map((n) => Math.round(n * 1000))));
    if (sig === registered) return;
    registered = sig;
    selfChange++;
    try { store.setTemporary(TEMP_KEY, list); } finally { selfChange--; }
    noPeople = null;
  }

  let walkCache: { src: Grid; sig: string; out: Grid } | null = null;
  function walkGrid(g: Grid): Grid {
    if (furnishing) return g;
    const mov = lives.filter(isDynamic);
    if (mov.length === 0) return g;
    const boxes = mov.map((l) => boxNow(l));
    const sig = boxes.map((b) => `${Math.round(b.cx * 50)},${Math.round(b.cz * 50)}`).join('|');
    if (walkCache && walkCache.src === g && walkCache.sig === sig) return walkCache.out;
    const out = stampFurniture(g, boxes.map((b, i) => ({
      id: `follower:${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'person', box: b, heightM: mov[i].rec.heightCm / 100, surfaceHeightM: 0,
    })));
    walkCache = { src: g, sig, out };
    return out;
  }

  // ---------------------------------------------------------------- the record

  const hostItems = (): FurnitureItem[] => [...store.all(), ...seats.items()];
  const hostById = (id: string | undefined): FurnitureItem | undefined => (id ? hostItems().find((i) => i.id === id) : undefined);

  function changed(discrete = true): void {
    if (discrete) persist();
    for (const cb of [...listeners]) { try { cb(); } catch (err) { console.error('[walkthru] people listener threw', err); } }
  }
  /** the store keeps the people in its "mine" value with the moves and fittings: tell it to save, and its listeners (the chip) to look again */
  function persist(): void {
    selfChange++;
    try { notifyStore(); } finally { selfChange--; }
  }

  const faceWalker = (at: Vec2): number => {
    const w = walker.position();
    return Math.hypot(w.x - at.x, w.z - at.z) < 0.05 ? walker.yawDeg() + 180 : (Math.atan2(w.x - at.x, w.z - at.z) / DEG + 360) % 360;
  };

  /** the lateral spots on `item` already used: other people on it, and the walker if they are posed there */
  function takenOn(item: FurnitureItem, selfId: string | null): number[] {
    const seat = seatKindOf(item, seats.isSeat(item));
    const out: number[] = [];
    for (const l of lives) {
      if (l.rec.id === selfId || l.rec.host !== item.id || l.rec.pose === 'stand') continue;
      out.push(spotLateral(item, l.rec.pose as HostAction, { x: l.rec.x, z: l.rec.z }, seat));
    }
    if (walker.poseOn() === item.id) {
      const p = walker.position();
      out.push(lateralOf(item, p));
    }
    return out;
  }

  /** the record a person would have at `at`, or why not. `selfId` is the person being moved (they do not count against themselves). */
  function resolve(spec: PersonSpec, at: Placement, selfId: string | null): { ok: true; fields: Pick<PersonRec, 'x' | 'z' | 'yawDeg' | 'pose' | 'host'> } | { ok: false; message: string } {
    if (at.kind === 'stand') {
      const yaw = at.yawDeg ?? faceWalker(at.at);
      const r: PlaceResult = placeStanding({
        grid: gridNoPeople(), others: recs().filter((p) => p.id !== selfId), walker: walker.state() === 'idle' || walker.state() === 'walk' || walker.state() === 'jog' ? walker.position() : undefined,
        swingNote: deps.swingNote,
      }, spec, at.at, yaw);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true, fields: { x: r.at.x, z: r.at.z, yawDeg: at.yawDeg ?? faceWalker(r.at), pose: 'stand' } };
    }
    const item = at.item;
    const act = hostActionOf(item);
    if (!act || act !== at.action) return { ok: false, message: act === 'lie' ? 'A bed is for lying on.' : act === 'sit' ? 'That is for sitting on.' : 'Nobody can sit or lie there.' };
    const ap = freeApproach(item, at.action, at.approach, takenOn(item, selfId), seatKindOf(item, seats.isSeat(item)));
    if (!ap) return { ok: false, message: `There is no room left on the ${hostName(item).toLowerCase()}.` };
    return { ok: true, fields: { x: ap.x, z: ap.z, yawDeg: item.box.yawDeg, pose: at.action, host: item.id } };
  }

  // ---------------------------------------------------------------- bodies

  function frameShadow(ch: Character): void {
    const s = ch.object.getObjectByName('contact-shadow');
    if (s) s.raycast = () => { /* the soft disc under the feet is not a thing to measure or tap */ };
  }

  async function ensureBody(l: Live, instant: boolean): Promise<void> {
    if (l.ch || l.loading) return;
    l.loading = true;
    try {
      const ch = await (deps.load ? deps.load(l.rec, personTier()) : Character.load(CHARACTER_URL, { body: l.rec.body, tone: l.rec.tone, tier: personTier() }));
      if (!lives.includes(l)) { ch.dispose(); return; }
      l.ch = ch;
      if (deps.surfaceProbe) ch.surfaceProbe = deps.surfaceProbe;
      // a standing or following person is drawn clear of the walls like the walker (SPEC 4.12); their own footprint is not in this grid
      ch.setBodyGuard(() => (deps.bodyGrid ? deps.bodyGrid(gridNoPeople()) : gridNoPeople()));
      ch.setHeight(l.rec.heightCm / 100, tintForPerson(l.rec.body, l.rec.heightCm));
      ch.object.userData.personId = l.rec.id;
      ch.object.name = `person-${l.rec.id}`;
      frameShadow(ch);
      ch.position = { x: l.rec.x, z: l.rec.z };
      ch.yawDeg = l.rec.yawDeg;
      ch.setShadowVisible(true);
      ch.setVisible(!suppressed);
      deps.scene.add(ch.object);
      // the pose plays out over the next frames (0.3 to 0.9 s); the person is "added" as soon as the body is in the scene
      if (instant) await applyPose(l, true); else void applyPose(l, false);
      deps.onBodies?.();
    } catch (err) {
      console.warn('[walkthru] a person could not be loaded:', err);
      const i = lives.indexOf(l);
      if (i >= 0) { lives.splice(i, 1); syncObstacles(); changed(); deps.toast('That person could not be loaded.'); }
    } finally {
      l.loading = false;
    }
  }

  /** Puts the body where the record says: standing at (x, z), or posed on the host as the walker would be. */
  async function applyPose(l: Live, instant: boolean): Promise<void> {
    const ch = l.ch;
    if (!ch) return;
    const token = ++l.token;
    const r = l.rec;
    if (r.pose !== 'stand') {
      const host = hostById(r.host);
      const act = host ? hostActionOf(host) : null;
      if (host && act === r.pose) {
        l.hostBox = { ...host.box };
        l.hostSig = hostSignature(host);
        const pose = hostPose(host, act, r.heightCm, { x: r.x, z: r.z }, (it, H) => seats.pose(it, H));
        if (ch.state === 'idle' && l.hostSig && Math.hypot(ch.position.x - r.x, ch.position.z - r.z) > 3) ch.position = { x: r.x, z: r.z };
        const done = pose.lie ? ch.lie(pose.lie) : ch.sit(pose.sit!);
        if (instant) ch.update(1);
        await done;
        if (token !== l.token) return;
        return;
      }
      // the piece is gone: stand where they were
      const free = nudgeAside(gridNoPeople(), r) ?? { x: r.x, z: r.z };
      r.pose = 'stand'; r.host = undefined; r.x = free.x; r.z = free.z;
      l.hostBox = null;
    }
    l.hostBox = null;
    if (ch.state === 'sitting' || ch.state === 'lying' || ch.state === 'transition') {
      const p = ch.release({ x: r.x, z: r.z });
      if (instant) ch.update(1);
      await p;
    } else {
      ch.position = { x: r.x, z: r.z };
    }
    if (token !== l.token) return;
    ch.yawDeg = r.yawDeg;
    ch.object.position.y = 0;
    l.shiftIn = 8 + rnd() * 14;
  }

  function dropBody(l: Live): void {
    const ch = l.ch;
    l.ch = null;
    if (ch) { ch.dispose(); }
  }

  // ---------------------------------------------------------------- the commands

  const spec = (r: PersonRec): PersonSpec => ({ body: r.body, tone: r.tone, heightCm: r.heightCm });

  async function place(s: PersonSpec, at: Placement): Promise<Outcome> {
    if (lives.length >= PEOPLE_MAX) return { ok: false, message: `You can add up to ${PEOPLE_MAX} people.` };
    if (shownCount(lives.length + 1, deps.tier()) < lives.length + 1) return { ok: false, message: `This device shows up to ${cap()} added ${cap() === 1 ? 'person' : 'people'}. Remove one to add another.` };
    const spec2: PersonSpec = { body: s.body, tone: s.tone, heightCm: clampPersonHeight(s.body, s.heightCm) };
    const r = resolve(spec2, at, null);
    if (!r.ok) return r;
    const rec: PersonRec = { id: nextId(), ...spec2, ...r.fields };
    const l = newLive(rec);
    lives.push(l);
    syncObstacles();
    changed();
    await track(ensureBody(l, false));
    return lives.includes(l) ? { ok: true, id: rec.id } : { ok: false, message: 'That person could not be loaded.' };
  }

  function newLive(rec: PersonRec): Live {
    return { rec, ch: null, loading: false, follow: false, chasing: false, lostFor: 0, hostBox: null, hostSig: '', shiftIn: 8 + rnd() * 14, shiftTo: null, acc: 0, occludedFor: 0, occluded: false, inView: true, token: 0 };
  }

  async function move(id: string, at: Placement): Promise<Outcome> {
    const l = find(id);
    if (!l) return { ok: false, message: 'That person is not here.' };
    const r = resolve(spec(l.rec), at, id);
    if (!r.ok) return r;
    Object.assign(l.rec, r.fields);
    if (r.fields.pose === 'stand') l.rec.host = undefined;
    l.follow = false;
    syncObstacles();
    changed();
    if (l.ch) void applyPose(l, false);
    return { ok: true, id };
  }

  async function setPose(id: string, pose: PersonPose): Promise<Outcome> {
    const l = find(id);
    if (!l) return { ok: false, message: 'That person is not here.' };
    if (l.rec.pose === pose) return { ok: true, id };
    const here: Vec2 = l.ch ? l.ch.position : { x: l.rec.x, z: l.rec.z };
    if (pose === 'stand') {
      // beside the piece they were on, on the nearest free floor
      const free = nudgeAside(gridNoPeople(), { ...l.rec, x: here.x, z: here.z }, 1.5);
      if (!free) return { ok: false, message: 'There is no free floor beside them to stand on.' };
      return move(id, { kind: 'stand', at: free, yawDeg: l.rec.yawDeg });
    }
    const host = nearestHost(here, pose, hostItems(), gridNoPeople(), 2);
    if (!host) return { ok: false, message: pose === 'lie' ? 'There is no bed within reach. Use Move to tap one.' : 'There is no sofa or chair within reach. Use Move to tap one.' };
    return move(id, { kind: 'host', item: host, action: pose, approach: here });
  }

  async function change(id: string, s: Partial<PersonSpec>): Promise<void> {
    const l = find(id);
    if (!l) return;
    const body = s.body ?? l.rec.body;
    const bodyChanged = body !== l.rec.body;
    const heightCm = clampPersonHeight(body, s.heightCm ?? (bodyChanged ? BODY_DEFAULT_CM[body] : l.rec.heightCm));
    const tone = s.tone ?? l.rec.tone;
    const sizeChanged = bodyChanged || heightCm !== l.rec.heightCm;
    l.rec.body = body; l.rec.tone = tone; l.rec.heightCm = heightCm;
    const ch = l.ch;
    if (ch) {
      await track(ch.setAppearance({ body, tone, tier: personTier() }));
      ch.setHeight(heightCm / 100, tintForPerson(body, heightCm));
      frameShadow(ch);
      if (sizeChanged) await track(applyPose(l, true));
      deps.onBodies?.();
    }
    // a taller person may no longer fit where they stand
    if (l.rec.pose === 'stand' && !standingFree(gridNoPeople(), l.rec)) {
      const free = nudgeAside(gridNoPeople(), l.rec, 0.6);
      if (free) { l.rec.x = free.x; l.rec.z = free.z; if (ch) ch.position = free; }
    }
    syncObstacles();
    changed();
  }

  function remove(id: string): void {
    const i = lives.findIndex((l) => l.rec.id === id);
    if (i < 0) return;
    const [l] = lives.splice(i, 1);
    dropBody(l);
    syncObstacles();
    changed();
    deps.onBodies?.();
  }

  function clear(): void {
    if (lives.length === 0) return;
    for (const l of lives.splice(0)) dropBody(l);
    syncObstacles();
    changed(false); // the store saves its own reset
    deps.onBodies?.();
  }

  async function become(id: string): Promise<Outcome> {
    const l = find(id);
    if (!l) return { ok: false, message: 'That person is not here.' };
    if (walker.state() === 'transition') return { ok: false, message: 'Wait a moment.' };
    await walker.getUp();
    const old = { ...walker.body(), heightCm: walker.heightCm(), at: walker.position(), yawDeg: walker.yawDeg() };
    // the person you were stays where you stood
    const target = l.rec;
    let at: Vec2 = { x: target.x, z: target.z };
    if (target.pose !== 'stand') at = nudgeAside(gridNoPeople(), { ...target, x: l.ch?.position.x ?? target.x, z: l.ch?.position.z ?? target.z }, 2) ?? old.at;
    const yaw = l.ch ? l.ch.yawDeg : target.yawDeg;
    const keep = { body: target.body, tone: target.tone, heightCm: target.heightCm };
    // swap: the chosen person leaves the list, the old walker joins it where they stood
    const i = lives.indexOf(l);
    lives.splice(i, 1);
    dropBody(l);
    const rec: PersonRec = { id: nextId(), body: old.body, tone: old.tone, heightCm: clampPersonHeight(old.body, old.heightCm), x: old.at.x, z: old.at.z, yawDeg: old.yawDeg, pose: 'stand' };
    const nl = newLive(rec);
    lives.push(nl);
    syncObstacles();
    await track(walker.swapTo({ ...keep, at, yawDeg: yaw }));
    await track(ensureBody(nl, true));
    changed();
    return { ok: true, id: rec.id };
  }

  function setFollow(id: string, on: boolean): void {
    const l = find(id);
    if (!l) return;
    if (on && l.rec.pose !== 'stand') { deps.toast('They get up first. Tap Stand, then Follow me.'); return; }
    if (l.follow === on) return;
    l.follow = on;
    l.chasing = false;
    l.lostFor = 0;
    if (!on && l.ch) {
      // they stop where they are: that is where they stand now
      const p = l.ch.position;
      l.rec.x = p.x; l.rec.z = p.z; l.rec.yawDeg = l.ch.yawDeg;
      persist();
    }
    syncObstacles();
    noPeople = null;
    changed(false);
  }

  // ---------------------------------------------------------------- tidy up when furniture moves

  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReconcile(): void {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => { reconcileTimer = null; reconcile(); }, 300);
  }
  function reconcile(): void {
    if (lives.length === 0) return;
    const g = gridNoPeople();
    let moved = false;
    for (const l of lives) {
      const r = l.rec;
      if (!isActive(l)) continue;
      if (r.pose === 'stand') {
        if (isDynamic(l)) continue;
        if (standingFree(g, r)) continue;
        const free = nudgeAside(g, r);
        if (free) {
          r.x = free.x; r.z = free.z;
          if (l.ch) { l.ch.position = free; }
          deps.toast(`${labelOf(r)} stepped aside.`);
          moved = true;
        } else if (!furnishing) {
          deps.toast(`A person is standing here: ${labelOf(r).toLowerCase()}. Move them first.`);
        }
        continue;
      }
      const host = hostById(r.host);
      if (!host || hostActionOf(host) !== r.pose) {
        const free = nudgeAside(g, r, 1.5) ?? { x: r.x, z: r.z };
        r.pose = 'stand'; r.host = undefined; r.x = free.x; r.z = free.z;
        deps.toast(`${labelOf(r)} got up: what they were on is gone.`);
        if (l.ch) void track(applyPose(l, false));
        moved = true;
        continue;
      }
      const sig = hostSignature(host);
      if (sig !== l.hostSig) {
        if (l.hostBox) { const a = carryApproach({ x: r.x, z: r.z }, l.hostBox, host.box); r.x = a.x; r.z = a.z; }
        if (l.ch) void track(applyPose(l, true));
        else l.hostSig = sig;
        moved = true;
      }
    }
    if (moved) { syncObstacles(); changed(); }
  }

  // ---------------------------------------------------------------- per frame

  const frustum = new THREE.Frustum();
  const proj = new THREE.Matrix4();
  const view = new THREE.Matrix4();
  const fwd = new THREE.Vector3();
  const lastCam = { x: Infinity, z: Infinity, dir: new THREE.Vector3(0, 0, 1) };
  const sphere = new THREE.Sphere();
  const FOLLOW_INPUT = { moveX: 0, moveY: 1, jog: false } as unknown as Input;
  const NO_INPUT = { moveX: 0, moveY: 0, jog: false } as unknown as Input;
  let passFor: string | null = null;
  let passTimer: ReturnType<typeof setTimeout> | null = null;
  let passShown = false;

  function occludedFrom(from: Vec2, to: Vec2): boolean {
    const g = gridNoPeople();
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    for (let t = 0.3; t < len - 0.3; t += 0.1) {
      if (cellValue(g, from.x + (dx * t) / len, from.z + (dz * t) / len) >= GRID_TALL_CM) return true;
    }
    return false;
  }

  /** turns on the spot toward `to` at up to `maxRadS`, the feet stepping; returns true while still turning */
  function turnToward(l: Live, to: number, dt: number, maxRadS: number): boolean {
    const ch = l.ch!;
    let d = (((to - ch.yawDeg) % 360) + 540) % 360 - 180;
    if (d === -180) d = 180;
    if (Math.abs(d) < 2) { ch.setLocomotion(0, false, 0); return false; }
    const step = Math.max(-maxRadS * dt / DEG, Math.min(maxRadS * dt / DEG, d));
    ch.yawDeg = ch.yawDeg + step;
    ch.setLocomotion(0, false, Math.abs(step) * DEG / Math.max(dt, 1e-4));
    return true;
  }

  function update(dt: number): void {
    stats.frames++;
    tierClock += dt;
    if (tierClock > 1) { tierClock = 0; checkTier(); }
    if (lives.length === 0) return;
    const cam = deps.camera;
    // the camera has moved since it was last drawn: its own inverse is not up to date yet
    cam.updateMatrixWorld();
    view.copy(cam.matrixWorld).invert();
    proj.multiplyMatrices(cam.projectionMatrix, view);
    frustum.setFromProjectionMatrix(proj);
    const camAt = { x: cam.position.x, z: cam.position.z };
    // what hides behind a wall is worked out every 0.3 s, and at once when the camera has moved or turned since (a corner, a door, a free camera)
    cam.getWorldDirection(fwd);
    const moved = Math.hypot(camAt.x - lastCam.x, camAt.z - lastCam.z) > 0.2 || fwd.dot(lastCam.dir) < 0.995;
    if (moved) { lastCam.x = camAt.x; lastCam.z = camAt.z; lastCam.dir.copy(fwd); }
    const w = walker.position();
    updateSwings(dt);
    const walkerOnFoot = walker.state() === 'idle' || walker.state() === 'walk' || walker.state() === 'jog';
    for (const l of lives) {
      const ch = l.ch;
      if (!ch) continue;
      const p = ch.position;
      const H = l.rec.heightCm / 100;
      sphere.set(new THREE.Vector3(p.x, H * 0.5, p.z), H * 0.9);
      l.inView = frustum.intersectsSphere(sphere);
      l.occludedFor = moved ? OCCLUSION_EVERY_S : l.occludedFor + dt;
      if (l.occludedFor >= OCCLUSION_EVERY_S) { l.occludedFor = 0; l.occluded = l.inView && occludedFrom(camAt, p); }
      const drawn = l.inView && !l.occluded && !suppressed;
      ch.setVisible(drawn);
      if (drawn) stats.drawn++;

      // what this person does of their own accord (standing ones: follow the walker, or shift their weight now and then)
      if (l.rec.pose === 'stand') {
        if (l.follow) followStep(l, dt, w, walkerOnFoot);
        else if (ch.state === 'idle' && !l.loading) shiftStep(l, dt);
      }

      l.acc += dt;
      const dist = Math.hypot(p.x - camAt.x, p.z - camAt.z);
      const step = !drawn ? HIDDEN_STEP_S : dist > FAR_M ? FAR_STEP_S : 0;
      if (step === 0 || l.acc >= step) { ch.update(l.acc); l.acc = 0; stats.updated++; }
    }
    updatePassing(w, walkerOnFoot);
  }

  // ---- people on a swing rock with it (the walker's own swing, src/buyer/swing-motion.ts, is driven by the interactions; this is for the others)
  const swings = new Map<string, { t: number }>();
  /** how far a swing mesh is swung now (radians), read off its moving groups, whoever is driving it */
  function angleOfMesh(mesh: THREE.Object3D, rig: SwingRig): number {
    const g = mesh.getObjectByName(rig.mode === 'parallel' ? 'swing-chains-front' : 'swing-rig');
    return g ? -g.rotation.x : 0;
  }
  function updateSwings(dt: number): void {
    const riders = new Map<string, Live[]>();
    for (const l of lives) {
      if (!l.ch || l.rec.pose !== 'sit' || l.ch.state !== 'sitting') continue;
      const host = hostById(l.rec.host);
      if (!host || pieceRule(host.catalogId)?.pose !== 'swing') continue;
      const list = riders.get(host.id) ?? [];
      list.push(l);
      riders.set(host.id, list);
    }
    for (const [id, st] of swings) {
      if (riders.has(id)) continue;
      const mesh = store.mesh(id);
      if (mesh && !(walker.poseOn() === id)) restSwingMesh(mesh);
      swings.delete(id);
      void st;
    }
    if (riders.size === 0 || prefersReducedMotion()) return;
    for (const [id, list] of riders) {
      const mesh = store.mesh(id);
      const rig = mesh?.userData?.swingRig as SwingRig | undefined;
      if (!mesh || !rig) continue;
      let a: number;
      if (walker.poseOn() === id) {
        // the walker is on it too: their swing drives it, these people ride along
        a = angleOfMesh(mesh, rig);
        swings.delete(id);
      } else {
        const st = swings.get(id) ?? { t: 0 };
        swings.set(id, st);
        st.t += dt;
        a = swingAngle(st.t, rig.lengthM);
        poseSwingMesh(mesh, a);
      }
      const { forward, up } = swingOffsets(rig.lengthM, a);
      const yaw = (list[0].hostBox?.yawDeg ?? 0) * DEG;
      for (const l of list) l.ch!.ride({ dx: Math.sin(yaw) * forward, dy: up, dz: Math.cos(yaw) * forward, pitchRad: rig.mode === 'rigid' ? -a : 0 });
    }
  }

  function shiftStep(l: Live, dt: number): void {
    const ch = l.ch!;
    if (l.shiftTo !== null) {
      if (!turnToward(l, l.shiftTo, dt, 2.2)) { l.shiftTo = null; l.shiftIn = 9 + rnd() * 16; }
      return;
    }
    l.shiftIn -= dt;
    if (l.shiftIn <= 0) {
      // a small shift of weight: a quarter turn at most, the feet stepping
      l.shiftTo = (ch.yawDeg + (rnd() < 0.5 ? -1 : 1) * (22 + rnd() * 30) + 360) % 360;
    }
  }

  function followStep(l: Live, dt: number, w: Vec2, walkerOnFoot: boolean): void {
    const ch = l.ch!;
    if (ch.state !== 'idle' && ch.state !== 'walk' && ch.state !== 'jog') return;
    const p = ch.position;
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (d > FOLLOW_LOST_M) { l.lostFor += dt; if (l.lostFor > FOLLOW_LOST_S) catchUp(l, w); } else l.lostFor = 0;
    if (!l.chasing && d > FOLLOW_START_M && walkerOnFoot) l.chasing = true;
    else if (l.chasing && d < FOLLOW_STOP_M) l.chasing = false;
    const g = gridNoPeople();
    if (l.chasing) {
      const yaw = Math.atan2(w.x - p.x, w.z - p.z) / DEG;
      stepLocomotion(ch, FOLLOW_INPUT, yaw, g, dt);
    } else {
      stepLocomotion(ch, NO_INPUT, 0, g, dt);
      // standing near the walker, they turn to face them
      if (ch.state === 'idle' && d < 3) {
        const want = Math.atan2(w.x - p.x, w.z - p.z) / DEG;
        let diff = (((want - ch.yawDeg) % 360) + 540) % 360 - 180;
        if (diff === -180) diff = 180;
        if (Math.abs(diff) > 25) turnToward(l, want, dt, 2.2);
      }
    }
  }

  function catchUp(l: Live, w: Vec2): void {
    const g = gridNoPeople();
    const spot = nudgeAside(g, { ...l.rec, x: w.x, z: w.z }, 2.5);
    if (spot && l.ch) { l.ch.position = spot; l.lostFor = 0; l.chasing = false; }
  }

  /** the walker beside a standing person in a narrow place: whether two people can pass, from their real widths */
  function updatePassing(w: Vec2, onFoot: boolean): void {
    if (!deps.passCard) return;
    let near: Live | null = null;
    let nd = Infinity;
    if (onFoot && !furnishing) {
      for (const l of lives) {
        if (!l.ch || l.rec.pose !== 'stand') continue;
        const p = l.ch.position;
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        if (d < nd) { nd = d; near = l; }
      }
    }
    if (passFor && (!near || near.rec.id !== passFor || nd > PASS_RESET_M)) {
      if (!near || near.rec.id !== passFor || nd > PASS_RESET_M) { passFor = null; hidePass(); }
    }
    if (!near || nd > PASS_NEAR_M || passFor === near.rec.id) return;
    const p = near.ch!.position;
    const dx = p.x - w.x, dz = p.z - w.z;
    const len = Math.hypot(dx, dz) || 1;
    const width = passageWidthAt(p, { x: dx / len, z: dz / len });
    passFor = near.rec.id;
    if (width === null) return;
    const me = walker.body();
    deps.passCard(passCard('You', labelOf(near.rec), width, shoulderWidthM(me.body, walker.heightCm()), shoulderWidthM(near.rec.body, near.rec.heightCm)));
    passShown = true;
    if (passTimer) clearTimeout(passTimer);
    passTimer = setTimeout(hidePass, PASS_CARD_MS);
  }
  function hidePass(): void {
    if (passTimer) { clearTimeout(passTimer); passTimer = null; }
    if (passShown) { passShown = false; deps.passCard?.(null); }
  }
  function passageWidthAt(at: Vec2, toward: Vec2): number | null {
    // the passage is the free floor to either side of the person, measured with the person taken out
    return passageWidth(gridNoPeople(), at, toward);
  }

  function checkTier(): void {
    const t = deps.tier();
    if (t === tierSeen) return;
    tierSeen = t;
    // the bodies of the new tier; people beyond the cap are not drawn (they stay in the layout and the link)
    lives.forEach((l, i) => {
      if (i >= shownCount(lives.length, t)) { dropBody(l); return; }
      if (l.ch) void track(l.ch.setAppearance({ tier: personTier() }).then(() => frameShadow(l.ch!)).catch(() => {}));
      else void track(ensureBody(l, true));
    });
    syncObstacles();
    deps.onBodies?.();
    changed(false);
  }

  function describe(id: string): { title: string; lines: string[]; pose: PersonPose; follows: boolean } | null {
    const l = find(id);
    if (!l) return null;
    const r = l.rec;
    const lines: string[] = [];
    if (r.pose === 'stand') lines.push('Standing.');
    else {
      const host = hostById(r.host);
      if (host) lines.push(`${POSE_WORD[r.pose]} on the ${hostName(host).toLowerCase()}.`, fitLine(host, r.pose as HostAction, r.heightCm));
    }
    const sh = shoulderWidthM(r.body, r.heightCm);
    lines.push(`Shoulders about ${Math.round(sh * 100)} cm across.`);
    return { title: `${labelOf(r)} · ${Math.round(r.heightCm)} cm`, lines, pose: r.pose, follows: l.follow };
  }

  // ---------------------------------------------------------------- boot

  {
    const initial = deps.store.initialPeople();
    for (const rec of sanitizeRecs(initial.map(cloneRec))) {
      rec.id = nextId();
      rec.heightCm = clampPersonHeight(rec.body, rec.heightCm);
      lives.push(newLive(rec));
    }
    notifyStore = deps.store.attachPeople({ list: () => recs().map(cloneRec), clear });
    // the people that are drawn first; the rest wait for a roomier tier
    lives.forEach((l, i) => { if (i < shownCount(lives.length, deps.tier())) void track(ensureBody(l, true)); });
    syncObstacles();
    if (lives.length && deps.store.fromLink()) persist(); // a shared layout is kept as this viewer's own
  }

  return {
    list: () => recs().map(cloneRec),
    count: () => lives.length,
    shown: () => shownCount(lives.length, deps.tier()),
    cap,
    maxPeople: () => PEOPLE_MAX,
    get: (id) => { const l = find(id); return l ? cloneRec(l.rec) : null; },
    bodyOf: (id) => find(id)?.ch ?? null,
    describe,
    place, move, setPose, change, remove, clear, become, setFollow,
    isFollowing: (id) => !!find(id)?.follow,
    update,
    walkGrid,
    footprints,
    objects: () => lives.flatMap((l) => (l.ch ? [l.ch.object] : [])),
    personIdOf(o) {
      let n: THREE.Object3D | null = o;
      while (n) { const v = n.userData?.personId; if (typeof v === 'string') return v; n = n.parent; }
      return null;
    },
    setSuppressed(on) { suppressed = on; for (const l of lives) l.ch?.setVisible(!on && l.inView && !l.occluded); },
    setFurnishing(on) {
      if (furnishing === on) return;
      furnishing = on;
      syncObstacles();
      if (!on) { noPeople = null; reconcile(); }
    },
    hostAt: (p) => hostAt(p, hostItems()),
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    async ready() { while (pending.size) await Promise.allSettled([...pending]); },
    stats: () => ({ added: lives.length, shown: lives.filter((l) => l.ch).length, drawn: stats.drawn, updated: stats.updated, frames: stats.frames }),
    dispose() {
      setExtraObstacles(null);
      hidePass();
      if (reconcileTimer) clearTimeout(reconcileTimer);
      store.flush();
      for (const l of lives.splice(0)) dropBody(l);
      store.attachPeople(null);
      selfChange++;
      try { store.setTemporary(TEMP_KEY, []); } finally { selfChange--; }
    },
  };
}
