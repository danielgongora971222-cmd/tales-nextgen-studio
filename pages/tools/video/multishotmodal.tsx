import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { LimitedTextarea, KLING_V3_SHOT_PROMPT_LIMIT } from "./LimitedTextarea";

type KlingV3Shot = { prompt: string; durationSeconds: number };
type KlingShotType = "customize" | "intelligent";

export function MultishotModal({
  open,
  onClose,
  shots,
  setShots,
  shotType,
  setShotType,
  totalSeconds,
}: {
  open: boolean;
  onClose: () => void;
  shots: KlingV3Shot[];
  setShots: React.Dispatch<React.SetStateAction<KlingV3Shot[]>>;
  shotType: KlingShotType;
  setShotType: React.Dispatch<React.SetStateAction<KlingShotType>>;
  totalSeconds: number;
}) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Multishot</div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.uploadBtn}
            onClick={() =>
              setShots((prev) => (prev.length >= 10 ? prev : [...prev, { prompt: "", durationSeconds: 3 }]))
            }
          >
            + Add shot
          </button>

          <div className={styles.segmentMeta}>Total: {totalSeconds}s (cada shot 3–15s · max 10)</div>
        </div>

        <div className={styles.modalActions}>
          <label className={styles.formLabel} style={{ width: 110 }}>
            Shot type
          </label>
          <div className={styles.segment}>
            <button
              type="button"
              className={`${styles.segmentBtn} ${shotType === "customize" ? styles.segmentBtnActive : ""}`}
              onClick={() => setShotType("customize")}
            >
              customize
            </button>
            <button
              type="button"
              className={`${styles.segmentBtn} ${shotType === "intelligent" ? styles.segmentBtnActive : ""}`}
              onClick={() => setShotType("intelligent")}
            >
              intelligent
            </button>
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
                    disabled={shots.length <= 1}
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
                  <span className={s.prompt.length > KLING_V3_SHOT_PROMPT_LIMIT ? styles.multishotCharOver : undefined}>
                    {s.prompt.length}/{KLING_V3_SHOT_PROMPT_LIMIT}
                    {s.prompt.length > KLING_V3_SHOT_PROMPT_LIMIT
                      ? ` (+${s.prompt.length - KLING_V3_SHOT_PROMPT_LIMIT})`
                      : ""}
                  </span>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Duration</label>
                  <input
                    className={styles.input}
                    type="number"
                    min={3}
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

          <div className={styles.modalNote}>
            Si Multishot está ON, el backend enviará `multi_prompt` y usará la suma de durations.
          </div>
        </div>
      </div>
    </div>
  );
}
