// Walking a building. The URL names a space (`?building=<id>&space=<id>`); this opens it with the walk (src/buyer/main.ts `boot`) and, going
// through a portal, takes that space down completely and opens the next one in the same page: the walker, their height and body, the view,
// the style and the time of day carry over, and the address and the Back button follow. One space is loaded at a time.
import './building.css';
import { BUILDING_ID_RE } from './parse';
import { findSpace, liftDoorAt, startSpaceOf } from './parse';
import type { Located } from './parse';
import { boot } from '../buyer/main';
import { createLoadingScreen } from '../buyer/loading';
import type { LoadingScreen } from '../buyer/loading';
import { ARRIVAL_FROM_M, arrivalAtDoor } from './arrival';
import { createCurtain, createLoadingCurtain } from './curtain';
import { catalogueFilterInstalled, contextOf, setCatalogueFilter, setSpaceContext } from './extension';
import { allowedIn } from '../core/places';
import { CATALOG } from '../core/catalog';
import { catalogueAllowedIn } from './extension';
import { openLiftPanel } from './lift-panel';
import type { LiftPanel } from './lift-panel';
import { NotFound, fetchBuilding, fetchScene } from './load';
import { mountBuildingMap } from './map';
import type { BuildingMap } from './map';
import { doorLooksFor } from './portal-looks';
import { mountPortals } from './portals';
import { mountSigns } from './signs';
import type { PortalHandle } from './portals';
import type { PersonSpec } from '../buyer/people/manager';
import type { MountedSpace, SpaceHost, SpaceSession } from './space-host';
import type { BuildingFile, Portal } from './types';
import { buildingUrl, parseBuildingUrl } from './url';

const MAP_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M3.5 21h17"/><path d="M9.5 7h1M13.5 7h1M9.5 11h1M13.5 11h1M9.5 15h1M13.5 15h1"/><path d="M11 21v-3h2v3"/></svg>';

interface EnterOptions {
  /** the door to land just inside, or null for the scene's own start */
  opening: string | null;
  fromM?: number;
  screen: LoadingScreen;
  first: boolean;
  history: 'push' | 'replace' | 'none';
}

export interface BuildingWalkApi {
  building: BuildingFile;
  current(): { spaceId: string; levelId: string; sceneId: string } | null;
  go(spaceId: string): Promise<void>;
  travel(liftId: string, levelId: string): Promise<void>;
  portal(id: string): Promise<boolean>;
  openMap(): void;
  /** debug: what the page holds right now, for the leak check */
  metrics(): { geometries: number; textures: number; programs: number; calls: number; nodes: number; spaces: number; lastBootMs: number };
  /** debug: the catalogue rule while a space is up: is one installed, which kind of space, how many pieces it offers */
  catalogue(): { installed: boolean; kind: string | null; offered: number };
}

class BuildingWalk implements BuildingWalkApi {
  private session: SpaceSession | null = null;
  private mounted: MountedSpace | null = null;
  private portals: PortalHandle | null = null;
  private here: Located | null = null;
  private liftPanel: LiftPanel | null = null;
  private map: { root: HTMLElement; view: BuildingMap; off: () => void } | null = null;
  private busy = false;
  /** Back or Forward was pressed while a transition was running: follow the address once it is done */
  private popAgain = false;
  private count = 0;
  /** debug: how long the last space took to build, down to "ready" (ms) */
  private lastBootMs = 0;

  constructor(readonly building: BuildingFile) {}

  current(): { spaceId: string; levelId: string; sceneId: string } | null {
    return this.here ? { spaceId: this.here.space.id, levelId: this.here.level.id, sceneId: this.here.space.sceneId } : null;
  }

  /** Opens `spaceId`: the old space is taken down first, then the new one built behind `screen`. */
  async enter(spaceId: string, o: EnterOptions): Promise<boolean> {
    const loc = findSpace(this.building, spaceId);
    if (!loc) { o.screen.showError('This place is not in the building.', `There is no space "${spaceId}" in ${this.building.name}.`); return false; }
    const carry = this.session?.carry() ?? null;
    const followers = this.session?.takeFollowers() ?? [];
    this.closePanels();
    this.portals?.dispose(); this.portals = null;
    this.session?.dispose(); this.session = null; this.mounted = null;
    this.here = null;
    const b = this.building;
    const host: SpaceHost = {
      styleScope: b.id,
      first: o.first,
      carry,
      bare: b.bare === true,
      space: { id: loc.space.id, kind: loc.space.kind, outdoor: loc.space.outdoor === true, pack: loc.space.pack ?? null },
      tagText: b.sample ? `${loc.space.name} · ${loc.level.label}. Sample building, not a real home.` : `${loc.space.name} · ${loc.level.label}`,
      loading: o.screen,
      doorLooks: doorLooksFor(loc.space),
      arrival: o.opening ? (layout, grid) => { const a = arrivalAtDoor(layout, grid, o.opening!, o.fromM ?? ARRIVAL_FROM_M); return a ? { x: a.x, z: a.z, yawDeg: a.yawDeg } : null; } : null,
      tapClaim: null,
      onMounted: (m) => this.onMounted(m, loc, host, followers),
    };
    let session: SpaceSession | null = null;
    const t0 = performance.now();
    try {
      session = await boot(loc.space.sceneId, null, host);
      this.lastBootMs = Math.round(performance.now() - t0);
    } catch (err) {
      console.error('[walkthru] could not open the space', err);
      o.screen.showError('Could not open this space.', err instanceof Error ? err.message : String(err));
      return false;
    }
    if (!session) return false;
    this.session = session;
    this.here = loc;
    this.count += 1;
    const url = buildingUrl({ building: b.id, space: spaceId });
    if (o.history === 'push') history.pushState({ wb: spaceId }, '', url);
    else if (o.history === 'replace') history.replaceState({ wb: spaceId }, '', url);
    document.title = `${loc.space.name} · ${b.name} · walkthru`;
    return true;
  }

  private onMounted(m: MountedSpace, loc: Located, host: SpaceHost, followers: PersonSpec[]): void {
    this.mounted = m;
    setSpaceContext(contextOf(this.building.id, loc.space));
    // stage 2: the tray offers what the kind of space allows (SPEC 16.17). The rule is installed with the space and goes with it: no stale rule in the next one.
    setCatalogueFilter((kind, item) => allowedIn(item.id, kind));
    m.onDispose(() => { setSpaceContext(null); setCatalogueFilter(null); });
    this.portals = mountPortals(m, loc.space.portals, (p) => { void this.usePortal(p); });
    host.tapClaim = (e) => this.portals?.tap(e) ?? false;
    const signs = mountSigns(m, loc.space, this.building);
    m.onDispose(() => signs.dispose());
    m.onDispose(() => { host.tapClaim = null; this.portals?.dispose(); this.portals = null; this.closePanels(); });
    void this.setDownFollowers(m, followers);
    // the "Building map" button, beside the HUD's own
    const bar = m.hud.root.querySelector('.wt-buttons');
    if (bar) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'wt-btn'; btn.dataset.ui = '1'; btn.dataset.btn = 'building';
      btn.setAttribute('aria-label', 'Building map'); btn.title = 'Building map';
      btn.innerHTML = MAP_ICON;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.openMap(); btn.blur(); });
      bar.insertBefore(btn, bar.firstChild);
    }
  }

  /** The people who were following the walker come out of the portal with them: set down just behind, one after another, and told to follow again. */
  private async setDownFollowers(m: MountedSpace, followers: PersonSpec[]): Promise<void> {
    // candidate spots around the walker, behind first and nearest first: (back, side) offsets. A cramped foyer rejects the usual ones
    // (a person may not block a door's swing), so the search widens to a full ring before it gives up.
    const spots: [number, number][] = [[0.9, 0.45], [0.9, -0.45], [1.5, 0], [1.5, 0.6], [1.5, -0.6], [2.1, 0.3], [2.1, -0.3]];
    for (const r of [0.6, 0.9, 1.3, 1.8, 2.4]) {
      for (let k = 0; k < 12; k++) {
        const a = Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6); // 180 degrees is straight behind
        spots.push([-Math.cos(a) * r, Math.sin(a) * r]);
      }
    }
    // one pass over the spots for each companion; one who finds no room (the walker stands in a cramped foyer) waits and is tried again
    // as the walker moves on, so nobody is dropped from the walk
    let waiting = followers.slice();
    const pass = async (): Promise<void> => {
      const w = m.ctx.character.position;
      const yaw = (m.ctx.character.yawDeg * Math.PI) / 180;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const left: PersonSpec[] = [];
      let n = 0;
      for (const spec of waiting) {
        let done = false;
        for (; n < spots.length && !done; n++) {
          const [back, side] = spots[n];
          const at = { x: w.x - fx * back + fz * side, z: w.z - fz * back - fx * side };
          const r = await m.people.place(spec, { kind: 'stand', at, yawDeg: m.ctx.character.yawDeg });
          if (r.ok) { m.people.setFollow(r.id, true); done = true; }
        }
        if (!done) left.push(spec);
      }
      waiting = left;
    };
    await pass();
    if (waiting.length) m.hud.toast(waiting.length === 1 ? 'There is no room for your companion yet. They join you as soon as there is.' : `There is no room for ${waiting.length} companions yet. They join you as soon as there is.`);
    for (let tries = 0; waiting.length && tries < 40 && this.mounted === m; tries++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (this.mounted !== m) return;
      await pass();
    }
  }

  // ---------------------------------------------------------------- portals

  private async usePortal(p: Portal): Promise<void> {
    const m = this.mounted;
    if (!m || this.busy || !this.here) return;
    if (p.kind === 'stairs') { m.hud.toast('The stairs are not walkable yet. Use the lift.'); return; }
    if (p.kind === 'outside') { m.hud.toast(`${p.label} is not part of this sample.`); return; }
    if (p.kind === 'lift') { this.openLift(p.lift); return; }
    const far = findSpace(this.building, p.to.space);
    const farPortal = far?.space.portals.find((x) => x.id === p.to.portal);
    if (!far || !farPortal) { m.hud.toast('That door does not lead anywhere yet.'); return; }
    await this.transition(far.space.id, { opening: farPortal.opening, kind: 'door', title: far.space.name, sub: far.level.label });
  }

  private openLift(liftId: string): void {
    const m = this.mounted, here = this.here;
    const lift = this.building.lifts.find((l) => l.id === liftId);
    if (!m || !here || !lift || this.liftPanel) return;
    m.block(true);
    this.liftPanel = openLiftPanel(m.hud.root, {
      building: this.building, lift, here: here.level.id,
      onChoose: (levelId) => { this.liftPanel = null; m.block(false); void this.travel(liftId, levelId); },
      onClose: () => { this.liftPanel = null; m.block(false); },
    });
  }

  async travel(liftId: string, levelId: string): Promise<void> {
    const b = this.building;
    const lift = b.lifts.find((l) => l.id === liftId);
    const at = liftDoorAt(b, liftId, levelId);
    const here = this.here;
    if (!lift || !at || !here) return;
    const level = b.levels.find((l) => l.id === levelId)!;
    const order = b.levels.map((l) => l.id);
    const a = order.indexOf(here.level.id), z = order.indexOf(levelId);
    const lo = Math.min(a, z), hi = Math.max(a, z);
    let path = order.slice(lo, hi + 1).filter((id) => lift.serves.includes(id));
    if (z < a) path = path.reverse();
    const floors = path.map((id) => b.levels.find((l) => l.id === id)!.short);
    await this.transition(at.space.id, { opening: at.portal.opening, fromM: 1.5, kind: 'lift', title: level.label, sub: level.summary, floors });
  }

  private async transition(spaceId: string, t: { opening: string | null; fromM?: number; kind: 'door' | 'lift'; title: string; sub?: string; floors?: string[] }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const curtain = t.kind === 'lift' ? createCurtain({ kind: 'lift', title: t.title, sub: t.sub, floors: t.floors }) : createLoadingCurtain(t.title, t.sub);
      await curtain.covered;
      await this.enter(spaceId, { opening: t.opening, fromM: t.fromM, screen: curtain.screen, first: false, history: 'push' });
    } finally { this.busy = false; this.followAddress(); }
  }

  async go(spaceId: string): Promise<void> {
    const loc = findSpace(this.building, spaceId);
    if (!loc || this.busy) return;
    await this.transition(spaceId, { opening: loc.space.portals[0]?.opening ?? null, kind: 'door', title: loc.space.name, sub: loc.level.label });
  }

  async portal(id: string): Promise<boolean> {
    const p = this.here?.space.portals.find((x) => x.id === id);
    if (!p) return false;
    await this.usePortal(p);
    return true;
  }

  /** the browser's Back or Forward: the address names a space of this building */
  async onPop(): Promise<void> {
    const u = parseBuildingUrl(location.search);
    if (!u || u.building !== this.building.id) { location.reload(); return; }
    const loc = findSpace(this.building, u.space) ?? startSpaceOf(this.building);
    if (this.here?.space.id === loc.space.id) return;
    if (this.busy) { this.popAgain = true; return; }
    this.busy = true;
    try {
      const curtain = createLoadingCurtain(loc.space.name, loc.level.label);
      await curtain.covered;
      await this.enter(loc.space.id, { opening: loc.space.portals[0]?.opening ?? null, screen: curtain.screen, first: false, history: 'none' });
    } finally { this.busy = false; this.followAddress(); }
  }

  private followAddress(): void {
    if (!this.popAgain) return;
    this.popAgain = false;
    void this.onPop();
  }

  // ---------------------------------------------------------------- panels

  private closePanels(): void {
    this.liftPanel?.close(); this.liftPanel = null;
    this.closeMap();
    this.mounted?.block(false);
  }

  openMap(): void {
    const m = this.mounted, here = this.here;
    if (!m || !here || this.map) return;
    m.block(true);
    const root = document.createElement('div');
    root.className = 'ws bm-overlay';
    root.dataset.ui = '1';
    root.dataset.testid = 'map-overlay';
    document.body.appendChild(root);
    const point = m.ctx.character.position;
    const close = (): void => { this.closeMap(); m.block(false); };
    const view = mountBuildingMap(root, {
      building: this.building, here: { spaceId: here.space.id, point: { x: point.x, z: point.z } }, actionLabel: 'Go here',
      back: { label: '← Back to the walk', onClick: close },
      onAction: (id) => { close(); void this.go(id); },
      loadScene: fetchScene,
    });
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey, true);
    this.map = { root, view, off: () => window.removeEventListener('keydown', onKey, true) };
  }

  private closeMap(): void {
    if (!this.map) return;
    this.map.off(); this.map.view.destroy(); this.map.root.remove(); this.map = null;
  }

  catalogue(): { installed: boolean; kind: string | null; offered: number } {
    const kind = this.here?.space.kind ?? null;
    return { installed: catalogueFilterInstalled(), kind, offered: kind ? CATALOG.filter((c) => catalogueAllowedIn(c, kind)).length : CATALOG.length };
  }

  metrics(): { geometries: number; textures: number; programs: number; calls: number; nodes: number; spaces: number; lastBootMs: number } {
    const w = window as unknown as { __walkthru?: { ctx?: { viewer?: { renderer?: { info?: { memory: { geometries: number; textures: number }; programs?: unknown[]; render: { calls: number } } } } } } };
    const info = w.__walkthru?.ctx?.viewer?.renderer?.info;
    return { geometries: info?.memory.geometries ?? 0, textures: info?.memory.textures ?? 0, programs: info?.programs?.length ?? 0, calls: info?.render.calls ?? 0, nodes: document.getElementsByTagName('*').length, spaces: this.count, lastBootMs: this.lastBootMs };
  }
}

/** Entry for `?building=<id>&space=<id>`. */
export async function startBuildingWalk(): Promise<void> {
  const u = parseBuildingUrl(location.search);
  const loading = createLoadingScreen(document.body);
  if (!u || !BUILDING_ID_RE.test(u.building)) { loading.showError('This building is not available.', 'The address does not name a building.'); return; }
  let building: BuildingFile;
  try {
    loading.setProgress(0.04, 'Loading the building…');
    building = await fetchBuilding(u.building);
  } catch (err) {
    if (err instanceof NotFound) { loading.showError('This building is not available.', `There is no building called "${u.building}" here.`); return; }
    loading.showError('Could not open this building.', err instanceof Error ? err.message : String(err));
    return;
  }
  loading.setTitle(building.name, building.subtitle);
  const loc = findSpace(building, u.space) ?? startSpaceOf(building);
  const walk = new BuildingWalk(building);
  (window as unknown as { __walkthruBuilding: BuildingWalkApi }).__walkthruBuilding = walk;
  window.addEventListener('popstate', () => { void walk.onPop(); });
  await walk.enter(loc.space.id, { opening: loc.space.portals[0]?.opening ?? null, screen: loading, first: true, history: 'replace' });
}
