// The one script index.html loads. It decides between the start page (a gallery of homes and buildings, no three.js), the walk of one home
// (`?scene=<id>`, which pulls in three.js and the rest as a lazy chunk) and the walk of a building (`?building=<id>&space=<id>`, the same
// chunk plus the building's portals). `?building=<id>` alone is the building's map page, part of the start page.
// Keep this file tiny and free of heavy imports.
const q = new URLSearchParams(location.search);
const scene = q.get('scene')?.trim();
const building = q.get('building')?.trim();
if (scene) void import('./main');
else if (building && q.get('space')?.trim()) void import('../building/walk').then((m) => m.startBuildingWalk());
else void import('../start/start').then((m) => m.mountStart());
