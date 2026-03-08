import { GOOGLE_IMAGE_MODELS } from "../../config/imageGenerationShared.js";

export const FACESWAP_ANALYSIS_MODEL = GOOGLE_IMAGE_MODELS.NANO_BANANA_2;
export const FACESWAP_INSERT_MODEL = GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO;
export const FACESWAP_ANALYSIS_STAGES = ["depth", "canny", "openpose"];

export function faceswapQualityHint(q) {
  if (q === "1K") return "high quality, clean, sharp";
  if (q === "2K") return "very high quality, ultra-detailed, crisp";
  if (q === "4K") return "ultra high quality, 4k, hyper-detailed, razor sharp";
  return "";
}

export function getFaceswapStageLabel(kind) {
  switch (kind) {
    case "depth":
      return "Depth";
    case "canny":
      return "Canny";
    case "openpose":
      return "OpenPose";
    default:
      return String(kind || "Stage");
  }
}

function regionDirective(swapType) {
  switch (swapType) {
    case "face":
      return "Selected region = face only. Keep hair, neck, body, clothing, accessories and background unchanged.";
    case "face_hair":
      return "Selected region = full head (face + hair). Keep neck, body, clothing, accessories and background unchanged.";
    case "body":
      return "Selected region = visible anatomy (face + hair + skin/body) while keeping clothing and accessories unchanged.";
    case "clothes_only":
      return "Selected region = garments/clothing only. Keep the person's face, hair, skin, physique, hands and pose unchanged.";
    case "body_clothes":
    default:
      return "Selected region = full visible subject (face + hair + body + clothing) while preserving overall framing, camera and scene.";
  }
}

function stageDirective(kind) {
  switch (kind) {
    case "depth":
      return [
        "Render the selected region as a clean grayscale depth map guide.",
        "Nearer surfaces must be lighter and farther surfaces darker.",
        "Preserve exact geometry, silhouette, perspective, pose and occlusion of the target region.",
        "Do not stylize, beautify, repaint or hallucinate donor identity.",
      ].join(" ");
    case "canny":
      return [
        "Render the selected region as a precise canny-style contour guide.",
        "Use thin, readable structural edges that describe boundaries, major facial features, garment seams and pose-critical contours.",
        "Keep the line placement aligned exactly to the target region geometry.",
        "Do not invent extra shapes, textures or donor identity.",
      ].join(" ");
    case "openpose":
      return [
        "Render the selected region as an openpose-style pose/alignment guide.",
        "Show only the essential pose skeleton / facial landmark guidance needed to reconstruct the same pose and placement.",
        "Keep the guide locked to the exact target position, scale and orientation.",
        "Do not change composition or invent anatomy not visible in the target.",
      ].join(" ");
    default:
      return "Render the selected region as a control guide while preserving exact alignment to the target image.";
  }
}

export function buildFaceswapAnalysisPrompt({ swapType, analysisKind, quality }) {
  const qHint = faceswapQualityHint(quality);
  return [
    "You are generating a TECHNICAL CONTROL IMAGE for a face/body swap pipeline.",
    "IMAGE 1 is the original target photo and defines the final framing, crop, perspective, lighting and scene.",
    regionDirective(swapType),
    stageDirective(analysisKind),
    "CRITICAL MARK RULE:",
    "- Preserve wounds, dirt, scars, blood, bruises, makeup smears, stains or distinct marks ONLY if they already exist in the selected target region.",
    "- If the selected target region is clean, the control image must stay clean. NEVER invent injuries, grime, blood, scars, redness, scratches or random marks.",
    "GLOBAL HARD RULES:",
    "- Keep exact canvas size, crop and composition from IMAGE 1.",
    "- Keep unselected areas visually aligned with IMAGE 1 so the control image can be used as a spatial guide.",
    "- Output exactly one image. No text, no labels, no collage, no watermark, no UI.",
    qHint ? `QUALITY: ${qHint}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function insertModeDirective(swapType) {
  switch (swapType) {
    case "face":
      return [
        "Replace only the face region with the donor identity.",
        "Keep the target hair, head silhouette, hairline integration, neck, clothing, accessories and background exactly as defined by the target guides.",
        "Match facial size to the target skull exactly. No big head, no tiny head.",
      ].join(" ");
    case "face_hair":
      return [
        "Replace the full head region (face + hair) with the donor head.",
        "Keep neck thickness, alignment, pose, camera and scene exactly as defined by the target guides.",
        "Match head size and placement perfectly.",
      ].join(" ");
    case "body":
      return [
        "Replace visible anatomy (face + hair + skin/body) with the donor anatomy.",
        "Keep clothing and accessories from the target exactly unchanged.",
        "Match pose, body scale and occlusion exactly.",
      ].join(" ");
    case "clothes_only":
      return [
        "Replace only the clothing/garment region with the donor outfit.",
        "Keep the target person's identity, face, hair, skin, body shape, hands and pose exactly unchanged.",
        "Match garment drape, folds and fit to the target pose.",
      ].join(" ");
    case "body_clothes":
    default:
      return [
        "Replace the full selected subject region with the donor person and donor clothing.",
        "Preserve target framing, pose, camera and scene exactly.",
        "Do not create explicit nudity. If needed, use a neutral seamless base-layer under garments.",
      ].join(" ");
  }
}

export function buildFaceswapInsertPrompt({ swapType, quality, sizeRule }) {
  const qHint = faceswapQualityHint(quality);
  return [
    "You are a senior photo-realistic VFX compositor.",
    "Reference tags:",
    "- @depth = target structural depth guide extracted from the ORIGINAL target zone.",
    "- @canny = target contour guide extracted from the ORIGINAL target zone.",
    "- @openpose = target pose/alignment guide extracted from the ORIGINAL target zone.",
    "- @element = donor appearance reference to insert.",
    "GOAL:",
    "- Reconstruct the final image using the exact placement jointly defined by @depth, @canny and @openpose.",
    "- Insert the requested region from @element into that exact target region.",
    "- Preserve framing, crop, perspective, lens feel, lighting and composition from the target guides.",
    sizeRule || "Keep exact size and aspect ratio from the target guides.",
    insertModeDirective(swapType),
    "CRITICAL MARK RULE:",
    "- Preserve target-specific wounds, dirt, scars, bruises, blood, stains or unique marks ONLY if they are present in the target guides.",
    "- If the target guides are clean, the final output must stay clean. NEVER invent injuries, grime, blood, scratches, scars, bruises, redness or random marks.",
    "GLOBAL HARD RULES:",
    "- Use @element for identity / head / body / clothing only; never import donor background, donor composition or donor camera.",
    "- Match size and alignment exactly to the target guides. No disproportion, no floating garments, no warped face.",
    "- Output exactly one image. No collage, no text, no watermark, no UI.",
    "- There must be zero mannequin / placeholder / plastic surface left in the final output.",
    qHint ? `QUALITY: ${qHint}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}