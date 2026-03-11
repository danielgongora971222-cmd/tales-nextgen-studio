export type CommunitySortKey = "hot" | "newer" | "older" | "most_commented" | "best_seller" | "my_shop";
export type CommunityMediaKey = "all" | "image" | "video" | "workflow";

export type CommunityFeedState = {
  sortKey: CommunitySortKey;
  mediaKey: CommunityMediaKey;
  searchQuery: string;
};

export const COMMUNITY_FEED_STATE_KEY = "tales.community.feed.state";
export const REEL_ENTRY_KEY = "tales.reel.initialListingId";

export const DEFAULT_COMMUNITY_FEED_STATE: CommunityFeedState = {
  sortKey: "newer",
  mediaKey: "all",
  searchQuery: "",
};

export const COMMUNITY_SORT_OPTIONS: Array<{ key: CommunitySortKey; label: string }> = [
  { key: "newer", label: "Most Recent" },
  { key: "hot", label: "Hot" },
  { key: "best_seller", label: "Best Seller" },
  { key: "most_commented", label: "Most Commented" },
  { key: "older", label: "Oldest" },
  { key: "my_shop", label: "My Shop" },
];

export const COMMUNITY_MEDIA_OPTIONS: Array<{ key: CommunityMediaKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
  { key: "workflow", label: "Workflows" },
];

export function toApiSort(sortKey: CommunitySortKey) {
  switch (sortKey) {
    case "hot":
      return "top_liked" as const;
    case "newer":
      return "recent" as const;
    case "older":
      return "oldest" as const;
    case "most_commented":
      return "top_commented" as const;
    case "best_seller":
      return "top_sold" as const;
    case "my_shop":
      return "recent" as const;
    default:
      return "recent" as const;
  }
}

export function readCommunityFeedState(): CommunityFeedState {
  if (typeof window === "undefined") return DEFAULT_COMMUNITY_FEED_STATE;

  try {
    const raw = window.localStorage.getItem(COMMUNITY_FEED_STATE_KEY);
    if (!raw) return DEFAULT_COMMUNITY_FEED_STATE;

    const parsed = JSON.parse(raw) as Partial<CommunityFeedState>;

    return {
      sortKey: COMMUNITY_SORT_OPTIONS.some((item) => item.key === parsed.sortKey)
        ? (parsed.sortKey as CommunitySortKey)
        : DEFAULT_COMMUNITY_FEED_STATE.sortKey,
      mediaKey: COMMUNITY_MEDIA_OPTIONS.some((item) => item.key === parsed.mediaKey)
        ? (parsed.mediaKey as CommunityMediaKey)
        : DEFAULT_COMMUNITY_FEED_STATE.mediaKey,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : DEFAULT_COMMUNITY_FEED_STATE.searchQuery,
    };
  } catch {
    return DEFAULT_COMMUNITY_FEED_STATE;
  }
}

export function writeCommunityFeedState(state: CommunityFeedState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMMUNITY_FEED_STATE_KEY, JSON.stringify(state));
}

export function getActiveCommunityFilterLabel(state: CommunityFeedState) {
  const sortLabel = COMMUNITY_SORT_OPTIONS.find((item) => item.key === state.sortKey)?.label || "Most Recent";
  const mediaLabel = COMMUNITY_MEDIA_OPTIONS.find((item) => item.key === state.mediaKey)?.label || "All";

  if (state.mediaKey === "all") return sortLabel;
  return `${sortLabel} · ${mediaLabel}`;
}
