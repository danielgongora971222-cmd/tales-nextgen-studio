import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { Icon } from "./icon";

type FrameSlotKey = "first" | "last";

type Props = {
  firstFrame: Asset | null;
  lastFrame: Asset | null;
  hasFirst: boolean;
  openPicker: (slot: FrameSlotKey) => void;
  clearFrame: (slot: FrameSlotKey) => void;
  swapFrames: () => void;
};

export function FrameStrip({ firstFrame, lastFrame, hasFirst, openPicker, clearFrame, swapFrames }: Props) {
  return (
    <div className={styles.frameStrip}>
      {/* FIRST */}
      <div
        className={styles.frameCard}
        title="FIRST frame"
        role="button"
        tabIndex={0}
        onClick={() => openPicker("first")}
        onKeyDown={(e) => e.key === "Enter" && openPicker("first")}
      >
        {firstFrame ? (
          <img className={styles.frameCardImg} src={firstFrame.url} alt="FIRST" />
        ) : (
          <div className={styles.frameCardEmpty}>
            <div className={styles.frameCardIcons}>
              <Icon name="image" />
              <Icon name="upload" />
            </div>
              <div className={styles.frameCardEmptyText}>Elegir</div>
          </div>
        )}

        <span className={styles.frameCardBadge}>FIRST</span>

        {firstFrame && (
          <button
            type="button"
            className={styles.frameCardRemove}
            aria-label="Remove FIRST"
            onClick={(e) => {
              e.stopPropagation();
              clearFrame("first");
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* SWAP */}
      <button
        type="button"
        className={styles.frameSwapBtn}
        onClick={swapFrames}
        disabled={!firstFrame || !lastFrame}
        title={!firstFrame || !lastFrame ? "Carga FIRST y LAST para invertir" : "Invertir FIRST ↔ LAST"}
      >
        <Icon name="swap" />
      </button>

      {/* LAST */}
      <div
        className={`${styles.frameCard} ${!hasFirst ? styles.frameCardLocked : ""}`}
        title={!hasFirst ? "Primero carga FIRST para habilitar LAST" : "LAST frame"}
        role="button"
        tabIndex={hasFirst ? 0 : -1}
        onClick={() => openPicker("last")}
        onKeyDown={(e) => e.key === "Enter" && openPicker("last")}
        aria-disabled={!hasFirst}
      >
        {lastFrame ? (
          <img className={styles.frameCardImg} src={lastFrame.url} alt="LAST" />
        ) : (
          <div className={styles.frameCardEmpty}>
            <div className={styles.frameCardIcons}>
              <Icon name="image" />
              <Icon name="upload" />
            </div>
            <div className={styles.frameCardEmptyText}>Elegir</div>
          </div>
        )}

        <span className={styles.frameCardBadge}>LAST</span>

        {lastFrame && (
          <button
            type="button"
            className={styles.frameCardRemove}
            aria-label="Remove LAST"
            onClick={(e) => {
              e.stopPropagation();
              clearFrame("last");
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
