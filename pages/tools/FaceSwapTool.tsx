import React, { useEffect, useMemo, useState } from "react";
import FileUploader from "../../components/FileUploader";
import ElementLibraryPickerModal from "../../components/ElementLibraryPickerModal";
import { Asset } from "../../types";
import {
  FaceSwapAnalysisOutput,
  FaceSwapAnalysisStage,
  FaceSwapType,
  ImageGenQuality,
  faceswapStep1GenerateAnalysisBundle,
  faceswapStep2InsertFromElement,
} from "../../services/geminiService";
import styles from "./FaceSwapTool.module.css";
import { estimateFaceSwapCostCredits } from "../../config/pricing.js";

const QUALITYS: ImageGenQuality[] = ["1K", "2K", "4K"];
const ANALYSIS_STAGES: Array<{ id: FaceSwapAnalysisStage; label: string; short: string }> = [
  { id: "depth", label: "Depth Map", short: "Depth" },
  { id: "canny", label: "Canny Edge Detection", short: "Canny" },
  { id: "openpose", label: "OpenPose", short: "OpenPose" },
];

const SWAP_OPTIONS: Array<{ id: FaceSwapType; label: string; desc: string }> = [
  { id: "face", label: "Cara", desc: "Analiza e inserta solo la cara. Conserva pelo del target." },
  { id: "face_hair", label: "Cara y Pelo", desc: "Analiza e inserta cabeza completa: cara + pelo." },
  { id: "body", label: "Cuerpo", desc: "Analiza anatomía visible, manteniendo ropa/accesorios del target." },
  { id: "body_clothes", label: "Cuerpo y Ropa", desc: "Analiza sujeto completo para reemplazo completo." },
  { id: "clothes_only", label: "Solo Ropa", desc: "Analiza solo la ropa; conserva identidad del target." },
];

function outputsToMap(outputs: FaceSwapAnalysisOutput[]) {
  return outputs.reduce<Record<FaceSwapAnalysisStage, FaceSwapAnalysisOutput | null>>(
    (acc, item) => {
      acc[item.kind] = item;
      return acc;
    },
    {
      depth: null,
      canny: null,
      openpose: null,
    }
  );
}

export default function FaceSwapTool() {
  const [step1Input, setStep1Input] = useState<Asset | null>(null);
  const [step1SwapType, setStep1SwapType] = useState<FaceSwapType>("face");
  const [step1Quality, setStep1Quality] = useState<ImageGenQuality>("2K");

  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [step1Progress, setStep1Progress] = useState<string>("");
  const [activeStage, setActiveStage] = useState<FaceSwapAnalysisStage | null>(null);
  const [analysisOutputs, setAnalysisOutputs] = useState<Record<FaceSwapAnalysisStage, FaceSwapAnalysisOutput | null>>({
    depth: null,
    canny: null,
    openpose: null,
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [donorElement, setDonorElement] = useState<Asset | null>(null);
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [finalOut, setFinalOut] = useState<{ url: string; assetId: string } | null>(null);

  const step1SelectedDesc = useMemo(() => {
    return SWAP_OPTIONS.find((x) => x.id === step1SwapType)?.desc || "";
  }, [step1SwapType]);

  const step2SelectedDesc = useMemo(() => {
    return SWAP_OPTIONS.find((x) => x.id === step1SwapType)?.desc || "";
  }, [step1SwapType]);

  const estimatedStepCostCredits = useMemo(() => estimateFaceSwapCostCredits(), []);

  const lockedSwapType = step1SwapType;
  const lockedQuality = step1Quality;

  const completedStageCount = ANALYSIS_STAGES.filter((stage) => !!analysisOutputs[stage.id]?.assetId).length;
  const step2Enabled = ANALYSIS_STAGES.every((stage) => !!analysisOutputs[stage.id]?.assetId);

  useEffect(() => {
    setAnalysisOutputs({ depth: null, canny: null, openpose: null });
    setFinalOut(null);
    setStep1Error(null);
    setStep2Error(null);
    setStep1Progress("");
    setActiveStage(null);
  }, [step1SwapType, step1Quality, step1Input?.id]);

  async function runStep1() {
    if (!step1Input?.id) return;

    setStep1Loading(true);
    setStep1Error(null);
    setStep2Error(null);
    setFinalOut(null);
    setStep1Progress("Preparando análisis en serie...");
    setActiveStage("depth");
    setAnalysisOutputs({ depth: null, canny: null, openpose: null });

    try {
      const res = await faceswapStep1GenerateAnalysisBundle({
        targetAssetId: step1Input.id,
        swapType: step1SwapType,
        quality: step1Quality,
        asyncHooks: {
          onProgress: (msg) => setStep1Progress(msg),
          onStageResults: (outputs) => {
            const nextMap = outputsToMap(outputs);
            setAnalysisOutputs(nextMap);

            const nextPending = ANALYSIS_STAGES.find((stage) => !nextMap[stage.id]);
            setActiveStage(nextPending?.id || null);
          },
        },
      });

      const nextMap = outputsToMap(res.outputs || []);
      setAnalysisOutputs(nextMap);
      setActiveStage(null);
      setStep1Progress("Paso 1 completado: Depth, Canny y OpenPose listos.");
    } catch (e: any) {
      setStep1Error(e?.message || "Error en Paso 1.");
    } finally {
      setStep1Loading(false);
    }
  }

  async function runStep2() {
    if (!step2Enabled) return;
    if (!donorElement?.id) return;

    setStep2Loading(true);
    setStep2Error(null);
    setFinalOut(null);

    try {
      const res = await faceswapStep2InsertFromElement({
        depthAssetId: analysisOutputs.depth?.assetId || undefined,
        cannyAssetId: analysisOutputs.canny?.assetId || undefined,
        openposeAssetId: analysisOutputs.openpose?.assetId || undefined,
        donorElementId: donorElement.id,
        swapType: lockedSwapType,
        quality: lockedQuality,
      });
      setFinalOut({ url: res.url, assetId: res.assetId });
    } catch (e: any) {
      setStep2Error(e?.message || "Error en Paso 2.");
    } finally {
      setStep2Loading(false);
    }
  }

  const donorPreview = donorElement?.url || "";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold mb-2">FaceSwap (2 pasos)</h1>
      <p className="text-gray-400 mb-8">
        Paso 1 genera 3 guías técnicas en serie sobre la misma imagen objetivo: <b>Depth</b>, <b>Canny</b> y <b>OpenPose</b>. Paso 2 usa esas 3 guías + tu <b>Element</b> para insertar el resultado final sin contaminar encuadre ni iluminación.
      </p>

      <ElementLibraryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(el) => {
          setDonorElement(el);
          setPickerOpen(false);
        }}
         title="Elegir / Crear Element (General Image Generator)"
      />

      <section className="space-y-4">
        <div className="glass-panel p-6 space-y-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Paso 1 — Analizar Imagen</h2>
            <span className="text-xs text-white/60">Modelo fijo: Nano Banana 2</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Área</label>
              <select
                value={step1SwapType}
                onChange={(e) => setStep1SwapType(e.target.value as FaceSwapType)}
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20"
              >
                {SWAP_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/60">{step1SelectedDesc}</div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Resolución</label>
              <select
                value={step1Quality}
                onChange={(e) => setStep1Quality(e.target.value as ImageGenQuality)}
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20"
              >
                {QUALITYS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/60">Las 3 guías respetarán el canvas y la proporción del input.</div>
            </div>
          </div>

          <FileUploader
            label="Imagen de referencia (Paso 1)"
            onAssetReady={setStep1Input}
            uploadTool="faceswap"
            uploadCategory="step1"
            previewFit="contain"
          />

          <button type="button" onClick={runStep1} disabled={!step1Input?.id || step1Loading} className={styles.generateBtn}>
            {step1Loading ? (
              <>
                {activeStage ? `Analizando · ${ANALYSIS_STAGES.find((x) => x.id === activeStage)?.short}` : "Analizando..."}
                <span className={styles.generateSpinner} />
              </>
            ) : (
              "Analizar imagen"
            )}
          </button>

          <div className="text-center text-[12px] text-white/60 -mt-2">
            Coste estimado: <span className="font-semibold text-white/85">{estimatedStepCostCredits}</span> crédito
          </div>

          {step1Error && <div className="text-sm text-red-400">{step1Error}</div>}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-bold">Viewport provisional del Paso 1</div>
              <div className="text-xs text-white/60">
                {completedStageCount}/3 guías listas{step1Loading ? " · generando en serie" : ""}
              </div>
            </div>

            <div className={styles.step1Note}>
              Este viewport es temporal para validar si los resultados de fondo son correctos. Después lo puedes volver a ocultar.
            </div>

            {step1Progress ? <div className={styles.progressText}>{step1Progress}</div> : null}

            <div className={styles.stageGrid}>
              {ANALYSIS_STAGES.map((stage) => {
                const output = analysisOutputs[stage.id];
                const isActive = activeStage === stage.id;
                const isDone = !!output?.assetId;
                const statusLabel = isDone ? "Listo" : isActive ? "Generando..." : step1Loading ? "En cola" : "Pendiente";

                return (
                  <div
                    key={stage.id}
                    className={`${styles.stageCard} ${isActive ? styles.stageCardActive : ""} ${isDone ? styles.stageCardDone : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="text-sm font-bold text-white/90">{stage.label}</div>
                        <div className="text-[11px] text-white/50">Paso 1/{ANALYSIS_STAGES.length}</div>
                      </div>
                      <span className={`${styles.stageBadge} ${isDone ? styles.stageBadgeDone : isActive ? styles.stageBadgeActive : styles.stageBadgeIdle}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <div className={styles.stageThumb}>
                      {output?.url ? (
                        <img src={output.url} alt={stage.label} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-center px-4 text-xs text-white/40 gap-2">
                          {isActive ? <span className={styles.generateSpinner} /> : null}
                          <span>{isActive ? `Generando ${stage.short}...` : `Sin resultado todavía`}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!step1Loading && step2Enabled ? (
              <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                ✅ Las 3 guías están listas. Ahora sí se desbloquea el <b>Paso 2</b>.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className={`glass-panel p-6 space-y-6 ${step2Enabled ? "" : "opacity-60"}`}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Paso 2 — Faceswap</h2>
            <span className="text-xs text-white/60">Modelo fijo: Nano Banana Pro</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Área (bloqueada por Paso 1)</label>
              <div className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm">
                {SWAP_OPTIONS.find((o) => o.id === lockedSwapType)?.label}
              </div>
              <div className="text-xs text-white/60">{step2SelectedDesc}</div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Resolución (bloqueada por Paso 1)</label>
              <div className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm">{lockedQuality}</div>
              <div className="text-xs text-white/60">La salida final usará las 3 guías del Paso 1 + el Element.</div>
            </div>
          </div>

          {!step2Enabled ? (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
              El Paso 2 permanece bloqueado hasta completar <b>Depth</b>, <b>Canny</b> y <b>OpenPose</b>.
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Elemento (General Image Generator)</label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={!step2Enabled}
                className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-bold disabled:opacity-60"
              >
                {donorElement ? "Cambiar Element" : "Elegir Element"}
              </button>

              {donorElement && (
                <div className="text-xs text-white/60">
                  Seleccionado: <b>{donorElement.name}</b>
                </div>
              )}
            </div>

            {donorElement ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                <div className="aspect-video bg-black/40">
                  {donorPreview ? (
                    <img src={donorPreview} alt={donorElement.name} className="w-full h-full object-contain" style={{ objectFit: "contain", objectPosition: "center" }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-white/40">Sin preview</div>
                  )}
                </div>
                <div className="p-4">
                  <div className="text-sm font-bold text-white/90">{donorElement.name}</div>
                  <div className="text-xs text-white/60 mt-1">
                    Paso 2 usará este Element como <b>@element</b> y lo alineará usando <b>@depth</b>, <b>@canny</b> y <b>@openpose</b>.
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-white/60">
                Selecciona un Element creado desde <b>General Image Generator &gt; Elements</b> (o créalo ahora).
              </div>
            )}
          </div>

          <button type="button" onClick={runStep2} disabled={!step2Enabled || !donorElement?.id || step2Loading} className={styles.generateBtn}>
            {step2Loading ? (
              <>
                Faceswap...
                <span className={styles.generateSpinner} />
              </>
            ) : (
              "Faceswap"
            )}
          </button>

          <div className="text-center text-[12px] text-white/60 -mt-2">
            Coste estimado: <span className="font-semibold text-white/85">{estimatedStepCostCredits}</span> crédito
          </div>

          {step2Error && <div className="text-sm text-red-400">{step2Error}</div>}

          <div className="space-y-2">
            <div className="text-sm font-bold">Resultado Paso 2</div>
            {finalOut?.url ? (
              <img src={finalOut.url} alt="Paso 2 final" className="w-full rounded-2xl border border-white/10" />
            ) : (
              <div className="text-xs text-white/60">Ejecuta el Paso 2 para generar la imagen final.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
