// Owned by C11c. Pure text helpers of the painting (no DOM), so they can be tested under Node.

/** "A painting of {title}. Illustrative." (SPEC 16.7). The title is text from property.json, shown as is. */
export function captionFor(title: string): string {
  const t = title.trim().replace(/[.\s]+$/, '');
  return t ? `A painting of ${t}. Illustrative.` : 'A painting of this home. Illustrative.';
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'home';
}
