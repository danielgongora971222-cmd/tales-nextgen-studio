import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppRoute, Comment } from "../types";
import BottomSheet from "../components/BottomSheet";
import { useAuth } from "../contexts/AuthContext";
import {
  createCommunityListingComment,
  getCommunityListing,
  getCommunityListingRecipe,
  listCommunityListingComments,
  listCommunityListings,
  purchaseCommunityListing,
  toggleCommunityListingLike,
} from "../services/communityStoreApi";
import { BadgeCheck, Heart, Loader2, MessageCircle, Play, ShoppingCart, Sparkles } from "lucide-react";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

type FeedFilter = "all" | "image" | "video";
type SortMode = "recent" | "top_liked" | "top_sold";

type ReelItem = {
  id: string;
  sellerId?: string;
  sellerUsername?: string;
  sellerVerified?: boolean;
  listingKind?: string;
  mediaTag?: string;
  name?: string;
  priceCredits?: number;
  description?: string;
  status?: string;
  previewUrl?: string | null;
  createdAt?: number;
  likesCount?: number;
  commentsCount?: number;
  salesCount?: number;
  likedByMe?: boolean;
  ownedByMe?: boolean;
  purchasedByMe?: boolean;
};

const PREFILL_KEY = "tales.prefill.imageGenerator";
const PREFILL_EVENT = "tales:prefill-image-generator";
const REEL_ENTRY_KEY = "tales.reel.initialListingId";

function fmtCompact(value: any) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(num);
}

function timeAgo(timestamp?: number) {
  if (!timestamp) return "Ahora";
  const diff = Date.now() - Number(timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h`;
  return `${Math.max(1, Math.floor(diff / day))}d`;
}

function sellerInitial(username?: string) {
  return String(username || "T").trim().charAt(0).toUpperCase() || "T";
}

function clampDescription(text?: string) {
  const clean = String(text || "").trim();
  if (!clean) return "Sin descripción todavía.";
  return clean;
}

export default function ReelFeed({ onNavigate }: Props) {
  const { user } = useAuth();

  const [items, setItems] = useState<ReelItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mediaFilter, setMediaFilter] = useState<FeedFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsTarget, setCommentsTarget] = useState<ReelItem | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");

  const [recipeCache, setRecipeCache] = useState<Record<string, any>>({});

  const feedRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const sortChips = [
    { key: "recent" as const, label: "Recentes" },
    { key: "top_liked" as const, label: "Top likes" },
    { key: "top_sold" as const, label: "Top ventas" },
  ];

  const mediaChips = [
    { key: "all" as const, label: "Todo" },
    { key: "image" as const, label: "Imágenes" },
    { key: "video" as const, label: "Videos" },
  ];

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (loading) return;
      setLoading(true);
      setError(null);

      try {
        const response = await listCommunityListings({
          limit: 10,
          offset: reset ? 0 : items.length,
          sort: sortMode,
          media: mediaFilter === "all" ? "all" : mediaFilter,
        });

        let nextItems = reset ? response.items : [...items, ...response.items];

        if (reset) {
          const reelEntryId = window.localStorage.getItem(REEL_ENTRY_KEY);
          if (reelEntryId) {
            window.localStorage.removeItem(REEL_ENTRY_KEY);

            const existingIndex = nextItems.findIndex((item: ReelItem) => item.id === reelEntryId);
            if (existingIndex > 0) {
              const [focused] = nextItems.splice(existingIndex, 1);
              nextItems = [focused, ...nextItems];
            } else if (existingIndex === -1) {
              try {
                const focused = await getCommunityListing(reelEntryId);
                nextItems = [focused, ...nextItems];
              } catch {
                // no-op
              }
            }
          }

          if (nextItems[0]?.id) {
            setActiveId(nextItems[0].id);
          }
        }

        setItems(nextItems);
        setHasMore(Boolean(response.hasMore));
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el carrete.");
      } finally {
        setLoading(false);
      }
    },
    [items, loading, mediaFilter, sortMode]
  );

  useEffect(() => {
    void fetchPage(true);
  }, [mediaFilter, sortMode]);

  useEffect(() => {
    const root = feedRef.current;
    if (!root || items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let winner: { id: string; ratio: number } | null = null;

        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.listingId;
          if (!id) continue;

          if (!winner || entry.intersectionRatio > winner.ratio) {
            winner = { id, ratio: entry.intersectionRatio };
          }
        }

        if (winner && winner.ratio >= 0.55) {
          setActiveId(winner.id);
        }
      },
      {
        root,
        threshold: [0.35, 0.55, 0.75, 0.95],
      }
    );

    for (const item of items) {
      const node = cardRefs.current[item.id];
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (!video) continue;
      if (id === activeId) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => undefined);
        }
      } else {
        video.pause();
      }
    }
  }, [activeId, items]);

  useEffect(() => {
    const root = feedRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchPage(false);
        }
      },
      {
        root,
        threshold: 0.2,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchPage, hasMore, loading]);

  async function refreshListing(listingId: string) {
    const fresh = await getCommunityListing(listingId);
    setItems((prev) => prev.map((item) => (item.id === listingId ? { ...item, ...fresh } : item)));
    if (commentsTarget?.id === listingId) {
      setCommentsTarget((prev) => (prev?.id === listingId ? { ...prev, ...fresh } : prev));
    }
    return fresh;
  }

  async function handleLike(listingId: string) {
    if (!user) {
      onNavigate(AppRoute.MY_CREATIONS);
      return;
    }

    if (busyId === listingId) return;

    setBusyId(listingId);
    setError(null);

    try {
      const next = await toggleCommunityListingLike(listingId);
      setItems((prev) =>
        prev.map((item) =>
          item.id === listingId
            ? { ...item, likedByMe: next.liked, likesCount: next.likesCount }
            : item
        )
      );
      if (commentsTarget?.id === listingId) {
        setCommentsTarget((prev) =>
          prev?.id === listingId ? { ...prev, likedByMe: next.liked, likesCount: next.likesCount } : prev
        );
      }
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar el like.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBuy(item: ReelItem) {
    if (!user) {
      onNavigate(AppRoute.MY_CREATIONS);
      return;
    }

    if (!item.id || busyId === item.id) return;

    setBusyId(item.id);
    setError(null);

    try {
      await purchaseCommunityListing(item.id, null);
      await refreshListing(item.id);

      if (!recipeCache[item.id]) {
        const recipe = await getCommunityListingRecipe(item.id);
        setRecipeCache((prev) => ({ ...prev, [item.id]: recipe }));
      }
    } catch (err: any) {
      setError(err?.message || "No se pudo completar la compra.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReuse(item: ReelItem) {
    if (!item.id || (!item.purchasedByMe && !item.ownedByMe)) return;

    setBusyId(item.id);
    setError(null);

    try {
      const recipe = recipeCache[item.id] || (await getCommunityListingRecipe(item.id));
      setRecipeCache((prev) => ({ ...prev, [item.id]: recipe }));

      window.localStorage.setItem(
        PREFILL_KEY,
        JSON.stringify({
          listingId: item.id,
          recipe: recipe.recipe,
          recipeHash: recipe.recipeHash || null,
          createdAt: recipe.createdAt || null,
          resolvedAssets: Array.isArray(recipe.resolvedAssets) ? recipe.resolvedAssets : [],
        })
      );

      window.dispatchEvent(new CustomEvent(PREFILL_EVENT));
      onNavigate(AppRoute.TOOL_GENERATOR);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar la receta.");
    } finally {
      setBusyId(null);
    }
  }

  async function openComments(item: ReelItem) {
    setCommentsTarget(item);
    setCommentsOpen(true);
    setCommentDraft("");
    setCommentsLoading(true);
    setError(null);

    try {
      const res = await listCommunityListingComments(item.id, { limit: 50, offset: 0 });
      setComments(res.comments);
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, commentsCount: res.commentsCount } : entry
        )
      );
      setCommentsTarget((prev) =>
        prev?.id === item.id ? { ...prev, commentsCount: res.commentsCount } : prev
      );
    } catch (err: any) {
      setComments([]);
      setError(err?.message || "No se pudieron cargar los comentarios.");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function submitComment() {
    if (!commentsTarget?.id || !commentDraft.trim()) return;

    setCommentsLoading(true);
    setError(null);

    try {
      const res = await createCommunityListingComment(commentsTarget.id, commentDraft.trim());
      setComments((prev) => [...prev, res.comment]);
      setCommentDraft("");
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === commentsTarget.id ? { ...entry, commentsCount: res.commentsCount } : entry
        )
      );
      setCommentsTarget((prev) =>
        prev?.id === commentsTarget.id ? { ...prev, commentsCount: res.commentsCount } : prev
      );
    } catch (err: any) {
      setError(err?.message || "No se pudo publicar el comentario.");
    } finally {
      setCommentsLoading(false);
    }
  }

  const reelHeight = useMemo(
    () => "calc(100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 10.75rem)",
    []
  );

  return (
    <div className="relative text-white">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[linear-gradient(180deg,rgba(0,0,0,0.9),rgba(0,0,0,0.66))] px-4 py-4 backdrop-blur-xl md:px-6">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">Carrete</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white md:text-3xl">Feed vertical estilo reels</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
                Una creación por pantalla, scroll vertical, compra rápida, likes, comentarios y reuso de receta.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onNavigate(AppRoute.MY_CREATIONS)}
              className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/88 transition hover:bg-white/10 md:inline-flex"
            >
              Volver al Home
            </button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {mediaChips.map((chip) => {
                const active = mediaFilter === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setMediaFilter(chip.key)}
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition ${
                      active
                        ? "border-[rgba(241,225,148,0.32)] bg-[rgba(241,225,148,0.14)] text-white"
                        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {sortChips.map((chip) => {
                const active = sortMode === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setSortMode(chip.key)}
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition ${
                      active
                        ? "border-white/20 bg-white/14 text-white"
                        : "border-white/10 bg-white/5 text-white/66 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? <div className="text-sm text-red-300">{error}</div> : null}
        </div>
      </div>

      <div
        ref={feedRef}
        className="mx-auto max-w-[1320px] overflow-y-auto overscroll-y-contain snap-y snap-mandatory px-0"
        style={{ height: reelHeight }}
      >
        {items.map((item) => {
          const active = activeId === item.id;
          const expanded = expandedCaptionId === item.id;
          const purchased = Boolean(item.purchasedByMe || item.ownedByMe);
          const buyLabel = purchased ? "Reusar receta" : "Comprar";

          return (
            <article
              key={item.id}
              ref={(node) => {
                cardRefs.current[item.id] = node;
              }}
              data-listing-id={item.id}
              className="snap-start"
              style={{ minHeight: reelHeight }}
            >
              <div className="relative mx-auto flex h-full max-w-[1180px] items-center justify-center px-3 py-3 md:px-6 md:py-5">
                <div className="relative h-full w-full overflow-hidden rounded-none border-y border-white/10 bg-black shadow-[0_28px_90px_rgba(0,0,0,0.55)] md:rounded-[34px] md:border md:border-white/10">
                  {item.previewUrl ? (
                    item.mediaTag === "video" ? (
                      <video
                        ref={(node) => {
                          videoRefs.current[item.id] = node;
                        }}
                        src={item.previewUrl}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <img src={item.previewUrl} alt={item.name || "Listing"} className="absolute inset-0 h-full w-full object-cover" />
                    )
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(91,14,20,0.45),rgba(0,0,0,0.96))]" />
                  )}

                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.22)_35%,rgba(0,0,0,0.72)_72%,rgba(0,0,0,0.94))]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(241,225,148,0.18),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(91,14,20,0.34),transparent_32%)]" />

                  <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3 md:left-6 md:right-6 md:top-6">
                    <div className="inline-flex max-w-[75%] items-center gap-3 rounded-full border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-md">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm font-black text-white">
                        {sellerInitial(item.sellerUsername)}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <span className="truncate">@{item.sellerUsername || "creator"}</span>
                          {item.sellerVerified ? <BadgeCheck className="h-4 w-4 text-[rgba(241,225,148,0.96)]" /> : null}
                        </div>
                        <div className="text-xs text-white/55">
                          {timeAgo(item.createdAt)} · {fmtCompact(item.salesCount)} ventas
                        </div>
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs font-semibold text-white/72 backdrop-blur-md">
                      {item.mediaTag === "video" ? <Play className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                      {item.mediaTag === "video" ? "Video" : "Image"}
                    </div>
                  </div>

                  <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+124px)] right-4 flex flex-col items-center gap-3 md:bottom-8 md:right-6">
                    <button
                      type="button"
                      onClick={() => openComments(item)}
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-md transition hover:bg-black/55"
                      title="Comentarios"
                    >
                      <MessageCircle className="h-5 w-5" />
                    </button>
                    <div className="text-center text-[11px] font-semibold text-white/82">{fmtCompact(item.commentsCount)}</div>

                    <button
                      type="button"
                      onClick={() => handleLike(item.id)}
                      className={`inline-flex h-12 w-12 items-center justify-center rounded-full border text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-md transition ${
                        item.likedByMe
                          ? "border-[rgba(241,225,148,0.26)] bg-[rgba(241,225,148,0.14)]"
                          : "border-white/10 bg-black/35 hover:bg-black/55"
                      }`}
                      title={item.likedByMe ? "Quitar like" : "Dar like"}
                    >
                      <Heart className="h-5 w-5" fill={item.likedByMe ? "currentColor" : "none"} />
                    </button>
                    <div className="text-center text-[11px] font-semibold text-white/82">{fmtCompact(item.likesCount)}</div>

                    <button
                      type="button"
                      onClick={() => {
                        setExpandedCaptionId(item.id);
                        setCommentsTarget(item);
                      }}
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/35 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-md transition hover:bg-black/55"
                      title={`Ver perfil de @${item.sellerUsername || "creator"}`}
                    >
                      {sellerInitial(item.sellerUsername)}
                    </button>

                    <button
                      type="button"
                      onClick={() => (purchased ? handleReuse(item) : handleBuy(item))}
                      className="inline-flex min-h-[52px] min-w-[138px] items-center justify-center rounded-full border border-[rgba(241,225,148,0.34)] bg-[linear-gradient(180deg,rgba(241,225,148,0.95),rgba(201,165,76,0.95))] px-4 py-3 text-sm font-black text-black shadow-[0_18px_40px_rgba(0,0,0,0.38)] transition hover:scale-[1.02]"
                    >
                      {busyId === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
                      {buyLabel}
                    </button>
                    <div className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-semibold text-white/82 backdrop-blur-md">
                      {fmtCompact(item.priceCredits)} credits
                    </div>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-4 md:p-6">
                    <div className="max-w-[min(100%,760px)] rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,8,10,0.72),rgba(8,8,10,0.92))] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl md:p-5">
                      <div className="text-xl font-black tracking-tight text-white md:text-2xl">
                        {item.name || "Community listing"}
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedCaptionId((prev) => (prev === item.id ? null : item.id))}
                        className="mt-3 text-left"
                      >
                        <p className={`text-sm leading-6 text-white/76 ${expanded ? "" : "line-clamp-2"}`}>
                          {clampDescription(item.description)}
                        </p>
                        <span className="mt-2 inline-flex text-xs font-semibold uppercase tracking-[0.18em] text-[rgba(241,225,148,0.88)]">
                          {expanded ? "Ocultar descripción" : "Expandir descripción"}
                        </span>
                      </button>

                      <div className="mt-4 flex items-center gap-3 text-xs text-white/52">
                        <span>{active ? "Activo en pantalla" : "Desliza para seguir"}</span>
                        <span>•</span>
                        <span>{fmtCompact(item.salesCount)} ventas</span>
                        <span>•</span>
                        <span>{fmtCompact(item.commentsCount)} comentarios</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        <div ref={sentinelRef} className="h-12" />

        {loading ? (
          <div className="flex items-center justify-center py-6 text-sm text-white/55">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Cargando más creaciones...
          </div>
        ) : null}
      </div>

      <BottomSheet
        open={commentsOpen}
        title={commentsTarget ? `Comentarios · ${commentsTarget.name || "Listing"}` : "Comentarios"}
        onClose={() => {
          setCommentsOpen(false);
          setCommentsTarget(null);
          setComments([]);
          setCommentDraft("");
        }}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/58">
            {commentsTarget ? `@${commentsTarget.sellerUsername || "creator"} · ${fmtCompact(commentsTarget.commentsCount)} comentarios` : "Sin selección"}
          </div>

          <div className="max-h-[45svh] space-y-3 overflow-y-auto pr-1">
            {commentsLoading && comments.length === 0 ? (
              <div className="text-sm text-white/55">Cargando comentarios...</div>
            ) : comments.length === 0 ? (
              <div className="text-sm text-white/55">Todavía no hay comentarios.</div>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="text-sm font-semibold text-white">@{comment.username}</div>
                  <div className="mt-2 text-sm leading-6 text-white/72">{comment.text}</div>
                </div>
              ))
            )}
          </div>

          {user ? (
            <div className="space-y-3">
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                rows={3}
                placeholder="Escribe tu comentario..."
                className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition focus:border-white/20 focus:bg-white/[0.05]"
              />
              <button
                type="button"
                onClick={submitComment}
                disabled={!commentDraft.trim() || commentsLoading}
                className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-[rgba(241,225,148,0.34)] bg-[rgba(241,225,148,0.16)] px-5 text-sm font-bold text-white transition hover:bg-[rgba(241,225,148,0.22)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {commentsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
                Publicar comentario
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(AppRoute.MY_CREATIONS)}
              className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/88 transition hover:bg-white/10"
            >
              Inicia sesión para comentar
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
