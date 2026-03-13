import React, { useMemo, useRef } from "react";
import styles from "../VideoGeneratorTool.module.css";

export const KLING_V3_SHOT_PROMPT_LIMIT = 512;

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type LimitedTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  limit?: number;
  /** Clase que aporta el “look” (background, border radius, shadow). Ej: styles.multishotTextarea o styles.textarea */
  surfaceClassName: string;
  inputResize?: "none" | "vertical";
};

export function LimitedTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  limit = KLING_V3_SHOT_PROMPT_LIMIT,
  surfaceClassName,
  inputResize = "none",
}: LimitedTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const overlayHtml = useMemo(() => {
    const text = value || "";
    if (!text) return "";
    const before = escapeHtml(text.slice(0, limit));
    const after = escapeHtml(text.slice(limit));
    if (!after) return before;
    return `${before}<span class="${styles.limitOverflow}">${after}</span>`;
  }, [value, limit]);

  const syncScroll = () => {
    const ta = taRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  };

  const hasValue = Boolean((value || "").length);

  return (
    <div className={`${surfaceClassName} ${styles.limitSurface}`}>
      <div
        ref={overlayRef}
        className={styles.limitOverlay}
        data-placeholder={hasValue ? "false" : "true"}
        aria-hidden="true"
        dangerouslySetInnerHTML={{
          __html: hasValue ? overlayHtml : escapeHtml(placeholder || ""),
        }}
      />

      <textarea
        ref={taRef}
        className={`${styles.limitInput} ${
          inputResize === "vertical" ? styles.limitInputResizeVertical : styles.limitInputResizeNone
        }`}
        style={{ caretColor: "var(--text-main, rgba(255, 255, 255, 0.92))" }}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(syncScroll);
        }}
        onScroll={syncScroll}
        onKeyUp={syncScroll}
        onMouseUp={syncScroll}
        aria-label={placeholder || "Prompt"}
        spellCheck={true}
      />
    </div>
  );
}
