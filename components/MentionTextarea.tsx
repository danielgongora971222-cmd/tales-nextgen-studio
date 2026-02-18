import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./MentionTextarea.module.css";

export type MentionItem = {
  id: string;
  token: string; // ej: "@img1" | "@bg" | "@nombre_del_elemento"
  label: string; // texto visible
  kind?: string; // "ref" | "bg" | "element"
  previewUrl?: string | null;
  // Si true: NO aparece en el dropdown, pero sí cuenta como token válido (compat prompts viejos)
  hidden?: boolean;
};

type MentionTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  // Nota: se aplica al "shell" (wrapper) para poder dibujar highlights por debajo del textarea.
  textareaClassName?: string;
  items: MentionItem[];
  maxItems?: number;
  // Hook opcional para el parent: permite side-effects al seleccionar un item.
  // Si devuelve false, NO insertamos el token.
  onSelectItem?: (item: MentionItem) => boolean | void;
};

function normalizeToken(t: string) {
  return (t || "").trim();
}

function normalizeQuery(q: string) {
  return (q || "").trim().toLowerCase();
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  textareaClassName,
  items,
  maxItems = 24,
  onSelectItem,
}: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hiRef = useRef<HTMLDivElement | null>(null);

  const syncWrapperPaddingVars = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const cs = window.getComputedStyle(wrap);
    wrap.style.setProperty("--mt-pad-top", cs.paddingTop || "0px");
    wrap.style.setProperty("--mt-pad-right", cs.paddingRight || "0px");
    wrap.style.setProperty("--mt-pad-bottom", cs.paddingBottom || "0px");
    wrap.style.setProperty("--mt-pad-left", cs.paddingLeft || "0px");
  }, []);

  useLayoutEffect(() => {
    syncWrapperPaddingVars();
  }, [syncWrapperPaddingVars]);

  useEffect(() => {
    const onResize = () => syncWrapperPaddingVars();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [syncWrapperPaddingVars]);

  const [open, setOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);

  const visibleItems = useMemo(() => {
    const src = Array.isArray(items) ? items : [];
    return src.filter((it) => !it.hidden);
  }, [items]);

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    const src = visibleItems;
    if (!q) return src.slice(0, maxItems);

    // match por token o label
    const re = new RegExp(escapeRegExp(q), "i");
    return src
      .filter((it) => re.test(it.token) || re.test(it.label))
      .slice(0, maxItems);
  }, [visibleItems, query, maxItems]);

  const tokenSet = useMemo(() => {
    const set = new Set<string>();
    for (const it of Array.isArray(items) ? items : []) {
      const t = normalizeToken(it.token);
      if (t) set.add(t);
    }
    return set;
  }, [items]);

  // Cierra al click afuera (pero NO al click dentro del picker)
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!open) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (wrap.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Detecta "@..." cerca del caret
  const updateFromCaret = () => {
    const ta = taRef.current;
    if (!ta) return;

    const caret = ta.selectionStart ?? 0;
    const text = ta.value ?? "";
    const upto = text.slice(0, caret);

    // busca el último "@"
    const at = upto.lastIndexOf("@");
    if (at === -1) {
      setOpen(false);
      setQuery("");
      setMentionStart(null);
      return;
    }

    // corta si hay espacio/linebreak entre @ y caret
    const between = upto.slice(at + 1);
    if (/\s/.test(between)) {
      setOpen(false);
      setQuery("");
      setMentionStart(null);
      return;
    }

    setMentionStart(at);
    setQuery(between);
    setOpen(true);
    setActiveIndex(0);
  };

  const insertMention = (it: MentionItem) => {
    const ta = taRef.current;
    if (!ta) return;

    if (typeof onSelectItem === "function") {
      const ok = onSelectItem(it);
      if (ok === false) return;
    }

    const text = ta.value ?? "";
    const caret = ta.selectionStart ?? text.length;
    const start = mentionStart ?? caret;

    const before = text.slice(0, start);
    const after = text.slice(caret);

    const token = normalizeToken(it.token);
    const inserted = `${before}${token} ${after}`;

    onChange(inserted);

    // mueve caret luego del token + espacio
    requestAnimationFrame(() => {
      const nextPos = (before + token + " ").length;
      ta.focus();
      ta.setSelectionRange(nextPos, nextPos);
      setOpen(false);
      setQuery("");
      setMentionStart(null);
    });
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (!filtered.length) return;
      e.preventDefault();
      insertMention(filtered[Math.max(0, Math.min(activeIndex, filtered.length - 1))]);
      return;
    }
  };

  const renderHighlighted = useMemo(() => {
    const text = String(value || "");
    if (!text) return [<span key="empty">{"\u200b"}</span>];

    const re = /@[a-z0-9_]+/gi;
    const nodes: React.ReactNode[] = [];
    let last = 0;
    let idx = 0;

    const pushText = (s: string) => {
      if (s === "") return;
      const parts = s.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) nodes.push(<br key={`br-${idx++}`} />);
        if (parts[i]) nodes.push(<span key={`t-${idx++}`}>{parts[i]}</span>);
      }
    };

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      pushText(text.slice(last, start));

      const token = String(m[0]);
      if (tokenSet.has(token)) {
        nodes.push(
          <span key={`m-${idx++}`} className={styles.mention}>
            {token}
          </span>
        );
      } else {
        nodes.push(<span key={`u-${idx++}`}>{token}</span>);
      }

      last = end;
    }
    pushText(text.slice(last));

    if (!nodes.length) return [<span key="empty">{"\u200b"}</span>];
    return nodes;
  }, [value, tokenSet]);

  const syncScroll = () => {
    const ta = taRef.current;
    const hi = hiRef.current;
    if (!ta || !hi) return;
    hi.scrollTop = ta.scrollTop;
    hi.scrollLeft = ta.scrollLeft;
  };

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${textareaClassName || ""}`}>
      <div ref={hiRef} className={styles.highlighter} aria-hidden="true">
        {renderHighlighted}
      </div>

      <textarea
        ref={taRef}
        className={styles.textarea}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={updateFromCaret}
        onMouseUp={updateFromCaret}
        onFocus={() => {
          syncWrapperPaddingVars();
          updateFromCaret();
        }}

        onScroll={syncScroll}
        placeholder={placeholder}
        aria-label={placeholder || "Prompt"}
        spellCheck={true}
      />

      {open && (
        <div className={styles.picker} role="listbox" aria-label="Insert reference">
          {!filtered.length ? (
            <div className={styles.empty}>No hay coincidencias</div>
          ) : (
            filtered.map((it, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={it.id + it.token}
                  type="button"
                  className={`${styles.item} ${active ? styles.itemActive : ""}`}
                  onMouseDown={(ev) => {
                    // Evita que el textarea pierda el caret antes de insertar.
                    ev.preventDefault();
                    ev.stopPropagation();
                  }}
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

                  {it.kind && <span className={styles.kind}>{it.kind}</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
