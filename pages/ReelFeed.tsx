import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { writeCommunityRecipePrefill } from "../services/communityRecipePrefill";
import {
  Heart,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

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
  priceUsd?: number;
  currency?: string;
  artDecoPayload?: any;
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

function shortCaption(text?: string) {
  const value = String(text || "").trim() || "This creation is ready to inspire your next recipe.";
  if (value.length <= 22) return value;
  return `${value.slice(0, 22).trimEnd()}...`;
}

function formatListingPrice(item: ReelItem) {
  if (item.listingKind === 'art_deco') {
    const amount = Number(item.priceUsd || item.artDecoPayload?.pricing?.salePrice || 0);
    return amount > 0 ? `$${amount.toFixed(2)}` : 'Art Deco';
  }
  return `${Number(item.priceCredits || 0).toLocaleString()} cr`;
}

function mergeUniqueListings(base: ReelItem[], incoming: ReelItem[]) {
  const seen = new Set<string>();
  const out: ReelItem[] = [];
  for (const item of [...base, ...incoming]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export default function ReelFeed({ onNavigate }: Props) {
  const { user } = useAuth();

  const [feedState, setFeedState] = useState<CommunityFeedState>(() => readCommunityFeedState());
  const [searchDraft, setSearchDraft] = useState(() => readCommunityFeedState().searchQuery || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<ReelItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [reelMuted, setReelMuted] = useState(true);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsTarget, setCommentsTarget] = useState<ReelItem | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [artDecoConfirm, setArtDecoConfirm] = useState<ReelItem | null>(null);

  const [recipeCache, setRecipeCache] = useState<Record<string, any>>({});

  const feedRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!commentsOpen && !artDecoConfirm) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [commentsOpen, artDecoConfirm]);

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

        let nextItems = reset ? response.items : mergeUniqueListings(items, response.items);

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
        }

        setItems(nextItems);
        setHasMore(Boolean(response.hasMore));
        if (nextItems[0]?.id && (reset || !activeId)) setActiveId(nextItems[0].id);
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el carrete.");
      } finally {
        setLoading(false);
      }
    },
    [activeId, feedState, items, loading, onNavigate, user]
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
      const isActive = id === activeId && !commentsOpen;
      video.muted = reelMuted;
      video.defaultMuted = reelMuted;
      if (isActive) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [activeId, commentsOpen, items, reelMuted]);

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
    if (likeBusyId === listingId) return;

    setLikeBusyId(listingId);
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
      setLikeBusyId(null);
    }
  }

  async function handleBuy(item: ReelItem) {
    if (!user) {
      onNavigate(AppRoute.MY_CREATIONS);
      return;
    }
    if (!item.id || actionBusyId === item.id) return;

    if (item.listingKind === 'art_deco') {
      setArtDecoConfirm(item);
      return;
    }

    setActionBusyId(item.id);
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
      setActionBusyId(null);
    }
  }

  async function confirmArtDecoPurchase() {
    if (!artDecoConfirm?.id) return;
    setActionBusyId(artDecoConfirm.id);
    setError(null);
    try {
      const fresh = await getCommunityListing(artDecoConfirm.id);
      setArtDecoConfirm(null);
      window.dispatchEvent(new CustomEvent('tales:open-store', { detail: { artDecoListing: fresh } }));
      onNavigate(AppRoute.STORE);
    } catch (err: any) {
      setError(err?.message || 'No se pudo abrir la compra Art Deco.');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleReuse(item: ReelItem) {
    if (!item.id || (!item.purchasedByMe && !item.ownedByMe)) return;

    setActionBusyId(item.id);
    setError(null);

    try {
      const recipe = recipeCache[item.id] || (await getCommunityListingRecipe(item.id));
      setRecipeCache((prev) => ({ ...prev, [item.id]: recipe }));

      const toolId = recipe?.recipe?.sourceAsset?.tool || recipe?.recipe?.sourceAsset?.meta?.tool || "image-generator";
      const target = writeCommunityRecipePrefill(toolId, {
        listingId: item.id,
        recipe: recipe.recipe,
        recipeHash: recipe.recipeHash || null,
        createdAt: recipe.createdAt || null,
        resolvedAssets: Array.isArray(recipe.resolvedAssets) ? recipe.resolvedAssets : [],
      });

      onNavigate(target.route);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar la receta.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function openComments(item: ReelItem) {
    setCommentsTarget(item);
    setCommentsOpen(true);
    setCommentDraft("");
    setReplyTarget(null);
    setCommentsLoading(true);
    setError(null);

    try {
      const res = await listCommunityListingComments(item.id, { limit: 50, offset: 0 });
      setComments(res.comments);
      setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, commentsCount: res.commentsCount } : entry)));
      setCommentsTarget((prev) => (prev?.id === item.id ? { ...prev, commentsCount: res.commentsCount } : prev));
      window.setTimeout(() => commentInputRef.current?.focus(), 120);
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
      setReplyTarget(null);
      setItems((prev) =>
        prev.map((entry) => (entry.id === commentsTarget.id ? { ...entry, commentsCount: res.commentsCount } : entry))
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

  function triggerReply(comment: Comment) {
    setReplyTarget(comment);
    const next = `@${comment.username} `;
    setCommentDraft((prev) => (prev.startsWith(next) ? prev : next));
    window.setTimeout(() => commentInputRef.current?.focus(), 60);
  }

  function closeComments() {
    setCommentsOpen(false);
    setCommentsTarget(null);
    setComments([]);
    setCommentDraft("");
    setReplyTarget(null);
  }

  const stageHeight = useMemo(() => "calc(100svh - env(safe-area-inset-bottom) - 74px)", []);
  const bottomDock = useMemo(() => "calc(env(safe-area-inset-bottom) + 64px)", []);
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
        <div className="pointer-events-auto flex min-h-[42px] items-center gap-5 rounded-full bg-black/18 px-4 text-sm font-semibold text-white/64 backdrop-blur-md">
          <button type="button" className="border-b-2 border-white px-1 pb-1.5 text-white">
            For You
          </button>
          <button
            type="button"
            onClick={() => setToast("Following llegará pronto.")}
            className="px-1 pb-1.5 text-white/56 transition hover:text-white/82"
          >
            Following
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex items-center gap-1.5 px-1 pb-1.5 text-white/82 transition hover:text-white"
          >
            Filters
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {toast && !error ? (
        <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+52px)] z-20 flex justify-center px-4">
          <div className="rounded-full bg-black/55 px-4 py-2 text-xs font-semibold text-white/86 backdrop-blur-md">
            {toast}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+52px)] z-20 flex justify-center px-4">
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
          const fullCaption = String(item.description || "").trim() || "This creation is ready to inspire your next recipe.";
          const captionPreview = shortCaption(fullCaption);

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
                      <>
                        <video
                          src={item.previewUrl}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <video
                            ref={(node) => {
                              videoRefs.current[item.id] = node;
                            }}
                            src={item.previewUrl}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-contain"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <img
                          src={item.previewUrl}
                          alt={item.name || "Listing"}
                          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <img src={item.previewUrl} alt={item.name || "Listing"} className="h-full w-full object-contain" />
                        </div>
                      </>
                    )
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(241,225,148,0.18),transparent_34%),linear-gradient(180deg,rgba(91,14,20,0.46),rgba(0,0,0,0.96))]" />
                  )}

                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.34),rgba(0,0,0,0.06)_26%,rgba(0,0,0,0.12)_54%,rgba(0,0,0,0.82)_84%,rgba(0,0,0,0.96))]" />
                  <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(0,0,0,0.62),rgba(0,0,0,0))]" />
                  <div className="absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.95))]" />

                  <div className="absolute right-2 z-10 flex flex-col items-center gap-3 md:right-3" style={{ bottom: bottomDock }}>
                    <button type="button" className="relative inline-flex h-12 w-12 items-center justify-center" title="Creator profile próximamente">
                      <img
                        src={avatarSeed(item.sellerUsername)}
                        alt={item.sellerUsername || "creator"}
                        className="h-12 w-12 rounded-full border border-white/20 bg-black/35 object-cover shadow-[0_12px_28px_rgba(0,0,0,0.32)]"
                      />
                      <span className="absolute -bottom-1 left-1/2 inline-flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-white/25 bg-[rgba(241,225,148,0.95)] text-black shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
                        <Plus className="h-3 w-3" />
                      </span>
                    </button>

                    <button type="button" onClick={() => handleLike(item.id)} className="flex flex-col items-center gap-1">
                      <span
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md transition ${
                          item.likedByMe ? "bg-[rgba(255,77,109,0.16)] text-[#ff4d6d]" : "bg-black/35 text-white/92 hover:bg-black/55"
                        }`}
                      >
                        {actionBusyId === item.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Heart className="h-5 w-5" fill={item.likedByMe ? "currentColor" : "none"} />
                        )}
                      </span>
                      <span className="text-[11px] font-semibold text-white/84">{compact(item.likesCount)}</span>
                    </button>

                    <button type="button" onClick={() => openComments(item)} className="flex flex-col items-center gap-1">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white/92 backdrop-blur-md transition hover:bg-black/55">
                        <MessageCircle className="h-5 w-5" />
                      </span>
                      <span className="text-[11px] font-semibold text-white/84">{compact(item.commentsCount)}</span>
                    </button>

                    {item.mediaTag === "video" ? (
                      <button type="button" onClick={() => setReelMuted((prev) => !prev)} className="flex flex-col items-center gap-1">
                        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white/92 backdrop-blur-md transition hover:bg-black/55">
                          {reelMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                        </span>
                        <span className="text-[11px] font-semibold text-white/84">{reelMuted ? "Mute" : "Audio"}</span>
                      </button>
                    ) : null}

                    <div className="animate-pulse text-[15px] font-black text-[rgba(241,225,148,0.98)] drop-shadow-[0_0_12px_rgba(241,225,148,0.4)]">
                      {formatListingPrice(item)}
                    </div>

                    <button
                      type="button"
                      onClick={() => (purchased ? handleReuse(item) : handleBuy(item))}
                      className={`inline-flex min-h-[56px] w-[82px] flex-col items-center justify-center rounded-[18px] px-2 py-3 text-center text-[10px] font-black leading-[1.05] shadow-[0_18px_40px_rgba(0,0,0,0.38)] transition ${
                        purchased
                          ? "bg-[linear-gradient(180deg,rgba(18,126,85,0.95),rgba(9,88,61,0.96))] text-white"
                          : "bg-[linear-gradient(180deg,rgba(241,225,148,0.98),rgba(201,165,76,0.96))] text-black"
                      }`}
                    >
                      {actionBusyId === item.id ? (
                        <Loader2 className="mb-1 h-4 w-4 animate-spin" />
                      ) : purchased ? (
                        <Sparkles className="mb-1 h-4 w-4" />
                      ) : (
                        <ShoppingCart className="mb-1 h-4 w-4" />
                      )}
                      <span>{purchased ? "Reusar receta" : item.listingKind === 'art_deco' ? 'Comprar físico' : 'Comprar'}</span>
                    </button>
                  </div>

                  <div className="absolute left-4 z-10 md:left-5" style={{ bottom: bottomDock }}>
                    <div className="max-w-[min(30ch,calc(100vw-108px))] md:max-w-[30ch]">
                      <div className="text-sm font-semibold text-white/84">
                        @{item.sellerUsername || "creator"} · {timeAgo(item.createdAt)}
                      </div>
                      <h1 className="mt-1 text-[1.1rem] font-black leading-tight text-white md:text-[1.25rem]">
                        {item.name || "Community listing"}
                      </h1>

                      <div className="mt-2 rounded-2xl bg-black/18 px-0 py-0 text-sm text-white/84 backdrop-blur-sm">
                        <div
                          className={`pr-2 leading-5 ${expanded ? "max-h-[7.8rem] overflow-y-auto" : "overflow-hidden"}`}
                          style={{ maxWidth: "30ch" }}
                        >
                          {expanded ? fullCaption : captionPreview}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedCaptionId((prev) => (prev === item.id ? null : item.id))}
                          className="mt-1 text-[12px] font-medium text-white/72"
                        >
                          {expanded ? "show less" : "show more"}
                        </button>
                      </div>

                      <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-white/56">
                        <span>{active ? "Live" : "Swipe"}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1">
                          {item.mediaTag === "video" ? <Play className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {item.listingKind === 'art_deco' ? 'Art Deco' : item.mediaTag === "video" ? "Video" : item.mediaTag === "workflow" ? "Workflow" : "Image"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        <div ref={sentinelRef} className="h-8" />

        {loading ? (
          <div className="flex items-center justify-center py-4 text-sm text-white/56">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading more creations...
          </div>
        ) : null}
      </div>

      <BottomSheet open={filtersOpen} title="Filters" onClose={() => setFiltersOpen(false)}>
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

      {commentsOpen
        ? createPortal(
            <div className="fixed inset-0 z-[130]">
              <div className="absolute inset-0 bg-black/62" onClick={closeComments} />
              <div className="absolute inset-x-0 bottom-0 max-h-[82svh] overflow-hidden rounded-t-[30px] bg-white text-neutral-900 shadow-[0_-28px_80px_rgba(0,0,0,0.45)]" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-black/8 px-4 py-4">
                  <div>
                    <div className="text-sm font-black">Comments</div>
                    <div className="mt-1 text-xs text-black/50">
                      {commentsTarget ? `@${commentsTarget.sellerUsername || "creator"} · ${compact(commentsTarget.commentsCount)} comments` : "No selection"}
                    </div>
                  </div>
                  <button type="button" onClick={closeComments} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/5 text-black/70 transition hover:bg-black/10">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="max-h-[calc(82svh-170px)] overflow-y-auto px-4 pb-24 pt-2">
                  {commentsLoading && comments.length === 0 ? (
                    <div className="py-6 text-sm text-black/55">Loading comments...</div>
                  ) : comments.length === 0 ? (
                    <div className="py-6 text-sm text-black/55">No comments yet.</div>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment.id} className="border-b border-black/6 py-3 last:border-b-0">
                        <div className="flex items-start gap-3">
                          <img src={avatarSeed(comment.username)} alt={comment.username} className="mt-0.5 h-9 w-9 rounded-full border border-black/8 object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="truncate font-semibold text-black">@{comment.username}</span>
                              <span className="text-[11px] text-black/38">{timeAgo(comment.timestamp)}</span>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-black/72">{comment.text}</div>
                            <button type="button" onClick={() => triggerReply(comment)} className="mt-2 text-[12px] font-semibold text-black/45 transition hover:text-black/72">
                              Reply
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="absolute inset-x-0 bottom-0 border-t border-black/8 bg-white px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
                  {replyTarget ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-full bg-black/5 px-3 py-2 text-[12px] text-black/58">
                      <span className="truncate">Replying to @{replyTarget.username}</span>
                      <button type="button" onClick={() => setReplyTarget(null)} className="font-semibold text-black/50">
                        Clear
                      </button>
                    </div>
                  ) : null}

                  {user ? (
                    <div className="flex items-end gap-3">
                      <img src={user.avatarUrl} alt={user.username} className="h-10 w-10 rounded-full border border-black/8 object-cover" />
                      <div className="flex min-w-0 flex-1 items-end gap-2 rounded-[24px] border border-black/10 bg-black/[0.03] px-3 py-2.5">
                        <textarea
                          ref={commentInputRef}
                          value={commentDraft}
                          rows={1}
                          onChange={(event) => setCommentDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              void submitComment();
                            }
                          }}
                          placeholder="Write a comment"
                          className="min-h-[24px] max-h-28 min-w-0 flex-1 resize-none bg-transparent text-sm text-black outline-none placeholder:text-black/32"
                        />
                        <button
                          type="button"
                          onClick={() => void submitComment()}
                          disabled={!commentDraft.trim() || commentsLoading}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label="Enviar comentario"
                        >
                          {commentsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => onNavigate(AppRoute.MY_CREATIONS)} className="inline-flex min-h-[46px] w-full items-center justify-center rounded-full border border-black/10 bg-black/5 px-5 text-sm font-semibold text-black/88 transition hover:bg-black/10">
                      Inicia sesión para comentar
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {artDecoConfirm
        ? createPortal(
            <div className="fixed inset-0 z-[135] flex items-end justify-center px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-6">
              <div className="absolute inset-0 bg-black/72" onClick={() => setArtDecoConfirm(null)} />
              <div className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-[#0b0b10] p-5 text-white shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f1e194]">Art Deco físico</div>
                <h3 className="mt-3 text-xl font-black leading-tight">¿Seguro que deseas comprar este Art Deco?</h3>
                <p className="mt-3 text-sm leading-6 text-white/72">Continuar te llevará al flujo completo de 1NationUp para confirmar producción, entrega y pago. Esta compra corresponde a una creación real y física que fabricaremos o enviaremos según tu solicitud final.</p>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                  <div className="font-semibold text-white">{artDecoConfirm.name || 'Art Deco listing'}</div>
                  <div className="mt-1 text-white/62">Precio publicado: {formatListingPrice(artDecoConfirm)}</div>
                  <div className="mt-2 text-white/52">El creador ya fijó material, medida y encuadre. Tú completarás los datos de entrega y pago antes de confirmar.</div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setArtDecoConfirm(null)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10">Cancelar</button>
                  <button type="button" onClick={() => void confirmArtDecoPurchase()} disabled={actionBusyId === artDecoConfirm.id} className="rounded-2xl bg-[linear-gradient(180deg,rgba(241,225,148,0.98),rgba(201,165,76,0.96))] px-4 py-3 text-sm font-black text-black transition hover:brightness-105 disabled:opacity-60">{actionBusyId === artDecoConfirm.id ? 'Abriendo...' : 'Continuar'}</button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
