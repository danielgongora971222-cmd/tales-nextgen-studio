import React, { useEffect, useMemo, useState } from "react";
import type { Asset } from "../types";
import { createCommunityListingFromAsset, updateCommunityListing } from "../services/communityStoreApi";
import { invalidateMyAssetsCache } from "../services/assetsApi";

interface SellListingModalProps {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
}

export default function SellListingModal({ open, asset, onClose }: SellListingModalProps) {
  const [name, setName] = useState<string>("");
  const [price, setPrice] = useState<string>("50");
  const [description, setDescription] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const listing = asset?.communityListing || null;

  const title = useMemo(() => {
    if (!asset) return "Sell";
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

  if (!open) return null;

  async function handleSave() {
    if (!asset) return;

    setBusy(true);
    setError(null);

    try {
      const priceCredits = Math.floor(Number(price));
      if (!Number.isFinite(priceCredits) || priceCredits <= 0) {
        throw new Error("El precio debe ser un número mayor que 0.");
      }

      const listingName = String(name || "").trim();
      if (!listingName) {
        throw new Error("El nombre es obligatorio.");
      }

      const desc = String(description || "").trim();

      if (listing?.id) {
        await updateCommunityListing(listing.id, {
          status: "active",
          name: listingName,
          priceCredits,
          description: desc,
        } as any);
      } else {
        await createCommunityListingFromAsset({
          previewAssetId: asset.id,
          name: listingName,
          priceCredits,
          description: desc,
          listingKind: "single",
        });
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

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-white text-lg font-semibold">{title}</div>
            <div className="text-white/60 text-xs mt-1">
              Aquí decides precio y descripción. La receta queda guardada como snapshot (inmutable).
            </div>
          </div>

          <button
            type="button"
            className="text-white/70 hover:text-white text-sm"
            onClick={() => {
              if (busy) return;
              onClose();
            }}
          >
            Cerrar
          </button>
        </div>

        {asset ? (
          <div className="mt-4 flex gap-4">
            <div className="w-40 h-40 rounded-xl overflow-hidden bg-black/40 border border-white/10 flex items-center justify-center">
              {asset.type === "video" ? (
                <video src={asset.url} className="w-full h-full object-cover" controls />
              ) : (
                <img src={asset.url} className="w-full h-full object-cover" alt={asset.name} />
              )}
            </div>

            <div className="text-white/80 text-xs mb-1">Nombre del listing (único)</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white text-sm mb-3"
                placeholder="Ej: MyBestPromptPack"
                maxLength={80}
              />

            <div className="flex-1">
              <div className="text-white/80 text-xs mb-1">Precio (créditos)</div>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white text-sm"
                inputMode="numeric"
                placeholder="Ej: 50"
              />

              <div className="text-white/80 text-xs mt-3 mb-1">Descripción</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[90px] rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white text-sm"
                placeholder="Explica qué hace y para qué sirve."
              />

              {error ? <div className="mt-3 text-red-400 text-sm">{error}</div> : null}

              <div className="mt-4 flex items-center justify-end gap-2">
                {listing?.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handlePause}
                    className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 disabled:opacity-50"
                  >
                    {busy ? "Procesando..." : "Dejar de vender"}
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSave}
                  className="px-4 py-2 rounded-lg bg-white text-black text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                  {busy ? "Guardando..." : listing?.id ? "Volver a vender / Actualizar" : "Vender"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 text-white/70">No hay asset seleccionado.</div>
        )}
      </div>
    </div>
  );
}
