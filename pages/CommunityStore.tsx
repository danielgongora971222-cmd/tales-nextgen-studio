import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  Heart,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { listCommunityListings, toggleCommunityListingLike } from "../services/communityStoreApi";
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
import styles from "./CommunityStore.module.css";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

type ListingItem = {
  id: string;
  sellerId?: string;
  sellerUsername?: string;
  sellerVerified?: boolean;
  mediaTag?: string;
  listingKind?: string;
  name?: string;
  priceCredits?: number;
  priceUsd?: number;
  currency?: string;
  description?: string;
  previewUrl?: string | null;
  likesCount?: number;
  commentsCount?: number;
  salesCount?: number;
  likedByMe?: boolean;
  purchasedByMe?: boolean;
  ownedByMe?: boolean;
};

function compact(value: any) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(num);
}

function avatarSeed(username?: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(String(username || "creator"))}`;
}

function formatListingPrice(item: ListingItem) {
  if (item.listingKind === 'art_deco') {
    const amount = Number(item.priceUsd || 0);
    return amount > 0 ? `$${amount.toFixed(2)} ${item.currency || 'USD'}` : 'Art Deco';
  }
  return `${Number(item.priceCredits || 0).toLocaleString()} créditos`;
}

export default function CommunityStore({ onNavigate }: Props) {
  const { user } = useAuth();

  const [feedState, setFeedState] = useState<CommunityFeedState>(() => readCommunityFeedState());
  const [searchInput, setSearchInput] = useState<string>(() => readCommunityFeedState().searchQuery || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(() => Boolean(readCommunityFeedState().searchQuery));

  const [items, setItems] = useState<ListingItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyLikeById, setBusyLikeById] = useState<Record<string, boolean>>({});

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFeedState((prev) => {
        const next = { ...prev, searchQuery: searchInput.trim() };
        writeCommunityFeedState(next);
        return next;
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadMore = useCallback(
    async (reset = false) => {
      if (loading) return;

      const activeState = reset ? readCommunityFeedState() : feedState;
      const nextOffset = reset ? 0 : offset;
      const wantsMine = activeState.sortKey === "my_shop";

      if (wantsMine && !user) {
        setError("Inicia sesión para ver My Shop.");
        setFeedState(DEFAULT_COMMUNITY_FEED_STATE);
        writeCommunityFeedState(DEFAULT_COMMUNITY_FEED_STATE);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const page = await listCommunityListings({
          limit: 12,
          offset: nextOffset,
          sort: toApiSort(activeState.sortKey),
          media: activeState.mediaKey,
          q: activeState.searchQuery || undefined,
          mine: wantsMine,
        });

        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setOffset(Number(page.nextOffset) || 0);
        setHasMore(Boolean(page.hasMore));
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar Community Store.");
      } finally {
        setLoading(false);
      }
    },
    [feedState, loading, offset, user]
  );

  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    void loadMore(true);
  }, [feedState.sortKey, feedState.mediaKey, feedState.searchQuery]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore(false);
      },
      { rootMargin: "320px 0px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  const activeFilterLabel = useMemo(() => getActiveCommunityFilterLabel(feedState), [feedState]);

  function updateSort(sortKey: CommunitySortKey) {
    if (sortKey === "my_shop" && !user) {
      setError("Inicia sesión para ver My Shop.");
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

  async function handleLike(event: React.MouseEvent, listingId: string) {
    event.stopPropagation();

    if (!user) {
      onNavigate(AppRoute.MY_CREATIONS);
      return;
    }

    if (busyLikeById[listingId]) return;

    setBusyLikeById((prev) => ({ ...prev, [listingId]: true }));
    setError(null);

    try {
      const result = await toggleCommunityListingLike(listingId);
      setItems((prev) =>
        prev.map((item) =>
          item.id === listingId ? { ...item, likedByMe: result.liked, likesCount: result.likesCount } : item
        )
      );
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar el like.");
    } finally {
      setBusyLikeById((prev) => ({ ...prev, [listingId]: false }));
    }
  }

  function openInReel(listingId: string) {
    writeCommunityFeedState(feedState);
    window.localStorage.setItem(REEL_ENTRY_KEY, listingId);
    onNavigate(AppRoute.REEL_FEED);
  }

  return (
    <section className="rounded-[30px] border border-white/10 bg-[rgba(7,7,9,0.72)] p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl md:p-5">
      <div className="flex flex-col gap-3 md:gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/42 md:text-[11px]">Community Store</div>
            <h2 className="mt-2 text-[clamp(1.45rem,3.6vw,2.3rem)] font-black leading-none tracking-tight text-white">
              Community Store
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(AppRoute.MY_TRADES)}
            className="inline-flex min-h-[42px] shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10"
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>My Trades</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
            className={`inline-flex min-h-[42px] max-w-full items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
              filtersOpen
                ? "border-[rgba(241,225,148,0.28)] bg-[rgba(241,225,148,0.12)] text-white"
                : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="max-w-[180px] truncate sm:max-w-[260px]">{activeFilterLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen((value) => !value)}
            className={`inline-flex h-[42px] w-[42px] items-center justify-center rounded-full border transition ${
              searchOpen
                ? "border-white/20 bg-white/12 text-white"
                : "border-white/10 bg-white/5 text-white/88 hover:bg-white/10"
            }`}
            aria-label="Buscar"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>

        {searchOpen ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nombre o @creador"
              className="w-full rounded-[22px] border border-white/10 bg-black/25 py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/32 focus:border-white/20 focus:bg-black/35"
            />
          </div>
        ) : null}

        {filtersOpen ? (
          <div className="grid gap-3 rounded-[24px] border border-white/10 bg-black/25 p-3 md:grid-cols-[1.2fr,1fr] md:p-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42 md:text-[11px]">Sort</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {COMMUNITY_SORT_OPTIONS.map((option) => {
                  const active = feedState.sortKey === option.key;
                  const disabled = option.key === "my_shop" && !user;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => updateSort(option.key)}
                      className={`rounded-full border px-3 py-2 text-[13px] font-semibold transition ${
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
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42 md:text-[11px]">Media</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {COMMUNITY_MEDIA_OPTIONS.map((option) => {
                  const active = feedState.mediaKey === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => updateMedia(option.key)}
                      className={`rounded-full border px-3 py-2 text-[13px] font-semibold transition ${
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
        ) : null}

        {error ? <div className="text-sm text-rose-300">{error}</div> : null}
      </div>

      <div className={styles.feedGrid}>
        {items.map((item) => {
          const purchased = Boolean(item.purchasedByMe || item.ownedByMe);
          const busyLike = Boolean(busyLikeById[item.id]);
          const listingTitle = (item.name || "Community listing").trim() || "Community listing";
          const sellerName = item.sellerUsername || "creator";

          return (
            <article key={item.id} className={styles.card}>
              <button
                type="button"
                className={styles.mediaButton}
                onClick={() => openInReel(item.id)}
                aria-label={`Ver ${listingTitle}`}
              >
                {item.previewUrl ? (
                  item.mediaTag === "video" ? (
                    <video
                      src={item.previewUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className={styles.media}
                    />
                  ) : (
                    <img src={item.previewUrl} alt={listingTitle} className={styles.media} loading="lazy" decoding="async" />
                  )
                ) : (
                  <div className={styles.mediaFallback}>
                    <span>Vista previa no disponible</span>
                  </div>
                )}
              </button>

              <div className={styles.cardBody}>
                <div className={styles.sellerRow}>
                  <div className={styles.sellerIdentity}>
                    <img
                      src={avatarSeed(sellerName)}
                      alt={sellerName}
                      className={styles.avatar}
                      loading="lazy"
                      decoding="async"
                    />
                    <span className={styles.sellerName}>@{sellerName}</span>
                  </div>

                  {item.listingKind === 'art_deco' ? <span className={`${styles.statePill} ${styles.statePillOwned}`}>{item.ownedByMe ? 'Tu Art Deco' : 'Art Deco'}</span> : purchased ? <span className={`${styles.statePill} ${styles.statePillOwned}`}>Comprado</span> : null}
                </div>

                <h3 className={styles.title}>{listingTitle}</h3>

                <div className={styles.actionsRow}>
                  <span className={`${styles.pricePill} ${purchased ? styles.pricePillOwned : ""}`}>
                    {purchased && item.listingKind !== 'art_deco' ? 'Comprado' : formatListingPrice(item)}
                  </span>

                  <button
                    type="button"
                    onClick={(event) => void handleLike(event, item.id)}
                    disabled={busyLike}
                    className={`${styles.likeButton} ${item.likedByMe ? styles.likeButtonActive : ""} ${busyLike ? styles.likeButtonBusy : ""}`}
                    aria-label={item.likedByMe ? "Quitar like" : "Dar like"}
                  >
                    {busyLike ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Heart className="h-4 w-4" fill={item.likedByMe ? "currentColor" : "none"} />
                    )}
                    <span>{compact(item.likesCount)}</span>
                  </button>

                  <button type="button" className={styles.buyButton} onClick={() => openInReel(item.id)}>
                    <span>{item.listingKind === 'art_deco' ? 'Ver compra física' : 'Ir a comprar'}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!loading && items.length === 0 ? (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-white/56">
          No encontramos creaciones con ese filtro.
        </div>
      ) : null}

      <div ref={sentinelRef} className="h-12" />

      {loading ? (
        <div className="flex items-center justify-center gap-2 pb-2 text-sm text-white/58">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Community Store...
        </div>
      ) : null}
    </section>
  );
}
