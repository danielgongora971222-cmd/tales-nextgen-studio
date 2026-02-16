import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { Icon } from "./icon";
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

  supportedResolutions: string[];
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

  klingShotType: "customize" | "intelligent";
  setKlingShotType: (v: any) => void;

  negativePrompt: string;
  setNegativePrompt: (v: any) => void;

  klingCfgScale: number;
  setKlingCfgScale: (v: any) => void;

  klingVoiceIdsText: string;
  setKlingVoiceIdsText: (v: any) => void;

  multishotEnabled: boolean;
  multishotTotalSeconds: number;
  setMultishotOpen: (v: any) => void;

  allowedDurations: number[];
  durationSeconds: number;
  setDurationSeconds: (v: any) => void;
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
}: Props) {
  if (!panel || panel === "frames") return null;

  const isKlingV2 = model === KLING_2_5_TURBO || model === KLING_2_6;
  const isKlingO3 = model === KLING_O3_PRO;

  return (
    <div ref={popoverRef} className={styles.popover}>
      <div className={styles.popoverInner}>
        <div className={styles.popoverHeader}>
          <div className={styles.popoverTitle}>
            {panel === "model" ? "Model" : panel === "parameters" ? "Parameters" : "Duration"}
          </div>
          <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button" title="Cerrar">
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
                setPanel(null);
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
                setPanel(null);
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
                setPanel(null);
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
                setPanel(null);
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
                setPanel(null);
              }}
            >
              <div className={styles.modelName}>Kling O3 Pro</div>
              <div className={styles.modelDesc}>Pro (Fal) · 3–15s · T2V + I2V + audio</div>
            </button>

            <button
              type="button"
              className={`${styles.modelOption} ${model === KLING_V3 ? styles.modelOptionActive : ""}`}
              onClick={() => {
                setModel(KLING_V3);
                setPanel(null);
              }}
            >
              <div className={styles.modelName}>Kling V3</div>
              <div className={styles.modelDesc}>Elements + Multishot · 3–15s</div>
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

            {isKlingV2 && (
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Kling mode</label>
                <div className={styles.segment}>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${klingMode === "std" ? styles.segmentBtnActive : ""}`}
                    onClick={() => setKlingMode("std")}
                  >
                    STD
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${klingMode === "pro" ? styles.segmentBtnActive : ""}`}
                    onClick={() => setKlingMode("pro")}
                  >
                    PRO
                  </button>
                  <span className={styles.segmentMeta}>
                    {model === KLING_2_6 ? "2.6: audio solo PRO" : "STD/PRO"}
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
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Shot type</label>

                  {!multishotEnabled ? (
                    <div className={styles.noteSmall}>Activa <b>Multishot</b> para habilitar shot_type.</div>
                  ) : hasFirst ? (
                    <div className={styles.noteSmall}>
                      Bloqueado por <b>FIRST</b> frame (Fal solo aplica shot_type en Text-to-Video Multishot).
                    </div>
                  ) : (
                    <div className={styles.segment}>
                      <button
                        type="button"
                        className={`${styles.segmentBtn} ${klingShotType === "customize" ? styles.segmentBtnActive : ""}`}
                        onClick={() => setKlingShotType("customize")}
                      >
                        customize
                      </button>

                      <button
                        type="button"
                        className={`${styles.segmentBtn} ${klingShotType === "intelligent" ? styles.segmentBtnActive : ""} ${
                          isKlingO3 ? styles.segmentBtnDisabled : ""
                        }`}
                        onClick={() => !isKlingO3 && setKlingShotType("intelligent")}
                        disabled={isKlingO3}
                        title={isKlingO3 ? "Kling O3 Pro solo soporta shot_type=customize" : "intelligent"}
                      >
                        intelligent
                      </button>

                      {isKlingO3 && <span className={styles.segmentMeta}>O3: solo customize</span>}
                    </div>
                  )}
                </div>

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

                <div className={styles.formRow}>
                  <label className={styles.formLabel}>CFG scale</label>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={klingCfgScale}
                    onChange={(e) => setKlingCfgScale(Number(e.target.value))}
                  />
                  <div className={styles.noteSmall}>Rango típico 0.0–1.0</div>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Voice IDs (opcional)</label>
                  <input
                    className={styles.input}
                    value={klingVoiceIdsText}
                    onChange={(e) => setKlingVoiceIdsText(e.target.value)}
                    placeholder="Ej: voice_1, voice_2"
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* DURATION */}
        {panel === "duration" && (
          <>
            {isKlingV3 && multishotEnabled ? (
              <div className={styles.note}>
                La duración la controla <b>Multishot</b>.
                <div className={styles.noteSmall}>
                  Total actual: {multishotTotalSeconds}s · Debe quedar entre 3s y 15s
                </div>

                <div className={styles.formRow}>
                  <button type="button" className={styles.segmentBtn} onClick={() => setMultishotOpen(true)}>
                    Editar Multishot
                  </button>
                </div>
              </div>
            ) : (
              <>
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

                <div className={styles.noteSmall}>
                  Las opciones dependen del modelo (y en Veo 3.1 también de resolución/frames).
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
