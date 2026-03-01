import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { prettyVideoModelLabel } from "../../../services/videoModels";
import { Icon } from "./icon";

function isObj(v: any) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function asBool(v: any): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function asStr(v: any): string | null {
  if (typeof v === "string") return v;
  return null;
}

function asNum(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function prettyEditKind(kind: string | null) {
  if (!kind) return { name: "—", desc: "" };

  if (kind === "reference-to-video") {
    return {
      name: "Imagen/Referencias → Video",
      desc: "Crea un video desde una imagen START (y opcional END) + referencias para consistencia.",
    };
  }

  if (kind === "video-to-video/edit") {
    return {
      name: "Editar Video",
      desc: "Edita un video existente guiado por tu prompt (cambios controlados).",
    };
  }

  if (kind === "video-to-video/reference") {
    return {
      name: "Video → Video con Referencias",
      desc: "Nueva versión del video base guiada por referencias (identidad/estilo) + continuidad de movimiento.",
    };
  }

  return { name: kind, desc: "" };
}

function getThumbUrlFromElement(el: any): string | null {
  if (!el) return null;
  if (typeof el.previewUrl === "string" && el.previewUrl) return el.previewUrl;
  if (Array.isArray(el.imageUrls) && typeof el.imageUrls[0] === "string") return el.imageUrls[0];
  return null;
}

export function ViewerModal({
  viewer,
  viewerRecipeInfo,
  onClose,
  onCopyPrompt,
  onReusePrompt,
  onTogglePublish,
  onDownload,
  onDelete,
}: {
  viewer: Asset | null;
  viewerRecipeInfo: any;
  onClose: () => void;
  onCopyPrompt: (a: Asset) => void;
  onReusePrompt: (a: Asset) => void;
  onTogglePublish: (a: Asset) => void;
  onDownload: (a: Asset) => void;
  onDelete: (a: Asset) => void;
}) {
  if (!viewer) return null;

  const meta: any = (viewer as any).meta || {};
  const recipe: any = viewerRecipeInfo || {};

  const modelId = asStr(recipe?.modelId) || asStr(meta?.model) || null;
  const aspectRatio = asStr(recipe?.aspectRatio) || asStr(meta?.aspectRatio) || "—";
  const resolution = asStr(recipe?.resolution) || asStr(meta?.resolution) || "—";
  const durationSeconds = asNum(recipe?.durationSeconds) ?? asNum(meta?.durationSeconds);

  const first = recipe?.first || null;
  const last = recipe?.last || null;

  const editRaw = isObj(recipe?.editVideo) ? recipe.editVideo : isObj(meta?.editVideo) ? meta.editVideo : null;
  const edit = editRaw && isObj(editRaw) ? editRaw : null;

  const isVideoEdit = Boolean(edit) || meta?.tool === "video-edit";

  const frameTitle = isVideoEdit ? "START / END" : "Frames";
  const firstTag = isVideoEdit ? "START" : "FIRST";
  const lastTag = isVideoEdit ? "END" : "LAST";
  const firstEmpty = isVideoEdit ? "No START" : "No FIRST";

  const editKind = asStr(edit?.kind);
  const editKindPretty = prettyEditKind(editKind);

  const keepAudio = asBool(edit?.keepAudio);
  const generateAudio = asBool(edit?.generateAudio);

  const refImages = Array.isArray(edit?.referenceImages) ? edit.referenceImages : null;
  const refImageIds = Array.isArray(edit?.referenceImageAssetIds) ? edit.referenceImageAssetIds : null;

  const elements = Array.isArray(edit?.elements) ? edit.elements : null;
  const elementIds = Array.isArray(edit?.klingElementIds) ? edit.klingElementIds : null;

  const inputVideo = isObj(edit?.inputVideo) ? edit.inputVideo : null;
  const startImage = isObj(edit?.startImage) ? edit.startImage : null;
  const endImage = isObj(edit?.endImage) ? edit.endImage : null;

  const multiPrompt = Array.isArray(edit?.multiPrompt) ? edit.multiPrompt : null;

  const totalRefs =
    (Array.isArray(refImages) ? refImages.length : Array.isArray(refImageIds) ? refImageIds.length : 0) +
    (Array.isArray(elements) ? elements.length : Array.isArray(elementIds) ? elementIds.length : 0);

  const storyText =
    multiPrompt && multiPrompt.length > 0
      ? multiPrompt
          .map((s: any, i: number) => {
            const p = String(s?.prompt || "").trim();
            const d =
              s?.duration != null
                ? String(s.duration)
                : s?.durationSeconds != null
                  ? String(s.durationSeconds)
                  : "?";
            return `[SHOT ${i + 1} · ${d}s] ${p}`;
          })
          .join("\n")
      : null;

  return (
    <div className={styles.viewerBackdrop} onClick={onClose}>
      <div className={styles.viewer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.viewerTop}>
          <div className={styles.viewerTitle}>
            <span className={styles.viewerKicker}>GENERATION</span>
            <span className={styles.viewerSub}>{viewer.isPublic ? "PUBLIC" : "PRIVATE"}</span>
          </div>

          <div className={styles.viewerTopActions}>
            <button className={styles.iconBtn} type="button" title="Copiar prompt" onClick={() => onCopyPrompt(viewer)}>
              <Icon name="copy" />
            </button>

            <button className={styles.iconBtn} type="button" title="Reusar prompt" onClick={() => onReusePrompt(viewer)}>
              <Icon name="reuse" />
            </button>

            <button
              className={styles.iconBtn}
              type="button"
              title="Vender / Administrar listing"
              onClick={() => onTogglePublish(viewer)}
            >
              <Icon name="share" />
            </button>

            <button className={styles.iconBtn} type="button" title="Descargar" onClick={() => onDownload(viewer)}>
              <Icon name="download" />
            </button>

            <button className={styles.iconBtnDanger} type="button" title="Eliminar" onClick={() => onDelete(viewer)}>
              <Icon name="trash" />
            </button>

            <button className={styles.closeBtn} type="button" onClick={onClose} title="Cerrar">
              <Icon name="close" />
            </button>
          </div>
        </div>

        <div className={styles.viewerBody}>
          <div className={styles.viewerVideoWrap}>
            <video className={styles.viewerVideo} src={viewer.url} controls autoPlay loop playsInline />
          </div>

          <div className={styles.viewerRecipe}>
            <div className={styles.viewerRecipeTitle}>RECIPE</div>

            <div className={styles.recipeGrid}>
              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Model</div>
                <div className={styles.recipeValue}>{prettyVideoModelLabel(modelId)}</div>
              </div>

              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Aspect</div>
                <div className={styles.recipeValue}>{aspectRatio || "—"}</div>
              </div>

              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Resolution</div>
                <div className={styles.recipeValue}>{resolution || "—"}</div>
              </div>

              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Duration</div>
                <div className={styles.recipeValue}>{durationSeconds != null ? `${durationSeconds}s` : "—"}</div>
              </div>

              {(recipe?.klingMode || recipe?.klingShotType || recipe?.klingSound != null) && (
                <div className={styles.recipeItemWide}>
                  <div className={styles.recipeLabel}>Kling</div>
                  <div className={styles.recipeValue}>
                    {recipe?.klingMode ? `mode: ${recipe.klingMode}` : ""}
                    {recipe?.klingShotType ? ` • shot: ${recipe.klingShotType}` : ""}
                    {recipe?.klingSound != null ? ` • sound: ${recipe.klingSound ? "on" : "off"}` : ""}
                  </div>
                </div>
              )}

              {edit && (
                <div className={styles.recipeItemWide}>
                  <div className={styles.recipeLabel}>Edit Mode</div>
                  <div className={styles.recipeValue}>
                    <b>{editKindPretty.name}</b>
                    {editKindPretty.desc ? ` — ${editKindPretty.desc}` : ""}
                    <div style={{ marginTop: 8, opacity: 0.92 }}>
                      kind: <b>{editKind || "—"}</b> • refs: <b>{totalRefs}</b>/4
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.recipeRefs}>
              <div className={styles.recipeLabel}>{frameTitle}</div>
              <div className={styles.recipeRefStrip}>
                {first ? (
                  <div className={styles.recipeRefThumb} title={firstTag}>
                    <img src={first.url} alt={firstTag} />
                    <span className={styles.recipeRefTag}>{firstTag}</span>
                  </div>
                ) : (
                  <div className={styles.recipeEmpty}>{firstEmpty}</div>
                )}

                {last ? (
                  <div className={styles.recipeRefThumb} title={lastTag}>
                    <img src={last.url} alt={lastTag} />
                    <span className={styles.recipeRefTag}>{lastTag}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {edit && (
              <>
                <div className={styles.recipeRefs}>
                  <div className={styles.recipeLabel}>Inputs</div>
                  <div className={styles.recipeRefStrip}>
                    {inputVideo?.url ? (
                      <div className={styles.recipeRefThumb} title="INPUT VIDEO">
                        <video
                          src={inputVideo.url}
                          muted
                          playsInline
                          loop
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                        <span className={styles.recipeRefTag}>INPUT</span>
                      </div>
                    ) : edit?.videoAssetId ? (
                      <div className={styles.recipeEmpty}>Video asset: {String(edit.videoAssetId)}</div>
                    ) : (
                      <div className={styles.recipeEmpty}>No input video</div>
                    )}

                    {startImage?.url ? (
                      <div className={styles.recipeRefThumb} title="START">
                        <img src={startImage.url} alt="START" />
                        <span className={styles.recipeRefTag}>START</span>
                      </div>
                    ) : null}

                    {endImage?.url ? (
                      <div className={styles.recipeRefThumb} title="END">
                        <img src={endImage.url} alt="END" />
                        <span className={styles.recipeRefTag}>END</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.recipeRefs}>
                  <div className={styles.recipeLabel}>References</div>
                  <div className={styles.recipeRefStrip}>
                    {refImages && refImages.length > 0
                      ? refImages.map((a: any) => (
                          <div key={a.id} className={styles.recipeRefThumb} title={String(a.name || a.id)}>
                            <img src={a.url} alt={String(a.name || a.id)} />
                            <span className={styles.recipeRefTag}>REF</span>
                          </div>
                        ))
                      : null}


                    {!refImages && refImageIds && refImageIds.length > 0 ? (
                      <div className={styles.recipeEmpty}>Image refs (ids): {refImageIds.map(String).join(", ")}</div>
                    ) : null}


                    {(!refImages || refImages.length === 0) &&
                    (!elements || elements.length === 0) &&
                    (!refImageIds || refImageIds.length === 0) &&
                    (!elementIds || elementIds.length === 0) ? (
                      <div className={styles.recipeEmpty}>No references</div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.recipeGrid}>
                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Keep audio</div>
                    <div className={styles.recipeValue}>{keepAudio == null ? "—" : keepAudio ? "yes" : "no"}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Generate audio</div>
                    <div className={styles.recipeValue}>
                      {generateAudio == null ? "—" : generateAudio ? "on" : "off"}
                    </div>
                  </div>
                </div>

                {storyText ? (
                  <div className={styles.recipeBlock}>
                    <div className={styles.recipeLabel}>Storyboard</div>
                    <div className={styles.recipeValue} style={{ whiteSpace: "pre-wrap" }}>
                      {storyText}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            <div className={styles.recipeBlock}>
              <div className={styles.recipeLabel}>Prompt</div>
              <div className={styles.recipeValue} style={{ whiteSpace: "pre-wrap" }}>
                {viewer.prompt || "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
