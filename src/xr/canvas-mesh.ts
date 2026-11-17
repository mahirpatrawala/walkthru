// A flat piece of the world that shows a canvas: the panel, the toasts, the door prompt, the debug readout. No DOM is shown in a headset session, so
// every word is a texture. Each one owns its texture, geometry and material and gives them back in `dispose()`.
import * as THREE from 'three';

export class CanvasMesh {
  readonly mesh: THREE.Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat: THREE.MeshBasicMaterial;

  /** `wM` by `hM` metres on the plane, `pxW` by `pxH` pixels of picture. */
  constructor(wM: number, hM: number, pxW: number, pxH: number, o: { renderOrder?: number; depthTest?: boolean; opacity?: number } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW; this.canvas.height = pxH;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('A 2D canvas is needed for the panel.');
    this.ctx = ctx;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.anisotropy = 1;
    this.geo = new THREE.PlaneGeometry(wM, hM);
    // tone mapping is for the home's light; words are not lit
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, depthWrite: false, depthTest: o.depthTest ?? true, opacity: o.opacity ?? 1 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = o.renderOrder ?? 900;
    this.mesh.frustumCulled = false;
  }

  /** Draws on the canvas and sends it to the GPU. Call only when something changed. */
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }

  setOpacity(a: number): void { this.mat.opacity = a; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.tex.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** The words, in the walkthru brand's colours (SPEC 2). */
export const INK = '#2B211C';
export const PAPER = '#F7F0E4';
export const CARD = '#FFFDF8';
export const TERRACOTTA = '#B2472B';
export const TEAL = '#1E6B73';
export const OCHRE = '#E3A33A';
export const FONT = "'Avenir Next', 'Trebuchet MS', system-ui, -apple-system, 'Segoe UI', sans-serif";

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Shortens `text` with an ellipsis until it fits `maxW` in the font now set on the context. */
export function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
