import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { LimitedTextarea, KLING_V3_SHOT_PROMPT_LIMIT } from "./LimitedTextarea";
import type { KlingShotType, KlingV3Shot } from "../../../services/videoModels/types";

export function MultishotModal({
  open,
  onClose,
  shots,
  setShots,
  shotType,
  setShotType,
  totalSeconds,
  durationSeconds,
}: {
  open: boolean;
  onClose: () => void;
  shots: KlingV3Shot[];
  setShots: React.Dispatch<React.SetStateAction<KlingV3Shot[]>>;
  shotType: KlingShotType;
  setShotType: React.Dispatch<React.SetStateAction<KlingShotType>>;
  totalSeconds: number;
  durationSeconds: number;
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
              setShots((prev) => (prev.length >= 6 ? prev : [...prev, { prompt: "", durationSeconds: 1 }]))
            }
          >
            + Add shot
          </button>

          <div className={styles.segmentMeta}>
            Total shots: {totalSeconds}s · Duration: {durationSeconds}s · cada shot 1–15s · max 6
          </div>
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
              className={`${styles.segmentBtn} ${shotType === "intelligence" ? styles.segmentBtnActive : ""}`}
              onClick={() => setShotType("intelligence")}
            >
              intelligence
            </button>
          </div>
        </div>

        <div className={styles.modalBody}>
          {shotType === "customize" ? (
            <>
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
                      <span className={styles.multishotCharCount}>{(s.prompt || "").length}/{KLING_V3_SHOT_PROMPT_LIMIT}</span>
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

          <div className={styles.modalNote}>
            Customize: se envía `multi_prompt` (storyboard) y la duración final se deriva de la suma de los shots.
            Intelligence: NO se envía storyboard; se usa solo `prompt`.
          </div>
            </>
          ) : (
            <div className={styles.note}>
              El modelo dividirá tu prompt en varios planos automáticamente (<b>shot_type=intelligence</b>).
              <div className={styles.noteSmall}>
                No hay storyboard manual. Deja tu prompt completo en la pantalla principal y ajusta Duration allí.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
