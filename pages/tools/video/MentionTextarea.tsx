import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { KlingElement } from "../../../services/klingElementsService";

type MentionTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  limit?: number;
  surfaceClassName: string;
  inputResize?: "none" | "vertical";
  elements: KlingElement[];

  /**
   * Puede devolver un string para insertar (ej: "@Element1")
   * o devolver void/null para fallback "@Nombre"
   */
  onPickElement?: (el: KlingElement) => string | void | null;

  onCaretChange?: (pos: number) => void;
};

function findActiveMentionQuery(text: string, caret: number) {
  const left = text.slice(0, caret);
  const at = left.lastIndexOf("@");
  if (at < 0) return null;

  const between = left.slice(at + 1);

  if (/\s/.test(between)) return null;
  if (at > 0 && /[a-z0-9_]/i.test(left[at - 1])) return null;

  // No abrir picker si el usuario está escribiendo @ElementN
  if (/^element\d*$/i.test(between)) return null;

  return { start: at, query: between };
}

function normalizeQuery(q: string) {
  return String(q || "").trim().toLowerCase();
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  surfaceClassName,
  inputResize = "none",
  elements,
  onPickElement,
  onCaretChange,
}: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) return elements.slice(0, 24);

    return elements
      .filter((e) => normalizeQuery(e.name).includes(q))
      .slice(0, 24);
  }, [elements, query]);

  const updateFromCaret = () => {
    const ta = taRef.current;
    if (!ta) return;

    const caret = ta.selectionStart ?? 0;
    onCaretChange?.(caret);

    const res = findActiveMentionQuery(String(value || ""), caret);
    if (!res) {
      setOpen(false);
      setQuery("");
      setMentionStart(null);
      setActiveIndex(0);
      return;
    }

    setOpen(true);
    setQuery(res.query);
    setMentionStart(res.start);
    setActiveIndex(0);
  };

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!open) return;
      const ta = taRef.current;
      if (!ta) return;
      if (ta.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const insertMention = (el: KlingElement) => {
    const ta = taRef.current;
    if (!ta) return;

    const caret = ta.selectionStart ?? 0;
    const current = String(value || "");

    const start = mentionStart ?? caret;
    const end = caret;

    const custom = onPickElement?.(el);
    const token =
      typeof custom === "string" && custom.trim()
        ? custom.trim()
        : `@${el.name}`;

    const before = current.slice(0, start);
    const after = current.slice(end);

    const next = `${before}${token} ${after}`;
    onChange(next);

    requestAnimationFrame(() => {
      const node = taRef.current;
      if (!node) return;
      const nextCaret = (before + token + " ").length;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
      onCaretChange?.(nextCaret);

      setOpen(false);
      setQuery("");
      setMentionStart(null);
      setActiveIndex(0);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const el = filtered[activeIndex];
      if (el) insertMention(el);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`${surfaceClassName} ${styles.limitSurface} ${styles.mentionSurface}`}>
      <textarea
        ref={taRef}
        className={`${styles.limitInput} ${styles.limitInputVisible} ${
          inputResize === "vertical"
            ? styles.limitInputResizeVertical
            : styles.limitInputResizeNone
        }`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={updateFromCaret}
        onMouseUp={updateFromCaret}
        onFocus={updateFromCaret}
        placeholder={placeholder}
        aria-label={placeholder || "Prompt"}
        spellCheck={true}
      />

      {open && (
        <div className={styles.mentionPicker} role="listbox" aria-label="Elements">
          {filtered.length === 0 ? (
            <div className={styles.mentionEmpty}>No elements</div>
          ) : (
            filtered.map((el, idx) => (
              <button
                key={el.id}
                type="button"
                className={`${styles.mentionItem} ${
                  idx === activeIndex ? styles.mentionItemActive : ""
                }`}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => insertMention(el)}
                role="option"
                aria-selected={idx === activeIndex}
              >
                <span className={styles.mentionDot} />
                <span className={styles.mentionName}>{el.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
