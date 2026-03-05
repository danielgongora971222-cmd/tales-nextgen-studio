import React, { useEffect, useMemo, useState } from "react";
import type { Asset } from "../types";
import { createCommunityListingFromAsset, deleteCommunityListing, updateCommunityListing } from "../services/communityStoreApi";
import { invalidateMyAssetsCache } from "../services/assetsApi";
import { MentionTextarea, type MentionItem } from "./MentionTextarea";
import { PauseCircle, Tag, Trash2, X } from "lucide-react";

interface SellListingModalProps {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
}

const MIN_DESC = 20;
const MAX_DESC = 2000;

const TOOL_PRESETS: MentionItem[] = [
  { id: "tool-image-generator", token: "@image-generator", label: "Image Generator", kind: "tool" },
  { id: "tool-restyler", token: "@restyler", label: "Restyler", kind: "tool" },
  { id: "tool-lightroom", token: "@lightroom", label: "Lightroom", kind: "tool" },
  { id: "tool-upscaler", token: "@upscaler", label: "Upscaler", kind: "tool" },
  { id: "tool-editor", token: "@editor", label: "Editor", kind: "tool" },
  { id: "tool-video-generator", token: "@video-generator", label: "Video Generator", kind: "tool" },
];

function clampPriceString(v: string) {
  const raw = String(v ?? "").replace(/[^\d]/g, "");
  if (!raw) return "";
  return String(Math.min(Math.max(parseInt(raw, 10) || 0, 0), 1000000));
}

function toToolToken(tool?: string | null) {
  const t = String(tool || "").trim();
  if (!t) return null;
  const normalized = t.startsWith("@") ? t : `@${t}`;
  return normalized.toLowerCase();
}

function extractAtTokens(text: string) {
  const s = String(text || "");
  const re = /@[a-zA-Z0-9_][a-zA-Z0-9_-]{1,40}/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.add(String(m[0]).toLowerCase());
  return [...out.values()];
}

function renderWithMentions(text: string) {
  const s = String(text || "");
  if (!s) return null;
  const parts = s.split(/(@[a-zA-Z0-9_][a-zA-Z0-9_-]{1,40})/g);
  return parts.map((p, i) => {
    const isMention = /^@[a-zA-Z0-9_][a-zA-Z0-9_-]{1,40}$/.test(p);
    if (!isMention) return <React.Fragment key={i}>{p}</React.Fragment>;
    return (
      <span
        key={i}
        className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-white/90 border border-white/10"
      >
        {p}
      </span>
    );
  });
}

export default function SellListingModal({ open, asset, onClose }: SellListingModalProps) {
  const [name, setName] = useState<string>("");
  const [price, setPrice] = useState<string>("50");
  const [description, setDescription] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const listing = asset?.communityListing || null;

  const title = useMemo(() => {
    if (!asset) return "Vender";
    if (listing?.status === "active") return "Tu listing está ACTIVO";
    if (listing?.status === "unlisted") return "Tu listing está PAUSADO";
    return "Crear listing en Community Store";
  }, [asset, listing?.status]);

  useEffect(() => {
    if (!open || !asset) return;

    setError(null);

    if (listing) {
      setName(String((listing as any).name || ""));
      setPrice(String(listing.priceCredits || 50));
      setDescription(listing.description || "");
    } else {
      setName("");
      setPrice("50");
      setDescription("");
    }
  }, [open, asset?.id, listing?.id]);

  const descTrim = useMemo(() => String(description || "").trim(), [description]);
  const descLen = descTrim.length;

  const toolItems = useMemo(() => {
    const items = [...TOOL_PRESETS];

    const tok = toToolToken(asset?.tool);
    if (tok && !items.some((b) => b.token.toLowerCase() === tok)) {
      items.unshift({ id: `tool-asset-${tok}`, token: tok, label: tok.replace(/^@/, ""), kind: "tool", hidden: true });
    }

    const dyn = extractAtTokens(description);
    for (const t of dyn) {
      if (!items.some((b) => b.token.toLowerCase() === t)) {
        items.push({ id: `tool-dyn-${t}`, token: t, label: t.replace(/^@/, ""), kind: "tool", hidden: true });
      }
    }

    return items;
  }, [asset?.tool, description]);

  function addToolToken(token: string) {
    const t = String(token || "").trim();
    if (!t) return;

    setDescription((prev) => {
      const p = String(prev || "");
      const tok = t.startsWith("@") ? t : `@${t}`;
      if (p.toLowerCase().includes(tok.toLowerCase())) return p;
      const sep = p.trim().length ? (p.endsWith(" ") || p.endsWith("\n") ? "" : " ") : "";
      return `${p}${sep}${tok} `;
    });
  }

  if (!open) return null;

  async function handleSave() {
    if (!asset) return;

    setBusy(true);
    setError(null);

    try {
      const priceCredits = Math.floor(Number(price));
      if (!Number.isFinite(priceCredits) || priceCredits <= 0) throw new Error("El precio debe ser un número mayor que 0.");

      const listingName = String(name || "").trim();
      if (!listingName) throw new Error("El nombre es obligatorio.");
      if (listingName.length < 3) throw new Error("El nombre debe tener al menos 3 caracteres.");

      const desc = String(description || "").trim();
      if (!desc || desc.length < MIN_DESC) throw new Error(`La descripción es obligatoria (mínimo ${MIN_DESC} caracteres).`);
      if (desc.length > MAX_DESC) throw new Error(`La descripción es demasiado larga (máximo ${MAX_DESC} caracteres).`);

      if (listing?.id) {
        await updateCommunityListing(listing.id, { status: "active", name: listingName, priceCredits, description: desc } as any);
      } else {
        await createCommunityListingFromAsset({ previewAssetId: asset.id, name: listingName, priceCredits, description: desc, listingKind: "single" });
      }

      invalidateMyAssetsCache(asset.type);
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el listing.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!asset || !listing?.id) return;

    setBusy(true);
    setError(null);

    try {
      await updateCommunityListing(listing.id, { status: "unlisted" });
      invalidateMyAssetsCache(asset.type);
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo pausar el listing.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteListing() {
    if (!asset || !listing?.id) return;

    const ok = window.confirm(
      "¿Eliminar este listing?\n\nSe quitará de la Community Store y ya no estará en venta. Esta acción se puede revertir creando un listing nuevo desde este mismo asset."
    );
    if (!ok) return;

    setBusy(true);
    setError(null);

    try {
      await deleteCommunityListing(listing.id);
      invalidateMyAssetsCache(asset.type);
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar el listing.");
    } finally {
      setBusy(false);
    }
  }

  const statusBadge =
    listing?.status === "active" ? (
      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200 border border-emerald-500/20">ACTIVO</span>
    ) : listing?.status === "unlisted" ? (
      <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/80 border border-white/10">PAUSADO</span>
    ) : null;

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-5xl">
        <div className="rounded-[28px] bg-gradient-to-br from-white/20 via-white/5 to-transparent p-[1px] shadow-2xl">
          <div className="rounded-[28px] border border-white/10 bg-[#0b0b0b] max-h-[calc(100vh-2rem)] overflow-auto">
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-white text-xl font-extrabold tracking-tight truncate">{title}</div>
                  {statusBadge}
                </div>
                <div className="text-white/60 text-sm mt-1">Haz que se vea premium: nombre corto + descripción completa + precio claro.</div>
              </div>

              <button
                type="button"
                className={`inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/80 hover:text-white hover:bg-white/10 ${busy ? "opacity-40 pointer-events-none" : ""}`}
                onClick={() => { if (!busy) onClose(); }}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {asset ? (
              <div className="px-6 pb-6 pt-5">
                <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-3">
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                      {asset.type === "video" ? (
                        <video src={asset.url} className="w-full aspect-square object-cover" controls />
                      ) : (
                        <img src={asset.url} className="w-full aspect-square object-cover" alt={asset.name} />
                      )}

                      <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-white text-sm font-semibold truncate">{name?.trim() || "Sin nombre"}</div>
                          <div className="text-white/65 text-xs truncate flex items-center gap-1"><Tag className="w-3 h-3" />{asset.tool ? String(asset.tool) : "—"}</div>
                        </div>

                        <div className="shrink-0 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wider text-white/60">Precio</div>
                          <div className="text-white text-sm font-bold">{price || "0"} cr</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                      <div className="text-xs text-white/70 font-semibold mb-2">Descripción (vista comprador)</div>
                      <div className="text-sm text-white/80 whitespace-pre-wrap break-words leading-relaxed">
                        {descTrim ? renderWithMentions(descTrim) : <span className="text-white/40">—</span>}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-3">
                      <div>
                        <div className="text-white/80 text-xs mb-1">Nombre del listing (único)</div>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
                          placeholder="Ej: cinematic-portraits-pack"
                          maxLength={80}
                          disabled={busy}
                        />
                        <div className="mt-1 text-[11px] text-white/45">3–80 caracteres</div>
                      </div>

                      <div>
                        <div className="text-white/80 text-xs mb-1">Precio (créditos)</div>
                        <input
                          value={price}
                          onChange={(e) => setPrice(clampPriceString(e.target.value))}
                          className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
                          inputMode="numeric"
                          placeholder="Ej: 50"
                          disabled={busy}
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          {[25, 50, 100, 250].map((p) => (
                            <button
                              key={p}
                              type="button"
                              disabled={busy}
                              onClick={() => setPrice(String(p))}
                              className={`rounded-full border px-3 py-1 text-xs transition ${String(price) === String(p) ? "border-white/25 bg-white/15 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"}`}
                            >
                              {p} cr
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="text-sm font-semibold text-white">Herramientas destacadas</div>
                      <div className="text-xs text-white/60 mt-1">Toca un chip para insertarlo en la descripción (se verá resaltado con @).</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {toolItems.filter((t) => !t.hidden).map((t) => (
                          <button key={t.id} type="button" disabled={busy} onClick={() => addToolToken(t.token)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white transition">
                            {t.token}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-white/80 text-xs">Descripción <span className="text-red-300">*</span> <span className="text-white/50">(obligatoria)</span></div>
                        <div className={`text-[11px] ${descLen >= MIN_DESC ? "text-white/55" : "text-yellow-200/80"}`}>{descLen}/{MAX_DESC} · mínimo {MIN_DESC}</div>
                      </div>

                      <MentionTextarea
                        value={description}
                        onChange={setDescription}
                        rows={8}
                        placeholder="Cuenta qué es, para qué sirve, y si quieres incluye un paso a paso. Tip: usa @tool."
                        items={toolItems}
                        textareaClassName="mt-2 w-full rounded-2xl bg-black/40 border border-white/10 p-3 text-white text-sm leading-relaxed min-h-[260px] focus-within:ring-2 focus-within:ring-white/15"
                      />
                    </div>

                    {error ? <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-red-200 text-sm">{error}</div> : null}

                    <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                      {listing?.id ? (
                        <button type="button" disabled={busy} onClick={handleDeleteListing} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-600/15 text-red-200 text-sm hover:bg-red-600/20 disabled:opacity-50 border border-red-600/20" title="Eliminar listing">
                          <Trash2 className="w-4 h-4" /> {busy ? "Procesando..." : "Eliminar"}
                        </button>
                      ) : null}

                      {listing?.status === "active" ? (
                        <button type="button" disabled={busy} onClick={handlePause} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/8 text-white text-sm hover:bg-white/12 disabled:opacity-50 border border-white/10">
                          <PauseCircle className="w-4 h-4" /> {busy ? "Procesando..." : "Pausar venta"}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={busy || descLen < MIN_DESC || !String(name || "").trim()}
                        onClick={handleSave}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm disabled:opacity-40 disabled:pointer-events-none bg-gradient-to-r from-[#DFB142] to-[#F5E18A] text-black hover:brightness-105"
                      >
                        {busy ? "Guardando..." : listing?.id ? "Volver a vender / Actualizar" : "Vender"}
                      </button>
                    </div>

                    <div className="mt-3 text-[11px] text-white/45">Límites: descripción {MAX_DESC} chars (servidor). Recomendación: 60–300 chars + pasos.</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-6 pb-6 pt-5 text-white/70">No hay asset seleccionado.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}