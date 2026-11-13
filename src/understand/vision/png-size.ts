// C12d. Width and height of a PNG without decoding it.
export function pngSize(png: Uint8Array): { w: number; h: number } {
  if (png.length < 24 || png[0] !== 137 || png[1] !== 80) throw new Error('not a PNG');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}
