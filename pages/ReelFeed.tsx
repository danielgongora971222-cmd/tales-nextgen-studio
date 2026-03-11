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
import {
  COMMUNITY_MEDIA_OPTIONS,
  COMMUNITY_SORT_OPTIONS,
  DEFAULT_COMMUNITY_FEED_STATE,
  REEL_ENTRY_KEY,
  getActiveCommunityFilterLabel,
  readCommunityFeedState,
  toApiSort,
  writeCommunityFeedState,
  type CommunityFeedState,
  type CommunityMediaKey,
  type CommunitySortKey,
} from "../services/communityFeedState";
import { Heart, Loader2, MessageCircle, Play, Search, ShoppingCart, SlidersHorizontal, Sparkles } from "lucide-react";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

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

function compact(value: any) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function avatarSeed(username?: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(String(username || "creator"))}`;
}

function timeAgo(timestamp?: number) {
  if (!timestamp) return "now";
  const diff = Date.now() - Number(timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h`;
  return `${Math.max(1, Math.floor(diff / day))}d`;
}

export default function ReelFeed({ onNavigate }: Props) {
  const { user } = useAuth();

  const [feedState, setFeedState] = useState<CommunityFeedState>(() => readCommunityFeedState());
  const [searchDraft, setSearchDraft] = useState(() => readCommunityFeedState().searchQuery || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [items, setItems] = useState<ReelItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFeedState((prev) => {
        const next = { ...prev, searchQuery: searchDraft.trim() };
        writeCommunityFeedState(next);
        return next;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (loading) return;

      const activeState = reset ? readCommunityFeedState() : feedState;
      const wantsMine = activeState.sortKey === "my_shop";

      if (wantsMine && !user) {
        setFeedState(DEFAULT_COMMUNITY_FEED_STATE);
        writeCommunityFeedState(DEFAULT_COMMUNITY_FEED_STATE);
        setSearchDraft("");
        onNavigate(AppRoute.MY_CREATIONS);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await listCommunityListings({
          limit: 10,
          offset: reset ? 0 : items.length,
          sort: toApiSort(activeState.sortKey),
          media: activeState.mediaKey,
          q: activeState.searchQuery || undefined,
          mine: wantsMine,
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
                // noop
              }
            }
          }

          if (nextItems[0]?.id) setActiveId(nextItems[0].id);
        }

        setItems(nextItems);
        setHasMore(Boolean(response.hasMore));
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el carrete.");
      } finally {
        setLoading(false);
      }
    },
    [feedState, items, loading, onNavigate, user]
  );

  useEffect(() => {
    setItems([]);
    setHasMore(true);
    void fetchPage(true);
  }, [feedState.sortKey, feedState.mediaKey, feedState.searchQuery]);

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

        if (winner && winner.ratio >= 0.55) setActiveId(winner.id);
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
        if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => undefined);
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
        if (entries[0]?.isIntersecting) void fetchPage(false);
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
          item.id === listingId ? { ...item, likedByMe: next.liked, likesCount: next.likesCount } : item
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
      const fresh = await refreshListing(item.id);
      const recipe = await getCommunityListingRecipe(item.id);
      setRecipeCache((prev) => ({ ...prev, [item.id]: recipe }));
      setToast(fresh?.ownedByMe ? "Creation ready to reuse." : "Purchase completed. Recipe unlocked.");
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
        prev.map((entry) => (entry.id === item.id ? { ...entry, commentsCount: res.commentsCount } : entry))
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
    if (!user) {
      onNavigate(AppRoute.MY_CREATIONS);
      return;
    }

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

  const stageHeight = useMemo(
    () => "calc(100svh - env(safe-area-inset-bottom) - 76px)",
    []
  );
  const bottomDock = useMemo(
    () => "calc(env(safe-area-inset-bottom) + 84px)",
    []
  );
  const activeFilterLabel = useMemo(() => getActiveCommunityFilterLabel(feedState), [feedState]);

  function updateSort(sortKey: CommunitySortKey) {
    if (sortKey === "my_shop" && !user) {
      onNavigate(AppRoute.MY_CREATIONS);
      return;
    }
    setFeedState((prev) => {
      const next = { ...prev, sortKey };
      writeCommunityFeedState(next);
      return next;
    });
  }

  function updateMedia(mediaKey: CommunityMediaKey) {
    setFeedState((prev) => {
      const next = { ...prev, mediaKey };
      writeCommunityFeedState(next);
      return next;
    });
  }

  return (
    <div className="relative h-full text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center px-4 pt-[max(env(safe-area-inset-top),12px)]">
        <div className="pointer-events-auto flex min-h-[44px] items-center gap-6 text-sm font-semibold text-white/56">
          <button type="button" className="border-b-2 border-white px-1 pb-2 text-white">
            For You
          </button>
          <button
            type="button"
            onClick={() => setToast("Following llegará pronto.")}
            className="px-1 pb-2 text-white/56 transition hover:text-white/82"
          >
            Following
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex items-center gap-2 px-1 pb-2 text-white/82 transition hover:text-white"
          >
            Filters
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {toast && !error ? (
        <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+54px)] z-20 flex justify-center px-4">
          <div className="rounded-full bg-black/55 px-4 py-2 text-xs font-semibold text-white/86 backdrop-blur-md">
            {toast}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+54px)] z-20 flex justify-center px-4">
          <div className="max-w-[90vw] rounded-full bg-[rgba(91,14,20,0.84)] px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-md">
            {error}
          </div>
        </div>
      ) : null}

      <div ref={feedRef} className="h-full overflow-y-auto snap-y snap-mandatory overscroll-y-contain" style={{ height: stageHeight }}>
        {items.map((item) => {
          const active = activeId === item.id;
          const expanded = expandedCaptionId === item.id;
          const purchased = Boolean(item.purchasedByMe || item.ownedByMe);
          const caption = String(item.description || "").trim() || "This creation is ready to inspire, purchase or reuse later.";

          return (
            <article
              key={item.id}
              ref={(node) => {
                cardRefs.current[item.id] = node;
              }}
              data-listing-id={item.id}
              className="snap-start"
              style={{ height: stageHeight }}
            >
              <div className="relative h-full w-full">
                <div className="relative h-full w-full overflow-hidden bg-black md:mx-auto md:max-w-[430px] md:rounded-[34px] md:shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
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
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(241,225,148,0.18),transparent_34%),linear-gradient(180deg,rgba(91,14,20,0.46),rgba(0,0,0,0.96))]" />
                  )}

                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.06)_28%,rgba(0,0,0,0.18)_52%,rgba(0,0,0,0.86)_84%,rgba(0,0,0,0.98))]" />

                  <div className="absolute inset-x-0 top-0 h-36 bg-[linear-gradient(180deg,rgba(0,0,0,0.62),rgba(0,0,0,0))]" />
                  <div className="absolute inset-x-0 bottom-0 h-56 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.95))]" />

                  <div className="absolute right-3 z-10 flex flex-col items-center gap-4 md:right-4" style={{ bottom: bottomDock }}>
                    <button
                      type="button"
                      className="flex flex-col items-center gap-1"
                      onClick={() => setExpandedCaptionId((prev) => (prev === item.id ? null : item.id))}
                    >
                      <img
                        src={avatarSeed(item.sellerUsername)}
                        alt={item.sellerUsername || "creator"}
                        className="h-12 w-12 rounded-full border border-white/20 bg-black/35 object-cover shadow-[0_12px_28px_rgba(0,0,0,0.32)]"
                      />
                      <span className="max-w-[58px] truncate text-[10px] font-semibold text-white/82">@{item.sellerUsername || "creator"}</span>
                    </button>

                    <button type="button" onClick={() => handleLike(item.id)} className="flex flex-col items-center gap-1">
                      <span
                        className={`inline-flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition ${
                          item.likedByMe
                            ? "bg-[rgba(241,225,148,0.16)] text-white"
                            : "bg-black/35 text-white/92 hover:bg-black/55"
                        }`}
                      >
                        {busyId === item.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Heart className="h-5 w-5" fill={item.likedByMe ? "currentColor" : "none"} />
                        )}
                      </span>
                      <span className="text-[11px] font-semibold text-white/84">{compact(item.likesCount)}</span>
                    </button>

                    <button type="button" onClick={() => openComments(item)} className="flex flex-col items-center gap-1">
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/35 text-white/92 backdrop-blur-md transition hover:bg-black/55">
                        <MessageCircle className="h-5 w-5" />
                      </span>
                      <span className="text-[11px] font-semibold text-white/84">{compact(item.commentsCount)}</span>
                    </button>

                    <div className="rounded-full bg-black/35 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/92 backdrop-blur-md">
                      {Number(item.priceCredits || 0).toLocaleString()} cr
                    </div>

                    <button
                      type="button"
                      onClick={() => (purchased ? handleReuse(item) : handleBuy(item))}
                      className={`inline-flex min-h-[54px] min-w-[136px] items-center justify-center rounded-full px-4 py-3 text-sm font-black shadow-[0_18px_40px_rgba(0,0,0,0.38)] transition ${
                        purchased
                          ? "bg-[linear-gradient(180deg,rgba(18,126,85,0.95),rgba(9,88,61,0.96))] text-white"
                          : "bg-[linear-gradient(180deg,rgba(241,225,148,0.98),rgba(201,165,76,0.96))] text-black"
                      }`}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : purchased ? (
                        <Sparkles className="mr-2 h-4 w-4" />
                      ) : (
                        <ShoppingCart className="mr-2 h-4 w-4" />
                      )}
                      {purchased ? "Reusar receta" : "Comprar"}
                    </button>
                  </div>

                  <div className="absolute left-4 z-10 max-w-[calc(100%-110px)] md:left-5" style={{ bottom: bottomDock }}>
                    <div className="text-sm font-semibold text-white/84">
                      @{item.sellerUsername || "creator"} · {timeAgo(item.createdAt)}
                    </div>
                    <h1 className="mt-2 text-[1.4rem] font-black leading-tight text-white">{item.name || "Community listing"}</h1>
                    <button
                      type="button"
                      onClick={() => setExpandedCaptionId((prev) => (prev === item.id ? null : item.id))}
                      className="mt-3 text-left"
                    >
                      <p className={`text-sm leading-6 text-white/82 ${expanded ? "" : "max-h-[4.5rem] overflow-hidden"}`}>
                        {caption}
                      </p>
                      <span className="mt-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/56">
                        {expanded ? "Hide caption" : "Expand caption"}
                      </span>
                    </button>
                    <div className="mt-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/56">
                      <span>{active ? "Live" : "Swipe"}</span>
                      <span>•</span>
                      <span>{item.mediaTag === "video" ? <Play className="inline h-3.5 w-3.5" /> : <Sparkles className="inline h-3.5 w-3.5" />} {item.mediaTag === "video" ? "Video" : item.mediaTag === "workflow" ? "Workflow" : "Image"}</span>
                      <span>•</span>
                      <span>{compact(item.salesCount)} sales</span>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        <div ref={sentinelRef} className="h-10" />

        {loading ? (
          <div className="flex items-center justify-center py-4 text-sm text-white/56">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading more creations...
          </div>
        ) : null}
      </div>

      <BottomSheet open={filtersOpen} title="Carrete Filters" onClose={() => setFiltersOpen(false)}>
        <div className="space-y-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Active filter</div>
            <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/86">
              {activeFilterLabel}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Search</div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Buscar por nombre o @creador"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/32 focus:border-white/20 focus:bg-white/[0.05]"
              />
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Sort</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMMUNITY_SORT_OPTIONS.map((option) => {
                const active = feedState.sortKey === option.key;
                const disabled = option.key === "my_shop" && !user;

                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateSort(option.key)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-[rgba(241,225,148,0.3)] bg-[rgba(241,225,148,0.14)] text-white"
                        : "border-white/10 bg-white/5 text-white/74 hover:bg-white/10 hover:text-white"
                    } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Media</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMMUNITY_MEDIA_OPTIONS.map((option) => {
                const active = feedState.mediaKey === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => updateMedia(option.key)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-white/20 bg-white/14 text-white"
                        : "border-white/10 bg-white/5 text-white/74 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={commentsOpen}
        title={commentsTarget ? `Comments · ${commentsTarget.name || "Listing"}` : "Comments"}
        onClose={() => {
          setCommentsOpen(false);
          setCommentsTarget(null);
          setComments([]);
          setCommentDraft("");
        }}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/58">
            {commentsTarget
              ? `@${commentsTarget.sellerUsername || "creator"} · ${compact(commentsTarget.commentsCount)} comments`
              : "Sin selección"}
          </div>

          <div className="max-h-[45svh] space-y-3 overflow-y-auto pr-1">
            {commentsLoading && comments.length === 0 ? (
              <div className="text-sm text-white/55">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-sm text-white/55">No comments yet.</div>
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
