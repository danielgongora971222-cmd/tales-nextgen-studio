import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppRoute } from "../types";
import {
  listCommunityListings,
  getCommunityListing,
  purchaseCommunityListing,
  getCommunityListingRecipe,
  toggleCommunityListingLike,
  listCommunityListingComments,
  createCommunityListingComment,
} from "../services/communityStoreApi";
import { Heart, MessageCircle, ShoppingCart, X, Loader2 } from "lucide-react";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

const PREFILL_KEY = "tales.prefill.imageGenerator";
const PREFILL_EVENT = "tales:prefill-image-generator";

function fmtInt(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString();
}

function safeJsonParse<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function CommunityStore({ onNavigate }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);

  const [busyLikeById, setBusyLikeById] = useState<Record<string, boolean>>({});
  const [busyPurchase, setBusyPurchase] = useState<boolean>(false);

  const [recipePack, setRecipePack] = useState<any | null>(null);
  const [showRecipe, setShowRecipe] = useState<boolean>(true);
  const [recipeAnimating, setRecipeAnimating] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"overview" | "comments" | "recipe">("overview");

  const [comments, setComments] = useState<any[]>([]);
  const [commentsCount, setCommentsCount] = useState<number>(0);
  const [commentsLoading, setCommentsLoading] = useState<boolean>(false);
  const [commentText, setCommentText] = useState<string>("");

  const modalRef = useRef<HTMLDivElement | null>(null);

  async function loadMore(reset = false) {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const page = await listCommunityListings({
        limit: 12,
        offset: reset ? 0 : offset,
        sort: "recent",
        media: "all",
      });

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

  async function openPreview(listingId: string, tab?: "overview" | "comments" | "recipe") {
    setSelectedId(listingId);
    setSelected(null);
    setRecipePack(null);
    setComments([]);
    setCommentsCount(0);
    setCommentText("");
    setError(null);

    setActiveTab(tab || "overview");
    setShowRecipe(true);
    setRecipeAnimating(false);

    try {
      const item = await getCommunityListing(listingId);
      setSelected(item);

      if (tab === "comments") {
        await loadComments(listingId, true);
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el listing.");
    }

    requestAnimationFrame(() => {
      modalRef.current?.focus();
    });
  }

  async function closePreview() {
    setSelectedId(null);
    setSelected(null);
    setRecipePack(null);
    setComments([]);
    setCommentsCount(0);
    setCommentText("");
    setError(null);
  }

  async function handleToggleLike(listingId: string) {
    if (busyLikeById[listingId]) return;

    setBusyLikeById((p) => ({ ...p, [listingId]: true }));
    setError(null);

    try {
      const res = await toggleCommunityListingLike(listingId);

      setItems((prev) =>
        prev.map((it) =>
          it.id === listingId
            ? { ...it, likedByMe: res.liked, likesCount: res.likesCount }
            : it
        )
      );

      setSelected((prev: any) =>
        prev?.id === listingId ? { ...prev, likedByMe: res.liked, likesCount: res.likesCount } : prev
      );
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar el like.");
    } finally {
      setBusyLikeById((p) => ({ ...p, [listingId]: false }));
    }
  }

  async function handleBuy() {
    if (!selected?.id) return;
    if (busyPurchase) return;

    setBusyPurchase(true);
    setError(null);

    try {
      await purchaseCommunityListing(selected.id, null);

      // refrescar listing (purchasedByMe / salesCount / etc)
      const fresh = await getCommunityListing(selected.id);
      setSelected(fresh);

      // tras compra: cargar receta y mostrarla (con transición suave)
      setRecipeAnimating(true);
      const pack = await getCommunityListingRecipe(selected.id);
      setRecipePack(pack);

      setActiveTab("recipe");
      setShowRecipe(true);

      requestAnimationFrame(() => setRecipeAnimating(false));
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
      setRecipeAnimating(true);
      const pack = await getCommunityListingRecipe(selected.id);
      setRecipePack(pack);
      setActiveTab("recipe");
      setShowRecipe(true);
      requestAnimationFrame(() => setRecipeAnimating(false));
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la receta.");
      setRecipeAnimating(false);
    }
  }

  async function loadComments(listingId: string, reset: boolean) {
    if (commentsLoading) return;

    setCommentsLoading(true);
    setError(null);

    try {
      const res = await listCommunityListingComments(listingId, { limit: 50, offset: reset ? 0 : comments.length });
      const next = reset ? res.comments : [...comments, ...res.comments];

      setComments(next);
      setCommentsCount(res.commentsCount);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar los comentarios.");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function handleCreateComment() {
    if (!selected?.id) return;
    const text = (commentText || "").trim();
    if (!text) return;

    setError(null);
    try {
      const res = await createCommunityListingComment(selected.id, text);
      setCommentText("");

      setComments((prev) => [...prev, res.comment]);
      setCommentsCount(res.commentsCount);

      setItems((prev) =>
        prev.map((it) => (it.id === selected.id ? { ...it, commentsCount: res.commentsCount } : it))
      );
      setSelected((prev: any) => (prev?.id === selected.id ? { ...prev, commentsCount: res.commentsCount } : prev));
    } catch (e: any) {
      setError(e?.message || "No se pudo comentar.");
    }
  }

  function handleReuseRecipe() {
    if (!selected?.id) return;
    if (!recipePack?.recipe) return;

    // guardamos payload para que ImageGeneratorTool lo lea y lo aplique
    window.localStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        listingId: selected.id,
        recipe: recipePack.recipe,
        recipeHash: recipePack.recipeHash || null,
        createdAt: recipePack.createdAt || null,
        resolvedAssets: Array.isArray(recipePack.resolvedAssets) ? recipePack.resolvedAssets : [],
      })
    );

    window.dispatchEvent(new CustomEvent(PREFILL_EVENT));
    onNavigate(AppRoute.TOOL_GENERATOR);
  }

  const selectedPreviewUrl = useMemo(() => selected?.previewUrl || null, [selected]);
  const selectedTitle = useMemo(() => selected?.name || "Sin nombre", [selected]);

  useEffect(() => {
    loadMore(true);
  }, []);

  // Cerrar modal con ESC
  useEffect(() => {
    if (!selectedId) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <div className="text-2xl font-bold">Community Store</div>
          <div className="text-white/60 text-sm mt-1">
            Feed con preview sin recorte + likes/comentarios + compra → receta → reusar.
          </div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition"
          onClick={() => onNavigate(AppRoute.MY_TRADES)}
        >
          Ir a My Trades
        </button>
      </div>

      {error ? <div className="mb-4 text-red-400">{error}</div> : null}

      {/* GRID estilo "History": tiles respetan aspect real (NO object-cover) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((it) => {
          const liked = Boolean(it.likedByMe);
          const likeBusy = Boolean(busyLikeById[it.id]);

          return (
            <div
              key={it.id}
              className="group relative rounded-2xl overflow-hidden bg-black/25 border border-white/10 hover:border-white/20 hover:bg-black/35 transition shadow-[0_18px_44px_rgba(0,0,0,0.45)]"
            >
              {/* Clickable media */}
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => openPreview(it.id, "overview")}
                title="Abrir preview"
              >
                <div className="relative">
                  {/* TOP overlay: seller + compras */}
                  <div className="absolute top-0 left-0 right-0 z-10 p-3 pointer-events-none">
                    <div className="flex items-center justify-between gap-2">
                      <div className="px-2 py-1 rounded-full bg-black/55 border border-white/10 text-[11px] text-white/90 backdrop-blur">
                        @{it.sellerUsername || "creator"}
                      </div>
                      <div className="px-2 py-1 rounded-full bg-black/55 border border-white/10 text-[11px] text-white/90 backdrop-blur">
                        {fmtInt(it.salesCount)} compras
                      </div>
                    </div>
                  </div>

                  {/* media */}
                  <div className="bg-black/30">
                    {it.previewUrl ? (
                      it.mediaTag === "video" ? (
                        <video
                          src={it.previewUrl}
                          className="w-full h-auto block"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img src={it.previewUrl} alt="" className="w-full h-auto block" />
                      )
                    ) : (
                      <div className="w-full h-[220px]" />
                    )}
                  </div>

                  {/* HOVER overlay: like/comment + BUY CTA */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                    {/* bottom actions */}
                    <div className="absolute left-0 right-0 bottom-0 p-3 z-10">
                      <div className="flex items-end justify-between gap-3">
                        {/* like + comments */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={likeBusy}
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition disabled:opacity-60"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleLike(it.id);
                            }}
                            title="Like"
                          >
                            <Heart
                              size={18}
                              className={`text-white ${liked ? "opacity-100" : "opacity-80"} group-hover:animate-pulse`}
                              fill={liked ? "currentColor" : "none"}
                            />
                            <span className="text-xs text-white/90 tabular-nums">{fmtInt(it.likesCount)}</span>
                          </button>

                          <button
                            type="button"
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPreview(it.id, "comments");
                            }}
                            title="Comentarios"
                          >
                            <MessageCircle size={18} className="text-white/90" />
                            <span className="text-xs text-white/90 tabular-nums">{fmtInt(it.commentsCount)}</span>
                          </button>
                        </div>

                        {/* buy CTA */}
                        <div className="flex flex-col items-end gap-2">
                          <div className="px-2 py-1 rounded-full bg-black/55 border border-white/10 text-[11px] text-white/90 backdrop-blur">
                            {fmtInt(it.priceCredits)} créditos
                          </div>

                          <button
                            type="button"
                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white text-black hover:bg-white/90 transition font-semibold"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPreview(it.id, "overview");
                            }}
                            title="Comprar"
                          >
                            <ShoppingCart size={18} />
                            Comprar
                          </button>
                        </div>
                      </div>

                      {/* name + short desc */}
                      <div className="mt-3">
                        <div className="text-sm font-semibold text-white line-clamp-1">{it.name || "Sin nombre"}</div>
                        <div className="text-xs text-white/70 line-clamp-2 mt-1">{it.description || ""}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          );
        })}
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

      {/* MODAL PREVIEW */}
      {selectedId ? (
        <div className="fixed inset-0 z-[5500] bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center">
          <div
            ref={modalRef}
            tabIndex={-1}
            className="w-full max-w-5xl rounded-2xl border border-white/10 bg-[#070707] overflow-hidden outline-none"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
              <div className="min-w-0">
                <div className="text-sm text-white/70">Preview</div>
                <div className="text-lg font-semibold text-white truncate">{selectedTitle}</div>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg bg-white/10 hover:bg-white/15 transition"
                onClick={closePreview}
                title="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            {selected ? (
              <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-0">
                {/* LEFT: image/video, sin crop */}
                <div className="bg-black/40 border-b lg:border-b-0 lg:border-r border-white/10">
                  <div className="flex items-center justify-center p-4">
                    {selectedPreviewUrl ? (
                      selected.mediaTag === "video" ? (
                        <video
                          src={selectedPreviewUrl}
                          className="max-h-[72vh] w-auto max-w-full rounded-xl border border-white/10"
                          controls
                          playsInline
                        />
                      ) : (
                        <img
                          src={selectedPreviewUrl}
                          alt=""
                          className="max-h-[72vh] w-auto max-w-full rounded-xl border border-white/10 object-contain"
                        />
                      )
                    ) : (
                      <div className="w-full h-[420px]" />
                    )}
                  </div>
                </div>

                {/* RIGHT: info + actions */}
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-white/80">
                      @{selected.sellerUsername} · {fmtInt(selected.salesCount)} compras
                    </div>
                    <div className="text-sm text-white/80 tabular-nums">
                      ❤ {fmtInt(selected.likesCount)} · 💬 {fmtInt(selected.commentsCount)}
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-white/60 text-xs">Precio</div>
                      <div className="text-2xl font-extrabold text-white">{fmtInt(selected.priceCredits)} créditos</div>
                    </div>

                    {!selected.ownedByMe && !selected.purchasedByMe ? (
                      <button
                        type="button"
                        disabled={busyPurchase}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black hover:bg-white/90 transition font-semibold disabled:opacity-60"
                        onClick={handleBuy}
                      >
                        {busyPurchase ? <Loader2 className="animate-spin" size={18} /> : <ShoppingCart size={18} />}
                        {busyPurchase ? "Comprando..." : "Comprar"}
                      </button>
                    ) : null}
                  </div>

                  {/* Tabs */}
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-lg border transition text-sm ${
                        activeTab === "overview" ? "bg-white text-black border-white" : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                      onClick={() => setActiveTab("overview")}
                    >
                      Descripción
                    </button>

                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-lg border transition text-sm ${
                        activeTab === "comments" ? "bg-white text-black border-white" : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                      onClick={async () => {
                        setActiveTab("comments");
                        await loadComments(selected.id, true);
                      }}
                    >
                      Comentarios
                    </button>

                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-lg border transition text-sm ${
                        activeTab === "recipe" ? "bg-white text-black border-white" : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                      onClick={handleViewRecipe}
                      disabled={!selected.purchasedByMe && !selected.ownedByMe}
                      title={!selected.purchasedByMe && !selected.ownedByMe ? "Compra para ver la receta" : "Ver receta"}
                    >
                      Receta
                    </button>
                  </div>

                  {/* CONTENT */}
                  {activeTab === "overview" ? (
                    <div className="mt-4">
                      <div className="text-sm text-white/70">Descripción</div>
                      <div className="mt-2 text-white/90 text-sm leading-relaxed whitespace-pre-wrap">
                        {selected.description || "—"}
                      </div>
                    </div>
                  ) : null}

                  {activeTab === "comments" ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-white/70">Comentarios</div>
                        <div className="text-xs text-white/60 tabular-nums">{fmtInt(commentsCount)}</div>
                      </div>

                      <div className="mt-3 space-y-2 max-h-[260px] overflow-auto pr-1">
                        {commentsLoading ? (
                          <div className="text-white/60 text-sm">Cargando…</div>
                        ) : comments.length === 0 ? (
                          <div className="text-white/60 text-sm">Aún no hay comentarios.</div>
                        ) : (
                          comments.map((c) => (
                            <div key={c.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-white/80">@{c.username}</div>
                                <div className="text-[11px] text-white/50 tabular-nums">
                                  {c.timestamp ? new Date(c.timestamp).toLocaleString() : ""}
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-white/90 whitespace-pre-wrap">{c.text}</div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/20 text-sm"
                          placeholder="Escribe un comentario…"
                        />
                        <button
                          type="button"
                          className="px-4 py-2 rounded-xl bg-white text-black hover:bg-white/90 transition font-semibold"
                          onClick={handleCreateComment}
                        >
                          Enviar
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === "recipe" ? (
                    <div className="mt-4">
                      {!selected.purchasedByMe && !selected.ownedByMe ? (
                        <div className="text-sm text-white/60">Compra para ver la receta.</div>
                      ) : recipePack?.recipe ? (
                        <div className={`transition-all duration-300 ${recipeAnimating ? "opacity-50 translate-y-1" : "opacity-100 translate-y-0"}`}>
                          {/* toggle Descripción/Receta (post compra) */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm text-white/70">Contenido</div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className={`px-3 py-1.5 rounded-lg border transition text-sm ${
                                  showRecipe ? "bg-white text-black border-white" : "bg-white/5 border-white/10 hover:bg-white/10"
                                }`}
                                onClick={() => setShowRecipe(true)}
                              >
                                Receta
                              </button>
                              <button
                                type="button"
                                className={`px-3 py-1.5 rounded-lg border transition text-sm ${
                                  !showRecipe ? "bg-white text-black border-white" : "bg-white/5 border-white/10 hover:bg-white/10"
                                }`}
                                onClick={() => setShowRecipe(false)}
                              >
                                Descripción
                              </button>
                            </div>
                          </div>

                          {showRecipe ? (
                            <div className="mt-3 space-y-3">
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-xs text-white/60">Resumen receta</div>
                                <div className="mt-1 text-sm text-white/90">
                                  Tool: <span className="font-semibold">{recipePack.recipe?.sourceAsset?.tool || "—"}</span>
                                </div>
                                <div className="mt-1 text-sm text-white/90">
                                  Modelo: <span className="font-semibold">{recipePack.recipe?.sourceAsset?.meta?.model || "—"}</span>
                                </div>
                                <div className="mt-1 text-sm text-white/90">
                                  Aspect: <span className="font-semibold">{recipePack.recipe?.sourceAsset?.meta?.aspectRatio || "—"}</span> ·
                                  Quality: <span className="font-semibold">{recipePack.recipe?.sourceAsset?.meta?.quality || "—"}</span> ·
                                  Count: <span className="font-semibold">{recipePack.recipe?.sourceAsset?.meta?.count || "—"}</span>
                                </div>
                              </div>

                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-xs text-white/60 mb-2">Prompt</div>
                                <div className="text-sm text-white/90 whitespace-pre-wrap">
                                  {recipePack.recipe?.sourceAsset?.prompt || "—"}
                                </div>
                              </div>

                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-xs text-white/60 mb-2">Referencias incluidas</div>
                                <div className="text-sm text-white/90">
                                  {Array.isArray(recipePack.resolvedAssets) && recipePack.resolvedAssets.length > 0
                                    ? recipePack.resolvedAssets.map((r: any) => (
                                        <div key={r.assetId} className="flex items-center justify-between gap-2 py-1">
                                          <div className="text-white/90">
                                            {r.role} <span className="text-white/50">({r.token || "no-token"})</span>
                                          </div>
                                          <div className="text-white/60 text-xs tabular-nums">{String(r.assetId).slice(0, 8)}</div>
                                        </div>
                                      ))
                                    : "—"}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black hover:bg-white/90 transition font-semibold"
                                  onClick={handleReuseRecipe}
                                  title="Abrir Image Generator con todo seteado"
                                >
                                  Reusar receta
                                </button>
                              </div>

                              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="text-xs text-white/60 mb-2">Recipe JSON completo</div>
                                <pre className="text-xs text-white/80 overflow-auto max-h-[220px]">
{JSON.stringify(recipePack.recipe, null, 2)}
                                </pre>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 text-white/90 text-sm whitespace-pre-wrap">
                              {selected.description || "—"}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3">
                          <button
                            type="button"
                            className="px-4 py-2 rounded-xl bg-white text-black hover:bg-white/90 transition font-semibold"
                            onClick={handleViewRecipe}
                          >
                            Ver receta
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {error ? <div className="mt-3 text-red-400 text-sm">{error}</div> : null}
                </div>
              </div>
            ) : (
              <div className="p-5 text-white/70">Cargando...</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}