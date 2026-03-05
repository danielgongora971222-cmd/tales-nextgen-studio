import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppRoute } from "../types";
import {
  listCommunityListings,
  getCommunityListing,
  updateCommunityListing,
  deleteCommunityListing,
  purchaseCommunityListing,
  getCommunityListingRecipe,
  toggleCommunityListingLike,
  listCommunityListingComments,
  createCommunityListingComment,
} from "../services/communityStoreApi";
import { Heart, MessageCircle, ShoppingCart, X, Loader2, Send, ArrowRightLeft, Pencil, Trash2, Search } from "lucide-react";
import styles from "./tools/ImageGeneratorTool.module.css";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

const PREFILL_KEY = "tales.prefill.imageGenerator";
const PREFILL_EVENT = "tales:prefill-image-generator";

type PreviewPalette = { sand: string; sandDim: string; burgundy: string; burgundyGlow: string };

const PREVIEW_PALETTES: PreviewPalette[] = [
  { sand: "#F1E194", sandDim: "rgba(241, 225, 148, 0.50)", burgundy: "#5B0E14", burgundyGlow: "rgba(91, 14, 20, 0.60)" },
  { sand: "#A7F3D0", sandDim: "rgba(167, 243, 208, 0.45)", burgundy: "#0F766E", burgundyGlow: "rgba(15, 118, 110, 0.55)" },
  { sand: "#93C5FD", sandDim: "rgba(147, 197, 253, 0.45)", burgundy: "#4F46E5", burgundyGlow: "rgba(79, 70, 229, 0.55)" },
  { sand: "#FCA5A5", sandDim: "rgba(252, 165, 165, 0.45)", burgundy: "#BE123C", burgundyGlow: "rgba(190, 18, 60, 0.55)" },
  { sand: "#FDE68A", sandDim: "rgba(253, 230, 138, 0.45)", burgundy: "#B45309", burgundyGlow: "rgba(180, 83, 9, 0.55)" },
  { sand: "#E9D5FF", sandDim: "rgba(233, 213, 255, 0.45)", burgundy: "#7C3AED", burgundyGlow: "rgba(124, 58, 237, 0.55)" },
];

function pickPreviewPalette(): PreviewPalette {
  return PREVIEW_PALETTES[Math.floor(Math.random() * PREVIEW_PALETTES.length)];
}

function fmtInt(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString();
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

function safeJsonParse<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function CommunityStore({ onNavigate }: Props) {
  const { user } = useAuth();

  const [items, setItems] = useState<any[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  type FeedFilter = "hot" | "newer" | "older" | "most_commented" | "best_seller" | "my_shop";
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("hot");

  const filters: { key: FeedFilter; label: string; disabled?: boolean }[] = [
    { key: "hot", label: "Hot" },
    { key: "newer", label: "Newer" },
    { key: "older", label: "Older" },
    { key: "most_commented", label: "Más comentados" },
    { key: "best_seller", label: "Best seller" },
    { key: "my_shop", label: "Mi tienda", disabled: !user },
  ];

  const [searchInput, setSearchInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);

  const [previewPalette, setPreviewPalette] = useState<PreviewPalette>(() => pickPreviewPalette());

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
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editPrice, setEditPrice] = useState<number>(1);
  const [editDesc, setEditDesc] = useState<string>("");
  const [editBusy, setEditBusy] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchQuery((searchInput || "").trim());
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  async function loadMore(reset = false) {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const mine = feedFilter === "my_shop";

      const sort =
        feedFilter === "hot"
          ? "top_liked"
          : feedFilter === "newer"
          ? "recent"
          : feedFilter === "older"
          ? "oldest"
          : feedFilter === "most_commented"
          ? "top_commented"
          : feedFilter === "best_seller"
          ? "top_sold"
          : "recent";

      const page = await listCommunityListings({
        limit: 12,
        offset: reset ? 0 : offset,
        sort,
        media: "all",
        q: searchQuery || undefined,
        mine,
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

    // ✅ paleta aleatoria por preview
    setPreviewPalette(pickPreviewPalette());

    setActiveTab(tab || "overview");

    // ✅ por defecto: descripción (evita “Compra para ver receta” como vista inicial)
    setShowRecipe(false);

    setRecipeAnimating(false);

    try {
      const item = await getCommunityListing(listingId);
      setSelected(item);

      // ✅ si ya está comprado (o es tuyo) entonces sí: receta por defecto
      setShowRecipe(Boolean(item?.purchasedByMe || item?.ownedByMe));

      // ✅ cargar comments 1 vez por apertura (en background)
      // evita duplicar llamadas (y evita pegarle al rate limiter)
      void loadComments(listingId, true);
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

    setEditOpen(false);
    setEditError(null);
  }

  function openEdit() {
    if (!selected?.ownedByMe) return;
    setEditName(String(selected?.name || "").trim());
    setEditPrice(Number(selected?.priceCredits) || 1);
    setEditDesc(String(selected?.description || "").trim());
    setEditError(null);
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!selected?.id) return;
    if (editBusy) return;

    const name = (editName || "").trim();
    const description = (editDesc || "").trim();
    const priceCredits = Math.max(1, Math.floor(Number(editPrice) || 1));

    if (name.length < 3) {
      setEditError("El nombre debe tener al menos 3 caracteres.");
      return;
    }
    if (description.length < 20) {
      setEditError("La descripción debe tener al menos 20 caracteres.");
      return;
    }

    setEditBusy(true);
    setEditError(null);

    try {
      await updateCommunityListing(selected.id, { name, priceCredits, description });

      // Refrescar detalle
      const fresh = await getCommunityListing(selected.id);
      setSelected(fresh);

      // Refrescar item en feed (nombre/precio/descripción)
      setItems((prev) =>
        prev.map((it) =>
          it.id === selected.id
            ? { ...it, name: fresh.name, priceCredits: fresh.priceCredits, description: fresh.description }
            : it
        )
      );

      setEditOpen(false);
    } catch (e: any) {
      setEditError(e?.message || "No se pudo guardar los cambios.");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (!selected?.id) return;
    if (!selected?.ownedByMe) return;

    const ok = window.confirm("¿Eliminar esta creación del Community Store?\n\nEsta acción la quitará del store.");
    if (!ok) return;

    setError(null);
    try {
      await deleteCommunityListing(selected.id);
      await closePreview();
      await loadMore(true);
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar.");
    }
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
    // reset visual cuando cambian filtros/búsqueda
    setItems([]);
    setOffset(0);
    setHasMore(true);
    void loadMore(true);
  }, [feedFilter, searchQuery]);

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
        <div className="flex items-center gap-3">
          <div className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_14px_34px_rgba(0,0,0,0.45)]">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/10" aria-hidden="true" />
            <ShoppingCart className="relative h-5 w-5 text-white/90" />
          </div>

          <div>
            <div className="text-3xl font-extrabold tracking-tight leading-none">
              <span className="bg-gradient-to-r from-white via-white/70 to-white bg-clip-text text-transparent">Community</span>{" "}
              <span className="text-white/90">Store</span>
            </div>
            <div className="mt-1 text-xs text-white/60">
              Presets y recetas listas para reusar, comprar o inspirarte.
            </div>
          </div>
        </div>

        <button
          type="button"
          className="group relative inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 shadow-[0_12px_30px_rgba(0,0,0,0.45)] transition hover:border-white/20 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
          onClick={() => onNavigate(AppRoute.MY_TRADES)}
        >
          <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/10 via-transparent to-white/10 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
          <ArrowRightLeft className="relative h-4 w-4" />
          <span className="relative">Ir a My Trades</span>
        </button>
      </div>



      {error ? <div className="mb-4 text-red-400">{error}</div> : null}

      {/* FEED: MISMO estilo del historial del ImageGeneratorTool (sin marcos / sin forzar aspect) */}
      <div className={styles.grid}>
        {items.map((it) => {
          const liked = Boolean(it.likedByMe);
          const likeBusy = Boolean(busyLikeById[it.id]);

          return (
            <div
              key={it.id}
              role="button"
              tabIndex={0}
              className={styles.tile}
              style={{ borderRadius: 22 }} // ✅ más redondeado
              onClick={() => openPreview(it.id, "overview")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPreview(it.id, "overview");
                }
              }}
              title="Click para ver"
            >
              {it.previewUrl ? (
                it.mediaTag === "video" ? (
                  <video
                    className={styles.tileImg}
                    src={it.previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    className={styles.tileImg}
                    src={it.previewUrl}
                    alt={it.name || "preview"}
                    loading="lazy"
                    decoding="async"
                  />
                )
              ) : null}

              {/* TOP (solo hover): seller + compras */}
              <div
                className={styles.tileActions}
                style={{ left: 10, right: 10, justifyContent: "space-between", pointerEvents: "none" }}
              >
                <span className={styles.publicTag}>@{it.sellerUsername || "creator"}</span>
                <span className={styles.publicTag}>{fmtInt(it.salesCount)} compras</span>
              </div>

              {/* CENTER (solo hover): likes + comentarios centrados */}
              <div
                className={styles.tileActions}
                style={{ top: "50%", left: 0, right: 0, justifyContent: "center", gap: 12 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={styles.ghostBtn}
                  style={{ padding: "8px 12px", fontSize: 12, animation: "klingCtaGlow 1.15s ease-in-out infinite" }}
                  title={liked ? "Quitar Like" : "Dar Like"}
                  disabled={likeBusy}
                  onClick={() => handleToggleLike(it.id)}
                >
                  <Heart size={18} style={{ marginRight: 8 }} fill={liked ? "currentColor" : "none"} />
                  {fmtInt(it.likesCount)}
                </button>

                <button
                  type="button"
                  className={styles.ghostBtn}
                  style={{ padding: "8px 12px", fontSize: 12 }}
                  title="Comentarios"
                  onClick={() => openPreview(it.id, "comments")}
                >
                  <MessageCircle size={18} style={{ marginRight: 8 }} />
                  {fmtInt(it.commentsCount)}
                </button>
              </div>

              {/* BOTTOM (solo hover): precio + comprar (subido para no chocar con el nombre) */}
              <div
                className={styles.tileActions}
                style={{ top: "auto", bottom: 64, left: 10, right: 10, justifyContent: "flex-end" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <span className={styles.publicTag}>{fmtInt(it.priceCredits)} créditos</span>
                  <button
                    type="button"
                    className={styles.generateBtn}
                    style={{ height: 36, padding: "0 14px", fontSize: 11 }}
                    onClick={() => openPreview(it.id, "overview")}
                    title="Abrir preview para comprar"
                  >
                    <ShoppingCart size={16} style={{ marginRight: 8 }} />
                    Comprar
                  </button>
                </div>
              </div>

              {/* Nombre (mismo lugar) */}
              <div className={styles.tileMeta}>
                <span
                  className={styles.tileCaption}
                  style={{ fontWeight: 900, color: "rgba(255,255,255,0.94)", textShadow: "0 6px 18px rgba(0,0,0,0.55)" }}
                >
                  {it.name || "—"}
                </span>
              </div>
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

      {/* MODAL PREVIEW (reusa el viewer del ImageGeneratorTool: sin marco + object-contain) */}
      {selectedId ? (
        <div className={styles.viewerBackdrop}>
          <div
            ref={modalRef}
            tabIndex={-1}
            className={styles.viewer}
            style={
              {
                ["--sand" as any]: previewPalette.sand,
                ["--sand-dim" as any]: previewPalette.sandDim,
                ["--burgundy" as any]: previewPalette.burgundy,
                ["--burgundy-glow" as any]: previewPalette.burgundyGlow,
                position: "relative",
              } as React.CSSProperties
            }
          >
            <div className={styles.viewerTop}>
              <div style={{ minWidth: 0 }}>
                <div className={styles.viewerTitle}>Community Store</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selected?.name || "Sin nombre"}
                </div>
              </div>

              <div className={styles.viewerTopActions}>
                {selected?.ownedByMe ? (
                  <>
                    <button type="button" className={styles.iconBtn} title="Editar" onClick={openEdit}>
                      <Pencil size={18} />
                    </button>
                    <button type="button" className={styles.iconBtn} title="Eliminar" onClick={handleDeleteSelected}>
                      <Trash2 size={18} />
                    </button>
                  </>
                ) : null}
                <button type="button" className={styles.iconBtn} title="Cerrar" onClick={closePreview}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {editOpen ? (
              <div
                role="dialog"
                aria-modal="true"
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                onClick={closeEdit}
              >
                <div
                  className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/80 p-5 text-white backdrop-blur"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-extrabold">Editar publicación</div>
                      <div className="mt-1 text-xs text-white/60">Solo tú (dueño) puedes editar o eliminar.</div>
                    </div>
                    <button type="button" className={styles.iconBtn} title="Cerrar" onClick={closeEdit}>
                      <X size={18} />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-1">
                      <span className="text-xs font-semibold text-white/70">Nombre</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 focus:bg-white/10"
                        placeholder="Ej: Cinematic Portrait Pack"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-xs font-semibold text-white/70">Precio (créditos)</span>
                      <input
                        type="number"
                        value={editPrice}
                        min={1}
                        step={1}
                        onChange={(e) => setEditPrice(Number(e.target.value))}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 focus:bg-white/10"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-xs font-semibold text-white/70">Descripción (mín. 20 caracteres)</span>
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={6}
                        className="resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 focus:bg-white/10"
                        placeholder="Explica el preset/receta: pasos, tips, resultados esperados…"
                      />
                    </label>

                    {editError ? <div className="text-sm text-red-300">{editError}</div> : null}

                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:border-white/20 hover:bg-white/10"
                        onClick={closeEdit}
                        disabled={editBusy}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-extrabold text-black disabled:opacity-60"
                        onClick={handleSaveEdit}
                        disabled={editBusy}
                      >
                        {editBusy ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {selected ? (
              <div className={styles.viewerBody}>
                {/* Imagen/Video: sin marco, ajusta sin recortar */}
                <div className={styles.viewerImageWrap}>
                  {selected.previewUrl ? (
                    selected.mediaTag === "video" ? (
                      <video src={selected.previewUrl} className={styles.viewerImage} style={{ boxShadow: "none" }} controls playsInline />
                    ) : (
                      <img src={selected.previewUrl} alt="" className={styles.viewerImage} style={{ boxShadow: "none" }} />
                    )
                  ) : null}
                </div>

                {/* Panel derecho: módulos separados (glass) */}
                <div className={styles.viewerRecipe}>
                  <div className={styles.recipeGrid}>
                    {/* Módulo 1: vendedor + métricas */}
                    <div className={styles.recipeItemWide}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span className={styles.publicTag}>@{selected.sellerUsername}</span>
                          <span className={styles.publicTag}>{fmtInt(selected.salesCount)} compras</span>
                        </div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(255,255,255,0.85)" }}>
                          ❤ {fmtInt(selected.likesCount)} · 💬 {fmtInt(selected.commentsCount)}
                        </div>
                      </div>
                    </div>

                    {/* Módulo 2: comprar + like + receta */}
                    <div className={styles.recipeItemWide}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div className={styles.viewerRecipeLabel}>Precio</div>
                          <div style={{ fontSize: 22, fontWeight: 900, color: "rgba(255,255,255,0.96)" }}>
                            {fmtInt(selected.priceCredits)} créditos
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnHeart} ${selected.likedByMe ? styles.iconBtnHeartActive : ""}`}
                            style={{ animation: "klingCtaGlow 1.15s ease-in-out infinite" }}
                            title={selected.likedByMe ? "Quitar Like" : "Dar Like"}
                            disabled={Boolean(busyLikeById[selected.id])}
                            onClick={() => handleToggleLike(selected.id)}
                          >
                            <Heart size={18} fill={selected.likedByMe ? "currentColor" : "none"} />
                          </button>

                          {!selected.ownedByMe && !selected.purchasedByMe ? (
                            <button type="button" className={styles.generateBtn} disabled={busyPurchase} onClick={handleBuy}>
                              {busyPurchase ? <Loader2 size={18} className={styles.spin} /> : <ShoppingCart size={18} />}
                              {busyPurchase ? "Comprando..." : "Comprar"}
                            </button>
                          ) : (
                            <span className={styles.publicTag}>Comprado</span>
                          )}

                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={handleViewRecipe}
                            disabled={!selected.purchasedByMe && !selected.ownedByMe}
                            title={!selected.purchasedByMe && !selected.ownedByMe ? "Compra para ver receta" : "Ver receta"}
                          >
                            Ver receta
                          </button>

                          {recipePack?.recipe ? (
                            <button type="button" className={styles.generateBtn} onClick={handleReuseRecipe} title="Abrir Image Generator con todo listo">
                              Reusar receta
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Módulo 3: descripción ↔ receta (toggle + transición) */}
                    <div className={styles.recipeItemWide}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div className={styles.viewerRecipeTitle}>{showRecipe ? "Receta" : "Descripción"}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className={styles.ghostBtn} onClick={() => setShowRecipe(false)}>Descripción</button>
                          <button type="button" className={styles.ghostBtn} onClick={() => setShowRecipe(true)}>Receta</button>
                        </div>
                      </div>

                      <div style={{ marginTop: 12, animation: recipeAnimating ? "popIn 0.22s var(--ease-smooth)" : undefined }}>
                        {showRecipe ? (
                          !selected.purchasedByMe && !selected.ownedByMe ? (
                            <div className={styles.viewerRecipeValue}>Compra para ver la receta.</div>
                          ) : recipePack?.recipe ? (
                            <>
                              <div className={styles.viewerRecipeLabel}>Resumen</div>
                              <div className={styles.viewerRecipeValue}>
                                Tool: {recipePack.recipe?.sourceAsset?.tool || "—"}{"\n"}
                                Modelo: {recipePack.recipe?.sourceAsset?.meta?.model || "—"}{"\n"}
                                Aspect: {recipePack.recipe?.sourceAsset?.meta?.aspectRatio || "—"} · Quality: {recipePack.recipe?.sourceAsset?.meta?.quality || "—"} · Count: {recipePack.recipe?.sourceAsset?.meta?.count || "—"}
                              </div>

                              <div className={styles.viewerRecipeLabel}>Prompt</div>
                              <div className={styles.viewerRecipeValue}>{recipePack.recipe?.sourceAsset?.prompt || "—"}</div>

                              <div className={styles.viewerRecipeLabel}>Referencias</div>
                              <div className={styles.viewerRecipeValue}>
                                {Array.isArray(recipePack.resolvedAssets) && recipePack.resolvedAssets.length
                                  ? recipePack.resolvedAssets.map((r: any) => `${r.role} ${r.token || ""} (${String(r.assetId).slice(0, 10)})`).join("\n")
                                  : "—"}
                              </div>
                            </>
                          ) : (
                            <button type="button" className={styles.generateBtn} onClick={handleViewRecipe}>
                              Cargar receta
                            </button>
                          )
                        ) : (
                          <div className={styles.viewerRecipeValue}>
                            {selected.description ? renderWithMentions(selected.description) : "—"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Módulo 4: comentarios (separado) */}
                    <div className={styles.recipeItemWide}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div className={styles.viewerRecipeTitle}>Comentarios</div>
                        <div className={styles.viewerRecipeLabel}>{fmtInt(commentsCount)}</div>
                      </div>

                      <div style={{ marginTop: 12, maxHeight: 260, overflow: "auto" }}>
                        {commentsLoading ? (
                          <div className={styles.viewerRecipeValue}>Cargando…</div>
                        ) : comments.length === 0 ? (
                          <div className={styles.viewerRecipeValue}>Aún no hay comentarios.</div>
                        ) : (
                          comments.map((c) => (
                            <div key={c.id} style={{ marginBottom: 10 }}>
                              <div className={styles.viewerRecipeLabel}>
                                @{c.username} · {c.timestamp ? new Date(c.timestamp).toLocaleString() : ""}
                              </div>
                              <div className={styles.viewerRecipeValue}>{c.text}</div>
                            </div>
                          ))
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <input
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Escribe un comentario…"
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: "1px solid rgba(255,255,255,0.10)",
                            background: "rgba(0,0,0,0.25)",
                            color: "rgba(255,255,255,0.92)",
                            outline: "none",
                          }}
                        />
                        <button
                          type="button"
                          className={styles.generateBtn}
                          style={{ width: 46, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          onClick={handleCreateComment}
                          title="Enviar comentario"
                          aria-label="Enviar comentario"
                        >
                          <Send size={18} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Filtros + búsqueda */}
                  <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {filters.map((f) => {
                        const active = feedFilter === f.key;
                        return (
                          <button
                            key={f.key}
                            type="button"
                            disabled={f.disabled}
                            className={
                              "rounded-xl border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/25 " +
                              (active
                                ? "border-white/25 bg-white/15 text-white"
                                : "border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10") +
                              (f.disabled ? " opacity-50 cursor-not-allowed" : "")
                            }
                            onClick={() => {
                              if (f.disabled) {
                                setError("Inicia sesión para ver ‘Mi tienda’. ");
                                return;
                              }
                              setError(null);
                              setFeedFilter(f.key);
                            }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="relative w-full md:w-[360px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/55" />
                      <input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Buscar por nombre o @creador…"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 py-2 pl-10 pr-3 text-sm text-white/90 outline-none transition focus:border-white/25 focus:bg-white/10"
                      />
                    </div>
                  </div>

                  {error ? <div style={{ marginTop: 10, color: "rgba(248, 113, 113, 0.95)" }}>{error}</div> : null}
                </div>
              </div>
            ) : (
              <div style={{ padding: 18, color: "rgba(255,255,255,0.70)" }}>Cargando...</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}