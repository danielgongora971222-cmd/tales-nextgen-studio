import React, { useEffect, useMemo, useRef, useState } from "react";
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

function recipeSays4K(asset: Asset | null): boolean {
  if (!asset) return false;

  const meta: any = (asset as any).meta || {};
  const candidates = [
    meta.quality,
    meta?.recipe?.quality,
    meta?.generation?.quality,
    meta?.params?.quality,
  ];

  return candidates.some((q) => typeof q === "string" && q.trim().toLowerCase() === "4k");
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

  // ✅ Acepta 4K por dimensiones reales O por receta/meta
  const ok4k = is4K(dims) || recipeSays4K(selected);

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
                      {cameraAngles
                        ? "NOT SUPPORTED (camera angles)"
                        : ok4k
                          ? recipeSays4K(selected) && !is4K(dims)
                            ? "4K OK (recipe)"
                            : "4K OK"
                          : "NOT 4K"}
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

        {(step === 2 || step === 3 || step === 4) && (
          <PrintStudio
            step={step}
            setStep={setStep}
            selected={selected}
            dims={dims}
            ok4k={ok4k}
          />
        )}
      </div>
    </div>
  );
};

type Material = "metal" | "acrylic" | "canvas" | "paper";
type FitMode = "perfect" | "crop" | "smart_fill";

type PrintSize = {
  id: string;
  wIn: number;
  hIn: number;
  label: string;
  basePrice: number;
};

const PRINT_SIZES: PrintSize[] = [
  { id: "8x10", wIn: 8, hIn: 10, label: `8" × 10"`, basePrice: 35 },
  { id: "12x16", wIn: 12, hIn: 16, label: `12" × 16"`, basePrice: 55 },
  { id: "16x20", wIn: 16, hIn: 20, label: `16" × 20"`, basePrice: 85 },
  { id: "24x24", wIn: 24, hIn: 24, label: `24" × 24"`, basePrice: 140 },
  { id: "24x36", wIn: 24, hIn: 36, label: `24" × 36"`, basePrice: 170 },
];

function aspect(w: number, h: number) {
  if (!w || !h) return 1;
  return w / h;
}

function closeEnough(a: number, b: number) {
  return Math.abs(a - b) < 0.015;
}

function formatMoney(n: number) {
  return `$${Math.round(n)}`;
}

async function imgNaturalDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = reject;
    img.src = url;
  });
}

type PrintStudioProps = {
  step: number;
  setStep: (n: number) => void;
  selected: Asset | null;
  dims: { w: number; h: number } | null;
  ok4k: boolean;
};

const PrintStudio: React.FC<PrintStudioProps> = ({ step, setStep, selected, dims, ok4k }) => {
  const [material, setMaterial] = useState<Material>("metal");
  const [size, setSize] = useState<PrintSize>(PRINT_SIZES[2]); // 16x20
  const [fitMode, setFitMode] = useState<FitMode>("perfect");

  // Crop state (simple: translate + scale)
  const [cropScale, setCropScale] = useState<number>(1);
  const [cropX, setCropX] = useState<number>(0);
  const [cropY, setCropY] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // Room visualizer
  const [room, setRoom] = useState<"living" | "office" | "bedroom">("living");

  // Checkout
  const [delivery, setDelivery] = useState<"ship" | "pickup">("ship");
  const [customerName, setCustomerName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [address1, setAddress1] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [zip, setZip] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [placingOrder, setPlacingOrder] = useState<boolean>(false);
  const [orderDone, setOrderDone] = useState<{ orderId: string } | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Safety: si por cualquier razón se pierde 4K/selected, volvemos a Step 1
  useEffect(() => {
    if (!selected || !ok4k) setStep(1);
  }, [selected?.id, ok4k]);

  const imgAspect = dims ? aspect(dims.w, dims.h) : 1;
  const sizeAspect = aspect(size.wIn, size.hIn);

  const perfectFit = closeEnough(imgAspect, sizeAspect);

  useEffect(() => {
    if (perfectFit) setFitMode("perfect");
    else if (fitMode === "perfect") setFitMode("crop");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.id, selected?.id]);

  const shippingCost = delivery === "ship" ? 15 : 0;
  const smartFillAddon = fitMode === "smart_fill" ? 10 : 0;

  const total = size.basePrice + shippingCost + smartFillAddon;

  const canGoStep3 = Boolean(material && size && fitMode);
  const canGoStep4 = canGoStep3;

  const canPlaceOrder = (() => {
    if (!selected) return false;
    if (!ok4k) return false;
    if (!customerName.trim()) return false;
    if (!email.trim()) return false;
    if (!phone.trim()) return false;
    if (delivery === "ship") {
      if (!address1.trim() || !city.trim() || !state.trim() || !zip.trim()) return false;
    }
    // Smart fill aún no está conectado a IA real: lo permitimos, pero lo marcamos como “placeholder controlado”
    return true;
  })();

  const materialLabel =
    material === "metal"
      ? "HD Metal"
      : material === "acrylic"
        ? "HD Acrylic"
        : material === "canvas"
          ? "Canvas"
          : "Paper Print";

  const panelTitle =
    step === 2 ? "2. Material, Size & Fit" : step === 3 ? "3. Room Visualizer" : "4. Checkout";

  const leftMode =
    step === 2 ? "editor" : step === 3 ? "room" : orderDone ? "success" : "checkout";

  const onMouseDownCrop = (e: React.MouseEvent) => {
    if (fitMode !== "crop") return;
    setDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: cropX, oy: cropY };
  };

  const onMouseMoveCrop = (e: React.MouseEvent) => {
    if (!dragging || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setCropX(dragRef.current.ox + dx);
    setCropY(dragRef.current.oy + dy);
  };

  const onMouseUpCrop = () => {
    setDragging(false);
    dragRef.current = null;
  };

  const submitOrder = async () => {
    if (!selected) return;
    setPlacingOrder(true);
    setOrderError(null);

    try {
      const payload = {
        assetId: selected.id,
        assetUrl: selected.url,
        assetName: selected.name || "",
        // redundante pero útil para producción
        imageDims: dims,
        require4k: true,

        material,
        materialLabel,

        size: { id: size.id, wIn: size.wIn, hIn: size.hIn, label: size.label },
        fitMode,

        crop: fitMode === "crop" ? { x: cropX, y: cropY, scale: cropScale } : null,

        pricing: {
          basePrice: size.basePrice,
          shipping: shippingCost,
          smartFillAddon,
          total,
        },

        delivery: {
          method: delivery,
          customerName,
          email,
          phone,
          address1: delivery === "ship" ? address1 : null,
          city: delivery === "ship" ? city : null,
          state: delivery === "ship" ? state : null,
          zip: delivery === "ship" ? zip : null,
        },

        notes,

        // v1: marcamos si smart fill es “placeholder”
        flags: {
          smartFillIsPlaceholder: fitMode === "smart_fill",
        },
      };

      const resp = await fetch(`/api/store/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error?.message || data?.error || "Order failed");
      }

      setOrderDone({ orderId: String(data.orderId || "") || "UNKNOWN" });
      setStep(4);
    } catch (e: any) {
      setOrderError(e?.message || "Order failed");
    } finally {
      setPlacingOrder(false);
    }
  };

  if (!selected) return null;

  return (
    <div className={styles.studioWrap}>
      <div className={styles.studioHeader}>
        <div className={styles.kicker}>1NationUp Store</div>
        <h2 className={styles.studioTitle}>{panelTitle}</h2>
        <div className={styles.studioSteps}>
          <button
            type="button"
            className={`${styles.stepChip} ${step === 1 ? styles.stepChipActive : ""}`}
            onClick={() => setStep(1)}
          >
            Step 1 · Image
          </button>
          <button
            type="button"
            className={`${styles.stepChip} ${step === 2 ? styles.stepChipActive : ""}`}
            onClick={() => setStep(2)}
          >
            Step 2 · Fit
          </button>
          <button
            type="button"
            className={`${styles.stepChip} ${step === 3 ? styles.stepChipActive : ""}`}
            onClick={() => canGoStep3 && setStep(3)}
            disabled={!canGoStep3}
          >
            Step 3 · Room
          </button>
          <button
            type="button"
            className={`${styles.stepChip} ${step === 4 ? styles.stepChipActive : ""}`}
            onClick={() => canGoStep4 && setStep(4)}
            disabled={!canGoStep4}
          >
            Step 4 · Checkout
          </button>
        </div>
      </div>

      <div className={styles.studioGrid}>
        {/* LEFT: Visual */}
        <div className={styles.leftPane} onMouseMove={onMouseMoveCrop} onMouseUp={onMouseUpCrop} onMouseLeave={onMouseUpCrop}>
          {leftMode === "editor" && (
            <div className={styles.editorStage}>
              <div className={styles.editorFrame} style={{ aspectRatio: `${size.wIn} / ${size.hIn}` as any }}>
                <div className={styles.editorMask} />
                <img
                  src={selected.url}
                  alt={selected.name || "Selected"}
                  draggable={false}
                  onMouseDown={onMouseDownCrop}
                  className={`${styles.editorImg} ${fitMode === "crop" ? styles.editorImgCrop : ""}`}
                  style={{
                    transform:
                      fitMode === "crop"
                        ? `translate(${cropX}px, ${cropY}px) scale(${cropScale})`
                        : `translate(0px, 0px) scale(1)`,
                    cursor: fitMode === "crop" ? (dragging ? "grabbing" : "grab") : "default",
                  }}
                />
                {fitMode === "smart_fill" && (
                  <div className={styles.smartFillOverlay}>
                    <div className={styles.smartFillTitle}>Smart Fill (IA)</div>
                    <div className={styles.smartFillText}>
                      En esta versión está como <b>placeholder controlado</b>. En la siguiente iteración lo conectamos a outpaint/inpaint real.
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.leftMetaRow}>
                <div className={styles.badge}>4K locked ✅</div>
                <div className={styles.badge}>Material: {materialLabel}</div>
                <div className={styles.badge}>Size: {size.label}</div>
                <div className={`${styles.badge} ${perfectFit ? styles.badgeOk : styles.badgeWarn}`}>
                  {perfectFit ? "Perfect fit" : `Aspect mismatch (${imgAspect.toFixed(2)} vs ${sizeAspect.toFixed(2)})`}
                </div>
              </div>
            </div>
          )}

          {leftMode === "room" && (
            <div className={`${styles.roomStage} ${styles[`room_${room}`]}`}>
              <div className={styles.roomWall}>
                <div
                  className={styles.roomFrame}
                  style={{
                    width: `${Math.round(260 * (size.wIn / 24))}px`,
                    height: `${Math.round(260 * (size.hIn / 24))}px`,
                  }}
                >
                  <img src={selected.url} alt="In room" className={styles.roomImg} />
                </div>
              </div>
              <div className={styles.roomSofa} />
              <div className={styles.roomCaption}>
                Visualizing {size.label} · Room: {room}
              </div>
            </div>
          )}

          {(leftMode === "checkout" || leftMode === "success") && (
            <div className={styles.checkoutStage}>
              <div className={styles.checkoutFrame}>
                <img src={selected.url} alt="Final" className={styles.checkoutImg} />
                <div className={styles.checkoutGlow} />
              </div>

              {orderDone && (
                <div className={styles.successOverlay}>
                  <div className={styles.successMark}>✓</div>
                  <div className={styles.successTitle}>Order created</div>
                  <div className={styles.successText}>Order ID: {orderDone.orderId}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Controls */}
        <div className={styles.rightPane}>
          {step === 2 && (
            <>
              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Material</div>
                <div className={styles.materialGrid}>
                  <button type="button" className={`${styles.materialCard} ${material === "metal" ? styles.cardActive : ""}`} onClick={() => setMaterial("metal")}>
                    <div className={styles.cardName}>HD Metal</div>
                    <div className={styles.cardDesc}>Vibrant · Ultra glossy</div>
                  </button>
                  <button type="button" className={`${styles.materialCard} ${material === "acrylic" ? styles.cardActive : ""}`} onClick={() => setMaterial("acrylic")}>
                    <div className={styles.cardName}>HD Acrylic</div>
                    <div className={styles.cardDesc}>Depth · Premium glass</div>
                  </button>
                  <button type="button" className={`${styles.materialCard} ${material === "canvas" ? styles.cardActive : ""}`} onClick={() => setMaterial("canvas")}>
                    <div className={styles.cardName}>Canvas</div>
                    <div className={styles.cardDesc}>Classic · Artistic texture</div>
                  </button>
                  <button type="button" className={`${styles.materialCard} ${material === "paper" ? styles.cardActive : ""}`} onClick={() => setMaterial("paper")}>
                    <div className={styles.cardName}>Paper Print</div>
                    <div className={styles.cardDesc}>Crisp · Traditional</div>
                  </button>
                </div>
              </div>

              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Size</div>
                <div className={styles.sizeGrid}>
                  {PRINT_SIZES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`${styles.sizeCard} ${size.id === s.id ? styles.cardActive : ""}`}
                      onClick={() => setSize(s)}
                    >
                      <div className={styles.cardName}>{s.label}</div>
                      <div className={styles.cardDesc}>{formatMoney(s.basePrice)} base</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Fit</div>

                {perfectFit ? (
                  <div className={styles.goodBox}>Perfect fit detected ✅ No crop needed.</div>
                ) : (
                  <div className={styles.fitGrid}>
                    <button
                      type="button"
                      className={`${styles.fitCard} ${fitMode === "crop" ? styles.cardActive : ""}`}
                      onClick={() => setFitMode("crop")}
                    >
                      <div className={styles.cardName}>Crop</div>
                      <div className={styles.cardDesc}>Drag + zoom to frame</div>
                    </button>

                    <button
                      type="button"
                      className={`${styles.fitCard} ${fitMode === "smart_fill" ? styles.cardActive : ""}`}
                      onClick={() => setFitMode("smart_fill")}
                    >
                      <div className={styles.cardName}>Smart Fill (IA)</div>
                      <div className={styles.cardDesc}>Outpaint borders (v1 placeholder)</div>
                    </button>
                  </div>
                )}

                {fitMode === "crop" && !perfectFit && (
                  <div className={styles.cropControls}>
                    <div className={styles.sliderRow}>
                      <div className={styles.sliderLabel}>Zoom</div>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={cropScale}
                        onChange={(e) => setCropScale(Number(e.target.value))}
                        className={styles.slider}
                      />
                    </div>
                    <div className={styles.mutedHelp}>Tip: drag the image on the left to frame it.</div>
                  </div>
                )}
              </div>

              <div className={styles.panelFooter}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setStep(1)}>
                  Back
                </button>
                <button type="button" className={styles.primaryBtn} onClick={() => setStep(3)} disabled={!canGoStep3}>
                  Continue to Room
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Choose a room</div>
                <div className={styles.roomGrid}>
                  <button type="button" className={`${styles.roomCard} ${room === "living" ? styles.cardActive : ""}`} onClick={() => setRoom("living")}>
                    Living
                  </button>
                  <button type="button" className={`${styles.roomCard} ${room === "office" ? styles.cardActive : ""}`} onClick={() => setRoom("office")}>
                    Office
                  </button>
                  <button type="button" className={`${styles.roomCard} ${room === "bedroom" ? styles.cardActive : ""}`} onClick={() => setRoom("bedroom")}>
                    Bedroom
                  </button>
                </div>

                <div className={styles.goodBox}>
                  Visual scale is approximate (v1). Next iteration: true inch-to-px mapping with calibrated scenes.
                </div>
              </div>

              <div className={styles.panelFooter}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setStep(2)}>
                  Back
                </button>
                <button type="button" className={styles.primaryBtn} onClick={() => setStep(4)} disabled={!canGoStep4}>
                  Continue to Checkout
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Summary</div>
                <div className={styles.summaryRow}>
                  <div className={styles.badge}>Material: {materialLabel}</div>
                  <div className={styles.badge}>Size: {size.label}</div>
                  <div className={styles.badge}>Fit: {fitMode}</div>
                </div>

                <div className={styles.priceBox}>
                  <div className={styles.priceLine}>
                    <span>Base</span>
                    <span>{formatMoney(size.basePrice)}</span>
                  </div>
                  <div className={styles.priceLine}>
                    <span>Shipping</span>
                    <span>{formatMoney(shippingCost)}</span>
                  </div>
                  <div className={styles.priceLine}>
                    <span>Smart Fill add-on</span>
                    <span>{formatMoney(smartFillAddon)}</span>
                  </div>
                  <div className={styles.priceTotal}>
                    <span>Total</span>
                    <span>{formatMoney(total)}</span>
                  </div>
                </div>
              </div>

              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Delivery</div>
                <div className={styles.tabs}>
                  <button type="button" className={`${styles.tab} ${delivery === "ship" ? styles.tabActive : ""}`} onClick={() => setDelivery("ship")}>
                    Ship
                  </button>
                  <button type="button" className={`${styles.tab} ${delivery === "pickup" ? styles.tabActive : ""}`} onClick={() => setDelivery("pickup")}>
                    Pickup (Miami)
                  </button>
                </div>

                <div className={styles.formGrid}>
                  <input className={styles.input} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Full name" />
                  <input className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                  <input className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />

                  {delivery === "ship" && (
                    <>
                      <input className={styles.input} value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="Address" />
                      <input className={styles.input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
                      <input className={styles.input} value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
                      <input className={styles.input} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" />
                    </>
                  )}
                </div>

                {delivery === "pickup" && (
                  <div className={styles.goodBox}>
                    Pickup location: Miami (v1). Next iteration: show exact address + pickup code flow.
                  </div>
                )}
              </div>

              <div className={styles.panelBlock}>
                <div className={styles.panelTitle}>Notes</div>
                <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any special instructions?" />
              </div>

              {orderError && <div className={styles.errorBox}>{orderError}</div>}

              <div className={styles.panelFooter}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setStep(3)} disabled={placingOrder}>
                  Back
                </button>
                <button type="button" className={styles.primaryBtn} onClick={submitOrder} disabled={!canPlaceOrder || placingOrder}>
                  {placingOrder ? "Placing order..." : "Confirm & Pay (v1)"} 
                </button>
              </div>

              <div className={styles.mutedHelp}>
                Nota: “Pay (v1)” crea la orden y guarda el payload. En la siguiente iteración conectamos pasarela + email de producción.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Store;