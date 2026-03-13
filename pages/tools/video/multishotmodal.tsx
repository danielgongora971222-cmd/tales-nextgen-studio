import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { LimitedTextarea, KLING_V3_SHOT_PROMPT_LIMIT } from "./LimitedTextarea";
import type { KlingV3Shot } from "../../../services/videoModels/types";

export function MultishotModal({
  open,
  onClose,
  shots,
  setShots,
  totalSeconds,
  durationSeconds,
  onGenerate,
  generateDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  shots: KlingV3Shot[];
  setShots: React.Dispatch<React.SetStateAction<KlingV3Shot[]>>;
  totalSeconds: number;
  durationSeconds: number;
  onGenerate?: () => void;
  generateDisabled?: boolean;
}) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Multishot • Customize</div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.uploadBtn}
            onClick={() =>
              setShots((prev) => (prev.length >= 6 ? prev : [...prev, { prompt: "", durationSeconds: 1 }]))
            }
          >
            + Add shot
          </button>

          <div className={styles.segmentMeta}>
            Total: {totalSeconds}s · Duration: {durationSeconds}s · max 6
          </div>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.shotsGrid}>
            {shots.map((s, i) => (
              <div key={i} className={styles.shotCard}>
                <div className={styles.shotHeader}>
                  <div className={styles.shotTitle}>Shot {i + 1}</div>
                  <button
                    type="button"
                    className={styles.swapBtn}
                    onClick={() => setShots((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={shots.length <= 2}
                  >
                    Remove
                  </button>
                </div>

                <LimitedTextarea
                  surfaceClassName={styles.textarea}
                  rows={2}
                  value={s.prompt}
                  onChange={(next) =>
                    setShots((prev) => prev.map((x, idx) => (idx === i ? { ...x, prompt: next } : x)))
                  }
                  placeholder="Prompt de este shot..."
                  limit={KLING_V3_SHOT_PROMPT_LIMIT}
                  inputResize="vertical"
                />

                <div className={styles.multishotCharRow}>
                  <span className={(s.prompt || "").length > KLING_V3_SHOT_PROMPT_LIMIT ? styles.multishotCharOver : undefined}>
                    {(s.prompt || "").length}/{KLING_V3_SHOT_PROMPT_LIMIT}
                  </span>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Duration</label>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={15}
                    value={s.durationSeconds}
                    onChange={(e) =>
                      setShots((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, durationSeconds: Number(e.target.value) } : x))
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Close</button>
          {onGenerate && (
            <button type="button" className={styles.uploadBtn} onClick={onGenerate} disabled={generateDisabled}>
              Generate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
