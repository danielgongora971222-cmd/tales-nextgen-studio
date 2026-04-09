import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { Icon } from "./icon";
import type { AspectRatio } from "../../../services/videoModels/types";
import {
  KLING_2_5_TURBO,
  KLING_2_6,
  KLING_O3_PRO,
  KLING_V3,
  SEEDANCE_2,
  SEEDANCE_2_FAST,
  VEO_3,
  VEO_3_1,
  VEO_3_1_FAST,
  VEO_3_FAST,
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
  capability: Capability;
  hasFirst: boolean;
  aspectRatio: string;
  setAspectRatio: (v: AspectRatio) => void;
  supportedResolutions: readonly string[];
  resolution: string;
  setResolution: (v: "720p" | "1080p" | "4k") => void;
  isKling: boolean;
  klingMode: "std" | "pro";
  setKlingMode: (v: "std" | "pro") => void;
  allowedDurations: readonly number[];
  durationSeconds: number;
  setDurationSeconds: (v: number) => void;
  inline?: boolean;
  onClose?: () => void;
};

type ModelOption = {
  id: string;
  name: string;
  desc: string;
};

const MODEL_OPTIONS: ModelOption[] = [
  { id: VEO_3, name: "Veo 3 Quality", desc: "8s · calidad" },
  { id: VEO_3_FAST, name: "Veo 3 Fast", desc: "8s · velocidad" },
  { id: VEO_3_1, name: "Veo 3.1 Quality", desc: "4/6/8s · calidad" },
  { id: VEO_3_1_FAST, name: "Veo 3.1 Fast", desc: "4/6/8s · velocidad" },
  { id: KLING_2_5_TURBO, name: "Kling 2.5 Turbo", desc: "5/10s" },
  { id: KLING_2_6, name: "Kling 2.6", desc: "5/10s" },
  { id: KLING_V3, name: "Kling 3.0", desc: "3–15s · multishot" },
  { id: KLING_O3_PRO, name: "Kling O3 Pro", desc: "3–15s · multishot" },
  { id: SEEDANCE_2, name: "Seedance 2", desc: "4–15s · text / first-last" },
  { id: SEEDANCE_2_FAST, name: "Seedance 2 Fast", desc: "4–15s · fast" },
];

export function ControlsPopover({
  panel,
  setPanel,
  popoverRef,
  model,
  setModel,
  capability,
  hasFirst,
  aspectRatio,
  setAspectRatio,
  supportedResolutions,
  resolution,
  setResolution,
  isKling,
  klingMode,
  setKlingMode,
  allowedDurations,
  durationSeconds,
  setDurationSeconds,
  inline = false,
  onClose,
}: Props) {
  if (!panel || panel === "frames") return null;

  const close = onClose || (() => setPanel(null));

  const isSeedance = model === SEEDANCE_2 || model === SEEDANCE_2_FAST;

  const selectAspect = (next: AspectRatio) => {
    setAspectRatio(next);
    close();
  };

  const selectResolution = (next: "720p" | "1080p" | "4k") => {
    setResolution(next);
    close();
  };

  const selectKlingMode = (next: "std" | "pro") => {
    setKlingMode(next);
    close();
  };

  const selectDuration = (next: number) => {
    setDurationSeconds(next);
    close();
  };

  const supports720 = supportedResolutions.includes("720p");
  const supports1080 = supportedResolutions.includes("1080p");
  const supports4k = supportedResolutions.includes("4k");

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

        <div className={styles.popoverBody}>
          {panel === "model" && (
            <div className={styles.modelGrid}>
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.modelOption} ${model === option.id ? styles.modelOptionActive : ""}`}
                  onClick={() => {
                    setModel(option.id);
                    close();
                  }}
                >
                  <div className={styles.modelName}>{option.name}</div>
                  <div className={styles.modelDesc}>{option.desc}</div>
                </button>
              ))}
            </div>
          )}

          {panel === "parameters" && (
            <>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Aspect ratio</label>
                {capability.supportsAspectRatio ? (
                  <div className={styles.segment}>
                    {isSeedance ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "21:9" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("21:9")}
                        >
                          21:9
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("16:9")}
                        >
                          16:9
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "4:3" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("4:3")}
                        >
                          4:3
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("1:1")}
                        >
                          1:1
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "3:4" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("3:4")}
                        >
                          3:4
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("9:16")}
                        >
                          9:16
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("16:9")}
                        >
                          16:9
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                          onClick={() => selectAspect("9:16")}
                        >
                          9:16
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""} ${
                            capability.supportsAspectRatio1x1 ? "" : styles.segmentBtnDisabled
                          }`}
                          onClick={() => capability.supportsAspectRatio1x1 && selectAspect("1:1")}
                          disabled={!capability.supportsAspectRatio1x1}
                          title={!capability.supportsAspectRatio1x1 ? "No disponible" : "1:1"}
                        >
                          1:1
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={styles.noteSmall}>{hasFirst ? "Auto por Start frame" : "Auto"}</div>
                )}
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Quality / Resolution</label>
                {isKling ? (
                  <div className={styles.segment}>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${klingMode === "std" ? styles.segmentBtnActive : ""} ${
                        supports720 ? "" : styles.segmentBtnDisabled
                      }`}
                      onClick={() => supports720 && selectKlingMode("std")}
                      disabled={!supports720}
                    >
                      720p
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${klingMode === "pro" ? styles.segmentBtnActive : ""} ${
                        supports1080 ? "" : styles.segmentBtnDisabled
                      }`}
                      onClick={() => supports1080 && selectKlingMode("pro")}
                      disabled={!supports1080}
                    >
                      1080p
                    </button>
                  </div>
                ) : capability.supportsResolution ? (
                  <div className={styles.segment}>
                    {supports720 && (
                      <button
                        type="button"
                        className={`${styles.segmentBtn} ${resolution === "720p" ? styles.segmentBtnActive : ""}`}
                        onClick={() => selectResolution("720p")}
                      >
                        720p
                      </button>
                    )}
                    {supports1080 && (
                      <button
                        type="button"
                        className={`${styles.segmentBtn} ${resolution === "1080p" ? styles.segmentBtnActive : ""}`}
                        onClick={() => selectResolution("1080p")}
                      >
                        1080p
                      </button>
                    )}
                    {supports4k && (
                      <button
                        type="button"
                        className={`${styles.segmentBtn} ${resolution === "4k" ? styles.segmentBtnActive : ""}`}
                        onClick={() => selectResolution("4k")}
                      >
                        4K
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={styles.noteSmall}>Auto</div>
                )}
              </div>
            </>
          )}

          {panel === "duration" && (
            <>
              <div className={styles.durationGrid}>
                {allowedDurations.map((duration) => (
                  <button
                    key={duration}
                    type="button"
                    className={`${styles.durationOption} ${durationSeconds === duration ? styles.durationOptionActive : ""}`}
                    onClick={() => selectDuration(duration)}
                  >
                    {duration}s
                  </button>
                ))}
              </div>
              <div className={styles.noteSmall}>Las opciones cambian según el modelo seleccionado.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
