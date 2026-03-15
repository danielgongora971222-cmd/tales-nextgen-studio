import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorModal from "../../components/ErrorModal";
import CameraAngleSimulator3D, { CameraAngleValue } from "../../components/CameraAngleSimulator3D";
import { estimateImageCostCredits } from "../../config/pricing.js";
import { downloadAssetToDisk, listMyAssets, uploadUserAsset } from "../../services/assetsApi";
import { generateImageBatch } from "../../services/geminiService";
import { AppRoute, Asset } from "../../types";

const CAMERA_ANGLES_MODEL = "fal-ai/qwen-image-edit-2511-multiple-angles";
const DEFAULT_COUNT = 1;
const DEFAULT_LORA_SCALE = 1;
const ASSET_FETCH_LIMIT = 250;

type IconProps = { className?: string };

const IconChevronLeft = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const IconDownload = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

const IconImagePlus = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M16 5h6" />
    <path d="M19 2v6" />
    <path d="M21 11.5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4.5" />
    <path d="m3 14 4-4a2 2 0 0 1 2.828 0L14 14" />
    <path d="m14 13 1-1a2 2 0 0 1 2.828 0L21 15" />
    <circle cx="9" cy="9" r="2" />
  </svg>
);

const IconImages = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M18 5H6a2 2 0 0 0-2 2v10" />
    <path d="M8 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="m6 13 3-3a2 2 0 0 1 2.828 0L18 16" />
    <path d="m14 14 1-1a2 2 0 0 1 2.828 0L20 15" />
    <circle cx="10" cy="8" r="2" />
  </svg>
);

const IconRefresh = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
  </svg>
);

const IconSparkles = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M19 3v4" />
    <path d="M21 5h-4" />
    <path d="M5 16v3" />
    <path d="M6.5 17.5h-3" />
  </svg>
);

const IconUpload = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

const IconClose = ({ className }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const cosmosBackground = {
  backgroundImage:
    "radial-gradient(1px 1px at 7% 18%, rgba(255,255,255,0.9), transparent), radial-gradient(1px 1px at 16% 71%, rgba(255,255,255,0.55), transparent), radial-gradient(1.2px 1.2px at 26% 36%, rgba(241,225,148,0.82), transparent), radial-gradient(1px 1px at 39% 14%, rgba(255,255,255,0.74), transparent), radial-gradient(1px 1px at 51% 82%, rgba(255,255,255,0.62), transparent), radial-gradient(1.2px 1.2px at 63% 44%, rgba(241,225,148,0.76), transparent), radial-gradient(1px 1px at 78% 21%, rgba(255,255,255,0.82), transparent), radial-gradient(1px 1px at 91% 67%, rgba(255,255,255,0.7), transparent), radial-gradient(circle at 18% 14%, rgba(91,14,20,0.34), transparent 28%), radial-gradient(circle at 82% 12%, rgba(241,225,148,0.08), transparent 18%), radial-gradient(circle at 50% 100%, rgba(91,14,20,0.3), transparent 35%), linear-gradient(180deg, rgba(6,2,4,0.98), rgba(3,1,2,1))",
};

const wrap360 = (v: number) => {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
};

function isLikelyImage(asset: Asset) {
  const type = typeof asset?.type === "string" ? asset.type.toLowerCase() : "";
  const mime = typeof asset?.meta?.mime === "string" ? asset.meta.mime.toLowerCase() : "";
  const url = typeof asset?.url === "string" ? asset.url.toLowerCase() : "";

  if (type === "image") return true;
  if (mime.startsWith("image/")) return true;
  if (url.match(/\.(png|jpg|jpeg|webp|gif)(\?|#|$)/)) return true;
  return !type && !!url;
}

function getAssetTool(asset: Asset) {
  return asset?.tool || asset?.meta?.tool || null;
}

function isCameraAnglesReferenceAsset(asset: Asset) {
  return getAssetTool(asset) === "camera-angles" && asset?.meta?.category === "reference";
}

function isCameraAnglesOutputAsset(asset: Asset) {
  return getAssetTool(asset) === "camera-angles" && !isCameraAnglesReferenceAsset(asset);
}

function sortNewestFirst(items: Asset[]) {
  return [...items].sort((a, b) => {
    const ta = Number(a?.createdAt || 0);
    const tb = Number(b?.createdAt || 0);
    return tb - ta;
  });
}

async function fetchAllImageAssets(fresh = false): Promise<Asset[]> {
  let items: Asset[] = [];

  try {
    items = await listMyAssets({ type: "image", limit: ASSET_FETCH_LIMIT, fresh });
    if (!items?.length) {
      items = await listMyAssets({ limit: ASSET_FETCH_LIMIT, fresh });
    }
  } catch {
    items = await listMyAssets({ limit: ASSET_FETCH_LIMIT, fresh });
  }

  return sortNewestFirst((items || []).filter((asset) => asset?.url).filter(isLikelyImage));
}

const pillClass =
  "inline-flex items-center gap-2 rounded-full border border-[rgba(241,225,148,0.1)] bg-[rgba(10,5,6,0.58)] px-4 py-2 text-[11px] font-medium text-[rgba(255,245,220,0.86)] shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-xl";
const softCardClass =
  "rounded-[28px] border border-[rgba(241,225,148,0.08)] bg-[linear-gradient(180deg,rgba(14,7,9,0.88),rgba(6,3,4,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.03)]";
const subtleButtonClass =
  "inline-flex items-center justify-center rounded-[18px] border border-[rgba(241,225,148,0.1)] bg-[rgba(12,6,8,0.72)] text-white/78 transition hover:border-[rgba(241,225,148,0.22)] hover:bg-[rgba(18,9,11,0.9)]";

const CameraAnglesTool: React.FC = () => {
  const [referenceAsset, setReferenceAsset] = useState<Asset | null>(null);
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [cam, setCam] = useState<CameraAngleValue>({ azimuth: 0, elevation: 0, zoom: 5 });
  const [loading, setLoading] = useState(false);
  const [allImageAssets, setAllImageAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [selectedHistoryAssetId, setSelectedHistoryAssetId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<"history" | "upload">("history");
  const [uploadingReference, setUploadingReference] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generationAzimuth = useMemo(() => wrap360(360 - cam.azimuth), [cam.azimuth]);
  const canGenerate = useMemo(() => Boolean(referenceAsset) && !loading, [referenceAsset, loading]);
  const estimatedCostCredits = useMemo(
    () => estimateImageCostCredits({ model: CAMERA_ANGLES_MODEL, quality: "1K", count: DEFAULT_COUNT }),
    []
  );

  const generatedHistory = useMemo(
    () => sortNewestFirst(allImageAssets.filter((asset) => isCameraAnglesOutputAsset(asset))),
    [allImageAssets]
  );

  const referenceLibrary = useMemo(() => sortNewestFirst(allImageAssets), [allImageAssets]);

  const selectedHistoryAsset = useMemo(() => {
    if (!generatedHistory.length) return null;
    return generatedHistory.find((asset) => asset.id === selectedHistoryAssetId) || generatedHistory[0] || null;
  }, [generatedHistory, selectedHistoryAssetId]);

  const refreshAssets = useCallback(async (fresh = false) => {
    setAssetsLoading(true);
    setAssetsError(null);

    try {
      const items = await fetchAllImageAssets(fresh);
      setAllImageAssets(items);
      return items;
    } catch (err: any) {
      const message = err?.message || "No se pudo cargar el historial.";
      setAssetsError(message);
      throw err;
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const items = await fetchAllImageAssets(true);
        if (!alive) return;
        setAllImageAssets(items);
      } catch (err: any) {
        if (!alive) return;
        setAssetsError(err?.message || "No se pudo cargar el historial.");
      } finally {
        if (!alive) return;
        setAssetsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!generatedHistory.length) {
      if (selectedHistoryAssetId !== null) setSelectedHistoryAssetId(null);
      return;
    }

    if (!selectedHistoryAssetId || !generatedHistory.some((asset) => asset.id === selectedHistoryAssetId)) {
      setSelectedHistoryAssetId(generatedHistory[0].id);
    }
  }, [generatedHistory, selectedHistoryAssetId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickerOpen) {
        setPickerOpen(false);
        return;
      }
      if (historyOpen) setHistoryOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickerOpen, historyOpen]);

  const handleGenerate = async () => {
    if (!referenceAsset) {
      setError("Primero selecciona una imagen de referencia.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await generateImageBatch(additionalPrompt || " ", CAMERA_ANGLES_MODEL, {
        tool: "camera-angles",
        nameHint: "camera-angle",
        count: DEFAULT_COUNT,
        characterAssetIds: [referenceAsset.id],
        horizontalAngle: generationAzimuth,
        verticalAngle: cam.elevation,
        zoom: cam.zoom,
        loraScale: DEFAULT_LORA_SCALE,
      });

      if (res.items?.[0]?.assetId) {
        setSelectedHistoryAssetId(res.items[0].assetId);
        setHistoryOpen(true);
      }

      await refreshAssets(true);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "No se pudo generar el nuevo ángulo.");
    } finally {
      setLoading(false);
    }
  };

  const handleReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setUploadingReference(true);
    setError(null);

    try {
      const uploaded = await uploadUserAsset(file, {
        tool: "camera-angles",
        category: "reference",
        name: file.name,
      });

      setReferenceAsset(uploaded);
      setPickerOpen(false);
      setPickerTab("history");
      setAllImageAssets((prev) => sortNewestFirst([uploaded, ...prev.filter((asset) => asset.id !== uploaded.id)]));
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "No se pudo subir la imagen de referencia.");
    } finally {
      setUploadingReference(false);
      input.value = "";
    }
  };

  const handleSelectReference = (asset: Asset) => {
    setReferenceAsset(asset);
    setPickerOpen(false);
  };

  const handleDownload = async (asset: Asset) => {
    try {
      await downloadAssetToDisk(asset.id, `camera-angle-${asset.id}.png`);
    } catch (err: any) {
      setError(err?.message || "No se pudo descargar la imagen.");
    }
  };

  const goHome = () => window.dispatchEvent(new CustomEvent("tales:navigate", { detail: { route: AppRoute.HOME } }));

  return (
    <div
      className="relative overflow-hidden bg-[#030102] text-[rgba(255,245,220,0.95)]"
      style={{
        width: "100vw",
        height: "100dvh",
        minHeight: "100svh",
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        overscrollBehavior: "none",
      }}
    >
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="absolute inset-0 opacity-95" style={cosmosBackground} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(91,14,20,0.24),transparent_34%),radial-gradient(circle_at_50%_58%,rgba(241,225,148,0.05),transparent_24%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.22))]" />
      <div className="pointer-events-none absolute left-[-14%] top-[2%] h-[280px] w-[280px] rounded-full bg-[rgba(91,14,20,0.24)] blur-[120px] md:h-[360px] md:w-[360px]" />
      <div className="pointer-events-none absolute bottom-[-18%] right-[-8%] h-[320px] w-[320px] rounded-full bg-[rgba(91,14,20,0.22)] blur-[140px] md:h-[420px] md:w-[420px]" />
      <div className="pointer-events-none absolute inset-x-[16%] top-[18%] h-[260px] rounded-full bg-[radial-gradient(circle,rgba(241,225,148,0.08),transparent_68%)] blur-[70px]" />

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleReferenceUpload} className="hidden" />

      {pickerOpen ? (
        <div className="absolute inset-0 z-50 bg-[rgba(2,1,2,0.88)] sm:bg-[rgba(2,1,2,0.72)] sm:p-4">
          <div className={`${softCardClass} flex h-full w-full flex-col overflow-hidden sm:mx-auto sm:h-[min(92dvh,980px)] sm:max-w-6xl sm:rounded-[32px]`}>
            <div className="flex items-center justify-between border-b border-[rgba(241,225,148,0.08)] px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <div className="text-base font-semibold text-[rgba(255,245,220,0.96)] sm:text-lg">Seleccionar referencia</div>
                <div className="mt-1 text-xs text-white/42">Upload local o historial global de imágenes</div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className={`${subtleButtonClass} h-11 w-11`}
                aria-label="Cerrar selector"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>

            <div className="px-4 pt-4 sm:px-6 sm:pt-5">
              <div className="inline-flex rounded-full border border-[rgba(241,225,148,0.1)] bg-[rgba(8,4,5,0.56)] p-1 backdrop-blur-xl">
                {[
                  { key: "history", label: "Historial global", icon: IconImages },
                  { key: "upload", label: "Upload local", icon: IconUpload },
                ].map((tab) => {
                  const active = pickerTab === tab.key;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setPickerTab(tab.key as "history" | "upload")}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-[rgba(241,225,148,0.14)] text-[rgba(255,245,220,0.96)]"
                          : "text-white/52 hover:text-white/82"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
              {pickerTab === "upload" ? (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingReference}
                    className="group flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-[rgba(241,225,148,0.18)] bg-[linear-gradient(180deg,rgba(18,8,10,0.88),rgba(7,3,5,0.96))] px-8 text-center transition hover:border-[rgba(241,225,148,0.32)] hover:bg-[linear-gradient(180deg,rgba(24,11,13,0.92),rgba(9,4,6,0.98))]"
                  >
                    {uploadingReference ? (
                      <>
                        <div className="h-12 w-12 animate-spin rounded-full border-2 border-[rgba(241,225,148,0.18)] border-t-[rgba(241,225,148,0.95)]" />
                        <div className="mt-5 text-sm font-semibold text-[rgba(255,245,220,0.92)]">Subiendo referencia...</div>
                      </>
                    ) : (
                      <>
                        <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-[rgba(241,225,148,0.16)] bg-[rgba(241,225,148,0.08)] text-[rgba(241,225,148,0.92)] transition group-hover:scale-105 group-hover:bg-[rgba(241,225,148,0.14)]">
                          <IconImagePlus className="h-7 w-7" />
                        </div>
                        <div className="mt-5 text-lg font-semibold text-[rgba(255,245,220,0.96)]">Subir desde tu equipo</div>
                        <div className="mt-2 max-w-md text-sm text-white/46">
                          La imagen se guardará como referencia y quedará disponible para reutilizarla cuando quieras.
                        </div>
                      </>
                    )}
                  </button>

                  <div className={`${softCardClass} p-4 sm:p-5`}>
                    <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-[rgba(241,225,148,0.64)]">Referencia actual</div>
                    <div className="mt-4 overflow-hidden rounded-[24px] border border-[rgba(241,225,148,0.08)] bg-[rgba(0,0,0,0.22)]">
                      {referenceAsset ? (
                        <img src={referenceAsset.url} alt={referenceAsset.name} className="aspect-square w-full object-contain bg-[rgba(0,0,0,0.28)] p-4" />
                      ) : (
                        <div className="flex aspect-square items-center justify-center px-6 text-center text-sm text-white/34">
                          Todavía no has seleccionado una imagen.
                        </div>
                      )}
                    </div>
                    {referenceAsset ? (
                      <div className="mt-4 rounded-[20px] border border-[rgba(241,225,148,0.08)] bg-[rgba(241,225,148,0.05)] px-4 py-3 text-sm text-white/72">
                        {referenceAsset.name}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {assetsLoading ? (
                    <div className={`${softCardClass} flex h-[280px] items-center justify-center text-white/55`}>Cargando historial...</div>
                  ) : assetsError ? (
                    <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">{assetsError}</div>
                  ) : referenceLibrary.length === 0 ? (
                    <div className={`${softCardClass} flex h-[280px] items-center justify-center px-6 text-center text-white/40`}>
                      No hay imágenes en tu historial todavía.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                      {referenceLibrary.map((asset) => {
                        const active = referenceAsset?.id === asset.id;
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => handleSelectReference(asset)}
                            className={`group relative overflow-hidden rounded-[24px] border bg-[rgba(0,0,0,0.22)] text-left transition ${
                              active
                                ? "border-[rgba(241,225,148,0.28)] shadow-[0_0_0_1px_rgba(241,225,148,0.1)]"
                                : "border-[rgba(241,225,148,0.08)] hover:border-[rgba(241,225,148,0.18)]"
                            }`}
                          >
                            <img src={asset.url} alt={asset.name} className="aspect-square w-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/18 to-transparent px-3 pb-3 pt-10">
                              <div className="line-clamp-2 text-xs text-white/86">{asset.prompt || asset.name}</div>
                            </div>
                            {active ? (
                              <div className="absolute left-3 top-3 rounded-full border border-[rgba(241,225,148,0.16)] bg-[rgba(8,4,5,0.84)] px-2 py-1 text-[10px] font-semibold text-[rgba(241,225,148,0.88)]">
                                Actual
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className={`pointer-events-none absolute inset-0 z-20 bg-black/18 transition-opacity duration-300 ${historyOpen ? "opacity-100" : "opacity-0"}`} />

      <div className="relative z-10 h-full">
        <div className="absolute left-3 z-20 sm:left-5" style={{ top: "max(env(safe-area-inset-top), 12px)" }}>
          <div className={pillClass}>
            <span className="h-2 w-2 rounded-full bg-[rgba(241,225,148,0.9)] shadow-[0_0_14px_rgba(241,225,148,0.8)]" />
            <span className="font-mono tracking-[0.18em] text-[rgba(241,225,148,0.78)]">CAMERA ANGLES 3D</span>
          </div>
        </div>

        <div className="absolute right-3 z-20 flex items-center gap-2 sm:right-5" style={{ top: "max(env(safe-area-inset-top), 12px)" }}>
          <button
            type="button"
            onClick={goHome}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(8,4,5,0.72)] px-4 py-2 text-sm text-[rgba(255,245,220,0.9)] shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl transition hover:border-[rgba(241,225,148,0.22)] hover:bg-[rgba(14,7,9,0.86)]"
            aria-label="Cerrar herramienta y volver al home"
            title="Close"
          >
            <IconClose className="h-4 w-4 text-[rgba(241,225,148,0.78)]" />
            <span className="hidden sm:inline">Close</span>
          </button>

          <div className={`${pillClass} hidden sm:inline-flex`}>
            <span className="text-[rgba(241,225,148,0.74)]">Coste</span>
            <span className="font-semibold text-[rgba(255,245,220,0.95)]">{estimatedCostCredits} créditos</span>
          </div>

          <button
            type="button"
            onClick={() => setHistoryOpen((prev) => !prev)}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(8,4,5,0.72)] px-4 py-2 text-sm text-[rgba(255,245,220,0.9)] shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl transition hover:border-[rgba(241,225,148,0.22)] hover:bg-[rgba(14,7,9,0.86)]"
            aria-label={historyOpen ? "Cerrar historial" : "Abrir historial"}
          >
            <IconImages className="h-4 w-4 text-[rgba(241,225,148,0.78)]" />
            <span className="hidden sm:inline">Historial</span>
            <span className="rounded-full bg-[rgba(241,225,148,0.14)] px-2 py-0.5 text-[11px] font-semibold text-[rgba(241,225,148,0.9)]">
              {generatedHistory.length}
            </span>
            <span className={`transition-transform duration-300 ${historyOpen ? "rotate-180" : "rotate-0"}`}>
              <IconChevronLeft className="h-4 w-4" />
            </span>
          </button>
        </div>

        <section
          className="relative h-full overflow-hidden px-3 sm:px-6"
          style={{
            paddingTop: "max(env(safe-area-inset-top), 12px)",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 108px)",
          }}
        >
          <div className="mx-auto flex h-full w-full max-w-[1500px] items-center justify-center">
            <div className="relative h-full w-full">
              <CameraAngleSimulator3D
                imageUrl={referenceAsset?.url || null}
                value={cam}
                onChange={setCam}
                disabled={loading}
                onOpenReferencePicker={() => setPickerOpen(true)}
                referenceLabel={referenceAsset?.name || null}
                displayAzimuth={generationAzimuth}
              />
            </div>
          </div>

          {loading ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(8,4,5,0.76)] px-5 py-3 text-sm text-white/84 shadow-[0_26px_70px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                Generando nueva vista...
              </div>
            </div>
          ) : null}

          <div className="absolute left-1/2 z-20 w-[calc(100%-1rem)] max-w-[980px] -translate-x-1/2 sm:w-[calc(100%-2rem)]" style={{ bottom: "max(env(safe-area-inset-bottom), 12px)" }}>
            <div className={`${softCardClass} overflow-hidden p-2.5 sm:p-3`}>
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[22px] border border-[rgba(241,225,148,0.08)] bg-[rgba(0,0,0,0.2)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <IconSparkles className="h-4 w-4 shrink-0 text-[rgba(241,225,148,0.72)]" />
                  <input
                    type="text"
                    value={additionalPrompt}
                    onChange={(e) => setAdditionalPrompt(e.target.value)}
                    placeholder="Prompt opcional"
                    className="w-full min-w-0 bg-transparent text-sm text-[rgba(255,245,220,0.94)] outline-none placeholder:text-white/32"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={`inline-flex min-h-[56px] items-center justify-center gap-3 rounded-[22px] px-5 text-sm font-semibold transition sm:min-w-[220px] ${
                    canGenerate
                      ? "border border-[rgba(241,225,148,0.22)] bg-[linear-gradient(180deg,rgba(241,225,148,0.98),rgba(205,176,93,0.96))] text-black shadow-[0_18px_44px_rgba(241,225,148,0.18)] hover:brightness-105"
                      : "cursor-not-allowed border border-[rgba(241,225,148,0.08)] bg-[rgba(255,255,255,0.06)] text-white/34"
                  }`}
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                      Generando...
                    </>
                  ) : (
                    <>
                      <IconSparkles className="h-4 w-4" />
                      <span>Generar</span>
                      <span className="rounded-full bg-black/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-black/80">
                        ✦ {estimatedCostCredits} créditos
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside
          className={`absolute inset-y-0 right-0 z-30 w-full border-l border-[rgba(241,225,148,0.08)] bg-[linear-gradient(180deg,rgba(10,5,6,0.92),rgba(4,2,3,0.98))] shadow-[-28px_0_80px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-transform duration-300 sm:w-[92vw] sm:max-w-[420px] ${
            historyOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{
            paddingTop: "max(env(safe-area-inset-top), 12px)",
            paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
          }}
          aria-hidden={!historyOpen}
        >
          <div className="flex h-full min-h-0 flex-col px-4 sm:px-5">
            <div className="flex items-center justify-between gap-3 border-b border-[rgba(241,225,148,0.08)] pb-4">
              <div>
                <div className="text-sm font-semibold text-[rgba(255,245,220,0.95)]">Historial</div>
                <div className="mt-1 text-xs text-white/42">{generatedHistory.length} imágenes guardadas</div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className={`${subtleButtonClass} h-11 w-11 shrink-0`}
                aria-label="Cerrar historial"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-1 pt-4">
              <div className="overflow-hidden rounded-[26px] border border-[rgba(241,225,148,0.08)] bg-[rgba(0,0,0,0.24)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                {selectedHistoryAsset ? (
                  <img
                    src={selectedHistoryAsset.url}
                    alt={selectedHistoryAsset.name}
                    className="aspect-square w-full object-contain bg-[rgba(0,0,0,0.32)] p-3 sm:p-4"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center px-6 text-center text-sm text-white/34">
                    Tus imágenes aparecerán aquí.
                  </div>
                )}
              </div>

              {selectedHistoryAsset ? (
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleDownload(selectedHistoryAsset)}
                    className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[18px] border border-[rgba(241,225,148,0.14)] bg-[rgba(241,225,148,0.08)] px-4 py-3 text-sm font-medium text-[rgba(255,245,220,0.95)] transition hover:border-[rgba(241,225,148,0.28)] hover:bg-[rgba(241,225,148,0.13)]"
                  >
                    <IconDownload className="h-4 w-4" />
                    Descargar
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshAssets(true).catch(() => undefined)}
                    className={`${subtleButtonClass} h-12 w-12 shrink-0`}
                    title="Refrescar historial"
                  >
                    <IconRefresh className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              <div className="mt-5 border-t border-[rgba(241,225,148,0.08)] pt-4">
                <div className="mb-3 text-[11px] font-mono uppercase tracking-[0.24em] text-[rgba(241,225,148,0.64)]">
                  Todas las generaciones
                </div>

                {assetsLoading ? (
                  <div className="rounded-[22px] border border-[rgba(241,225,148,0.08)] bg-[rgba(0,0,0,0.18)] px-4 py-4 text-sm text-white/48">
                    Cargando historial...
                  </div>
                ) : assetsError ? (
                  <div className="rounded-[22px] border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">
                    {assetsError}
                  </div>
                ) : generatedHistory.length === 0 ? (
                  <div className="flex min-h-[180px] items-center justify-center rounded-[24px] border border-[rgba(241,225,148,0.08)] bg-[rgba(0,0,0,0.18)] px-6 text-center text-sm text-white/38">
                    Genera tu primera imagen para empezar a llenar este historial.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {generatedHistory.map((asset) => {
                      const active = selectedHistoryAsset?.id === asset.id;
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setSelectedHistoryAssetId(asset.id)}
                          className={`group relative overflow-hidden rounded-[22px] border bg-[rgba(0,0,0,0.24)] text-left transition ${
                            active
                              ? "border-[rgba(241,225,148,0.28)] shadow-[0_0_0_1px_rgba(241,225,148,0.1)]"
                              : "border-[rgba(241,225,148,0.08)] hover:border-[rgba(241,225,148,0.18)]"
                          }`}
                        >
                          <img src={asset.url} alt={asset.name} className="aspect-square w-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/88 via-black/18 to-transparent px-3 pb-3 pt-8">
                            <span className="line-clamp-2 text-[11px] text-white/88">{asset.prompt || asset.name}</span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDownload(asset);
                              }}
                              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-[rgba(241,225,148,0.1)] bg-[rgba(8,4,5,0.84)] text-white/84 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"
                              title="Descargar"
                            >
                              <IconDownload className="h-4 w-4" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CameraAnglesTool;
