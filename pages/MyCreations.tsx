import React, { useEffect, useMemo, useRef, useState } from "react";
import { deleteAsset, downloadAssetToDisk, listMyAssets } from "../services/assetsApi";
import { Asset } from "../types";
import styles from "./MyCreations.module.css";
import generatorStyles from "./tools/ImageGeneratorTool.module.css";
import { EVENT_MY_CREATIONS_FILTER } from "../services/appEvents";
import { toggleLike } from "../services/socialApi";
import OneNationUpIcon from "../components/brand/OneNationUpIcon";
import { readFavoriteAssetIds, syncFavoriteAssetState, writeFavoriteAssetIds } from "../services/favoriteAssets";
import {
  finalizeVideoStill,
  prepareVideoPreview,
  primeVideoStill,
  resetVideoStill,
  startVideoHoverPreview,
} from "./tools/video/videoPreview";

type FilterKey =
  | "all"
  | "favorites"
  | "image"
  | "video"
  | "lip-sync"
  | "motion-control"
  | "element"
  | "reference"
  | "audio"
  | "extras";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "favorites", label: "Favoritos" },
  { key: "image", label: "Solo Imagen" },
  { key: "video", label: "Solo Video" },
  { key: "lip-sync", label: "Lip-Sync" },
  { key: "motion-control", label: "Motion Control" },
  { key: "element", label: "Element" },
  { key: "reference", label: "Reference" },
  { key: "audio", label: "Audio" },
  { key: "extras", label: "Extras" },
];

const SELLABLE_IMAGE_TOOLS = new Set(["image-generator", "editor-pro"]);
const SELLABLE_VIDEO_TOOLS = new Set(["video-generator", "video-edit", "ingredients-to-video", "extend-video"]);

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeHiddenBlocks(input: string) {
  let out = input || "";
  const pairs = [
    { start: "[[STYLE_PRESET_START]]", end: "[[STYLE_PRESET_END]]" },
    { start: "/* STYLE_PRESET_START */", end: "/* STYLE_PRESET_END */" },
    { start: "[[LIGHTING_PRESET_START]]", end: "[[LIGHTING_PRESET_END]]" },
    { start: "[[UPSCALE_MASTER_START]]", end: "[[UPSCALE_MASTER_END]]" },
  ];

  for (const { start, end } of pairs) {
    const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, "g");
    out = out.replace(re, "");
  }
  return out.trim();
}

function getToolId(asset: Asset) {
  const meta = (asset as any)?.meta || {};
  const direct = typeof asset.tool === "string" ? asset.tool : "";
  return direct || (typeof meta.tool === "string" ? meta.tool : "");
}

function getCaption(asset: Asset) {
  const tool = getToolId(asset);
  if (tool === "upscaler") return "UPSCALE";
  const cleaned = removeHiddenBlocks(asset.prompt || "");
  return cleaned || asset.name || "—";
}

function canSellAsset(asset: Asset) {
  if ((asset as any)?.accessSource === "purchased") return false;
  const tool = getToolId(asset);
  if (asset.type === "image") return SELLABLE_IMAGE_TOOLS.has(tool);
  if (asset.type === "video") return SELLABLE_VIDEO_TOOLS.has(tool);
  return false;
}

const MyCreations: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoriteAssetIds());
  const [error, setError] = useState<string | null>(null);
  const [likeBusyById, setLikeBusyById] = useState<Record<string, boolean>>({});
  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    const handler = (ev: any) => {
      const key = ev?.detail?.filterKey;
      if (key) setActiveFilter(key);
    };

    window.addEventListener(EVENT_MY_CREATIONS_FILTER, handler as any);
    return () => window.removeEventListener(EVENT_MY_CREATIONS_FILTER, handler as any);
  }, []);

  useEffect(() => {
    setLoading(true);
    listMyAssets()
      .then((items) => {
        const sorted = [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setAssets(sorted);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    writeFavoriteAssetIds(favoriteIds);
  }, [favoriteIds]);

  useEffect(() => {
    const onFavs = () => setFavoriteIds(readFavoriteAssetIds());
    window.addEventListener("tales:favorites-updated", onFavs as any);
    return () => window.removeEventListener("tales:favorites-updated", onFavs as any);
  }, []);

  const filteredAssets = useMemo(() => {
    const matchFilter = (asset: Asset) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "favorites") return favoriteIds.includes(asset.id);
      if (activeFilter === "image") return asset.type === "image";
      if (activeFilter === "video") return asset.type === "video";

      const meta = (asset as any).meta || {};
      const tool = typeof meta.tool === "string" ? meta.tool : "";
      const category = typeof meta.category === "string" ? meta.category : "";

      switch (activeFilter) {
        case "lip-sync":
          return tool === "lip-sync" || category === "lip-sync";
        case "motion-control":
          return tool === "motion-control" || category === "motion-control";
        case "element":
          return tool === "element-library" || meta.isElement === true;
        case "reference":
          return (
            tool === "image-generator-ref" ||
            tool === "upscaler-ref" ||
            tool === "restyler-ref" ||
            tool === "lightroom-ref" ||
            category === "reference"
          );
        case "audio":
          return tool === "audio" || category === "audio";
        case "extras":
          return tool === "extras" || category === "extras";
        default:
          return true;
      }
    };

    return assets.filter(matchFilter);
  }, [assets, activeFilter, favoriteIds]);

  async function handleToggleLike(asset: Asset) {
    if (likeBusyById[asset.id]) return;
    setLikeBusyById((prev) => ({ ...prev, [asset.id]: true }));

    try {
      const res = await toggleLike(asset.id);
      const nextFavoriteIds = syncFavoriteAssetState(asset.id, res.liked);
      setFavoriteIds(nextFavoriteIds);
      setAssets((prev) =>
        prev.map((entry) => (entry.id === asset.id ? { ...entry, likedByMe: res.liked, likesCount: res.likesCount } : entry))
      );
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar el Like.");
    } finally {
      setLikeBusyById((prev) => ({ ...prev, [asset.id]: false }));
    }
  }

  async function handleDownload(asset: Asset) {
    try {
      await downloadAssetToDisk(asset.id, asset.name || (asset.type === "video" ? "video" : "image"));
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar.");
    }
  }

  async function handleDelete(asset: Asset) {
    const isPurchased = asset.accessSource === "purchased";
    const ok = window.confirm(
      isPurchased
        ? "¿Ocultar este asset comprado de tu biblioteca?"
        : `¿Seguro que deseas eliminar ${asset.type === "video" ? "este video" : "esta imagen"}?`
    );
    if (!ok) return;

    try {
      await deleteAsset(asset.id);
      setAssets((prev) => prev.filter((entry) => entry.id !== asset.id));
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar.");
    }
  }

  function handleTogglePublish(asset: Asset) {
    window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>MY ASSETS</span>
          <h1 className={styles.title}>Historial</h1>
        </div>
        <span className={styles.count}>{assets.length}</span>
      </div>

      <div className={styles.filters}>
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
            className={`${styles.filterChip} ${activeFilter === filter.key ? styles.filterChipActive : ""}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? <div className={styles.emptyState}>{error}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>Cargando historial...</div>
      ) : filteredAssets.length === 0 ? (
        <div className={styles.emptyState}>No hay generaciones en este filtro todavía.</div>
      ) : (
        <div className={generatorStyles.historyGrid}>
          <div className={generatorStyles.grid}>
            {filteredAssets.map((asset) => {
              const showSell = canSellAsset(asset);
              return (
                <div
                  key={asset.id}
                  className={generatorStyles.tile}
                  onMouseEnter={() => {
                    if (asset.type === "video") startVideoHoverPreview(hoverVideoEls.current[asset.id]);
                  }}
                  onMouseLeave={() => {
                    if (asset.type === "video") resetVideoStill(hoverVideoEls.current[asset.id]);
                  }}
                >
                  {asset.type === "video" ? (
                    <video
                      ref={(el) => {
                        hoverVideoEls.current[asset.id] = el;
                        if (el) prepareVideoPreview(el);
                      }}
                      className={generatorStyles.tileImg}
                      src={asset.url}
                      muted
                      playsInline
                      loop
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        prepareVideoPreview(e.currentTarget);
                        primeVideoStill(e.currentTarget);
                      }}
                      onLoadedData={(e) => primeVideoStill(e.currentTarget)}
                      onCanPlay={(e) => primeVideoStill(e.currentTarget)}
                      onCanPlayThrough={(e) => primeVideoStill(e.currentTarget)}
                      onSeeked={(e) => finalizeVideoStill(e.currentTarget)}
                    />
                  ) : (
                    <img className={generatorStyles.tileImg} src={asset.url} alt={asset.name} loading="lazy" decoding="async" />
                  )}

                  <div className={generatorStyles.tileMeta}>
                    <span className={generatorStyles.tileCaption}>{getCaption(asset)}</span>
                  </div>

                  <div className={generatorStyles.tileActions} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={generatorStyles.iconBtn} title="Descargar" onClick={() => handleDownload(asset)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z" />
                        <path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
                      </svg>
                    </button>

                    <button type="button" className={generatorStyles.iconBtnDanger} title="Eliminar" onClick={() => handleDelete(asset)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path fill="currentColor" d="M9 3h6l1 2h4a1 1 0 1 1 0 2h-1l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4a1 1 0 1 1 0-2h4l1-2zm0 6a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0v-9a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0v-9a1 1 0 0 1 1-1z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className={`${generatorStyles.iconBtn} ${generatorStyles.iconBtnHeart} ${asset.likedByMe ? generatorStyles.iconBtnHeartActive : ""}`}
                      title={asset.likedByMe ? "Quitar Like" : "Dar Like"}
                      disabled={Boolean(likeBusyById[asset.id])}
                      onClick={() => handleToggleLike(asset)}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path fill="currentColor" d="M12 21s-7.2-4.35-9.6-8.55C.3 8.7 2.55 5.7 6 5.7c1.95 0 3.3 1.05 4 2.1.7-1.05 2.05-2.1 4-2.1 3.45 0 5.7 3 3.6 6.75C19.2 16.65 12 21 12 21z" />
                      </svg>
                    </button>

                    {showSell ? (
                      <button
                        type="button"
                        className={`${generatorStyles.iconBtn} ${generatorStyles.iconBtnMoney}`}
                        title="Vender / Administrar listing"
                        onClick={() => handleTogglePublish(asset)}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                          <path fill="currentColor" d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7zm3-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H6zm6 2c2.2 0 4 1.34 4 3s-1.8 3-4 3-4-1.34-4-3 1.8-3 4-3zm0 2c-1.2 0-2 .62-2 1s.8 1 2 1 2-.62 2-1-.8-1-2-1z" />
                        </svg>
                      </button>
                    ) : null}

                    {asset.type === "image" ? (
                      <button
                        type="button"
                        className={generatorStyles.iconBtn}
                        title="1NationUp Store"
                        onClick={() => window.dispatchEvent(new CustomEvent("tales:open-store", { detail: { asset } }))}
                      >
                        <OneNationUpIcon size={18} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MyCreations;
