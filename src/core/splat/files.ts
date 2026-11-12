// Owned by C7. SPEC 4.11 (core/splat/files.ts): read splat centres, opacity and colour out of .ply and .splat bytes.
// Pure TypeScript, no DOM. `.spz` is not parsed here; the editor falls back to Spark's forEachSplat for it.
import type { RawCloud } from '../../types';

const SH_C0 = 0.28209479177387814;

type PlyType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';
const TYPE_ALIASES: Record<string, PlyType> = {
  char: 'int8', int8: 'int8', uchar: 'uint8', uint8: 'uint8',
  short: 'int16', int16: 'int16', ushort: 'uint16', uint16: 'uint16',
  int: 'int32', int32: 'int32', uint: 'uint32', uint32: 'uint32',
  float: 'float32', float32: 'float32', double: 'float64', float64: 'float64',
};
const TYPE_SIZE: Record<PlyType, number> = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8 };

interface PlyProp { name: string; type: PlyType; offset: number }
interface PlyElement { name: string; count: number; props: PlyProp[]; stride: number; hasList: boolean }

function readHeader(bytes: Uint8Array): { elements: PlyElement[]; dataStart: number; format: string } {
  const marker = 'end_header';
  const limit = Math.min(bytes.length, 1 << 20);
  let end = -1;
  outer: for (let i = 0; i + marker.length <= limit; i++) {
    for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker.charCodeAt(j)) continue outer;
    end = i;
    break;
  }
  if (end < 0) throw new Error('This file is not a PLY: no end_header line was found in the first megabyte.');
  let dataStart = end + marker.length;
  if (bytes[dataStart] === 0x0d) dataStart++;
  if (bytes[dataStart] === 0x0a) dataStart++;
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, end));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines[0] !== 'ply') throw new Error('This file is not a PLY: it does not start with "ply".');
  let format = '';
  const elements: PlyElement[] = [];
  let cur: PlyElement | null = null;
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') format = parts[1] ?? '';
    else if (parts[0] === 'element') {
      cur = { name: parts[1], count: parseInt(parts[2], 10), props: [], stride: 0, hasList: false };
      elements.push(cur);
    } else if (parts[0] === 'property' && cur) {
      if (parts[1] === 'list') { cur.hasList = true; continue; }
      const type = TYPE_ALIASES[parts[1]];
      if (!type) throw new Error(`Unsupported PLY property type "${parts[1]}".`);
      cur.props.push({ name: parts[2], type, offset: cur.stride });
      cur.stride += TYPE_SIZE[type];
    }
  }
  return { elements, dataStart, format };
}

function reader(dv: DataView, type: PlyType): (at: number) => number {
  switch (type) {
    case 'int8': return (a) => dv.getInt8(a);
    case 'uint8': return (a) => dv.getUint8(a);
    case 'int16': return (a) => dv.getInt16(a, true);
    case 'uint16': return (a) => dv.getUint16(a, true);
    case 'int32': return (a) => dv.getInt32(a, true);
    case 'uint32': return (a) => dv.getUint32(a, true);
    case 'float32': return (a) => dv.getFloat32(a, true);
    case 'float64': return (a) => dv.getFloat64(a, true);
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Standard 3D Gaussian Splatting PLY, binary little-endian. Reads `x y z opacity f_dc_0..2`; everything else (spherical
 * harmonics, scales, rotations) is skipped. `alpha = sigmoid(opacity)`, `rgb = clamp(0.5 + 0.28209479177387814 * f_dc)`.
 * Throws on a PlayCanvas compressed PLY (it has an `element chunk`), on ASCII or big-endian files, and on a missing x, y or z.
 * // SPEC-GAP: 4.11 names only f_dc colour. A PLY with `red green blue` uchar properties and no f_dc is read as plain 8-bit
 * // colour, and one with neither gets mid grey. A PLY with no `opacity` property gets full opacity.
 */
export function parsePly(bytes: Uint8Array): RawCloud {
  const { elements, dataStart, format } = readHeader(bytes);
  if (elements.some((e) => e.name === 'chunk')) {
    throw new Error('This is a PlayCanvas compressed PLY (it has an "element chunk"). Convert it to a standard PLY or .splat first.');
  }
  if (format !== 'binary_little_endian') throw new Error(`Only binary little-endian PLY files are supported (this one is "${format}").`);
  const vertex = elements.find((e) => e.name === 'vertex');
  if (!vertex) throw new Error('This PLY has no vertex element.');
  let start = dataStart;
  for (const e of elements) {
    if (e === vertex) break;
    if (e.hasList) throw new Error(`Cannot skip the PLY element "${e.name}" (it has list properties) to reach the vertices.`);
    start += e.stride * e.count;
  }
  if (vertex.hasList) throw new Error('The PLY vertex element has list properties, which are not supported.');
  const n = vertex.count;
  if (!(n >= 0) || start + vertex.stride * n > bytes.length) {
    throw new Error(`This PLY is cut short: the header promises ${n} vertices but the file ends early.`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prop = (name: string): PlyProp | undefined => vertex.props.find((p) => p.name === name);
  const px = prop('x'), py = prop('y'), pz = prop('z');
  if (!px || !py || !pz) throw new Error('This PLY has no x, y, z properties.');
  const rx = reader(dv, px.type), ry = reader(dv, py.type), rz = reader(dv, pz.type);
  const po = prop('opacity');
  const ro = po ? reader(dv, po.type) : null;
  const dc = [prop('f_dc_0'), prop('f_dc_1'), prop('f_dc_2')];
  const rdc = dc.map((p) => (p ? reader(dv, p.type) : null));
  const col = [prop('red'), prop('green'), prop('blue')];
  const rcol = col.map((p) => (p ? reader(dv, p.type) : null));
  const hasDc = dc.every((p) => !!p);
  const hasCol = col.every((p) => !!p);

  const positions = new Float32Array(n * 3);
  const opacity = new Uint8Array(n);
  const rgb = new Uint8Array(n * 3);
  const stride = vertex.stride;
  for (let i = 0; i < n; i++) {
    const base = start + i * stride;
    positions[i * 3] = rx(base + px.offset);
    positions[i * 3 + 1] = ry(base + py.offset);
    positions[i * 3 + 2] = rz(base + pz.offset);
    if (ro && po) {
      const a = 1 / (1 + Math.exp(-ro(base + po.offset)));
      opacity[i] = Math.round(clamp01(a) * 255);
    } else opacity[i] = 255;
    for (let c = 0; c < 3; c++) {
      if (hasDc) rgb[i * 3 + c] = Math.round(clamp01(0.5 + SH_C0 * rdc[c]!(base + dc[c]!.offset)) * 255);
      else if (hasCol) rgb[i * 3 + c] = Math.max(0, Math.min(255, Math.round(rcol[c]!(base + col[c]!.offset))));
      else rgb[i * 3 + c] = 128;
    }
  }
  return { count: n, positions, opacity, rgb };
}

/** antimatter15 `.splat`: 32 bytes per splat: position f32 x3, scale f32 x3, rgba u8 x4, rotation u8 x4. */
export function parseSplat(bytes: Uint8Array): RawCloud {
  const n = Math.floor(bytes.length / 32);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(n * 3);
  const opacity = new Uint8Array(n);
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 32;
    positions[i * 3] = dv.getFloat32(o, true);
    positions[i * 3 + 1] = dv.getFloat32(o + 4, true);
    positions[i * 3 + 2] = dv.getFloat32(o + 8, true);
    rgb[i * 3] = bytes[o + 24];
    rgb[i * 3 + 1] = bytes[o + 25];
    rgb[i * 3 + 2] = bytes[o + 26];
    opacity[i] = bytes[o + 27];
  }
  return { count: n, positions, opacity, rgb };
}
