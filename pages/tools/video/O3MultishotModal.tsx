import React, { useEffect } from "react";
import styles from "../VideoGeneratorTool.module.css";
import { LimitedTextarea } from "./LimitedTextarea";
import { MentionTextarea, type MentionItem } from "../../../components/MentionTextarea";

export type O3Shot = { prompt: string; durationSeconds: number };

export const O3_SHOT_PROMPT_LIMIT = 4000;

export function O3MultishotModal({
  open,
  onClose,
  shots,
  setShots,
  totalSeconds,
  mentionItems,
  onGenerate,
  generateDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  shots: O3Shot[];
  setShots: React.Dispatch<React.SetStateAction<O3Shot[]>>;
  totalSeconds: number;
  mentionItems?: MentionItem[];
  onGenerate?: () => void;
  generateDisabled?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    if (!shots || shots.length === 0) {
      setShots([{ prompt: "", durationSeconds: 5 }]);
    }
  }, [open, shots, setShots]);

  if (!open) return null;

  const totalWarn = totalSeconds < 3 || totalSeconds > 15;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Storyboard • Customize</div>
          <button className={styles.modalClose} onClick={onClose} type="button" title="Cerrar">
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

          <div className={styles.segmentMeta} style={totalWarn ? { color: "rgba(255, 86, 94, 0.95)" } : undefined}>
            Total: {totalSeconds}s · max 10
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
                    title={shots.length <= 1 ? "Debe existir al menos 1 shot" : "Eliminar shot"}
                  >
                    Remove
                  </button>
                </div>

                {mentionItems && mentionItems.length > 0 ? (
                  <MentionTextarea
                    textareaClassName={styles.textarea}
                    value={s.prompt}
                    onChange={(next) => setShots((prev) => prev.map((x, idx) => (idx === i ? { ...x, prompt: next } : x)))}
                    items={mentionItems}
                    placeholder="Prompt de este shot…"
                  />
                ) : (
                  <LimitedTextarea
                    surfaceClassName={styles.textarea}
                    rows={3}
                    value={s.prompt}
                    onChange={(next) => setShots((prev) => prev.map((x, idx) => (idx === i ? { ...x, prompt: next } : x)))}
                    placeholder="Prompt de este shot…"
                    limit={O3_SHOT_PROMPT_LIMIT}
                    inputResize="vertical"
                  />
                )}

                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Duration</label>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={15}
                    value={s.durationSeconds}
                    onChange={(e) =>
                      setShots((prev) => prev.map((x, idx) => (idx === i ? { ...x, durationSeconds: Number(e.target.value) } : x)))
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
