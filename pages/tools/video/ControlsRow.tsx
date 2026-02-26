import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { Icon } from "./icon";

export type PanelKey = "frames" | "model" | "parameters" | "duration" | null;

type Props = {
  panel: PanelKey;
  setPanel: React.Dispatch<React.SetStateAction<PanelKey>>;

  modelLabel: string;
  paramsLabel: string;
  durationLabel: string;

  isVeoFamily: boolean;
  veoSpeedLabel: string;
  toggleVeoSpeed: () => void;

  // Kling API (v2.* + v3) — NO incluye O3 (Fal)
  isKlingApi: boolean;
  klingMode: "std" | "pro";
  toggleKlingMode: () => void;

  supportsSound: boolean;
  klingSound: boolean;
  toggleSound: () => void;

  supportsVideoElements: boolean;
  selectedKlingElementCount: number;
  openElements: () => void;

  multishotEnabled: boolean;
  setMultishotEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  multishotMetaLabel: string; // ej: "12s" o "Intelligence"
};

export function ControlsRow({
  panel,
  setPanel,
  modelLabel,
  paramsLabel,
  durationLabel,
  isVeoFamily,
  veoSpeedLabel,
  toggleVeoSpeed,
  isKlingApi,
  klingMode,
  toggleKlingMode,
  supportsSound,
  klingSound,
  toggleSound,
  supportsVideoElements,
  selectedKlingElementCount,
  openElements,
  multishotEnabled,
  setMultishotEnabled,
  multishotMetaLabel,
}: Props) {
  return (
    <div className={styles.controlsRow}>
      <button
        type="button"
        className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
        onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
      >
        <span className={styles.controlBtnLeft}>
          <Icon name="model" />
          <span>Model</span>
        </span>
        <span className={styles.controlBtnMeta}>{modelLabel}</span>
      </button>

      <button
        type="button"
        className={`${styles.controlBtn} ${panel === "parameters" ? styles.controlBtnActive : ""}`}
        onClick={() => setPanel((p) => (p === "parameters" ? null : "parameters"))}
      >
        <span className={styles.controlBtnLeft}>
          <Icon name="sliders" />
          <span>Parameters</span>
        </span>
        <span className={styles.controlBtnMeta}>{paramsLabel}</span>
      </button>

      <button
        type="button"
        className={`${styles.controlBtn} ${panel === "duration" ? styles.controlBtnActive : ""}`}
        onClick={() => setPanel((p) => (p === "duration" ? null : "duration"))}
      >
        <span className={styles.controlBtnLeft}>
          <Icon name="clock" />
          <span>Duration</span>
        </span>
        <span className={styles.controlBtnMeta}>{durationLabel}</span>
      </button>

      {isVeoFamily && (
        <button
          type="button"
          className={styles.controlBtn}
          onClick={() => {
            setPanel(null);
            toggleVeoSpeed();
          }}
          title="Cambiar entre Fast y Quality"
        >
          <span className={styles.controlBtnLeft}>
            <Icon name="speed" />
            <span>Veo</span>
          </span>
          <span className={styles.controlBtnMeta}>{veoSpeedLabel}</span>
        </button>
      )}

      {isKlingApi && (
        <button
          type="button"
          className={styles.controlBtn}
          onClick={() => {
            setPanel(null);
            toggleKlingMode();
          }}
          title="Cambiar resolución Kling (STD=720p / PRO=1080p)"
        >
          <span className={styles.controlBtnLeft}>
            <Icon name="mode" />
            <span>Kling</span>
          </span>
          <span className={styles.controlBtnMeta}>{klingMode === "std" ? "720p" : "1080p"}</span>
        </button>
      )}

      {supportsSound && (
        <button
          type="button"
          className={`${styles.controlBtn} ${klingSound ? styles.controlBtnActive : ""}`}
          onClick={() => {
            setPanel(null);
            toggleSound();
          }}
          title="Activar/Desactivar sonido"
        >
          <span className={styles.controlBtnLeft}>
            <Icon name="sound" />
            <span>Sound</span>
          </span>
          <span className={styles.controlBtnMeta}>{klingSound ? "On" : "Off"}</span>
        </button>
      )}

      {supportsVideoElements && (
        <>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              setPanel(null);
              openElements();
            }}
            title="Seleccionar Elements"
          >
            <span className={styles.controlBtnLeft}>
              <Icon name="elements" />
              <span>Elements</span>
            </span>
            <span className={styles.controlBtnMeta}>
              {selectedKlingElementCount ? `${selectedKlingElementCount} sel` : "Optional"}
            </span>
          </button>

          <button
            type="button"
            className={`${styles.controlBtn} ${multishotEnabled ? styles.controlBtnActive : ""}`}
            onClick={() => {
              setPanel(null);
              setMultishotEnabled((v) => !v);
            }}
            title="Activar/Desactivar Multishot"
          >
            <span className={styles.controlBtnLeft}>
              <Icon name="multishot" />
              <span>Multishot</span>
            </span>
            <span className={styles.controlBtnMeta}>
              {multishotEnabled ? multishotMetaLabel : "Off"}
            </span>
          </button>
        </>
      )}
    </div>
  );
}