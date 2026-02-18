import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./MentionTextarea.module.css";

export type MentionItem = {
  id: string;
  token: string; // ej: "@img1" | "@bg" | "@nombre_del_elemento"
  label: string; // texto visible
  kind?: string; // "ref" | "bg" | "element"
  previewUrl?: string | null;
};

type MentionTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  textareaClassName?: string;
  items: MentionItem[];
  maxItems?: number;
};

function normalizeToken(t: string) {
  return String(t || "").trim();
}

function normalizeQuery(q: string) {
  return String(q || "").trim().toLowerCase();
}

function findActiveMentionQuery(text: string, caret: number) {
  const left = text.slice(0, caret);
  const at = left.lastIndexOf("@");
  if (at < 0) return null;

  const between = left.slice(at + 1);

  if (!between && at === caret - 1) {
    return { start: at, query: "" };
  }

  if (/\s/.test(between)) return null;
  if (at > 0 && /[a-z0-9_]/i.test(left[at - 1])) return null;

  return { start: at, query: between };
}

function escapeRegExp(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  textareaClassName,
  items,
  maxItems = 24,
}: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    const src = Array.isArray(items) ? items : [];
    if (!q) return src.slice(0, maxItems);

    return src
      .filter((it) => {
        const token = normalizeQuery(it.token);
        const label = normalizeQuery(it.label);
        return token.includes(q) || label.includes(q);
      })
      .slice(0, maxItems);
  }, [items, query, maxItems]);

  const updateFromCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? 0;

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

  const insertMention = (it: MentionItem) => {
    const ta = taRef.current;
    if (!ta) return;

    const caret = ta.selectionStart ?? 0;
    const current = String(value || "");
    const start = mentionStart ?? caret;
    const end = caret;

    const token = normalizeToken(it.token);
    if (!token) return;

    const before = current.slice(0, start);
    const after = current.slice(end);

    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
    const insert = `${needsSpaceBefore ? " " : ""}${token}${needsSpaceAfter ? " " : " "}`;

    const next = `${before}${insert}${after}`;
    onChange(next);

    requestAnimationFrame(() => {
      const node = taRef.current;
      if (!node) return;
      const nextCaret = (before + insert).length;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);

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
      const it = filtered[activeIndex];
      if (it) insertMention(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  return (
    <div className={styles.wrap}>
      <textarea
        ref={taRef}
        className={textareaClassName}
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
        <div className={styles.picker} role="listbox" aria-label="References">
          {filtered.length === 0 ? (
            <div className={styles.empty}>No matches</div>
          ) : (
            filtered.map((it, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={it.id + it.token}
                  type="button"
                  className={`${styles.item} ${active ? styles.itemActive : ""}`}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => insertMention(it)}
                  role="option"
                  aria-selected={active}
                >
                  {it.previewUrl ? (
                    <span className={styles.thumb}>
                      <img src={it.previewUrl} alt={it.label} />
                    </span>
                  ) : (
                    <span className={styles.thumb} />
                  )}

                  <span className={styles.meta}>
                    <span className={styles.label}>{it.label}</span>
                    <span className={styles.token}>{it.token}</span>
                  </span>

                  {it.kind ? <span className={styles.kind}>{it.kind}</span> : null}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
