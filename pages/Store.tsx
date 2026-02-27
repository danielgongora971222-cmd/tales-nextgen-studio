import React, { useEffect, useMemo, useState } from "react";
import { AppRoute, Asset } from "../types";
import { listMyAssets } from "../services/assetsApi";
import styles from "./Store.module.css";

type StorePrefill = { asset?: Asset | null };

interface StoreProps {
  onNavigate: (route: AppRoute) => void;
  prefill?: StorePrefill;
  onRequestUpscale?: (asset: Asset) => void;
}

function loadImgDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = reject;
    img.src = url;
  });
}

function is4K(d: { w: number; h: number } | null): boolean {
  if (!d) return false;
  return d.w >= 3840 && d.h >= 2160;
}

function isCameraAngles(asset: Asset | null): boolean {
  if (!asset) return false;
  const t = String(asset.tool || "").toLowerCase();
  // en tu backend/cliente aparece como "camera-angles"
  return t === "camera-angles" || t === "camera_angles";
}

const Store: React.FC<StoreProps> = ({ onNavigate, prefill, onRequestUpscale }) => {
  const [step, setStep] = useState<number>(1);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState<boolean>(false);

  const [selected, setSelected] = useState<Asset | null>(prefill?.asset ?? null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [dimsLoading, setDimsLoading] = useState<boolean>(false);

  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [filter, setFilter] = useState<string>("");

  // Si el usuario entra desde historial (prefill), precargar selección
  useEffect(() => {
    if (prefill?.asset) {
      setSelected(prefill.asset);
      setStep(1);
    }
  }, [prefill?.asset]);

  // Cargar assets (historial global de imágenes)
  useEffect(() => {
    (async () => {
      setLoadingAssets(true);
      try {
        const items = await listMyAssets({ type: "image", fresh: true });
        setAssets(items || []);
      } finally {
        setLoadingAssets(false);
      }
    })();
  }, []);

  // Calcular dimensiones reales al seleccionar imagen
  useEffect(() => {
    (async () => {
      setDims(null);
      if (!selected?.url) return;
      setDimsLoading(true);
      try {
        const d = await loadImgDims(selected.url);
        setDims(d);
      } catch {
        setDims(null);
      } finally {
        setDimsLoading(false);
      }
    })();
  }, [selected?.id, selected?.url]);

  const filteredAssets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => {
      const name = String(a.name || "").toLowerCase();
      const prompt = String(a.prompt || "").toLowerCase();
      const tool = String(a.tool || "").toLowerCase();
      return name.includes(q) || prompt.includes(q) || tool.includes(q);
    });
  }, [assets, filter]);

  const cameraAngles = isCameraAngles(selected);
  const ok4k = is4K(dims);
  const canContinue = Boolean(selected) && ok4k && !cameraAngles;

  const blockReason = useMemo(() => {
    if (!selected) return null;
    if (cameraAngles) return "This image comes from Camera Angles. Store printing for Camera Angles outputs is not available yet.";
    if (!ok4k) return "This image is not 4K yet. For a high-quality physical product, please upscale it first.";
    return null;
  }, [selected, cameraAngles, ok4k]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.kicker}>1NationUp Store</div>
        <h1 className={styles.title}>Turn your creation into a real physical print</h1>
        <p className={styles.subtitle}>
          Be original—turn your own art into reality: decorate your home or gift something crafted millimeter by millimeter by you.
        </p>

        <div className={styles.breadcrumbs}>
          <div className={`${styles.stepChip} ${step === 1 ? styles.stepChipActive : ""}`}>Step 1 · Choose image</div>
          <div className={`${styles.stepChip} ${step === 2 ? styles.stepChipActive : ""}`}>Step 2 · (Next)</div>
          <div className={`${styles.stepChip} ${step === 3 ? styles.stepChipActive : ""}`}>Step 3 · (Next)</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTop}>
          <div className={styles.cardTitle}>Step 1 — Choose the image you want to make real</div>
          <button className={styles.backBtn} type="button" onClick={() => onNavigate(AppRoute.HOME)}>
            Back to Home
          </button>
        </div>

        <div className={styles.selectionRow}>
          <div className={styles.preview}>
            {selected ? (
              <>
                <img className={styles.previewImg} src={selected.url} alt={selected.name || "Selected"} />
                <div className={styles.previewMeta}>
                  <div className={styles.previewName}>{selected.name || "Untitled"}</div>
                  <div className={styles.previewSmall}>
                    <span className={styles.badge}>tool: {selected.tool || "unknown"}</span>
                    <span className={styles.badge}>
                      {dimsLoading ? "checking resolution..." : dims ? `${dims.w}×${dims.h}` : "resolution unknown"}
                    </span>
                    <span className={`${styles.badge} ${ok4k && !cameraAngles ? styles.badgeOk : styles.badgeWarn}`}>
                      {cameraAngles ? "NOT SUPPORTED (camera angles)" : ok4k ? "4K OK" : "NOT 4K"}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.previewEmpty}>
                <div className={styles.previewEmptyCode}>NO IMAGE SELECTED</div>
                <div className={styles.previewEmptyText}>Pick one image from your full creation history to start.</div>
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setPickerOpen(true)}
              disabled={loadingAssets}
            >
              {loadingAssets ? "Loading your images..." : "Pick an image from your history"}
            </button>

            <button
              type="button"
              className={styles.continueBtn}
              disabled={!canContinue}
              onClick={() => setStep(2)}
              title={!canContinue ? "Select a 4K image (not from Camera Angles) to continue." : "Continue"}
            >
              Continue to Step 2
            </button>

            {blockReason && selected && (
              <div className={styles.blockBox}>
                <div className={styles.blockTitle}>Cannot continue yet</div>
                <div className={styles.blockText}>{blockReason}</div>

                <button
                  type="button"
                  className={styles.upscaleBtn}
                  onClick={() => onRequestUpscale?.(selected)}
                >
                  Upscale this image
                </button>
              </div>
            )}
          </div>
        </div>

        {pickerOpen && (
          <div className={styles.modalBackdrop} onClick={() => setPickerOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalTop}>
                <div className={styles.modalTitle}>Pick an image</div>
                <button type="button" className={styles.modalClose} onClick={() => setPickerOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalSearchRow}>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className={styles.modalSearch}
                  placeholder="Search by name / prompt / tool..."
                />
                <div className={styles.modalCount}>{filteredAssets.length} items</div>
              </div>

              <div className={styles.grid}>
                {filteredAssets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={styles.tile}
                    onClick={() => {
                      setSelected(a);
                      setPickerOpen(false);
                    }}
                    title={a.prompt || a.name}
                  >
                    <img className={styles.tileImg} src={a.url} alt={a.name} loading="lazy" decoding="async" />
                    <div className={styles.tileMeta}>
                      <div className={styles.tileName}>{a.name || "Untitled"}</div>
                      <div className={styles.tileSmall}>{a.tool || "unknown"}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={styles.nextStep}>
            <div className={styles.nextStepTitle}>Step 2 (placeholder)</div>
            <div className={styles.nextStepText}>
              You told me you’ll explain how the next steps work after Step 1 is done.  
              When you’re ready, I implement Step 2/3 with the same safety level.
            </div>

            <div className={styles.nextStepRow}>
              <button type="button" className={styles.backStepBtn} onClick={() => setStep(1)}>
                Back to Step 1
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Store;