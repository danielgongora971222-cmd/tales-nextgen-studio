import type { ImagePreset } from "../presetTypes";

import backLight from "./back_light";
import bourdinCandy from "./bourdin_candy";
import candlelitBaroque from "./candlelit_baroque";
import coldWarm from "./cold_warm";
import darkFrozen from "./dark_frozen";
import desertCopper from "./desert_copper";
import dustyBeams from "./dusty_beams";
import electricYouth from "./electric_youth";
import flashback from "./flashback";
import glacialCyan from "./glacial_cyan";
import lightBeam from "./light_beam";
import magentaMist from "./magenta_mist";
import midnightFlash from "./midnight_flash";
import mtvCosmic from "./mtv_cosmic";
import noirStudio from "./noir_studio";
import pearlBeauty from "./pearl_beauty";
import polaroidLavender from "./polaroid_lavender";
import roseFog from "./rose_fog";
import sodiumVapor from "./sodium_vapor";
import supermodelSilver from "./supermodel_silver";
import tealSunsetHalation from "./teal_sunset_halation";
import titaniumDrama from "./titanium_drama";
import tropicGlam from "./tropic_glam";
import vhs from "./vhs";
import violetCyan from "./violet_cyan";
import vitral from "./vitral";

export const LIGHTING_PRESETS: ImagePreset[] = [
  backLight,
  bourdinCandy,
  candlelitBaroque,
  coldWarm,
  darkFrozen,
  desertCopper,
  dustyBeams,
  electricYouth,
  flashback,
  glacialCyan,
  lightBeam,
  magentaMist,
  midnightFlash,
  mtvCosmic,
  noirStudio,
  pearlBeauty,
  polaroidLavender,
  roseFog,
  sodiumVapor,
  supermodelSilver,
  tealSunsetHalation,
  titaniumDrama,
  tropicGlam,
  vhs,
  violetCyan,
  vitral,
];

const _seen = new Set<string>();
for (const p of LIGHTING_PRESETS) {
  if (_seen.has(p.id)) throw new Error(`Duplicate LIGHTING_PRESETS id: ${p.id}`);
  _seen.add(p.id);
}
