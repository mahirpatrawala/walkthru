// The flats' downloaded models (SPEC 16.15.4): free CC BY 4.0 models from the Objaverse archive of Sketchfab, credited by name (the buyer page's
// "3D model credits" lists them from public/look/home/home.lock.json; an item card that shows one says whose it is). Each is used only where
// the honest-sizing rule of fit.ts lets it stand in the drawn box; otherwise the generated piece stays. Sizes come from the home, never from here.
import type { LibModel } from './library';

/** furniture of the flats, tried after the CC0 ones (fit.ts picks the closest fit among those a pack allows) */
export const HOME_FURNITURE: LibModel[] = [
  {
    // the source's own map (grey back, oatmeal seat) is kept as weave and seams under the style's fabric colour; the legs are cut off it by height
    id: 'sofa_3s_midcentury', label: '3-seat sofa', family: 'sofa', use: 'whole', credit: '"Mid Century Modern Sofa" by Tom Seddon, CC BY 4.0',
    parts: { fabric: { role: ['fabric', 'accent'] }, legs: { role: ['legs', 'case', 'handle'] } },
  },
  {
    id: 'sofa_2s_grey', label: '2-seat sofa', family: 'sofa', use: 'whole', credit: '"Sofa" by katjagricishina, CC BY 4.0',
    parts: { fabric: { role: ['fabric', 'accent'] }, legs: { role: ['legs', 'case', 'handle'] } },
  },
  {
    // a tweed tub chair: the weave kept under the style's fabric colour, the legs cut off it by height
    id: 'armchair_tub', label: 'Upholstered armchair', family: 'sofa', use: 'whole', credit: '"Arm chair / Furniture" by maxsbond.work, CC BY 4.0',
    parts: { fabric: { role: ['fabric', 'accent'] }, legs: { role: ['legs', 'case', 'handle'] } },
  },
  {
    // the base and headboard of a bed; the generated mattress, flat quilt and pillows of SPEC 16.23 go on its deck. It is upholstered: it wears the
    // first fabric among its roles (a pack's oak headboard is for the generator's slatted one) in the kit's linen weave
    id: 'bed_frame_soho', label: 'Upholstered bed', family: 'bed', use: 'frame', credit: '"Soho bed - 3D Model" by BertO, CC BY 4.0',
    parts: { frame: { role: ['headboard', 'bedFrame', 'fabric', 'accent'], fabric: true } },
  },
  {
    id: 'wc_floor', label: 'Close-coupled commode', family: 'bath', use: 'whole', variants: ['wc-floor'], credit: '"Toilet" by Urpo, CC BY 4.0',
    // the source's own lid, turned down onto the seat (tools/optimise-home-models.mjs `close`)
    parts: { pan: {}, seat: {}, lid: {} },
  },
  {
    // hung on the wall: the top of the tap at the box's top, the rim at the drawn rim height
    id: 'basin_wall', label: 'Wall-hung basin', family: 'bath', use: 'whole', mount: 'top', variants: ['basin-wall'], credit: '"Unseen: Bathroom Sink" by JmCVoyager, CC BY 4.0',
    parts: { bowl: {}, tap: {}, trap: {} },
  },
];

/** lived-in decor: scaled to the planner's footprint (never part of a measurement) */
export const HOME_DECOR: LibModel[] = [
  { id: 'hob_4_glass', label: 'Glass-top gas hob', family: 'hob', use: 'decor', decorFit: 'footprint', credit: '"Gas Stove No.1" by lutz_westerfeld, CC BY 4.0', parts: { glass: {}, trim: {}, grates: {} } },
  { id: 'hood_chimney', label: 'Chimney hood', family: 'hood', use: 'decor', decorFit: 'width', stretch: ['flue'], credit: '"Range Hood (Kitchen Hood)" by govindu94, CC BY 4.0', parts: { canopy: {}, flue: {}, lights: {}, 'lights-2': {} } },
];
