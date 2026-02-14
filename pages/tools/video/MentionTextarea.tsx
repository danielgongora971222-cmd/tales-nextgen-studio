import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { KlingElement } from "../../../services/klingElementsService";

// Token interno (no visible para el usuario porque el texto real del textarea es transparente)
// Formato: @{<elementId>}
const TOKEN_RE = /@\{([^}]+)\}/g;
const TOKEN_TEST_RE = /@\{[^}]+\}/;

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeForSearch(s: string) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getTokenRanges(value: string) {
  const ranges: Array<{ start: number; end: number; id: string }> = [];
  const s = String(value || "");
  for (const m of s.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const full = String(m[0] || "");
    const id = String(m[1] || "").trim();
    ranges.push({ start, end: start + full.length, id });
  }
  return ranges;
}

function findTokenAtPos(ranges: Array<{ start: number; end: number; id: string }>, pos: number) {
  for (const r of ranges) {
    if (pos >= r.start && pos <= r.end) return r;
  }
  return null;
}

function findActiveMentionQuery(text: string, caret: number) {
  const left = text.slice(0, caret);
  const at = left.lastIndexOf("@");
  if (at < 0) return null;

  // Si ya es un token "@{", no abrimos picker
  if (left.slice(at, at + 2) === "@{") return null;

  const between = left.slice(at + 1);
  // Si hay espacio/salto de línea, no es una mención activa
  if (/\s/.test(between)) return null;

  // Opcional: evitar emails (char antes de @ es alfanumérico)
  if (at > 0 && /[a-z0-9_]/i.test(left[at - 1])) return null;

  return { start: at, query: between };
}

function buildOverlayHtml(value: string, elementsById: Map<string, KlingElement>, limit?: number) {
  const s = String(value || "");
  const pieces: string[] = [];

  let i = 0;
  const matches = Array.from(s.matchAll(TOKEN_RE));
  for (const m of matches) {
    const start = m.index ?? 0;
    const full = String(m[0] || "");
    const id = String(m[1] || "").trim();
    const end = start + full.length;

    // text before
    if (start > i) {
      const seg = s.slice(i, start);
      pieces.push(renderTextSegment(seg, i, limit));
    }

    const el = elementsById.get(id);
    const label = el ? `@${el.name}` : "@Element";
    const chip = `<span class="${styles.mentionChip}" data-mention="true">${escapeHtml(label)}</span>`;

    // overflow wrapping (simple)
    if (typeof limit === "number" && limit >= 0 && start >= limit) {
      pieces.push(`<span class="${styles.limitOverflow}">${chip}</span>`);
    } else {
      pieces.push(chip);
    }

    i = end;
  }

  // tail
  if (i < s.length) {
    const seg = s.slice(i);
    pieces.push(renderTextSegment(seg, i, limit));
  }

  // placeholder: si está vacío, el overlay queda vacío y se verá el placeholder del textarea
  return pieces.join("");
}

function renderTextSegment(seg: string, startIndex: number, limit?: number) {
  const safe = escapeHtml(seg);

  if (typeof limit !== "number" || limit < 0) return safe;

  const endIndex = startIndex + seg.length;
  if (endIndex <= limit) return safe;
  if (startIndex >= limit) return `<span class="${styles.limitOverflow}">${safe}</span>`;

  // crosses limit
  const okLen = Math.max(0, limit - startIndex);
  const a = escapeHtml(seg.slice(0, okLen));
  const b = escapeHtml(seg.slice(okLen));
  return `${a}<span class="${styles.limitOverflow}">${b}</span>`;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows,
  surfaceClassName,
  inputResize,
  limit,
  elements,
  onPickElement,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  surfaceClassName: string;
  inputResize?: "none" | "vertical" | "horizontal" | "both";
  limit?: number;
  elements: KlingElement[];
  onPickElement?: (el: KlingElement) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const elementsById = useMemo(() => {
    const m = new Map<string, KlingElement>();
    for (const el of elements || []) m.set(String((el as any).id), el);
    return m;
  }, [elements]);

  // Mention picker state
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const caretRef = useRef(0);

  const matches = useMemo(() => {
    if (!open) return [];
    const q = normalizeForSearch(query);

    const items = (elements || []).slice();
    if (!q) return items;

    const starts: KlingElement[] = [];
    const contains: KlingElement[] = [];

    for (const el of items) {
      const name = normalizeForSearch((el as any).name);
      const tag = normalizeForSearch((el as any).tag || "");
      if (name.startsWith(q) || tag.startsWith(q)) starts.push(el);
      else if (name.includes(q) || tag.includes(q)) contains.push(el);
    }
    return [...starts, ...contains];
  }, [open, query, elements]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query]);

  const overlayHtml = useMemo(() => buildOverlayHtml(value, elementsById, limit), [value, elementsById, limit]);

  function updateMentionFromCaret() {
    const ta = taRef.current;
    if (!ta) return;

    const caret = ta.selectionStart ?? 0;
    caretRef.current = caret;

    const found = findActiveMentionQuery(value, caret);
    if (!found) {
      setOpen(false);
      setQuery("");
      setMentionStart(null);
      return;
    }

    setOpen(true);
    setMentionStart(found.start);
    setQuery(found.query);
  }

  function snapCaretIfInsideToken() {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (start !== end) return;

    const ranges = getTokenRanges(value);
    const tok = findTokenAtPos(ranges, start);
    if (!tok) return;

    // Si el caret cae dentro del token, lo llevamos al final del token (comportamiento tipo “tag”)
    if (start > tok.start && start < tok.end) {
      requestAnimationFrame(() => {
        ta.setSelectionRange(tok.end, tok.end);
      });
    }
  }

  function insertElement(el: KlingElement) {
    const ta = taRef.current;
    if (!ta) return;

    const caret = caretRef.current;
    const start = mentionStart ?? caret;
    const end = caret;

    const before = value.slice(0, start);
    const after = value.slice(end);

    const token = `@{${String((el as any).id)}} `;
    const next = `${before}${token}${after}`;

    onChange(next);

    // mover caret después del token insertado
    requestAnimationFrame(() => {
      const pos = before.length + token.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });

    onPickElement?.(el);
    setOpen(false);
    setQuery("");
    setMentionStart(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Navegación del picker
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        if (matches[activeIndex]) {
          e.preventDefault();
          insertElement(matches[activeIndex]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }

    // Borrado atómico de tokens
    if (e.key === "Backspace" || e.key === "Delete") {
      const ta = taRef.current;
      if (!ta) return;

      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;

      const ranges = getTokenRanges(value);

      // Si hay selección, borramos normal (pero expandimos tokens completos si toca)
      if (start !== end) {
        // expand selection to full tokens if it intersects
        let newStart = start;
        let newEnd = end;
        for (const r of ranges) {
          if (r.start < newEnd && r.end > newStart) {
            newStart = Math.min(newStart, r.start);
            newEnd = Math.max(newEnd, r.end);
          }
        }

        const next = value.slice(0, newStart) + value.slice(newEnd);
        e.preventDefault();
        onChange(next);
        requestAnimationFrame(() => {
          ta.setSelectionRange(newStart, newStart);
        });
        setOpen(false);
        return;
      }

      // caret dentro o pegado a token => borrar token entero
      const probePos = e.key === "Backspace" ? start : start + 1;
      const tok = findTokenAtPos(ranges, probePos);
      if (tok) {
        e.preventDefault();
        const next = value.slice(0, tok.start) + value.slice(tok.end);
        onChange(next);
        requestAnimationFrame(() => {
          ta.setSelectionRange(tok.start, tok.start);
        });
        setOpen(false);
        return;
      }
    }

    // Bloquear escritura dentro de token (comportamiento etiqueta)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ta = taRef.current;
      if (!ta) return;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      if (start !== end) return;

      const ranges = getTokenRanges(value);
      const tok = findTokenAtPos(ranges, start);
      if (tok && start > tok.start && start < tok.end) {
        e.preventDefault();
        requestAnimationFrame(() => {
          ta.setSelectionRange(tok.end, tok.end);
        });
      }
    }
  }

  return (
    <div className={`${surfaceClassName} ${styles.limitSurface} ${styles.mentionSurface}`}>
      <div className={styles.limitOverlay} aria-hidden="true" dangerouslySetInnerHTML={{ __html: overlayHtml }} />
      <textarea
        ref={taRef}
        className={styles.limitInput}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={() => {
          snapCaretIfInsideToken();
          updateMentionFromCaret();
        }}
        onClick={() => {
          snapCaretIfInsideToken();
          updateMentionFromCaret();
        }}
        onBlur={() => {
          // Pequeño delay para permitir click en el picker
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder={placeholder}
        rows={rows}
        style={{ resize: inputResize }}
      />

      {open && (
        <div className={styles.mentionPicker} role="listbox">
          {matches.length === 0 ? (
            <div className={styles.mentionEmpty}>No hay Elements que coincidan.</div>
          ) : (
            matches.slice(0, 12).map((el, idx) => (
              <button
                key={String((el as any).id)}
                type="button"
                className={`${styles.mentionItem} ${idx === activeIndex ? styles.mentionItemActive : ""}`}
                onMouseDown={(ev) => {
                  // evita que el textarea pierda el foco antes de insertar
                  ev.preventDefault();
                }}
                onClick={() => insertElement(el)}
              >
                {(el as any).previewUrl ? (
                  <img className={styles.mentionThumb} src={String((el as any).previewUrl)} alt="" />
                ) : (
                  <div className={styles.mentionThumb} aria-hidden="true" />
                )}
                <div className={styles.mentionText}>
                  <div className={styles.mentionName}>@{String((el as any).name || "Element")}</div>
                  {(el as any).tag ? <div className={styles.mentionTag}>{String((el as any).tag)}</div> : null}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
