import type { ImagePreset } from "../presetTypes";

import liveAction from "./live_action";
import luxuryProduct from "./luxury_product";
import pixar3d from "./pixar_3d";

export const STYLE_PRESETS: ImagePreset[] = [liveAction, luxuryProduct, pixar3d,];

// Seguridad: IDs únicos (para no romper selección / matching)
const _seen = new Set<string>();
for (const p of STYLE_PRESETS) {
  if (_seen.has(p.id)) throw new Error(`Duplicate STYLE_PRESETS id: ${p.id}`);
  _seen.add(p.id);
}
