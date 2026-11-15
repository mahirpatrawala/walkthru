// The words an uploaded home carries everywhere it is shown. Its own tiny file (no imports) so the buyer page and the start page can use it
// without loading the reader.
export const UPLOAD_TAG = 'Read automatically from your upload · not checked by a person';
export const SAMPLE_UPLOAD_TAG = 'Made-up sample plan · read automatically in your browser · not checked by a person';
/** After the visitor confirmed or corrected some values themselves in "Check the drawing". */
export const uploadTag = (checkedByYou: number): string => `Read automatically from your upload · ${checkedByYou} value${checkedByYou === 1 ? '' : 's'} checked by you`;
export const isLocalHomeId = (id: string): boolean => /^local-[a-z0-9]{6,32}$/.test(id);
