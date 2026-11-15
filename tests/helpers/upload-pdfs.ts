// Small hand-made PDFs for the upload tests: a scan (one picture and nothing else), a letter (text only), a drawing with one wall-less box, and a lock.
// Same style as scripts/drawing-sets/render.ts toPdf: PDF 1.4, no library, a correct xref table.
const bytesOf = (s: string): Uint8Array => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

function assemble(objs: string[]): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytesOf(out);
}

/** A scan: one full-page grey picture with a few dark blocks, no lines, no text. */
export function imageOnlyPdf(): Uint8Array {
  const w = 64, h = 48;
  let px = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px += String.fromCharCode((x % 16 < 2 || y % 12 < 2) ? 40 : 235);
  const content = 'q 595 0 0 420 0 0 cm /Im0 Do Q';
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 420] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${px.length} >>\nstream\n${px}\nendstream`,
  ]);
}

/** A letter: Helvetica text and no drawing at all. */
export function textOnlyPdf(): Uint8Array {
  let content = 'BT /F1 12 Tf 50 780 Td 14 TL ';
  for (let i = 0; i < 30; i++) content += `(Dear customer, thank you for your order number ${1000 + i}.) Tj T* `;
  content += 'ET';
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** Drawn lines that are not a plan: a grid of 400 thin lines, a title, no room words and no closed walls. */
export function gridPdf(): Uint8Array {
  let content = '0.5 w ';
  for (let i = 0; i <= 20; i++) content += `${50 + i * 25} 100 m ${50 + i * 25} 700 l S 50 ${100 + i * 30} m 550 ${100 + i * 30} l S `;
  content += 'BT /F1 14 Tf 50 750 Td (Quarterly chart) Tj ET';
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** `n` empty pages (to cross the page limit). */
export function manyPagesPdf(n: number): Uint8Array {
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`];
  for (let i = 0; i < n; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${4 + i * 2} 0 R >>`);
    const c = '0 0 m 100 100 l S';
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  }
  return assemble(objs);
}
