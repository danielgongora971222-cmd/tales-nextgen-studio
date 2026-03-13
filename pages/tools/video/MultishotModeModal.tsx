import React from "react";
import styles from "../VideoGeneratorTool.module.css";

export function MultishotModeModal({
  open,
  title = "Multishot",
  intelligenceTitle = "Intelligence",
  intelligenceText = "Usa un único prompt y el modelo divide los planos automáticamente.",
  customizeTitle = "Customize",
  customizeText = "Abre el editor shot-by-shot para definir storyboard manual.",
  customizeHint = "Antes de abrirlo, deja listos modelo y parámetros.",
  onChooseIntelligence,
  onChooseCustomize,
  onClose,
}: {
  open: boolean;
  title?: string;
  intelligenceTitle?: string;
  intelligenceText?: string;
  customizeTitle?: string;
  customizeText?: string;
  customizeHint?: string;
  onChooseIntelligence: () => void;
  onChooseCustomize: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{title}</div>
          <button className={styles.modalClose} onClick={onClose} type="button" title="Cerrar">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.modeChoiceGrid}>
            <button type="button" className={styles.modeChoiceCard} onClick={onChooseIntelligence}>
              <div className={styles.modeChoiceTitle}>{intelligenceTitle}</div>
              <div className={styles.modeChoiceDesc}>{intelligenceText}</div>
            </button>

            <button type="button" className={styles.modeChoiceCard} onClick={onChooseCustomize}>
              <div className={styles.modeChoiceTitle}>{customizeTitle}</div>
              <div className={styles.modeChoiceDesc}>{customizeText}</div>
              <div className={styles.modeChoiceHint}>{customizeHint}</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
