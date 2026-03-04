import React, { useEffect, useState } from "react";
import { AppRoute } from "../types";
import { listCommunityListings, getCommunityListing, purchaseCommunityListing, getCommunityListingRecipe } from "../services/communityStoreApi";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

export default function CommunityStore({ onNavigate }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);

  const [busyPurchase, setBusyPurchase] = useState<boolean>(false);
  const [recipe, setRecipe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMore(reset = false) {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const page = await listCommunityListings({ limit: 12, offset: reset ? 0 : offset, sort: "recent", media: "all" });
      const next = reset ? page.items : [...items, ...page.items];

      setItems(next);
      setOffset(page.nextOffset);
      setHasMore(page.hasMore);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar Community Store.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMore(true);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setRecipe(null);
      return;
    }

    (async () => {
      setError(null);
      setRecipe(null);

      try {
        const item = await getCommunityListing(selectedId);
        setSelected(item);
      } catch (e: any) {
        setError(e?.message || "No se pudo cargar el listing.");
      }
    })();
  }, [selectedId]);

  async function handleBuy() {
    if (!selected?.id) return;

    setBusyPurchase(true);
    setError(null);

    try {
      await purchaseCommunityListing(selected.id, null);
      const fresh = await getCommunityListing(selected.id);
      setSelected(fresh);
    } catch (e: any) {
      setError(e?.message || "No se pudo comprar.");
    } finally {
      setBusyPurchase(false);
    }
  }

  async function handleViewRecipe() {
    if (!selected?.id) return;

    setError(null);
    try {
      const r = await getCommunityListingRecipe(selected.id);
      setRecipe(r.recipe);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la receta.");
    }
  }

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <div className="text-2xl font-bold">Community Store</div>
          <div className="text-white/60 text-sm mt-1">Listings paginados (12 en 12) con receta protegida.</div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
          onClick={() => onNavigate(AppRoute.MY_TRADES)}
        >
          Ir a My Trades
        </button>
      </div>

      {error ? <div className="mb-4 text-red-400">{error}</div> : null}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((it) => (
          <div
            key={it.id}
            role="button"
            tabIndex={0}
            className="text-left rounded-xl overflow-hidden border border-white/10 bg-black/30 hover:bg-black/40 transition cursor-pointer"
            onClick={() => setSelectedId(it.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelectedId(it.id);
            }}
          >
            <div className="w-full aspect-square bg-black/40">
              {it.previewUrl ? <img src={it.previewUrl} alt="" className="w-full h-full object-cover" /> : null}
            </div>

            <div className="p-3">
              <div className="text-sm font-semibold text-white line-clamp-1">{it.name || "Sin nombre"}</div>

              <div className="mt-1 flex items-center justify-between gap-3">
                <div className="text-xs text-white/70">
                  <span className="font-semibold text-white/80">{it.priceCredits}</span> créditos
                </div>

                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(it.id);
                  }}
                >
                  Comprar
                </button>
              </div>

              <div className="text-xs text-white/60 mt-2">@{it.sellerUsername}</div>
              <div className="text-xs text-white/70 mt-2 line-clamp-2">{it.description}</div>
              <div className="text-[11px] text-white/50 mt-2">
                ❤ {it.likesCount} · 💬 {it.commentsCount} · 🧾 {it.salesCount}
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-white text-black disabled:opacity-50"
            onClick={() => loadMore(false)}
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        </div>
      ) : null}

      {selectedId ? (
        <div className="fixed inset-0 z-[5500] bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Listing</div>
                <div className="text-white/60 text-xs mt-1">No muestra receta sin compra.</div>
              </div>
              <button type="button" className="text-white/70 hover:text-white" onClick={() => setSelectedId(null)}>
                Cerrar
              </button>
            </div>

            {selected ? (
              <div className="mt-4 flex gap-4">
                <div className="w-56 h-56 rounded-xl overflow-hidden bg-black/40 border border-white/10">
                  {selected.previewUrl ? <img src={selected.previewUrl} alt="" className="w-full h-full object-cover" /> : null}
                </div>

                <div className="flex-1">
                  <div className="text-white/80 text-sm">@{selected.sellerUsername}</div>
                  <div className="text-white text-xl font-bold mt-1">{selected.priceCredits} credits</div>
                  <div className="text-white/70 text-sm mt-2">{selected.description}</div>

                  <div className="text-xs text-white/50 mt-3">
                    ❤ {selected.likesCount} · 💬 {selected.commentsCount} · 🧾 {selected.salesCount}
                  </div>

                  {selected.ownedByMe ? (
                    <div className="mt-4 text-xs text-white/60">
                      Este listing es tuyo (no puedes comprarte a ti mismo).
                    </div>
                  ) : selected.purchasedByMe ? (
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        className="px-4 py-2 rounded-lg bg-white text-black"
                        onClick={handleViewRecipe}
                      >
                        Ver receta
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={busyPurchase}
                        className="px-4 py-2 rounded-lg bg-white text-black disabled:opacity-50"
                        onClick={handleBuy}
                      >
                        {busyPurchase ? "Comprando..." : "Comprar"}
                      </button>
                    </div>
                  )}

                  {recipe ? (
                    <div className="mt-4">
                      <div className="text-sm font-semibold mb-2">Recipe JSON</div>
                      <pre className="text-xs bg-black/40 border border-white/10 rounded-lg p-3 max-h-[240px] overflow-auto">
                        {JSON.stringify(recipe, null, 2)}
                      </pre>
                    </div>
                  ) : null}

                  {error ? <div className="mt-3 text-red-400 text-sm">{error}</div> : null}
                </div>
              </div>
            ) : (
              <div className="mt-4 text-white/70">Cargando...</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
