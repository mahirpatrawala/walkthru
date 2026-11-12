// Owned by C11a. Fetches the files under public/look/ and counts every byte (stats().bytesLoaded, acceptance 18).
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const LOOK_BASE = '/look/';

export class AssetLoader {
  /** bytes of look assets fetched so far */
  bytes = 0;
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly hdrs = new Map<string, Promise<THREE.DataTexture>>();
  private jsonCache = new Map<string, Promise<unknown>>();

  constructor(private readonly base: string = LOOK_BASE) {}

  private async bytesOf(path: string): Promise<ArrayBuffer> {
    const res = await fetch(this.base + path);
    if (!res.ok) throw new Error(`look asset ${path}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    this.bytes += buf.byteLength;
    return buf;
  }

  /** a JPG as a texture; `srgb` for colour maps, false for normal and roughness data */
  texture(path: string, opts: { srgb: boolean; anisotropy?: number }): Promise<THREE.Texture> {
    const key = `${path}|${opts.srgb}`;
    let p = this.textures.get(key);
    if (!p) {
      p = (async () => {
        const buf = await this.bytesOf(path);
        const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }), {
          imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
        });
        const t = new THREE.Texture(bitmap);
        t.flipY = false;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = opts.anisotropy ?? 4;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        return t;
      })();
      this.textures.set(key, p);
      p.catch(() => this.textures.delete(key));
    }
    return p;
  }

  /** an equirectangular HDRI (.hdr) as a half-float texture */
  hdr(path: string): Promise<THREE.DataTexture> {
    let p = this.hdrs.get(path);
    if (!p) {
      p = (async () => {
        const buf = await this.bytesOf(path);
        const loader = new HDRLoader();
        const parsed = loader.parse(buf);
        const t = new THREE.DataTexture(parsed.data as unknown as Uint16Array, parsed.width, parsed.height, parsed.format, parsed.type);
        t.colorSpace = THREE.LinearSRGBColorSpace;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.flipY = true;
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.needsUpdate = true;
        return t;
      })();
      this.hdrs.set(path, p);
      p.catch(() => this.hdrs.delete(path));
    }
    return p;
  }

  json<T>(path: string): Promise<T> {
    let p = this.jsonCache.get(path);
    if (!p) {
      p = this.bytesOf(path).then((b) => JSON.parse(new TextDecoder().decode(b)));
      this.jsonCache.set(path, p);
      p.catch(() => this.jsonCache.delete(path));
    }
    return p as Promise<T>;
  }

  dispose(): void {
    for (const p of this.textures.values()) void p.then((t) => t.dispose(), () => {});
    for (const p of this.hdrs.values()) void p.then((t) => t.dispose(), () => {});
    this.textures.clear();
    this.hdrs.clear();
  }
}
