import React, { useMemo, useState } from "react";
import ErrorModal from "../../components/ErrorModal";
import FileUploader from "../../components/FileUploader";
import { generateImageBatch } from "../../services/geminiService";
import { Asset } from "../../types";
import { estimateImageCostCredits } from "../../config/pricing.js";

const CAMERA_ANGLES_MODEL = "fal-ai/qwen-image-edit-2511-multiple-angles";

type ImageSizeMode = "auto" | "preset" | "custom";
type ImageSizePreset =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9";

type CameraFormState = {
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
  additionalPrompt: string;
  negativePrompt: string;
  count: number;
  loraScale: number;
  guidanceScale: number;
  numInferenceSteps: number;
  acceleration: "none" | "regular";
  enableSafetyChecker: boolean;
  outputFormat: "png" | "jpeg" | "webp";
  imageSizeMode: ImageSizeMode;
  imageSizePreset: ImageSizePreset;
  customWidth: string;
  customHeight: string;
  seed: string;
};

const DEFAULT_FORM: CameraFormState = {
  horizontalAngle: 0,
  verticalAngle: 0,
  zoom: 5,
  additionalPrompt: "",
  negativePrompt: "",
  count: 1,
  loraScale: 1,
  guidanceScale: 4.5,
  numInferenceSteps: 28,
  acceleration: "regular",
  enableSafetyChecker: true,
  outputFormat: "png",
  imageSizeMode: "auto",
  imageSizePreset: "square_hd",
  customWidth: "1280",
  customHeight: "720",
  seed: "",
};

const sizePresetOptions: { value: ImageSizePreset; label: string }[] = [
  { value: "square_hd", label: "square_hd" },
  { value: "square", label: "square" },
  { value: "portrait_4_3", label: "portrait_4_3" },
  { value: "portrait_16_9", label: "portrait_16_9" },
  { value: "landscape_4_3", label: "landscape_4_3" },
  { value: "landscape_16_9", label: "landscape_16_9" },
];

const CameraAnglesTool: React.FC = () => {
  const [referenceAsset, setReferenceAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState<CameraFormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<{ url: string; assetId: string }[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = useMemo(() => {
    if (!referenceAsset || loading) return false;
    if (form.imageSizeMode !== "custom") return true;

    const width = Number(form.customWidth);
    const height = Number(form.customHeight);
    return Number.isInteger(width) && width >= 64 && Number.isInteger(height) && height >= 64;
  }, [form.customHeight, form.customWidth, form.imageSizeMode, loading, referenceAsset]);

  const estimatedCostCredits = useMemo(() => {
    return estimateImageCostCredits({ model: CAMERA_ANGLES_MODEL, quality: "1K", count: form.count });
  }, [form.count]);

  const selectedItem = useMemo(() => {
    if (!items.length) return null;
    return items.find((it) => it.assetId === selectedAssetId) || items[0];
  }, [items, selectedAssetId]);

  const updateForm = <K extends keyof CameraFormState>(key: K, value: CameraFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetCameraDefaults = () => {
    setForm((prev) => ({
      ...prev,
      horizontalAngle: 0,
      verticalAngle: 0,
      zoom: 5,
      loraScale: 1,
      guidanceScale: 4.5,
      numInferenceSteps: 28,
      acceleration: "regular",
      enableSafetyChecker: true,
      outputFormat: "png",
    }));
  };

  const applyHorizontalPreset = (value: number) => updateForm("horizontalAngle", value);
  const applyVerticalPreset = (value: number) => updateForm("verticalAngle", value);

  const handleGenerate = async () => {
    if (!referenceAsset) {
      setError("Primero sube una imagen de referencia.");
      return;
    }

    let imageSize:
      | ImageSizePreset
      | {
          width: number;
          height: number;
        }
      | undefined;

    if (form.imageSizeMode === "preset") {
      imageSize = form.imageSizePreset;
    }

    if (form.imageSizeMode === "custom") {
      const width = Number(form.customWidth);
      const height = Number(form.customHeight);

      if (!Number.isInteger(width) || width < 64 || !Number.isInteger(height) || height < 64) {
        setError("Custom size inválido. Usa width y height enteros de 64 o más.");
        return;
      }

      imageSize = { width, height };
    }

    const parsedSeed = form.seed.trim().length ? Number(form.seed) : undefined;
    if (form.seed.trim().length && !Number.isInteger(parsedSeed)) {
      setError("Seed inválido. Debe ser un número entero.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await generateImageBatch(form.additionalPrompt || " ", CAMERA_ANGLES_MODEL, {
        tool: "camera-angles",
        nameHint: "camera-angle",
        count: form.count,
        characterAssetIds: [referenceAsset.id],
        horizontalAngle: form.horizontalAngle,
        verticalAngle: form.verticalAngle,
        zoom: form.zoom,
        loraScale: form.loraScale,
        imageSize,
        guidanceScale: form.guidanceScale,
        numInferenceSteps: form.numInferenceSteps,
        acceleration: form.acceleration,
        negativePrompt: form.negativePrompt,
        seed: parsedSeed,
        enableSafetyChecker: form.enableSafetyChecker,
        outputFormat: form.outputFormat,
      });

      const newItems = res.items || [];
      setItems((prev) => [...newItems, ...prev]);
      if (newItems.length) {
        setSelectedAssetId(newItems[0].assetId);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate camera angle.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col xl:flex-row gap-8 animate-in fade-in zoom-in duration-500">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="w-full xl:w-[430px] space-y-6">
        <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Camera Angles</h2>
              <p className="text-xs text-white/45 mt-1 font-mono leading-relaxed">
                Interfaz alineada al modelo Qwen Multiple Angles: todos los controles principales salen del endpoint real.
              </p>
            </div>

            <button
              type="button"
              onClick={resetCameraDefaults}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] font-mono text-white/75"
            >
              Reset defaults
            </button>
          </div>

          <div className="space-y-3">
            <FileUploader
              label="Imagen de referencia"
              onAssetReady={(asset) => setReferenceAsset(asset)}
              accept="image/*"
              uploadTool="camera-angles"
              uploadCategory="reference"
            />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-[11px] text-white/55 font-mono leading-relaxed">
              <div>• Horizontal: 0° frente, 90° derecha, 180° atrás, 270° izquierda.</div>
              <div>• Vertical: -30° contrapicado, 0° eye-level, 60° high-angle, 90° bird&apos;s-eye.</div>
              <div>• Zoom: 0 wide, 5 medium, 10 close.</div>
              <div>• El zoom arranca siempre en 5, al centro de la barra.</div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ángulos de cámara</div>
                <div className="text-[11px] text-white/40 mt-1 font-mono">Mapeados directo a horizontal_angle, vertical_angle y zoom.</div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
                <span>Horizontal angle</span>
                <span className="text-white/85">{Math.round(form.horizontalAngle)}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={form.horizontalAngle}
                onChange={(e) => updateForm("horizontalAngle", Number(e.target.value))}
                className="w-full"
                disabled={loading}
              />
              <div className="mt-2 grid grid-cols-4 gap-2">
                <button type="button" onClick={() => applyHorizontalPreset(0)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">Frente</button>
                <button type="button" onClick={() => applyHorizontalPreset(90)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">Derecha</button>
                <button type="button" onClick={() => applyHorizontalPreset(180)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">Atrás</button>
                <button type="button" onClick={() => applyHorizontalPreset(270)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">Izquierda</button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
                <span>Vertical angle</span>
                <span className="text-white/85">{Math.round(form.verticalAngle)}°</span>
              </div>
              <input
                type="range"
                min={-30}
                max={90}
                step={1}
                value={form.verticalAngle}
                onChange={(e) => updateForm("verticalAngle", Number(e.target.value))}
                className="w-full"
                disabled={loading}
              />
              <div className="mt-2 grid grid-cols-4 gap-2">
                <button type="button" onClick={() => applyVerticalPreset(-30)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">-30°</button>
                <button type="button" onClick={() => applyVerticalPreset(0)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">0°</button>
                <button type="button" onClick={() => applyVerticalPreset(60)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">60°</button>
                <button type="button" onClick={() => applyVerticalPreset(90)} disabled={loading} className="p-2 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40">90°</button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
                <span>Zoom</span>
                <span className="text-white/85">{form.zoom.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={form.zoom}
                onChange={(e) => updateForm("zoom", Number(e.target.value))}
                className="w-full"
                disabled={loading}
              />
              <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-white/45">
                <span>0 wide</span>
                <span className="text-white/75">5 default</span>
                <span>10 close</span>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Prompts</div>
              <div className="text-[11px] text-white/40 mt-1 font-mono">additional_prompt y negative_prompt del endpoint.</div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Additional prompt</label>
              <textarea
                value={form.additionalPrompt}
                onChange={(e) => updateForm("additionalPrompt", e.target.value)}
                rows={4}
                placeholder="e.g. cinematic lighting, dramatic fog, luxury catalog shot"
                className="w-full bg-black/50 border border-white/20 rounded-2xl px-4 py-3 focus:outline-none focus:border-white text-sm resize-y"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Negative prompt</label>
              <textarea
                value={form.negativePrompt}
                onChange={(e) => updateForm("negativePrompt", e.target.value)}
                rows={3}
                placeholder="e.g. blur, extra limbs, deformed anatomy, duplicate subject"
                className="w-full bg-black/50 border border-white/20 rounded-2xl px-4 py-3 focus:outline-none focus:border-white text-sm resize-y"
              />
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Parámetros del modelo</div>
              <div className="text-[11px] text-white/40 mt-1 font-mono">Todos salen del schema del modelo, excepto sync_mode que tu app ya maneja con jobs y storage.</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Num images</label>
                <select
                  value={form.count}
                  onChange={(e) => updateForm("count", Number(e.target.value))}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white"
                  disabled={loading}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Acceleration</label>
                <select
                  value={form.acceleration}
                  onChange={(e) => updateForm("acceleration", e.target.value as "none" | "regular")}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white"
                  disabled={loading}
                >
                  <option value="regular">regular</option>
                  <option value="none">none</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
                <span>LoRA scale</span>
                <span className="text-white/85">{form.loraScale.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={4}
                step={0.1}
                value={form.loraScale}
                onChange={(e) => updateForm("loraScale", Number(e.target.value))}
                className="w-full"
                disabled={loading}
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
                <span>Guidance scale</span>
                <span className="text-white/85">{form.guidanceScale.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                step={0.1}
                value={form.guidanceScale}
                onChange={(e) => updateForm("guidanceScale", Number(e.target.value))}
                className="w-full"
                disabled={loading}
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
                <span>Num inference steps</span>
                <span className="text-white/85">{form.numInferenceSteps}</span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={form.numInferenceSteps}
                onChange={(e) => updateForm("numInferenceSteps", Number(e.target.value))}
                className="w-full"
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Output format</label>
                <select
                  value={form.outputFormat}
                  onChange={(e) => updateForm("outputFormat", e.target.value as "png" | "jpeg" | "webp")}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white"
                  disabled={loading}
                >
                  <option value="png">png</option>
                  <option value="jpeg">jpeg</option>
                  <option value="webp">webp</option>
                </select>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Safety checker</label>
                <button
                  type="button"
                  onClick={() => updateForm("enableSafetyChecker", !form.enableSafetyChecker)}
                  disabled={loading}
                  className={`w-full rounded-xl px-3 py-2 text-sm border transition-colors ${form.enableSafetyChecker ? "bg-white text-black border-white" : "bg-black/40 text-white border-white/20"}`}
                >
                  {form.enableSafetyChecker ? "Enabled" : "Disabled"}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tamaño y seed</div>
              <div className="text-[11px] text-white/40 mt-1 font-mono">image_size puede ser auto, preset del modelo o tamaño custom.</div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => updateForm("imageSizeMode", "auto")} disabled={loading} className={`p-3 rounded-xl text-[11px] font-mono border ${form.imageSizeMode === "auto" ? "border-white/60 bg-white/10" : "border-white/10 bg-white/5 hover:border-white/40"}`}>Auto</button>
              <button type="button" onClick={() => updateForm("imageSizeMode", "preset")} disabled={loading} className={`p-3 rounded-xl text-[11px] font-mono border ${form.imageSizeMode === "preset" ? "border-white/60 bg-white/10" : "border-white/10 bg-white/5 hover:border-white/40"}`}>Preset</button>
              <button type="button" onClick={() => updateForm("imageSizeMode", "custom")} disabled={loading} className={`p-3 rounded-xl text-[11px] font-mono border ${form.imageSizeMode === "custom" ? "border-white/60 bg-white/10" : "border-white/10 bg-white/5 hover:border-white/40"}`}>Custom</button>
            </div>

            {form.imageSizeMode === "preset" ? (
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Image size preset</label>
                <select
                  value={form.imageSizePreset}
                  onChange={(e) => updateForm("imageSizePreset", e.target.value as ImageSizePreset)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white"
                  disabled={loading}
                >
                  {sizePresetOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {form.imageSizeMode === "custom" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Width</label>
                  <input
                    type="number"
                    min={64}
                    step={1}
                    value={form.customWidth}
                    onChange={(e) => updateForm("customWidth", e.target.value)}
                    className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Height</label>
                  <input
                    type="number"
                    min={64}
                    step={1}
                    value={form.customHeight}
                    onChange={(e) => updateForm("customHeight", e.target.value)}
                    className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
                    disabled={loading}
                  />
                </div>
              </div>
            ) : null}

            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Seed (opcional)</label>
              <input
                type="number"
                step={1}
                min={0}
                value={form.seed}
                onChange={(e) => updateForm("seed", e.target.value)}
                placeholder="Vacío = random"
                className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
                disabled={loading}
              />
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
              !canGenerate ? "bg-gray-600 cursor-not-allowed" : "bg-white hover:scale-[1.02] shadow-[0_0_20px_white]"
            }`}
          >
            {loading ? "GENERATING ANGLE..." : "GENERATE ANGLE"}
          </button>

          <div className="text-center text-[12px] text-white/60">
            Coste estimado: <span className="font-semibold text-white/85">{estimatedCostCredits}</span> créditos
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex flex-col gap-4 p-6 relative overflow-hidden min-h-[520px]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Salida</div>
            <div className="text-[11px] text-white/35 mt-1 font-mono">Preview principal + historial descargable.</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] font-mono text-white/60">
            H {Math.round(form.horizontalAngle)}° · V {Math.round(form.verticalAngle)}° · Z {form.zoom.toFixed(1)}
          </div>
        </div>

        {items.length ? (
          <div className="space-y-5">
            {selectedItem ? (
              <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 min-h-[360px] flex items-center justify-center">
                <img src={selectedItem.url} alt="Selected angle" className="w-full h-full object-contain" />

                <a
                  href={selectedItem.url}
                  download={`camera-angle-${selectedItem.assetId}.${form.outputFormat}`}
                  className="absolute top-3 right-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black/70 border border-white/15 hover:border-white/40 text-xs font-mono text-white/80"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Descargar
                </a>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Historial ({items.length})</div>
              <div className="text-[11px] text-white/35 font-mono">Click en una miniatura para ver el resultado grande.</div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3">
              {items.map((it) => {
                const isSelected = selectedItem?.assetId === it.assetId;

                return (
                  <div
                    key={it.assetId}
                    className={`group relative rounded-2xl overflow-hidden border bg-black/40 cursor-pointer ${
                      isSelected ? "border-white/40" : "border-white/10 hover:border-white/30"
                    }`}
                    onClick={() => setSelectedAssetId(it.assetId)}
                    title={isSelected ? "Seleccionada" : "Ver en grande"}
                  >
                    <img src={it.url} alt="History item" className="w-full h-full object-cover aspect-square" />

                    <a
                      href={it.url}
                      download={`camera-angle-${it.assetId}.${form.outputFormat}`}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-9 h-9 rounded-xl bg-black/70 border border-white/15 hover:border-white/40 text-white/80"
                      title="Descargar imagen"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-center text-white/20 py-10">
            <div>
              <div className="font-mono text-sm">SUBE UNA IMAGEN Y CONFIGURA LOS PARÁMETROS DEL MODELO</div>
              <div className="text-xs mt-2 text-white/30">La salida aparecerá aquí.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraAnglesTool;