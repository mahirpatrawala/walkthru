// Which addresses show the landing page: the bare `/` only. Any parameter the app reads (a home, a building, a view, a sales-room
// setting) keeps the page it always opened. Links passed round in chat apps and social sites pick up tracking tags; those are not
// ours and do not change the page. Pure.

const SHARE_TAG = /^(utm_[a-z_]+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|li_fat_id|ref|ref_src|ref_url|source)$/i;

/** `search` is `location.search` ("" or "?a=b"). */
export function isLandingAddress(search: string): boolean {
  for (const key of new URLSearchParams(search).keys()) if (!SHARE_TAG.test(key)) return false;
  return true;
}
