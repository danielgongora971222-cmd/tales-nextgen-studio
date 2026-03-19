import React, { useEffect, useMemo, useRef, useState } from "react";
import { Asset } from "../types";
import { listMyAssetsRobust, uploadUserAsset } from "../services/assetsApi";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: Asset) => void;
  title?: string;
};

type Tab = "pick" | "create";

type SlotInput =
  | { kind: "asset"; assetId: string; previewUrl: string }
  | { kind: "dataUrl"; dataUrl: string; previewUrl: string };

function slugifyName(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function loadImageViaObjectUrl(src: string): Promise<{ img: HTMLImageElement; revoke?: () => void }> {
  const isDataUrl = src.startsWith("data:");
  const img = new Image();

  if (isDataUrl) {
    img.src = src;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("No se pudo cargar la imagen."));
    });
    return { img };
  }

  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`No se pudo descargar una imagen (${resp.status}).`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);

  img.src = url;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("No se pudo cargar la imagen."));
  });

  return { img, revoke: () => URL.revokeObjectURL(url) };
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const iw = img.naturalWidth || (img as any).width || 1;
  const ih = img.naturalHeight || (img as any).height || 1;

  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;

  ctx.drawImage(img, dx, dy, dw, dh);
}

export default function ElementLibraryPickerModal({ open, onClose, onSelect, title }: Props) {
  const [tab, setTab] = useState<Tab>("pick");

  const [elements, setElements] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [library, setLibrary] = useState<Asset[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryErr, setLibraryErr] = useState<string | null>(null);
  const [libraryQ, setLibraryQ] = useState("");
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [slots, setSlots] = useState<(SlotInput | null)[]>([null, null, null, null]);
  const [creating, setCreating] = useState(false);
  const fileInputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  useEffect(() => {
    if (!open) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const assets = await listMyAssetsRobust({ type: "image", limit: 200 });
        if (!alive) return;

        const list = Array.isArray(assets) ? assets : [];
        const els = list.filter((a) => a?.meta?.tool === "element-library" || a?.meta?.isElement === true);
        setElements(els);
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

  useEffect(() => {
    if (!open) return;
    if (tab !== "create") return;

    let alive = true;
    (async () => {
      setLibraryLoading(true);
      setLibraryErr(null);
      try {
        const assets = await listMyAssetsRobust({ type: "image", limit: 400 });
        if (!alive) return;
        const list = Array.isArray(assets) ? assets : [];
        const lib = list.filter((a) => !(a?.meta?.tool === "element-library" || a?.meta?.isElement === true));
        setLibrary(lib);
      } catch (e: any) {
        if (!alive) return;
        setLibraryErr(e?.message || "No se pudo cargar tu biblioteca.");
      } finally {
        if (!alive) return;
        setLibraryLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, tab]);

  const filteredElements = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return elements;
    return elements.filter((x) => (x.name || "").toLowerCase().includes(needle));
  }, [elements, q]);

  const filteredLibrary = useMemo(() => {
    const needle = libraryQ.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((x) => (x.name || "").toLowerCase().includes(needle));
  }, [library, libraryQ]);

  function setSlot(index: number, value: SlotInput | null) {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function resolveSlotToUrl(input: SlotInput): Promise<string> {
    if (input.kind === "dataUrl") return input.dataUrl;
    const a = library.find((x) => x.id === input.assetId);
    return a?.url || input.previewUrl;
  }

  async function buildMosaic2x2(inputs: (SlotInput | null)[]): Promise<File> {
    const s1 = inputs[0];
    if (!s1) throw new Error("Slot 1 es obligatorio (define el aspecto del mosaico).");

    const url1 = await resolveSlotToUrl(s1);
    const loaded1 = await loadImageViaObjectUrl(url1);

    const w1 = loaded1.img.naturalWidth || 1024;
    const h1 = loaded1.img.naturalHeight || 1024;

    const MAX_CELL = 1280;
    const down = Math.min(1, MAX_CELL / Math.max(w1, h1));
    const cellW = Math.max(1, Math.round(w1 * down));
    const cellH = Math.max(1, Math.round(h1 * down));

    const canvas = document.createElement("canvas");
    canvas.width = cellW * 2;
    canvas.height = cellH * 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el canvas.");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const coords = [
      { x: 0, y: 0 },
      { x: cellW, y: 0 },
      { x: 0, y: cellH },
      { x: cellW, y: cellH },
    ];

    drawContain(ctx, loaded1.img, coords[0].x, coords[0].y, cellW, cellH);
    loaded1.revoke?.();

    for (let i = 1; i < 4; i++) {
      const input = inputs[i];
      if (!input) continue;
      const url = await resolveSlotToUrl(input);
      const loaded = await loadImageViaObjectUrl(url);
      drawContain(ctx, loaded.img, coords[i].x, coords[i].y, cellW, cellH);
      loaded.revoke?.();
    }

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo exportar el mosaico."))), "image/jpeg", 0.92);
    });

    return new File([blob], `element_${Date.now()}.jpg`, { type: "image/jpeg" });
  }

  async function buildSingleElementFile(input: SlotInput): Promise<File> {
    if (input.kind === "dataUrl") {
      const resp = await fetch(input.dataUrl);
      const blob = await resp.blob();
      return new File([blob], `element_${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
    }

    const src = await resolveSlotToUrl(input);
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`No se pudo descargar la imagen (${resp.status}).`);
    const blob = await resp.blob();
    return new File([blob], `element_${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
  }

  async function handleCreate() {
    const cleanName = (name || "").trim();
    if (!slots[0]) {
      setErr("Para crear un Element, el Slot 1 es obligatorio (define el aspecto del mosaico). ");
      return;
    }
    if (!cleanName) {
      setErr("Ponle un nombre al Element (obligatorio). ");
      return;
    }

    const imagesCount = slots.filter(Boolean).length;
    if (imagesCount < 1) {
      setErr("Selecciona o sube al menos 1 imagen (máximo 4). ");
      return;
    }

    setCreating(true);
    setErr(null);
    try {
      const baseFile = imagesCount === 1 && slots[0]
        ? await buildSingleElementFile(slots[0])
        : await buildMosaic2x2(slots);

      const slug = slugifyName(cleanName);
      const fileName = slug ? `${slug}.jpg` : `element_${Date.now()}.jpg`;
      const finalFile = new File([baseFile], fileName, { type: baseFile.type || "image/jpeg" });

      const uploaded = await uploadUserAsset(finalFile, { tool: "element-library", category: "element", name: cleanName });

      setElements((prev) => [uploaded, ...prev]);

      onSelect(uploaded);
      setTab("pick");
      setName("");
      setSlots([null, null, null, null]);
      setPickerSlot(null);
      setLibraryQ("");
      onClose();
    } catch (e: any) {
      setErr(e?.message || "No se pudo crear el Element.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-black/60 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="text-sm font-bold text-white/90">
            {title || "Elegir Element (General Image Generator)"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10"
          >
            CERRAR
          </button>
        </div>

        <div className="px-5 pt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("pick")}
            className={`text-xs font-bold px-4 py-2 rounded-xl border ${tab === "pick" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
          >
            ELEGIR
          </button>
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`text-xs font-bold px-4 py-2 rounded-xl border ${tab === "create" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
          >
            CREAR NUEVO
          </button>
        </div>

        <div className="p-5 space-y-4">
          {err && (
            <div className="text-xs text-red-300">{err}</div>
          )}

          {tab === "pick" && (
            <>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar Elements por nombre..."
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20"
              />

              {loading && (
                <div className="text-xs text-white/60">Cargando Elements...</div>
              )}

              {!loading && filteredElements.length === 0 && (
                <div className="text-xs text-white/60">
                  No hay Elements aún. Ve a <b>CREAR NUEVO</b> para generar uno aquí mismo.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredElements.map((el) => (
                  <button
                    key={el.id}
                    type="button"
                    onClick={() => {
                      onSelect(el);
                      onClose();
                    }}
                    className="text-left rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors overflow-hidden"
                  >
                    <div className="aspect-video bg-black/40">
                      {el.url ? (
                        <img
                          src={el.url}
                          alt={el.name}
                          className="w-full h-full object-contain"
                          style={{ objectFit: "contain", objectPosition: "center" }}
                        />
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
                ))}
              </div>

              <div className="text-xs text-white/60 pt-2">
                Tip: si tu Element es un collage/mosaico, está perfecto: el backend lo usa como referencia.
              </div>
            </>
          )}

          {tab === "create" && (
            <>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Nombre del Element</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Persona - Outfit Azul"
                  className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20"
                />
                <div className="text-xs text-white/60">Slot 1 es obligatorio (define el aspecto). Máximo 4 imágenes.</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {slots.map((slot, idx) => (
                  <div key={idx} className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="aspect-video bg-black/40">
                      {slot ? (
                        <img
                          src={slot.previewUrl}
                          alt={`slot-${idx + 1}`}
                          className="w-full h-full object-contain"
                          style={{ objectFit: "contain", objectPosition: "center" }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-white/40">
                          Slot {idx + 1}
                        </div>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="text-xs font-bold text-white/80">Slot {idx + 1}{idx === 0 ? " (obligatorio)" : ""}</div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setPickerSlot(idx)}
                          className="text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10"
                        >
                          BIBLIOTECA
                        </button>

                        <button
                          type="button"
                          onClick={() => fileInputRefs[idx].current?.click()}
                          className="text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10"
                        >
                          SUBIR
                        </button>

                        <button
                          type="button"
                          onClick={() => setSlot(idx, null)}
                          className="text-xs font-bold px-3 py-2 rounded-xl bg-black/30 hover:bg-black/40 border border-white/10"
                        >
                          LIMPIAR
                        </button>
                      </div>

                      <input
                        ref={fileInputRefs[idx]}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.currentTarget.files?.[0];
                          if (!file) return;
                          try {
                            const dataUrl = await fileToDataUrl(file);
                            setSlot(idx, { kind: "dataUrl", dataUrl, previewUrl: dataUrl });
                          } finally {
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="w-full px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-bold disabled:opacity-60"
              >
                {creating ? "Creando Element..." : "Crear Element"}
              </button>
            </>
          )}
        </div>
      </div>

      {pickerSlot !== null && (
        <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-black/70 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="text-sm font-bold text-white/90">Seleccionar imagen (Slot {pickerSlot + 1})</div>
              <button
                type="button"
                onClick={() => setPickerSlot(null)}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10"
              >
                CERRAR
              </button>
            </div>

            <div className="p-5 space-y-4">
              <input
                value={libraryQ}
                onChange={(e) => setLibraryQ(e.target.value)}
                placeholder="Buscar en tu biblioteca..."
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20"
              />

              {libraryLoading && (
                <div className="text-xs text-white/60">Cargando biblioteca...</div>
              )}

              {libraryErr && (
                <div className="text-xs text-red-300">{libraryErr}</div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredLibrary.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setSlot(pickerSlot, { kind: "asset", assetId: a.id, previewUrl: a.url });
                      setPickerSlot(null);
                    }}
                    className="text-left rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors overflow-hidden"
                  >
                    <div className="aspect-video bg-black/40">
                      <img
                        src={a.url}
                        alt={a.name}
                        className="w-full h-full object-contain"
                        style={{ objectFit: "contain", objectPosition: "center" }}
                      />
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-bold text-white/85">{a.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
