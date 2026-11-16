// The clubhouse level of the Sample Tower, as measured on the amenity-level plan of a published builder brochure.
//
// THE ONLY DRAWN DIMENSION IS THE LAP POOL: the plan prints "25 M Lap Pool" and no other length. Every number below is a pixel position read off
// the plan's raster (4165 x 2125 px for the whole spread), and every size in metres is that pixel distance divided by a scale taken from the lap
// pool: its long edge, the one against the east planting strip, is 642 px for 25 m. So everything here is SCALED FROM THE DRAWING, NOT MEASURED:
// good to about one metre, and it carries the drawing's own distortion. Walls are taken at the centre of the drawn wall line. Nothing is
// invented from this file but the simplifications named in the comments (a diagonal kept, a notch squared, a tree-covered edge straightened).
//
// Numbers only (pixels): x east, y south on the page. The page's up is 15 degrees anticlockwise of true north: the north arrow leans to the right, so the
// plan's -z direction has the compass bearing NORTH_DEG below.
export const ANCHOR = { name: 'lap pool, long edge', printedM: 25, fromPx: 748, toPx: 1390 } as const;
/** pixels of the plan per metre */
export const PX_PER_M = (ANCHOR.toPx - ANCHOR.fromPx) / ANCHOR.printedM;
/** the plan's top-left corner of the pool wing is the frame's (0, 0) */
export const ORIGIN_PX = { x: 1150, y: 497 } as const;
export const NORTH_DEG = -15;

export type PxRect = readonly [x0: number, y0: number, x1: number, y1: number];
export type PxPoint = readonly [x: number, y: number];

/** page px to the level's frame, metres, to the centimetre (so two rooms that share a wall share its coordinates exactly) */
export const mx = (px: number): number => Math.round(((px - ORIGIN_PX.x) / PX_PER_M) * 100) / 100;
export const mz = (py: number): number => Math.round(((py - ORIGIN_PX.y) / PX_PER_M) * 100) / 100;
export const toM = (p: PxPoint): { x: number; z: number } => ({ x: mx(p[0]), z: mz(p[1]) });
export const lenM = (px: number): number => Math.round((px / PX_PER_M) * 100) / 100;

/** each indoor and outdoor space as the rectangles it is the union of (or the polygon, where the plan has a diagonal) */
export const SPACES_PX = {
  /** lift lobby, the passage round the lifts and the passage along the gym; the lifts and stairs are solid between the rectangles */
  foyer: [[2079, 1050, 2351, 1098], [2079, 1098, 2137, 1515], [2287, 1098, 2351, 1253], [2208, 1337, 2317, 1446], [1897, 1446, 2317, 1515]],
  games: [[2351, 1023, 2750, 1253]],
  /** the link passage east of the games area, and the pantry corner under it */
  link: [[2750, 1012, 3128, 1078], [2750, 1078, 2853, 1253]],
  gym: [[1908, 1515, 2317, 1758]],
  changing1: [[1910, 1262, 2079, 1333]],
  changing2: [[1910, 1333, 2079, 1429]],
  hall1: [[3128, 722, 3348, 935]],
  lounge: [[3128, 935, 3348, 1147]],
  /** its south-west corner is cut on the diagonal the plan draws (a glazed wall onto a planted slope): kept as drawn */
  hall2: [[2972, 1147], [3348, 1147], [3348, 1362], [3172, 1362]],
  deck: [[3348, 718, 3436, 1367]],
  /** the open deck court under the building and the aqua play area, with the planted slope east of it */
  aqua: [[2287, 1253, 2870, 1337], [2317, 1337, 2870, 1442], [2317, 1442, 2870, 1830], [2870, 1330, 3100, 1442]],
  /** the pool wing: the deck, the pools and the lawns, with the bridge to the building */
  wing: [[1150, 497], [1590, 497], [1590, 1420], [1897, 1420], [1897, 1480], [1590, 1480], [1590, 1619], [1277, 1619], [1277, 1065], [1150, 1065]],
} as const satisfies Record<string, readonly PxRect[] | readonly PxPoint[]>;

/** the water, as the plan draws it: one body of water read as three touching rectangles (the notches of the outline squared to a common line) */
export const WATER_PX = {
  /** item 2 */
  shallow: [1241, 599, 1432, 953],
  /** item 1: 25 m long (the anchor edge) */
  lap: [1432, 748, 1561, 1390],
  /** the lighter strip along the lap pool's west side, drawn paler */
  ledge: [1377, 1140, 1432, 1390],
  /** item 4, the shallow play pool */
  aqua: [2427, 1443, 2817, 1771],
} as const satisfies Record<string, PxRect>;

/** the lawn patches and planted strips of the wing (item 5 is the south patch) */
export const LAWN_PX = {
  /** item 5 */
  south: [1380, 1457, 1561, 1540],
} as const satisfies Record<string, PxRect>;

/** the lines the wing's decks, lawns and planting strips are laid to (pixels): the strips are the plan's planted edge, the rest are where a timber deck gives way to lawn */
export const WING_LINES_PX = {
  westInnerX: 1168, eastInnerX: 1572, eastX: 1590, northInnerY: 512, centreWestX: 1297, southWestBottomY: 1590, southStripBottomY: 1457, bridgeY: [1420, 1480], bridgeEndX: 1897,
  /** the planted strips along the edge: [x0, y0, x1, y1] */
  strips: { w1: [1150, 497, 1168, 1065], top: [1168, 497, 1590, 512], e1: [1572, 512, 1590, 1420], w2: [1277, 1065, 1295, 1619], s: [1295, 1601, 1590, 1619], e2: [1572, 1480, 1590, 1601] },
  centreLawnNotchY: 1065,
} as const;

/** the aqua-play area: timber court, the timber strip along the gym, the play features and the hedges */
export const AQUA_PX = {
  westStrip: [2317, 1442, 2427, 1830],
  slopeBed: [2870, 1330, 3100, 1442],
  towerAt: [2585, 1562], sunAt: [2556, 1655], mushroomAt: [2645, 1655], jetsAt: [2610, 1737],
  palms: [[2517, 1517], [2725, 1550]],
  chairsX: 2347, chairsY: [1510, 1580, 1647, 1715],
  southHedgeY: 1795, eastHedgeX: 2838,
} as const;

/** doors: the plan point of each doorway, and its width in metres where it is not an ordinary 1.0 m */
export const DOORS_PX = {
  foyerGym: [2060, 1515], foyerChanging1: [2079, 1298], foyerChanging2: [2079, 1381], foyerGames: [2351, 1175], foyerDeck: [2318, 1253],
  foyerBridge: [1897, 1462], foyerGround: [2079, 1200],
  gamesLink: [2750, 1045], linkLounge: [3128, 1043], linkDeck: [2800, 1253], linkStairs: [2853, 1170], foyerStairs: [2180, 1050],
  hall1Lounge: [3331, 935], loungeHall2: [3331, 1147],
  hall1Deck: [3348, 825], loungeDeck: [3348, 1038], hall2Deck: [3348, 1253],
} as const satisfies Record<string, PxPoint>;
export const LIFT_AT_PX = [2175, 2250] as const;

/** the furnishing the plan draws: the page position of each (an icon's centre) */
export const GAMES_PX = {
  cardTable: [2425, 1072], chessTable: [2403, 1222], foosball: [2470, 1123], carrom: [2551, 1118], tableTennis: [2650, 1078], pool: [2517, 1190], sofa: [2634, 1200], sofaTable: [2680, 1200],
} as const satisfies Record<string, PxPoint>;
export const GYM_PX = {
  treadmillX: 1917, treadmillY: [1543, 1729], treadmillCount: 6,
  bikesY: 1730, bikesX: [2040, 2150],
  machinesX: 2171, machinesY: [1565, 1610, 1646, 1688],
  matsX: [2232, 2257, 2281], matsY: [1608, 1662],
  benchAt: [2244, 1734], dumbbellAt: [2043, 1636],
} as const;
export const HALL1_TABLES_PX = [[3191, 769], [3245, 769], [3191, 828], [3245, 828], [3191, 887], [3245, 887]] as const;
export const LOUNGE_TABLES_PX = [[3185, 978], [3260, 978], [3185, 1105], [3260, 1105]] as const;
export const HALL2_TABLES_PX = [[3152, 1250], [3210, 1250], [3267, 1250], [3210, 1310], [3267, 1310]] as const;
export const WING_PX = {
  loungersTop: { y: 548, x: [1250, 1290, 1330, 1370, 1410] },
  loungersWest: { x: 1196, y0: 610, y1: 925, n: 10 },
  chairsX: 1325, chairsY: [1215, 1290, 1365, 1440, 1515, 1585],
  trees: [[1461, 545], [1531, 616], [1466, 689], [1406, 981], [1319, 1025], [1417, 1079], [1450, 1450], [1411, 1542], [1520, 1542]],
} as const;
