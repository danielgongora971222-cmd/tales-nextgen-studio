import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { prettyVideoModelLabel } from "../../../services/videoModels";
import { Icon } from "./icon";

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
              title={viewer.isPublic ? "Quitar de público" : "Publicar"}
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
                <div className={styles.recipeValue}>{prettyVideoModelLabel(viewerRecipeInfo?.modelId || null)}</div>
              </div>

              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Aspect</div>
                <div className={styles.recipeValue}>{viewerRecipeInfo?.aspectRatio || "—"}</div>
              </div>

              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Resolution</div>
                <div className={styles.recipeValue}>{viewerRecipeInfo?.resolution || "—"}</div>
              </div>

              <div className={styles.recipeItem}>
                <div className={styles.recipeLabel}>Duration</div>
                <div className={styles.recipeValue}>
                  {viewerRecipeInfo?.durationSeconds != null ? `${viewerRecipeInfo.durationSeconds}s` : "—"}
                </div>
              </div>

              {(viewerRecipeInfo?.klingMode || viewerRecipeInfo?.klingShotType) && (
                <div className={styles.recipeItemWide}>
                  <div className={styles.recipeLabel}>Kling</div>
                  <div className={styles.recipeValue}>
                    {viewerRecipeInfo.klingMode ? `mode: ${viewerRecipeInfo.klingMode}` : ""}
                    {viewerRecipeInfo.klingShotType ? ` • shot: ${viewerRecipeInfo.klingShotType}` : ""}
                    {viewerRecipeInfo.klingSound != null ? ` • sound: ${viewerRecipeInfo.klingSound ? "on" : "off"}` : ""}
                  </div>
                </div>
              )}
            </div>

            <div className={styles.recipeRefs}>
              <div className={styles.recipeLabel}>Frames</div>
              <div className={styles.recipeRefStrip}>
                {viewerRecipeInfo?.first ? (
                  <div className={styles.recipeRefThumb} title="FIRST">
                    <img src={viewerRecipeInfo.first.url} alt="FIRST" />
                    <span className={styles.recipeRefTag}>FIRST</span>
                  </div>
                ) : (
                  <div className={styles.recipeEmpty}>No FIRST</div>
                )}

                {viewerRecipeInfo?.last ? (
                  <div className={styles.recipeRefThumb} title="LAST">
                    <img src={viewerRecipeInfo.last.url} alt="LAST" />
                    <span className={styles.recipeRefTag}>LAST</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.recipeBlock}>
              <div className={styles.recipeLabel}>Prompt</div>
              <div className={styles.recipeValue}>{viewer.prompt || "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
