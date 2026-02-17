import React, { useMemo, useState } from "react";
import FileUploader from "../../components/FileUploader";
import KlingElementPickerModal from "../../components/KlingElementPickerModal";
import { Asset } from "../../types";
import { ImageGenQuality, faceswapStep1MakeMannequin, faceswapStep2InsertFromElement, FaceSwapType } from "../../services/geminiService";
import { KlingElement } from "../../services/klingElementsService";

const SWAP_OPTIONS: Array<{ id: FaceSwapType; label: string; desc: string }> = [
  { id: "face", label: "Cara", desc: "Convierte solo la cara / Inserta solo la cara (mantiene pelo del base)." },
  { id: "face_hair", label: "Cara y Pelo", desc: "Convierte cara+pelo / Inserta cabeza completa (cara+pelo)." },
  { id: "body", label: "Cuerpo", desc: "Incluye cara+pelo+cuerpo (mantiene ropa/accesorios en base)." },
  { id: "body_clothes", label: "Cuerpo y Ropa", desc: "Incluye todo; en base se elimina ropa (mantiene escena)." },
];

const QUALITYS: ImageGenQuality[] = ["1K", "2K", "4K"];

export default function FaceSwapTool() {
  // --------------------
  // PASO 1
  // --------------------
  const [step1SwapType, setStep1SwapType] = useState<FaceSwapType>("face");
  const [step1Quality, setStep1Quality] = useState<ImageGenQuality>("2K");
  const [step1Input, setStep1Input] = useState<Asset | null>(null);

  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [mannequin, setMannequin] = useState<{ url: string; assetId: string } | null>(null);

  // --------------------
  // PASO 2
  // --------------------
  const [step2SwapType, setStep2SwapType] = useState<FaceSwapType>("face");
  const [step2Quality, setStep2Quality] = useState<ImageGenQuality>("2K");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [donorElement, setDonorElement] = useState<KlingElement | null>(null);

  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [finalOut, setFinalOut] = useState<{ url: string; assetId: string } | null>(null);

  const step2Enabled = !!mannequin;

  const step1SelectedDesc = useMemo(() => {
    return SWAP_OPTIONS.find((x) => x.id === step1SwapType)?.desc || "";
  }, [step1SwapType]);

  const step2SelectedDesc = useMemo(() => {
    return SWAP_OPTIONS.find((x) => x.id === step2SwapType)?.desc || "";
  }, [step2SwapType]);

  async function runStep1() {
    if (!step1Input?.id) return;

    setStep1Loading(true);
    setStep1Error(null);

    try {
      const res = await faceswapStep1MakeMannequin({
        targetAssetId: step1Input.id,
        swapType: step1SwapType,
        quality: step1Quality,
      });

      setMannequin({ url: res.url, assetId: res.assetId });
      setFinalOut(null); // al cambiar maniquí, invalidamos el resultado final
      setStep2Error(null);
    } catch (e: any) {
      setStep1Error(e?.message || "Error generando el maniquí.");
    } finally {
      setStep1Loading(false);
    }
  }

  async function runStep2() {
    if (!mannequin?.assetId) return;
    if (!donorElement?.id) return;

    setStep2Loading(true);
    setStep2Error(null);

    try {
      const res = await faceswapStep2InsertFromElement({
        baseAssetId: mannequin.assetId,
        donorElementId: donorElement.id,
        swapType: step2SwapType,
        quality: step2Quality,
      });

      setFinalOut({ url: res.url, assetId: res.assetId });
    } catch (e: any) {
      setStep2Error(e?.message || "Error insertando la identidad en el maniquí.");
    } finally {
      setStep2Loading(false);
    }
  }

  const donorPreview = donorElement?.previewUrl || donorElement?.imageUrls?.[0] || "";

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold mb-2">FaceSwap (2 pasos)</h1>
      <p className="text-gray-400 mb-8">
        Paso 1 crea el maniquí conservando la esencia (suciedad/heridas/expresión). Paso 2 inserta identidad desde <b>Element/Person</b> sin contaminar estilo/iluminación/composición.
      </p>

      <KlingElementPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(el) => {
          setDonorElement(el);
          setPickerOpen(false);
        }}
        title="Elegir Person Element (donante)"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ===================== */}
        {/* PASO 1 */}
        {/* ===================== */}
        <div className="glass-panel p-6 space-y-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Paso 1 — Crear Maniquí</h2>
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
              <div className="text-xs text-white/60">Recomendado: 2K/4K si tu input es bueno.</div>
            </div>
          </div>

          <FileUploader label="Imagen base (modelo real) — para convertir a maniquí" onAssetReady={setStep1Input} uploadTool="faceswap" uploadCategory="step1" />

          <button
            type="button"
            onClick={runStep1}
            disabled={!step1Input?.id || step1Loading}
            className="w-full primary-button disabled:opacity-50"
          >
            {step1Loading ? "Generando maniquí..." : "Generar Maniquí (Paso 1)"}
          </button>

          {step1Error && <p className="text-red-300 text-sm">{step1Error}</p>}

          <div className="space-y-3">
            <div className="text-sm font-bold">Resultado Paso 1</div>
            {mannequin?.url ? (
              <img src={mannequin.url} alt="Paso 1 maniquí" className="w-full rounded-2xl border border-white/10" />
            ) : (
              <div className="aspect-video bg-black/20 rounded-2xl border border-white/10 flex items-center justify-center">
                <p className="text-white/40 text-sm">Aquí aparecerá el maniquí</p>
              </div>
            )}
          </div>
        </div>

        {/* ===================== */}
        {/* PASO 2 */}
        {/* ===================== */}
        <div className={`glass-panel p-6 space-y-6 ${step2Enabled ? "" : "opacity-60"}`}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Paso 2 — Insertar identidad (Element/Person)</h2>
            <span className="text-xs text-white/60">Sin contaminar estilo/iluminación</span>
          </div>

          {!step2Enabled && (
            <div className="text-sm text-white/70 bg-black/30 border border-white/10 rounded-2xl p-4">
              Primero completa el <b>Paso 1</b> para desbloquear el Paso 2.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Área</label>
              <select
                value={step2SwapType}
                onChange={(e) => setStep2SwapType(e.target.value as FaceSwapType)}
                disabled={!step2Enabled}
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20 disabled:opacity-60"
              >
                {SWAP_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/60">{step2SelectedDesc}</div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Resolución</label>
              <select
                value={step2Quality}
                onChange={(e) => setStep2Quality(e.target.value as ImageGenQuality)}
                disabled={!step2Enabled}
                className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm outline-none focus:border-white/20 disabled:opacity-60"
              >
                {QUALITYS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/60">La salida conserva el encuadre del maniquí (Paso 1).</div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Donante: Element/Person</label>

            <div className="flex flex-col md:flex-row gap-4">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={!step2Enabled}
                className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-bold disabled:opacity-60"
              >
                {donorElement ? "Cambiar Element" : "Elegir Element"}
              </button>

              {donorElement && (
                <button
                  type="button"
                  onClick={() => setDonorElement(null)}
                  disabled={!step2Enabled}
                  className="px-4 py-3 rounded-2xl bg-black/30 hover:bg-black/40 border border-white/10 text-sm font-bold disabled:opacity-60"
                >
                  Quitar
                </button>
              )}
            </div>

            {donorElement ? (
              <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/30">
                <div className="aspect-video bg-black/40">
                  {donorPreview ? (
                    <img src={donorPreview} alt={donorElement.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-white/40">
                      Sin preview
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="text-sm font-bold text-white/90">{donorElement.name}</div>
                  <div className="text-xs text-white/60 mt-1">
                    Si el Element es un collage, se usará solo como identidad (no se devolverán grillas).
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-white/60">
                Selecciona un Element (Person) creado desde <b>Image Generator &gt; Elements</b>.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={runStep2}
            disabled={!step2Enabled || !donorElement?.id || step2Loading}
            className="w-full primary-button disabled:opacity-50"
          >
            {step2Loading ? "Insertando..." : "Generar Imagen Final (Paso 2)"}
          </button>

          {step2Error && <p className="text-red-300 text-sm">{step2Error}</p>}

          <div className="space-y-3">
            <div className="text-sm font-bold">Resultado Paso 2</div>
            {finalOut?.url ? (
              <img src={finalOut.url} alt="Resultado final faceswap" className="w-full rounded-2xl border border-white/10" />
            ) : (
              <div className="aspect-video bg-black/20 rounded-2xl border border-white/10 flex items-center justify-center">
                <p className="text-white/40 text-sm">Aquí aparecerá el resultado final</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
