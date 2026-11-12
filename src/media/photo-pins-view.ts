// Owned by C9. SPEC 14.9: the buyer's "Real photo" bubbles. Standalone: plain parameters, not BuyerContext.
import * as THREE from 'three';
import type { Vec2 } from '../types';
import { sceneUrl } from './client';
import './media.css';
import { validatePinsFile } from './pins';
import type { PhotoPin } from './types';

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

export const MAX_BUBBLES = 6;
export const BUBBLE_RANGE_M = 4;
export const PIN_COLOUR = '#2F6BFF';
const RING_RADIUS = 0.18;
const BUBBLE_HEIGHT = 1.5;
const FADE_MS = 150;

/**
 * Which pins get a bubble: those the viewer can see (`visible`, default all) that are in the viewer's room or within
 * 4 m, nearest first, at most 6. Pure.
 */
export function selectBubbles(pins: { id: string; at: Vec2; roomId?: string | null }[], viewer: Vec2, viewerRoomId: string | null,
  roomIdAt: (p: Vec2) => string | null, visible: (id: string) => boolean = () => true,
  max = MAX_BUBBLES, rangeM = BUBBLE_RANGE_M): { id: string; dist: number }[] {
  const out: { id: string; dist: number }[] = [];
  for (const p of pins) {
    if (!visible(p.id)) continue;
    const dist = Math.hypot(p.at.x - viewer.x, p.at.z - viewer.z);
    const room = p.roomId ?? roomIdAt(p.at);
    const sameRoom = viewerRoomId !== null && room === viewerRoomId;
    if (sameRoom || dist <= rangeM) out.push({ id: p.id, dist });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, max);
}

function makeMarker(pin: PhotoPin): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: PIN_COLOUR, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(RING_RADIUS * 0.72, RING_RADIUS, 32).rotateX(-Math.PI / 2), mat);
  g.add(ring);
  if (pin.yawDeg !== null) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.34, -0.08, 0, 0.21, 0.08, 0, 0.21], 3));
    tri.setIndex([0, 1, 2]);
    const wedge = new THREE.Mesh(tri, mat);
    g.add(wedge);
  }
  g.position.set(pin.at!.x, 0.01, pin.at!.z);
  g.rotation.y = ((pin.yawDeg ?? 0) * Math.PI) / 180;
  return g;
}

export async function mountPhotoPins(opts: PhotoPinsOptions): Promise<PhotoPinsHandle> {
  const none: PhotoPinsHandle = { count: 0, setVisible() { /* nothing */ }, dispose() { /* nothing */ } };
  let pins: PhotoPin[] = [];
  try {
    const res = await fetch(sceneUrl(opts.sceneId, 'photo-pins.json'), { cache: 'no-store' });
    if (!res.ok) return none;
    pins = validatePinsFile(await res.json()).pins.filter((p) => p.at !== null);
  } catch {
    return none; // missing, not JSON (a dev server answering with index.html) or invalid: no pins
  }
  if (pins.length === 0) return none;

  const group = new THREE.Group();
  group.name = 'photo-pins';
  const disposables: { dispose(): void }[] = [];
  interface Bubble { pin: PhotoPin; el: HTMLButtonElement; shown: boolean }
  const bubbles = new Map<string, Bubble>();
  for (const pin of pins) {
    const marker = makeMarker(pin);
    marker.traverse((o) => {
      if (o instanceof THREE.Mesh) { disposables.push(o.geometry as THREE.BufferGeometry); disposables.push(o.material as THREE.Material); }
    });
    group.add(marker);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wt-pin-bubble';
    el.setAttribute('aria-label', 'Real photo');
    const img = document.createElement('img');
    img.src = sceneUrl(opts.sceneId, pin.thumb);
    img.alt = '';
    img.draggable = false;
    const cap = document.createElement('span');
    cap.textContent = 'Real photo';
    el.append(img, cap);
    el.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(pin); });
    opts.overlay.appendChild(el);
    bubbles.set(pin.id, { pin, el, shown: false });
  }
  opts.scene.add(group);

  // ---- lightbox
  let lightbox: HTMLElement | null = null;
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeLightbox(); };
  function openLightbox(pin: PhotoPin): void {
    if (lightbox) return;
    const box = document.createElement('div');
    box.className = 'wt-lightbox';
    box.addEventListener('click', (e) => { if (e.target === box) closeLightbox(); });
    const img = document.createElement('img');
    img.src = sceneUrl(opts.sceneId, pin.file);
    img.alt = pin.caption ?? 'Real photo';
    const roomId = pin.roomId ?? (pin.at ? opts.roomIdAt(pin.at) : null);
    const line = document.createElement('div');
    line.className = 'wt-lightbox-line';
    line.textContent = `Real photo${roomId ? ` · ${opts.roomLabel(roomId)}` : ''}${pin.caption ? ` · ${pin.caption}` : ''}`;
    const small = document.createElement('div');
    small.className = 'wt-lightbox-small';
    small.textContent = 'Photo from the broker';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wt-lightbox-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', closeLightbox);
    box.append(img, line, small, close);
    opts.overlay.appendChild(box);
    lightbox = box;
    window.addEventListener('keydown', onKey);
    opts.onLightbox?.(true);
  }
  function closeLightbox(): void {
    if (!lightbox) return;
    lightbox.remove();
    lightbox = null;
    window.removeEventListener('keydown', onKey);
    opts.onLightbox?.(false);
  }

  // ---- per frame: project, choose, fade
  const v = new THREE.Vector3();
  const cs = new THREE.Vector3();
  let visibleAll = true;
  const unsub = opts.onFrame(() => {
    const w = opts.overlay.clientWidth;
    const h = opts.overlay.clientHeight;
    opts.camera.updateMatrixWorld();
    const projected = new Map<string, { x: number; y: number }>();
    const inFront = (id: string): boolean => {
      const b = bubbles.get(id)!;
      cs.set(b.pin.at!.x, BUBBLE_HEIGHT, b.pin.at!.z).applyMatrix4(opts.camera.matrixWorldInverse);
      if (cs.z >= 0) return false; // behind the camera
      v.set(b.pin.at!.x, BUBBLE_HEIGHT, b.pin.at!.z).project(opts.camera);
      if (Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return false;
      projected.set(id, { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h });
      return true;
    };
    const viewer = opts.viewerPosition();
    const chosen = visibleAll
      ? new Set(selectBubbles(pins.map((p) => ({ id: p.id, at: p.at!, roomId: p.roomId })), viewer, opts.roomIdAt(viewer), opts.roomIdAt, inFront).map((s) => s.id))
      : new Set<string>();
    for (const b of bubbles.values()) {
      const on = chosen.has(b.pin.id);
      if (on) {
        const p = projected.get(b.pin.id)!;
        b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
      if (on !== b.shown) {
        b.shown = on;
        b.el.classList.toggle('wt-on', on);
        b.el.style.transitionDuration = `${FADE_MS}ms`;
        b.el.style.pointerEvents = on ? 'auto' : 'none';
      }
    }
  });

  return {
    count: pins.length,
    setVisible(vis: boolean): void {
      visibleAll = vis;
      group.visible = vis;
      if (!vis) closeLightbox();
    },
    dispose(): void {
      unsub();
      closeLightbox();
      opts.scene.remove(group);
      for (const d of disposables) d.dispose();
      for (const b of bubbles.values()) b.el.remove();
      bubbles.clear();
    },
  };
}
