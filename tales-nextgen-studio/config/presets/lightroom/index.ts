import type { ImagePreset } from "../presetTypes";

import goldenHour from "./golden_hour";
import blueHour from "./blue_hour";
import studioSoftbox from "./studio_softbox";
import dramaticRim from "./dramatic_rim";
import moodyLowKey from "./moody_low_key";
import highKeyBeauty from "./high_key_beauty";
import overcastSoft from "./overcast_soft";
import neonNight from "./neon_night";
import candlelight from "./candlelight";
import hardNoonSun from "./hard_noon_sun";

export const LIGHTING_PRESETS: ImagePreset[] = [
  goldenHour,
  blueHour,
  studioSoftbox,
  dramaticRim,
  moodyLowKey,
  highKeyBeauty,
  overcastSoft,
  neonNight,
  candlelight,
  hardNoonSun,
];

// Seguridad: IDs únicos
const _seen = new Set<string>();
for (const p of LIGHTING_PRESETS) {
  if (_seen.has(p.id)) throw new Error(`Duplicate LIGHTING_PRESETS id: ${p.id}`);
  _seen.add(p.id);
}
