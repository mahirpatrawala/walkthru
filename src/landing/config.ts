// The landing page's few settings (the page at bare `/`). One place, so nothing else names a building or an address.

/** The building the landing page draws in its hero and opens from "Walk a sample project" (a folder of public/buildings). */
export const FEATURED_BUILDING_ID = 'sample-tower';

/** Where "Talk to us" goes: a `mailto:`, `https:` or `tel:` address. Empty (as now): no contact button is shown anywhere. */
export const CONTACT_URL = '';

/** The address a contact button may use, or '' when there is none or it is not one of the three kinds. Pure. */
export function contactHref(url: string = CONTACT_URL): string {
  const u = url.trim();
  return /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+|tel:\+?[0-9 ()-]{6,})$/i.test(u) ? u : '';
}
