import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorModal from "../../components/ErrorModal";
import CameraAngleSimulator3D, { CameraAngleValue } from "../../components/CameraAngleSimulator3D";
import { estimateImageCostCredits } from "../../config/pricing.js";
import { downloadAssetToDisk, listMyAssets, uploadUserAsset } from "../../services/assetsApi";
import { generateImageBatch } from "../../services/geminiService";
import { Asset } from "../../types";

const CAMERA_ANGLES_MODEL = "fal-ai/qwen-image-edit-2511-multiple-angles";
const DEFAULT_COUNT = 1;
const DEFAULT_LORA_SCALE = 1;
const ASSET_FETCH_LIMIT = 250;

const cosmosBackground = {
  backgroundImage:
    "radial-gradient(1px 1px at 7% 18%, rgba(255,255,255,0.9), transparent), radial-gradient(1px 1px at 16% 71%, rgba(255,255,255,0.55), transparent), radial-gradient(1.2px 1.2px at 26% 36%, rgba(241,225,148,0.82), transparent), radial-gradient(1px 1px at 39% 14%, rgba(255,255,255,0.74), transparent), radial-gradient(1px 1px at 51% 82%, rgba(255,255,255,0.62), transparent), radial-gradient(1.2px 1.2px at 63% 44%, rgba(241,225,148,0.76), transparent), radial-gradient(1px 1px at 78% 21%, rgba(255,255,255,0.82), transparent), radial-gradient(1px 1px at 91% 67%, rgba(255,255,255,0.7), transparent), radial-gradient(circle at 18% 14%, rgba(91,14,20,0.34), transparent 28%), radial-gradient(circle at 82% 12%, rgba(241,225,148,0.08), transparent 18%), radial-gradient(circle at 50% 100%, rgba(91,14,20,0.3), transparent 35%), linear-gradient(180deg, rgba(6,2,4,0.98), rgba(3,1,2,1))",
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
    return generatedHistory.find((asset) => asset.id === selectedHistoryAssetId) || generatedHistory[0];
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
        horizontalAngle: cam.azimuth,
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

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[30px] border border-[rgba(241,225,148,0.08)] bg-[#030102] text-[rgba(255,245,220,0.95)]">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="absolute inset-0 opacity-95" style={cosmosBackground} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(91,14,20,0.28),transparent_38%),radial-gradient(circle_at_50%_60%,rgba(241,225,148,0.05),transparent_22%),linear-gradient(180deg,rgba(0,0,0,0.05),rgba(0,0,0,0.25))]" />
      <div className="pointer-events-none absolute left-[-12%] top-[8%] h-[320px] w-[320px] rounded-full bg-[rgba(91,14,20,0.22)] blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-12%] right-[-8%] h-[360px] w-[360px] rounded-full bg-[rgba(91,14,20,0.2)] blur-[150px]" />

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleReferenceUpload} className="hidden" />

      {pickerOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
          <div className="relative flex h-[min(88vh,920px)] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-[rgba(241,225,148,0.12)] bg-[linear-gradient(180deg,rgba(10,5,6,0.96),rgba(3,1,2,0.98))] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
              <div>
                <div className="text-lg font-semibold text-[rgba(255,245,220,0.95)]">Seleccionar referencia</div>
                <div className="mt-1 text-xs text-white/45">Upload local o historial global de imágenes</div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/72 transition hover:border-[rgba(241,225,148,0.28)] hover:bg-white/10"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 pt-5">
              <div className="inline-flex rounded-2xl border border-[rgba(241,225,148,0.12)] bg-black/30 p-1 backdrop-blur-xl">
                {[
                  { key: "history", label: "Historial global" },
                  { key: "upload", label: "Upload local" },
                ].map((tab) => {
                  const active = pickerTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setPickerTab(tab.key as "history" | "upload")}
                      className={`rounded-[14px] px-4 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-[rgba(241,225,148,0.14)] text-[rgba(255,245,220,0.96)]"
                          : "text-white/58 hover:text-white/82"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
              {pickerTab === "upload" ? (
                <div className="grid h-full gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingReference}
                    className="group flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-[rgba(241,225,148,0.18)] bg-[linear-gradient(180deg,rgba(18,8,10,0.86),rgba(7,3,5,0.96))] px-8 text-center transition hover:border-[rgba(241,225,148,0.34)] hover:bg-[linear-gradient(180deg,rgba(24,11,13,0.92),rgba(9,4,6,0.98))]"
                  >
                    {uploadingReference ? (
                      <>
                        <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/15 border-t-[rgba(241,225,148,0.95)]" />
                        <div className="mt-5 text-sm font-semibold">Subiendo referencia...</div>
                      </>
                    ) : (
                      <>
                        <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-[rgba(241,225,148,0.18)] bg-[rgba(241,225,148,0.08)] text-[rgba(241,225,148,0.9)] transition group-hover:scale-105 group-hover:bg-[rgba(241,225,148,0.14)]">
                          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </div>
                        <div className="mt-5 text-lg font-semibold text-[rgba(255,245,220,0.96)]">Subir desde tu equipo</div>
                        <div className="mt-2 max-w-md text-sm text-white/46">La imagen se guarda como referencia y queda lista para reutilizarla cuando quieras.</div>
                      </>
                    )}
                  </button>

                  <div className="rounded-[28px] border border-white/8 bg-black/25 p-5">
                    <div className="text-xs font-mono uppercase tracking-[0.24em] text-[rgba(241,225,148,0.64)]">Referencia actual</div>
                    <div className="mt-4 overflow-hidden rounded-[24px] border border-white/8 bg-black/35">
                      {referenceAsset ? (
                        <img src={referenceAsset.url} alt={referenceAsset.name} className="aspect-square w-full object-contain bg-black/30 p-4" />
                      ) : (
                        <div className="flex aspect-square items-center justify-center text-sm text-white/34">Todavía no has seleccionado una imagen.</div>
                      )}
                    </div>
                    {referenceAsset ? (
                      <div className="mt-4 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-white/70">{referenceAsset.name}</div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {assetsLoading ? (
                    <div className="flex h-[280px] items-center justify-center rounded-[28px] border border-white/8 bg-black/25 text-white/55">
                      Cargando historial...
                    </div>
                  ) : assetsError ? (
                    <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">{assetsError}</div>
                  ) : referenceLibrary.length === 0 ? (
                    <div className="flex h-[280px] items-center justify-center rounded-[28px] border border-white/8 bg-black/25 text-white/40">
                      No hay imágenes en tu historial todavía.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                      {referenceLibrary.map((asset) => {
                        const active = referenceAsset?.id === asset.id;
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => handleSelectReference(asset)}
                            className={`group relative overflow-hidden rounded-[24px] border bg-black/35 text-left transition ${
                              active
                                ? "border-[rgba(241,225,148,0.42)] shadow-[0_0_0_1px_rgba(241,225,148,0.18)]"
                                : "border-white/8 hover:border-[rgba(241,225,148,0.22)]"
                            }`}
                          >
                            <img src={asset.url} alt={asset.name} className="aspect-square w-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent px-3 pb-3 pt-10">
                              <div className="line-clamp-2 text-xs text-white/88">{asset.prompt || asset.name}</div>
                            </div>
                            {active ? (
                              <div className="absolute left-3 top-3 rounded-full border border-[rgba(241,225,148,0.18)] bg-[rgba(10,5,6,0.82)] px-2 py-1 text-[10px] font-semibold text-[rgba(241,225,148,0.88)]">
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

      <div className="relative z-10 flex h-full min-h-0 flex-col lg:flex-row">
        <section className="relative flex min-h-[620px] flex-1 items-center justify-center px-4 pb-36 pt-6 sm:px-6 lg:min-h-0 lg:px-8 lg:pb-12 lg:pt-8">
          <div className="absolute left-4 top-4 z-20 inline-flex items-center gap-3 rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(10,5,6,0.72)] px-4 py-2 text-xs text-white/72 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
            <span className="h-2 w-2 rounded-full bg-[rgba(241,225,148,0.85)] shadow-[0_0_12px_rgba(241,225,148,0.8)]" />
            <span className="font-mono tracking-[0.22em] text-[rgba(241,225,148,0.74)]">CAMERA ANGLES 3D</span>
          </div>

          <div className="absolute right-4 top-4 z-20 hidden items-center gap-3 rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(10,5,6,0.72)] px-4 py-2 text-xs text-white/72 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.28)] sm:inline-flex">
            <span className="text-[rgba(241,225,148,0.74)]">Coste</span>
            <span className="font-semibold text-[rgba(255,245,220,0.95)]">{estimatedCostCredits} créditos</span>
          </div>

          <div className="relative flex w-full max-w-[1020px] items-center justify-center">
            <div className="w-full max-w-[860px]">
              <CameraAngleSimulator3D
                imageUrl={referenceAsset?.url || null}
                value={cam}
                onChange={setCam}
                disabled={loading || !referenceAsset}
                onOpenReferencePicker={() => setPickerOpen(true)}
                referenceLabel={referenceAsset?.name || null}
              />
            </div>

            {loading ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-[28px] border border-[rgba(241,225,148,0.14)] bg-[rgba(6,2,4,0.7)] px-6 py-4 text-sm text-white/84 backdrop-blur-xl shadow-[0_20px_70px_rgba(0,0,0,0.4)]">
                  Generando nueva vista...
                </div>
              </div>
            ) : null}
          </div>

          <div className="absolute bottom-4 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-[930px] -translate-x-1/2 rounded-[28px] border border-[rgba(241,225,148,0.12)] bg-[rgba(10,5,6,0.74)] p-3 backdrop-blur-2xl shadow-[0_28px_90px_rgba(0,0,0,0.38)] sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 rounded-[22px] border border-white/8 bg-black/25 px-4 py-3">
                <input
                  type="text"
                  value={additionalPrompt}
                  onChange={(e) => setAdditionalPrompt(e.target.value)}
                  placeholder="Prompt opcional"
                  className="w-full bg-transparent text-sm text-[rgba(255,245,220,0.94)] outline-none placeholder:text-white/32"
                />
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`inline-flex min-h-[56px] items-center justify-center gap-3 rounded-[22px] px-6 text-sm font-semibold transition sm:min-w-[220px] ${
                  canGenerate
                    ? "border border-[rgba(241,225,148,0.28)] bg-[linear-gradient(180deg,rgba(241,225,148,0.96),rgba(207,178,95,0.96))] text-black shadow-[0_16px_45px_rgba(241,225,148,0.22)] hover:brightness-105"
                    : "cursor-not-allowed border border-white/8 bg-white/8 text-white/36"
                }`}
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                    Generando...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                    Generar
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <aside
          className={`relative z-20 flex shrink-0 flex-col border-t border-white/8 bg-[rgba(5,2,3,0.72)] backdrop-blur-2xl transition-all duration-300 lg:border-l lg:border-t-0 ${
            historyOpen ? "w-full lg:w-[360px]" : "w-full lg:w-[96px]"
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-4 lg:min-h-[88px]">
            <div className={`${historyOpen ? "opacity-100" : "opacity-0 lg:hidden"} transition-opacity`}>
              <div className="text-sm font-semibold text-[rgba(255,245,220,0.94)]">Historial</div>
              <div className="mt-1 text-xs text-white/42">{generatedHistory.length} imágenes guardadas</div>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen((prev) => !prev)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(241,225,148,0.12)] bg-white/5 text-white/78 transition hover:border-[rgba(241,225,148,0.3)] hover:bg-white/10"
              title={historyOpen ? "Plegar historial" : "Abrir historial"}
            >
              {historyOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {historyOpen ? (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="border-b border-white/8 px-4 py-4">
                  <div className="overflow-hidden rounded-[24px] border border-white/8 bg-black/30">
                    {selectedHistoryAsset ? (
                      <img
                        src={selectedHistoryAsset.url}
                        alt={selectedHistoryAsset.name}
                        className="aspect-square w-full object-contain bg-black/35 p-3"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-sm text-white/34">Tus imágenes aparecerán aquí.</div>
                    )}
                  </div>
                  {selectedHistoryAsset ? (
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(selectedHistoryAsset)}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-[18px] border border-[rgba(241,225,148,0.16)] bg-[rgba(241,225,148,0.08)] px-4 py-3 text-sm font-medium text-[rgba(255,245,220,0.95)] transition hover:border-[rgba(241,225,148,0.3)] hover:bg-[rgba(241,225,148,0.14)]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <path d="m7 10 5 5 5-5" />
                          <path d="M12 15V3" />
                        </svg>
                        Descargar
                      </button>
                      <button
                        type="button"
                        onClick={() => refreshAssets(true).catch(() => undefined)}
                        className="inline-flex h-[50px] w-[50px] items-center justify-center rounded-[18px] border border-white/10 bg-white/5 text-white/72 transition hover:border-[rgba(241,225,148,0.22)] hover:bg-white/10"
                        title="Refrescar historial"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 2v6h-6" />
                          <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
                          <path d="M3 22v-6h6" />
                          <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {assetsLoading ? (
                    <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4 text-sm text-white/48">Cargando historial...</div>
                  ) : generatedHistory.length === 0 ? (
                    <div className="flex h-full min-h-[180px] items-center justify-center rounded-[24px] border border-white/8 bg-black/20 px-6 text-center text-sm text-white/38">
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
                            className={`group relative overflow-hidden rounded-[22px] border bg-black/30 text-left transition ${
                              active
                                ? "border-[rgba(241,225,148,0.36)] shadow-[0_0_0_1px_rgba(241,225,148,0.14)]"
                                : "border-white/8 hover:border-[rgba(241,225,148,0.2)]"
                            }`}
                          >
                            <img src={asset.url} alt={asset.name} className="aspect-square w-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/88 via-black/26 to-transparent px-3 pb-3 pt-8">
                              <span className="line-clamp-2 text-[11px] text-white/88">{asset.prompt || asset.name}</span>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDownload(asset);
                                }}
                                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-black/55 text-white/82 opacity-0 transition group-hover:opacity-100"
                                title="Descargar"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <path d="m7 10 5 5 5-5" />
                                  <path d="M12 15V3" />
                                </svg>
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center gap-3 overflow-y-auto px-3 py-4">
                <div className="rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(241,225,148,0.08)] px-3 py-1 text-[11px] font-mono text-[rgba(241,225,148,0.78)]">
                  {generatedHistory.length}
                </div>
                {generatedHistory.slice(0, 8).map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      setSelectedHistoryAssetId(asset.id);
                      setHistoryOpen(true);
                    }}
                    className="overflow-hidden rounded-[20px] border border-white/8 bg-black/30 transition hover:border-[rgba(241,225,148,0.2)]"
                    title={asset.prompt || asset.name}
                  >
                    <img src={asset.url} alt={asset.name} className="h-[64px] w-[64px] object-cover" />
                  </button>
                ))}
                {!generatedHistory.length && !assetsLoading ? (
                  <div className="px-2 pt-6 text-center text-[11px] text-white/34">Sin historial</div>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CameraAnglesTool;
