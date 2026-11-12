// Real-data check for C7: the 44 MB Brush splat from the WhatsApp video (SH degree 3, COLMAP, Y-down so preset flip-x).
// Skipped when the file is not there (it is git-excluded). Prints the numbers the C7 report quotes.
// Set WALKTHRU_PLAN_PNG=/path/out.png to also write the top-down plan image for a look.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parsePly } from '../src/core/splat/files';
import { levelSplat, toLevelled } from '../src/core/splat/floor';
import { renderPlanImage, suggestPxPerUnit } from '../src/core/splat/plan-image';
import { quatInvert, rotateY } from '../src/core/geometry';
import type { LevelResult } from '../src/types';

const file = path.resolve(__dirname, '../public/scenes/video-sample/scene.ply');
const have = fs.existsSync(file);

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { let c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(out: string, w: number, h: number, rgba: Uint8ClampedArray): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = y * (w * 4 + 1) + 1 + x * 4, a = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(rgba[i + c] * a + 255 * (1 - a));
    raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]));
}

describe.skipIf(!have)('real Brush splat (video-sample)', { timeout: 300_000 }, () => {
  it('parses and levels with flip-x (default guard and raised guard)', () => {
    const t0 = performance.now();
    const bytes = new Uint8Array(fs.readFileSync(file));
    const t1 = performance.now();
    const cloud = parsePly(bytes);
    const t2 = performance.now();
    const def = levelSplat(cloud, 'flip-x');
    const t3 = performance.now();
    const raised = levelSplat(cloud, 'flip-x', { maxTiltDeg: 45 });
    const t4 = performance.now();
    let opaque = 0;
    for (let i = 0; i < cloud.count; i++) if (cloud.opacity[i] >= 77) opaque++;
    const show = (name: string, r: LevelResult): void => {
      const n = rotateY(quatInvert(r.rotation), { x: 0, y: 1, z: 0 });
      console.log(`[C7 real] ${name}: tilt ${r.tiltDeg.toFixed(2)} deg, floorOffsetRaw ${r.floorOffsetRaw.toFixed(4)}, ceilingRaw ${r.ceilingRaw?.toFixed(4) ?? 'null'}, confidence ${r.confidence.toFixed(2)}, lowConfidence ${r.lowConfidence}; floor normal in raw space (${n.x.toFixed(4)}, ${n.y.toFixed(4)}, ${n.z.toFixed(4)})`);
    };
    console.log(`[C7 real] ${cloud.count} splats (${opaque} with opacity >= 0.3), read ${(t1 - t0).toFixed(0)} ms, parsePly ${(t2 - t1).toFixed(0)} ms, levelSplat default ${(t3 - t2).toFixed(0)} ms, raised guard ${(t4 - t3).toFixed(0)} ms`);
    show('default guard 15', def);
    show('maxTiltDeg 45  ', raised);
    const lv = toLevelled(cloud, raised);
    let below = 0, total = 0;
    for (let i = 0; i < cloud.count; i++) { if (cloud.opacity[i] < 77) continue; total += cloud.opacity[i]; if (lv[i * 3 + 1] < -0.3) below += cloud.opacity[i]; }
    console.log(`[C7 real] with the raised guard, ${(100 * below / total).toFixed(1)} % of the opacity weight lies more than 0.3 units below the floor (mirrored tiles)`);
    const plan = renderPlanImage(cloud, raised, suggestPxPerUnit(cloud, raised, 700), { footprint: 1, minOpacity: 0.05 });
    let filled = 0;
    for (let i = 3; i < plan.rgba.length; i += 4) if (plan.rgba[i]) filled++;
    console.log(`[C7 real] plan image ${plan.width}x${plan.height}, ${(100 * filled / (plan.width * plan.height)).toFixed(1)} % filled`);
    if (process.env.WALKTHRU_PLAN_PNG) writePng(process.env.WALKTHRU_PLAN_PNG, plan.width, plan.height, plan.rgba);
    expect(cloud.count).toBe(188317);
    expect(Number.isFinite(def.floorOffsetRaw)).toBe(true);
    // the default guard refuses a plane tilted past 15 degrees; the raised guard accepts it
    if (def.tiltDeg > 15) { expect(def.lowConfidence).toBe(true); expect(raised.rotation).not.toEqual(def.rotation); }
  });
});
