// IEEE half floats, for the probe file (SPEC 16.13): the pipeline writes them, the runtime reads them. Pure.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let man = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0);
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    man = (man | 0x800000) >> (1 - exp);
    return sign | ((man + 0x1000) >> 13);
  }
  man += 0x1000;
  if (man & 0x800000) { man = 0; exp++; if (exp >= 31) return sign | 0x7c00; }
  return sign | (exp << 10) | (man >> 13);
}

export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const man = h & 0x3ff;
  if (exp === 0) return sign * man * 5.960464477539063e-8;
  if (exp === 31) return man ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + man / 1024);
}

export function halfArray(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = toHalf(src[i]);
  return out;
}
export function floatArray(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = fromHalf(src[i]);
  return out;
}
