import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { Icon } from "./icon";
import type { KlingShotType } from "../../../services/videoModels/types";
import {
  DEFAULT_VIDEO_MODEL,
  KLING_2_5_TURBO,
  KLING_2_6,
  KLING_V3,
  KLING_O3_PRO,
  VEO_3,
  VEO_3_FAST,
  VEO_3_1,
  VEO_3_1_FAST,
} from "../../../services/videoModels";

export type PanelKey = "frames" | "model" | "parameters" | "duration" | null;

type Capability = {
  supportsAspectRatio: boolean;
  supportsAspectRatio1x1: boolean;
  supportsResolution: boolean;
  supportsSound: boolean;
};

type Props = {
  panel: PanelKey;
  setPanel: React.Dispatch<React.SetStateAction<PanelKey>>;
  popoverRef: React.RefObject<HTMLDivElement>;

  model: string;
  setModel: (m: string) => void;
  veoIsFast: boolean;

  capability: Capability;
  hasFirst: boolean;

  aspectRatio: string;
  setAspectRatio: (v: any) => void;

  supportedResolutions: readonly string[];
  resolution: string;
  setResolution: (v: any) => void;

  count: number;
  setCount: (v: any) => void;

  isKling: boolean;
  isKlingV3: boolean;

  klingMode: "std" | "pro";
  setKlingMode: (v: any) => void;

  klingSound: boolean;
  setKlingSound: (v: any) => void;
  setKlingSoundTouched: (v: any) => void;

  klingShotType: KlingShotType;
  setKlingShotType: React.Dispatch<React.SetStateAction<KlingShotType>>;

  negativePrompt: string;
  setNegativePrompt: (v: any) => void;

  klingCfgScale: number;
  setKlingCfgScale: (v: any) => void;

  klingVoiceIdsText: string;
  setKlingVoiceIdsText: (v: any) => void;

  multishotEnabled: boolean;
  multishotTotalSeconds: number;
  setMultishotOpen: (v: any) => void;

  allowedDurations: readonly number[];
  durationSeconds: number;
  setDurationSeconds: (v: any) => void;

  inline?: boolean;
  onClose?: () => void;
};

export function ControlsPopover({
  panel,
  setPanel,
  popoverRef,
  model,
  setModel,
  veoIsFast,
  capability,
  hasFirst,
  aspectRatio,
  setAspectRatio,
  supportedResolutions,
  resolution,
  setResolution,
  count,
  setCount,
  isKling,
  isKlingV3,
  klingMode,
  setKlingMode,
  klingSound,
  setKlingSound,
  setKlingSoundTouched,
  klingShotType,
  setKlingShotType,
  negativePrompt,
  setNegativePrompt,
  klingCfgScale,
  setKlingCfgScale,
  klingVoiceIdsText,
  setKlingVoiceIdsText,
  multishotEnabled,
  multishotTotalSeconds,
  setMultishotOpen,
  allowedDurations,
  durationSeconds,
  setDurationSeconds,
  inline = false,
  onClose,
}: Props) {
  if (!panel || panel === "frames") return null;

  const close = onClose || (() => setPanel(null));

  const isKlingV2 = model === KLING_2_5_TURBO || model === KLING_2_6;
  const isKlingO3 = model === KLING_O3_PRO;
  const isKlingV3Model = model === KLING_V3;

  return (
    <div ref={popoverRef} className={`${styles.popover} ${inline ? styles.cookInlinePopover : ""}`}>
      <div className={styles.popoverInner}>
        <div className={styles.popoverHeader}>
          <div className={styles.popoverTitle}>
            {panel === "model" ? "Model" : panel === "parameters" ? "Parameters" : "Duration"}
          </div>
          <button className={styles.closeBtn} onClick={close} type="button" title="Cerrar">
            <Icon name="close" />
          </button>
        </div>

        {/* MODEL */}
        {panel === "model" && (
          <div className={styles.modelGrid}>
            <button
              type="button"
              className={`${styles.modelOption} ${model === VEO_3 || model === VEO_3_FAST ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(veoIsFast ? VEO_3_FAST : VEO_3);
                close();
              }}
            >
              <div className={styles.modelName}>Veo 3</div>
              <div className={styles.modelDesc}>8s fijo · velocidad en "Veo: Quality/Fast"</div>
            </button>

            <button
              type="button"
              className={`${styles.modelOption} ${model === VEO_3_1 || model === VEO_3_1_FAST ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(veoIsFast ? VEO_3_1_FAST : VEO_3_1);
                close();
              }}
            >
              <div className={styles.modelName}>Veo 3.1</div>
              <div className={styles.modelDesc}>4/6/8s (según resolución y frames) · velocidad en "Veo: Quality/Fast"</div>
            </button>

            <button
              type="button"
              className={`${styles.modelOption} ${model === KLING_2_5_TURBO ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(KLING_2_5_TURBO);
                close();
              }}
            >
              <div className={styles.modelName}>Kling 2.5 Turbo</div>
              <div className={styles.modelDesc}>5/10s · soporta first/last</div>
            </button>

            <button
              type="button"
              className={`${styles.modelOption} ${model === KLING_2_6 ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(KLING_2_6);
                close();
              }}
            >
              <div className={styles.modelName}>Kling 2.6</div>
              <div className={styles.modelDesc}>Mejorado · audio solo en PRO</div>
            </button>

            <button
              type="button"
              className={`${styles.modelOption} ${model === KLING_O3_PRO ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(KLING_O3_PRO);
                close();
              }}
            >
              <div className={styles.modelName}>Kling O3 Pro</div>
              <div className={styles.modelDesc}>Omni (Kling API) · 3–15s · T2V + I2V + audio</div>
            </button>

            <button
              type="button"
              className={`${styles.modelOption} ${model === KLING_V3 ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(KLING_V3);
                close();
              }}
            >
              <div className={styles.modelName}>Kling V3</div>
              <div className={styles.modelDesc}>Multishot · 3–15s</div>
            </button>
          </div>
        )}

        {/* PARAMETERS */}
        {panel === "parameters" && (
          <>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Aspect ratio</label>

              {capability.supportsAspectRatio ? (
                <div className={styles.segment}>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                    onClick={() => setAspectRatio("16:9")}
                  >
                    16:9
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                    onClick={() => setAspectRatio("9:16")}
                  >
                    9:16
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""} ${
                      capability.supportsAspectRatio1x1 ? "" : styles.segmentBtnDisabled
                    }`}
                    onClick={() => capability.supportsAspectRatio1x1 && setAspectRatio("1:1")}
                    disabled={!capability.supportsAspectRatio1x1}
                    title={!capability.supportsAspectRatio1x1 ? "No disponible para este modelo/estado" : "1:1"}
                  >
                    1:1
                  </button>
                  {!capability.supportsAspectRatio && <span className={styles.segmentMeta}>Auto</span>}
                  {hasFirst && <span className={styles.segmentMeta}>Bloqueado por FIRST</span>}
                </div>
              ) : (
                <div className={styles.noteSmall}>Auto (se bloquea si usas FIRST frame)</div>
              )}
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>Resolution</label>

                {capability.supportsResolution ? (
                  isKling ? (
                    <div className={styles.noteSmall}>Kling: usa “Kling resolution” (STD=720p / PRO=1080p).</div>
                  ) : (
                    <div className={styles.segment}>
                      {supportedResolutions.map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={`${styles.segmentBtn} ${resolution === r ? styles.segmentBtnActive : ""}`}
                          onClick={() => setResolution(r)}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className={styles.noteSmall}>Auto / Fixed (según el modelo)</div>
                )}
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>Count</label>
              <div className={styles.segment}>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`${styles.segmentBtn} ${count === n ? styles.segmentBtnActive : ""} ${
                      isKlingV3 ? styles.segmentBtnDisabled : ""
                    }`}
                    onClick={() => !isKlingV3 && setCount(n)}
                    disabled={isKlingV3}
                    title={isKlingV3 ? "Kling V3 genera 1 video por vez" : `Generar x${n}`}
                  >
                    x{n}
                  </button>
                ))}
                {isKlingV3 && <span className={styles.segmentMeta}>Kling V3: x1</span>}
              </div>
            </div>

            {(isKlingV2 || isKlingV3Model) && (
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Kling resolution</label>
                <div className={styles.segment}>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${klingMode === "std" ? styles.segmentBtnActive : ""}`}
                    onClick={() => setKlingMode("std")}
                  >
                    720p
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${klingMode === "pro" ? styles.segmentBtnActive : ""}`}
                    onClick={() => setKlingMode("pro")}
                  >
                    1080p
                  </button>
                  <span className={styles.segmentMeta}>
                    {model === KLING_2_6
                      ? "2.6: 1080p requerido para audio"
                      : model === KLING_V3
                        ? "V3: 720p/1080p (mode std/pro)"
                        : "720p/1080p"}
                  </span>
                </div>
              </div>
            )}
            {capability.supportsSound && (
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Sound</label>
                <div className={styles.segment}>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${!klingSound ? styles.segmentBtnActive : ""}`}
                    onClick={() => {
                      setKlingSound(false);
                      setKlingSoundTouched(true);
                    }}
                  >
                    OFF
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${klingSound ? styles.segmentBtnActive : ""}`}
                    onClick={() => {
                      setKlingSound(true);
                      setKlingSoundTouched(true);
                    }}
                  >
                    ON
                  </button>
                  <span className={styles.segmentMeta}>Disponible en este modo</span>
                </div>
              </div>
            )}

            {isKlingV3 && (
              <>
                {isKlingV3Model && (
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Negative prompt</label>
                    <textarea
                      className={styles.textarea}
                      rows={2}
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      placeholder="Evitar: blur, low quality, artifacts..."
                    />
                  </div>
                )}

                {isKlingO3 && (
                  <div className={styles.noteSmall}>
                    Kling O3 (Omni): este modelo no expone Negative prompt / CFG / Voice IDs en esta UI.
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* DURATION */}
        {panel === "duration" && (
          <>
            {isKlingV3Model && multishotEnabled && klingShotType === "customize" && (
              <div className={styles.note}>
                <div>
                  Multishot (<b>customize</b>) activo.
                </div>
                <div className={styles.noteSmall}>
                  La duración final se calcula automáticamente como la suma de los shots (3s–15s).
                </div>

                <div className={styles.formRow}>
                  <button type="button" className={styles.segmentBtn} onClick={() => setMultishotOpen(true)}>
                    Editar Multishot
                  </button>
                </div>
              </div>
            )}

            {!(isKlingV3Model && multishotEnabled && klingShotType === "customize") && (
              <div className={styles.durationGrid}>
                {allowedDurations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`${styles.durationOption} ${durationSeconds === d ? styles.durationOptionActive : ""}`}
                    onClick={() => setDurationSeconds(d)}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            )}

            <div className={styles.noteSmall}>
              Las opciones dependen del modelo (y en Veo 3.1 también de resolución/frames).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
