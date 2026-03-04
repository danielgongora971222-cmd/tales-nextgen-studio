import React, { useEffect, useMemo, useState } from "react";
import { listMyAssets } from "../services/assetsApi";
import { Asset } from "../types";
import styles from "./MyCreations.module.css";
import generatorStyles from "./tools/ImageGeneratorTool.module.css";
import { EVENT_MY_CREATIONS_FILTER } from "../services/appEvents";

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
  return typeof meta.tool === "string" ? meta.tool : "";
}

function getCaption(asset: Asset) {
  const tool = getToolId(asset);
  if (tool === "upscaler") return "UPSCALE";
  const cleaned = removeHiddenBlocks(asset.prompt || "");
  return cleaned || asset.name || "—";
}


const MyCreations: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("tales.favoriteAssets");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

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
    localStorage.setItem("tales.favoriteAssets", JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
  const onFavs = () => {
    try {
      const raw = localStorage.getItem("tales.favoriteAssets");
      const arr: string[] = raw ? JSON.parse(raw) : [];
      setFavoriteIds(Array.isArray(arr) ? arr : []);
    } catch {
      setFavoriteIds([]);
    }
  };

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

  const toggleFavorite = (assetId: string) => {
    setFavoriteIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>MY CREATIONS</span>
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

      {loading ? (
        <div className={styles.emptyState}>Cargando historial...</div>
      ) : filteredAssets.length === 0 ? (
        <div className={styles.emptyState}>
          No hay generaciones en este filtro todavía.
        </div>
      ) : (
        <div className={generatorStyles.historyGrid}>
          <div className={generatorStyles.grid}>
            {filteredAssets.map((asset) => (
              <div key={asset.id} className={generatorStyles.tile}>
                {asset.type === "video" ? (
                  <video className={generatorStyles.tileImg} src={asset.url} muted playsInline loop />
                ) : (
                  <img className={generatorStyles.tileImg} src={asset.url} alt={asset.name} />
                )}

                <div className={generatorStyles.tileMeta}>
                  <span className={generatorStyles.tileCaption}>
                    {getCaption(asset)}
                  </span>
                </div>

                <div className={generatorStyles.tileActions}>
                  <button
                    type="button"
                    className={generatorStyles.iconBtn}
                    onClick={() => toggleFavorite(asset.id)}
                    title={favoriteIds.includes(asset.id) ? "Quitar de favoritos" : "Agregar a favoritos"}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill={favoriteIds.includes(asset.id) ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        d="M12 21s-7.2-4.35-9.6-8.55C.3 8.7 2.55 5.7 6 5.7c1.95 0 3.3 1.05 4 2.1.7-1.05 2.05-2.1 4-2.1 3.45 0 5.7 3 3.6 6.75C19.2 16.65 12 21 12 21z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MyCreations;
