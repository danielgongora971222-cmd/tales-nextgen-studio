import React, { useEffect, useMemo, useState } from "react";
import FileUploader from "../../components/FileUploader";
import ElementLibraryPickerModal from "../../components/ElementLibraryPickerModal";
import { Asset } from "../../types";
import { ImageGenQuality, faceswapStep1MakeMannequin, faceswapStep2InsertFromElement, FaceSwapType } from "../../services/geminiService";
import styles from "./FaceSwapTool.module.css";

const QUALITYS: ImageGenQuality[] = ["1K", "2K", "4K"];

const SWAP_OPTIONS: Array<{ id: FaceSwapType; label: string; desc: string }> = [
  { id: "face", label: "Cara", desc: "Convierte solo la cara / Inserta solo la cara (mantiene pelo del base)." },
  { id: "face_hair", label: "Cara y Pelo", desc: "Convierte cara+pelo / Inserta cabeza completa (cara+pelo)." },
  { id: "body", label: "Cuerpo", desc: "Incluye cara+pelo+cuerpo (mantiene ropa/accesorios en base)." },
  { id: "body_clothes", label: "Cuerpo y Ropa", desc: "Incluye todo; en base se elimina ropa (mantiene escena)." },
  { id: "clothes_only", label: "Solo Ropa", desc: "Mantiene la persona del Paso 1 y en Paso 2 solo reemplaza la ropa con el Element (outfit)." },
];

export default function FaceSwapTool() {
  // --------------------
  // PASO 1
  // --------------------
  const [step1Input, setStep1Input] = useState<Asset | null>(null);
  const [step1SwapType, setStep1SwapType] = useState<FaceSwapType>("face");
  const [step1Quality, setStep1Quality] = useState<ImageGenQuality>("2K");

  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [mannequin, setMannequin] = useState<{ url: string; assetId: string } | null>(null);

  // --------------------
  // PASO 2
  // --------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [donorElement, setDonorElement] = useState<Asset | null>(null);

  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [finalOut, setFinalOut] = useState<{ url: string; assetId: string } | null>(null);

  const step2Enabled = !!mannequin?.assetId;

  const step1SelectedDesc = useMemo(() => {
    return SWAP_OPTIONS.find((x) => x.id === step1SwapType)?.desc || "";
  }, [step1SwapType]);

  const step2SelectedDesc = useMemo(() => {
    return SWAP_OPTIONS.find((x) => x.id === step1SwapType)?.desc || "";
  }, [step1SwapType]);

  // 🔒 Paso 2 hereda SIEMPRE del Paso 1
  const lockedSwapType = step1SwapType;
  const lockedQuality = step1Quality;

  // Si cambias área/quality o imagen del Paso 1, invalidamos el flujo (obliga re-analizar)
  useEffect(() => {
    setMannequin(null);
    setFinalOut(null);
    setStep2Error(null);
  }, [step1SwapType, step1Quality, step1Input?.id]);

  async function runStep1() {
    if (!step1Input?.id) return;

    setStep1Loading(true);
    setStep1Error(null);
    setMannequin(null);
    setFinalOut(null);

    try {
      const res = await faceswapStep1MakeMannequin({
        targetAssetId: step1Input.id,
        swapType: step1SwapType,
        quality: step1Quality,
      });
      setMannequin({ url: res.url, assetId: res.assetId });
    } catch (e: any) {
      setStep1Error(e?.message || "Error en Paso 1.");
    } finally {
      setStep1Loading(false);
    }
  }

  async function runStep2() {
    if (!mannequin?.assetId) return;
    if (!donorElement?.id) return;

    setStep2Loading(true);
    setStep2Error(null);
    setFinalOut(null);

    try {
      const res = await faceswapStep2InsertFromElement({
        baseAssetId: mannequin.assetId,
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
        Paso 1 <b>Analiza</b> la imagen y prepara la base. Paso 2 aplica <b>Faceswap</b> usando un <b>Element</b> del <b>General Image Generator</b>.
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

      {/* PASO 1 */}
      <section className="space-y-4">
        <div className="glass-panel p-6 space-y-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Paso 1 — Analizar Imagen</h2>
            <span className="text-xs text-white/60">Modelo fijo: NanoBanana Pro</span>
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
              <div className="text-xs text-white/60">La salida conservará el encuadre y aspecto del input.</div>
            </div>
          </div>

          <FileUploader
            label="Imagen de referencia (Paso 1)"
            onAssetReady={setStep1Input}
            uploadTool="faceswap"
            uploadCategory="step1"
            previewFit="contain"
          />

          <button
            type="button"
            onClick={runStep1}
            disabled={!step1Input?.id || step1Loading}
            className={styles.generateBtn}
          >
            {step1Loading ? (
              <>
                Analizando...
                <span className={styles.generateSpinner} />
              </>
            ) : (
              "Analizar imagen"
            )}
          </button>

          {step1Error && <div className="text-sm text-red-400">{step1Error}</div>}

          <div className="space-y-2">
            <div className="text-sm font-bold">Resultado Paso 1</div>
            {mannequin?.url ? (
              <img src={mannequin.url} alt="Paso 1 maniquí" className="w-full rounded-2xl border border-white/10" />
            ) : (
              <div className="text-xs text-white/60">
                Ejecuta el Paso 1 para generar la base.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* PASO 2 */}
      <section className="space-y-4">
        <div className={`glass-panel p-6 space-y-6 ${step2Enabled ? "" : "opacity-60"}`}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Paso 2 — Faceswap</h2>
            <span className="text-xs text-white/60">Sin contaminar estilo/iluminación</span>
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
              <div className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm">
                {lockedQuality}
              </div>
              <div className="text-xs text-white/60">La salida respeta la relación de aspecto del Paso 1.</div>
            </div>
          </div>

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
                    <img
                      src={donorPreview}
                      alt={donorElement.name}
                      className="w-full h-full object-contain"
                      style={{ objectFit: "contain", objectPosition: "center" }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-white/40">
                      Sin preview
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="text-sm font-bold text-white/90">{donorElement.name}</div>
                  <div className="text-xs text-white/60 mt-1">
                    Puedes elegir un Element existente o crear uno nuevo desde el botón <b>Elegir Element</b>.
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-white/60">
                Selecciona un Element creado desde <b>General Image Generator &gt; Elements</b> (o créalo ahora).
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={runStep2}
            disabled={!step2Enabled || !donorElement?.id || step2Loading}
            className={styles.generateBtn}
          >
            {step2Loading ? (
              <>
                Faceswap...
                <span className={styles.generateSpinner} />
              </>
            ) : (
              "Faceswap"
            )}
          </button>

          {step2Error && <div className="text-sm text-red-400">{step2Error}</div>}

          <div className="space-y-2">
            <div className="text-sm font-bold">Resultado Paso 2</div>
            {finalOut?.url ? (
              <img src={finalOut.url} alt="Paso 2 final" className="w-full rounded-2xl border border-white/10" />
            ) : (
              <div className="text-xs text-white/60">
                Ejecuta el Paso 2 para generar la imagen final.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
