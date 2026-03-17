import type { ImagePreset } from "../presetTypes";

import acrylicNeoExpressionist from "./acrylic_neo_expressionist";
import baroqueImpastoOilDrama from "./baroque_impasto_oil_drama";
import bronzeMonument from "./bronze_monument";
import cardboard from "./cardboard";
import ceramicMosaic from "./ceramic_mosaic";
import claymationMaquette from "./claymation_maquette";
import crackedFresco from "./cracked_fresco";
import crazyPencil from "./crazy_pencil";
import expressionistPaletteKnife from "./expressionist_palette_knife";
import feltPuppet from "./felt_puppet";
import foldPaper from "./fold_paper";
import gouachePoster from "./gouache_poster";
import grafito from "./grafito";
import inkCyclone from "./ink_cyclone";
import liveAction from "./live_action";
import noirIlustrator from "./noir_ilustrator";
import patchwork from "./patchwork";
import pixar3d from "./pixar_3d";
import popArt from "./pop_art";
import popEditorial from "./pop_editorial";
import ruggedPaper from "./rugged_paper";
import waxCrayon from "./wax_crayon";

export const STYLE_PRESETS: ImagePreset[] = [
  acrylicNeoExpressionist,
  baroqueImpastoOilDrama,
  bronzeMonument,
  cardboard,
  ceramicMosaic,
  claymationMaquette,
  crackedFresco,
  crazyPencil,
  expressionistPaletteKnife,
  feltPuppet,
  foldPaper,
  gouachePoster,
  grafito,
  inkCyclone,
  liveAction,
  noirIlustrator,
  patchwork,
  pixar3d,
  popArt,
  popEditorial,
  ruggedPaper,
  waxCrayon,
];

const _seen = new Set<string>();
for (const p of STYLE_PRESETS) {
  if (_seen.has(p.id)) throw new Error(`Duplicate STYLE_PRESETS id: ${p.id}`);
  _seen.add(p.id);
}
