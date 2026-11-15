// "Upload your floor plan": what is supported, and the plain-English answer when a file is not. Every way a file can fail is one `Problem`
// with a title, one sentence of why, and what to try, so the page never ends in a spinner with nothing. Pure: no DOM, no Node.
import { isPictureOfPlan } from '../import/vector-page';
import type { ProposalExtras, VectorPage } from '../import/types';

/** v1 supports one kind of file. The limits keep a visitor's laptop (and phone) from being locked up by a file nobody checked. */
export const LIMITS = {
  /** a plan PDF from a drawing program is a few hundred KB to a few MB */
  maxBytes: 30 * 1024 * 1024,
  maxPages: 12,
  /** painting operators on one page: a flat plan is 5k to 300k; a whole-site CAD export is millions */
  maxOperators: 1_500_000,
  /** the wall clock the reader gets before it is stopped */
  maxSeconds: 150,
} as const;

export type ProblemCode =
  | 'no-file' | 'several-files' | 'empty' | 'not-pdf' | 'image-file' | 'too-big' | 'unreadable' | 'encrypted' | 'too-many-pages'
  | 'too-complex' | 'picture-pdf' | 'blank' | 'not-a-plan' | 'no-rooms' | 'several-flats' | 'failed' | 'timeout' | 'no-worker';

export interface Problem { code: ProblemCode; title: string; detail: string; tips: string[] }

export const SUPPORTED_NOTE = 'A PDF floor plan saved from drawing software (AutoCAD, Revit, ArchiCAD, SketchUp and the like), one flat, with real lines and typed room names.';
export const PRIVACY_NOTE = 'Your plan stays on this device. Nothing is uploaded anywhere.';
export const PICTURE_MESSAGE = 'This PDF is a picture of a plan. For now Walkthru reads plans saved from drawing software. Photo and image plans are coming.';

const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function problem(code: ProblemCode, info: { size?: number; pages?: number; flats?: number; detail?: string } = {}): Problem {
  switch (code) {
    case 'no-file': return { code, title: 'Choose a file', detail: 'No file was chosen, so there is nothing to read yet.', tips: ['Pick a PDF floor plan.'] };
    case 'several-files': return { code, title: 'One plan at a time', detail: 'Walkthru reads one flat at a time, so only one file can be chosen.', tips: ['Choose the PDF of the flat you want to walk through.'] };
    case 'empty': return { code, title: 'That file is empty', detail: 'The file has no content.', tips: ['Export the plan again from your drawing software and choose the new PDF.'] };
    case 'not-pdf': return { code, title: 'Upload a PDF', detail: 'Walkthru reads floor plans saved as a PDF from drawing software. This file is not a PDF.', tips: ['In your drawing software choose Print or Export, then PDF, and upload that file.'] };
    case 'image-file': return { code, title: 'Upload a PDF', detail: 'This looks like a photo or an image. For now Walkthru reads plans saved from drawing software as a PDF. Photo and image plans are coming.', tips: ['If you have the plan as a drawing file, export it as a PDF.'] };
    case 'too-big': return { code, title: 'That file is too large', detail: `This file is ${mb(info.size ?? 0)}. The limit is ${mb(LIMITS.maxBytes)}, so it opens quickly and safely on this device.`, tips: ['Export only the floor plan page, not the whole set.', 'Or save the PDF again with a smaller size option.'] };
    case 'unreadable': return { code, title: 'This PDF could not be opened', detail: 'The file is damaged or is not a normal PDF, so it could not be read.', tips: ['Open it in a PDF viewer to check it shows the plan.', 'Export it again from your drawing software.'] };
    case 'encrypted': return { code, title: 'This PDF is locked', detail: 'The PDF needs a password, and Walkthru cannot read a locked file.', tips: ['Save a copy without the password and upload that.'] };
    case 'too-many-pages': return { code, title: 'This PDF has too many pages', detail: `It has ${info.pages ?? 'many'} pages. Walkthru reads up to ${LIMITS.maxPages}.`, tips: ['Export only the floor plan page, plus the elevation pages if you have them.'] };
    case 'too-complex': return { code, title: 'This sheet is too large to read here', detail: 'The drawing holds a very large number of lines. That is usually a whole building or a site plan, which a laptop browser cannot read in reasonable time.', tips: ['Crop or export just one flat’s floor plan to its own page and upload that.'] };
    case 'picture-pdf': return { code, title: 'This PDF is a picture of a plan', detail: PICTURE_MESSAGE, tips: ['If you have the original drawing file, export a PDF from it.', 'A PDF with selectable text (try selecting a room name in a PDF viewer) works.'] };
    case 'blank': return { code, title: 'No drawing found on these pages', detail: 'The pages have no lines or text that make up a plan.', tips: ['Open the PDF in a viewer to check the plan shows.', 'Export the floor plan page again.'] };
    case 'not-a-plan': return { code, title: 'This PDF is not a floor plan', detail: 'It has text but no drawn lines, so there are no walls to read. It looks like a document, not a drawing.', tips: ['Upload the floor plan page saved from drawing software.', 'Try the sample plan to see what a good file looks like.'] };
    case 'no-rooms': return { code, title: 'We could not find rooms in this plan', detail: 'The file opened, but no walls closed into rooms we could name. It may be an elevation, a site plan or a furniture layout, or the room names may be drawn as pictures.', tips: ['Upload the page that shows the floor plan with walls and room names.', 'Make sure room names are typed text, not scanned or traced.', 'Try the sample plan to see what a good file looks like.'] };
    case 'several-flats': return { code, title: 'This sheet shows several flats', detail: `We found about ${info.flats ?? 'more than one'} flats on this sheet. Walkthru walks one flat at a time, so nothing was built.`, tips: ['Crop or export one flat’s plan to its own page and upload that.'] };
    case 'timeout': return { code, title: 'This is taking too long', detail: `Reading stopped after ${LIMITS.maxSeconds} seconds. The drawing is probably much more detailed than a single flat plan.`, tips: ['Export just one flat’s floor plan to its own page.', 'A plan with fewer drawn details reads faster.'] };
    case 'no-worker': return { code, title: 'This browser cannot read plans', detail: 'The reader needs a current browser (Chrome, Edge, Safari 15 or later, Firefox 114 or later).', tips: ['Open Walkthru in an up-to-date browser.'] };
    case 'failed': return { code, title: 'We could not read this plan', detail: info.detail ?? 'Something unexpected stopped the reader.', tips: ['Try exporting the plan to PDF again.', 'Try the sample plan to check this browser works.'] };
  }
}

// ---------------------------------------------------------------- before any long work: look at the first bytes

const startsWith = (b: Uint8Array, s: string, at = 0): boolean => { for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false; return true; };

/** What the first bytes say a file is. The name is a hint only: the content decides. */
export function sniff(head: Uint8Array): 'pdf' | 'image' | 'other' {
  // PDF 32000: the header may sit anywhere in the first 1024 bytes
  const text = new TextDecoder('latin1').decode(head.subarray(0, 1024));
  if (text.includes('%PDF-')) return 'pdf';
  if (startsWith(head, '\x89PNG') || (head[0] === 0xff && head[1] === 0xd8) || startsWith(head, 'GIF8') || startsWith(head, 'RIFF') && startsWith(head, 'WEBP', 8)
    || startsWith(head, 'ftyp', 4) || startsWith(head, 'BM') || startsWith(head, 'II*\0') || startsWith(head, 'MM\0*')) return 'image';
  return 'other';
}

/** Checks a chosen file by size and first bytes. Null means it may go on to the reader. */
export function preflightFile(file: { size: number; name?: string; type?: string }, head: Uint8Array): Problem | null {
  if (file.size === 0) return problem('empty');
  if (file.size > LIMITS.maxBytes) return problem('too-big', { size: file.size });
  const kind = sniff(head);
  if (kind === 'pdf') return null;
  if (kind === 'image' || /^image\//.test(file.type ?? '') || /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(file.name ?? '')) return problem('image-file');
  return problem('not-pdf');
}

// ---------------------------------------------------------------- after the PDF is open: the pages

/** The pages say the PDF is a scan or a picture, or holds nothing. */
export function preflightPages(pages: VectorPage[]): Problem | null {
  if (pages.length === 0) return problem('blank');
  if (pages.every((p) => isPictureOfPlan(p))) return problem('picture-pdf');
  const drawn = pages.some((p) => p.strokes.length + p.fills.length >= 20);
  if (!drawn) return problem(pages.some((p) => p.imageCoverage > 0.05) ? 'picture-pdf' : pages.some((p) => p.texts.length > 0) ? 'not-a-plan' : 'blank');
  return null;
}

/**
 * After the reader ran: nothing to walk, or a sheet of several flats. The flat splitter groups rooms that touch, and it also splits one big flat
 * (a 3 BHK with a gap between wings) into two, so a sheet is refused only on strong evidence: three or more groups, or two groups holding 14 or more rooms
 * between them. Anything weaker is a note in "What we could not read" and the rooms of every group are in the home.
 */
export function preflightRead(extras: Pick<ProposalExtras, 'units'>, roomCount: number): Problem | null {
  if (roomCount === 0) return problem('no-rooms');
  const units = extras.units ?? [];
  const inUnits = units.reduce((n, u) => n + u.roomIds.length, 0);
  if (units.length >= 3 || (units.length >= 2 && inUnits >= 14 && units.every((u) => u.roomIds.length >= 5))) return problem('several-flats', { flats: units.length });
  return null;
}

/** What went wrong in pdf.js, said plainly. */
export function problemFromError(e: unknown): Problem {
  const name = (e as { name?: string } | null)?.name ?? '';
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'PasswordException' || /password|encrypt/i.test(msg)) return problem('encrypted');
  if (code === 'too-many-pages') return problem('too-many-pages', { pages: Number(/has (\d+) pages/.exec(msg)?.[1]) || undefined });
  if (code === 'too-complex') return problem('too-complex');
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || /invalid pdf|not a pdf|xref|stream/i.test(msg)) return problem('unreadable');
  if (code === 'no-plan-page') return problem('no-rooms');
  if (code === 'raster-plan') return problem('picture-pdf');
  return problem('failed', { detail: msg.split('\n')[0].slice(0, 200) });
}
