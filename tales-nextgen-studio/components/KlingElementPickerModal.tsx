import React, { useEffect, useMemo, useState } from "react";
import { KlingElement, listKlingElements } from "../services/klingElementsService";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (el: KlingElement) => void;
  title?: string;
};

export default function KlingElementPickerModal({ open, onClose, onSelect, title }: Props) {
  const [items, setItems] = useState<KlingElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const els = await listKlingElements();
        if (!alive) return;
        setItems(Array.isArray(els) ? els : []);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "No se pudieron cargar los Elements.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((x) => (x.name || "").toLowerCase().includes(needle));
  }, [items, q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-black/60 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="text-sm font-bold text-white/90">
            {title || "Elegir Person Element"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10"
          >
            CERRAR
          </button>
        </div>

        <div className="p-5 space-y-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20"
          />

          {loading && (
            <div className="text-xs text-white/60">Cargando Elements...</div>
          )}

          {err && (
            <div className="text-xs text-red-300">{err}</div>
          )}

          {!loading && !err && filtered.length === 0 && (
            <div className="text-xs text-white/60">
              No hay Elements. Crea uno en <b>Image Generator &gt; Elements</b> (tipo Person).
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map((el) => {
              const preview = el.previewUrl || el.imageUrls?.[0] || "";
              return (
                <button
                  key={el.id}
                  type="button"
                  onClick={() => onSelect(el)}
                  className="text-left rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors overflow-hidden"
                >
                  <div className="aspect-video bg-black/40">
                    {preview ? (
                      <img src={preview} alt={el.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-white/40">
                        Sin preview
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="text-sm font-bold text-white/90">{el.name}</div>
                    <div className="text-xs text-white/60 mt-1">ID: {el.id}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-white/10 text-xs text-white/60">
          Tip: si tu Element es un collage, está bien. El backend lo usará solo como identidad (no devuelve grillas).
        </div>
      </div>
    </div>
  );
}
