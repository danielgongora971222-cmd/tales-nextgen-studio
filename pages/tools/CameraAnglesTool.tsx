import React, { useMemo, useState } from "react";
import ErrorModal from "../../components/ErrorModal";
import FileUploader from "../../components/FileUploader";
import CameraAngleSimulator3D, { CameraAngleValue } from "../../components/CameraAngleSimulator3D";
import { generateImageBatch } from "../../services/geminiService";
import { Asset } from "../../types";
import { estimateImageCostCredits } from "../../config/pricing.js";

const CAMERA_ANGLES_MODEL = "fal-ai/qwen-image-edit-2511-multiple-angles";

const CameraAnglesTool: React.FC = () => {
  const [referenceAsset, setReferenceAsset] = useState<Asset | null>(null);

  // This text is sent as `additional_prompt` to the model.
  const [additionalPrompt, setAdditionalPrompt] = useState("");

  const [count, setCount] = useState<number>(1);
  const [loraScale, setLoraScale] = useState<number>(1);

  const [cam, setCam] = useState<CameraAngleValue>({
    azimuth: 0,
    elevation: 0,
    zoom: 5,
  });

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<{ url: string; assetId: string }[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);


  const canGenerate = useMemo(() => {
    return !!referenceAsset && !loading;
  }, [referenceAsset, loading]);

  const estimatedCostCredits = useMemo(() => {
    return estimateImageCostCredits({ model: CAMERA_ANGLES_MODEL, quality: "1K", count });
  }, [count]);

  const selectedItem = useMemo(() => {
    if (!items.length) return null;
    return items.find((it) => it.assetId === selectedAssetId) || items[0];
  }, [items, selectedAssetId]);


  const handleGenerate = async () => {
    if (!referenceAsset) {
      setError("Primero sube una imagen de referencia.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await generateImageBatch(
        additionalPrompt || " ",
        CAMERA_ANGLES_MODEL,
        {
          tool: "camera-angles",
          nameHint: "camera-angle",
          count,
          characterAssetIds: [referenceAsset.id],

          horizontalAngle: cam.azimuth,
          verticalAngle: cam.elevation,
          zoom: cam.zoom,
          loraScale,
        }
      );

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
    <div className="h-full flex flex-col lg:flex-row gap-8 animate-in fade-in zoom-in duration-500">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="w-full lg:w-1/3 space-y-6">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-white/10 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold">Camera Angles (3D)</h2>
              <p className="text-xs text-white/40 mt-1 font-mono">
                Ajusta el ángulo con una simulación visual y genera la misma escena desde ese punto de vista.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="space-y-3">
              <FileUploader
                label="Imagen de referencia"
                onAssetReady={(asset) => setReferenceAsset(asset)}
                accept="image/*"
                uploadTool="camera-angles"
                uploadCategory="reference"
              />

              <div className="text-[11px] text-white/45 font-mono leading-relaxed">
                • Horizontal (azimuth): 0° frente, 90° derecha, 180° atrás, 270° izquierda<br />
                • Vertical (elevation): -30° contrapicado, 0° normal, 90° cenital<br />
                • Zoom: 0 wide, 10 close
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Prompt extra (opcional)
              </label>
              <input
                type="text"
                value={additionalPrompt}
                onChange={(e) => setAdditionalPrompt(e.target.value)}
                placeholder="e.g. cinematic lighting, rain, cyberpunk mood"
                className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
              />
              <div className="text-[11px] text-white/35 mt-2 font-mono">
                Este texto se agrega como <span className="text-white/60">additional_prompt</span> al modelo.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Cantidad
                </label>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
                <div className="text-[11px] text-white/35 mt-2 font-mono">Genera 1–4 variantes.</div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                  LoRA Strength
                </label>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.1}
                  value={loraScale}
                  onChange={(e) => setLoraScale(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex items-center justify-between text-[11px] font-mono text-white/50 mt-2">
                  <span>0</span>
                  <span className="text-white/80">{loraScale.toFixed(1)}</span>
                  <span>4</span>
                </div>
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

            <div className="mt-2 text-center text-[12px] text-white/60">
              Coste estimado: <span className="font-semibold text-white/85">{estimatedCostCredits}</span> créditos
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex flex-col gap-4 p-6 relative overflow-hidden min-h-[520px]">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1">
            <CameraAngleSimulator3D
              imageUrl={referenceAsset?.url || null}
              value={cam}
              onChange={setCam}
              disabled={!referenceAsset || loading}
            />
          </div>

          <div className="w-full lg:w-[260px] space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Controles finos</div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-1">
                    <span>Azimuth (0–360)</span>
                    <span className="text-white/85">{Math.round(cam.azimuth)}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={cam.azimuth}
                    onChange={(e) => setCam({ ...cam, azimuth: Number(e.target.value) })}
                    className="w-full"
                    disabled={!referenceAsset || loading}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-1">
                    <span>Elevation (-30–90)</span>
                    <span className="text-white/85">{Math.round(cam.elevation)}°</span>
                  </div>
                  <input
                    type="range"
                    min={-30}
                    max={90}
                    step={1}
                    value={cam.elevation}
                    onChange={(e) => setCam({ ...cam, elevation: Number(e.target.value) })}
                    className="w-full"
                    disabled={!referenceAsset || loading}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-1">
                    <span>Zoom (0–10)</span>
                    <span className="text-white/85">{cam.zoom.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={cam.zoom}
                    onChange={(e) => setCam({ ...cam, zoom: Number(e.target.value) })}
                    className="w-full"
                    disabled={!referenceAsset || loading}
                  />
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Snaps rápidos</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="p-3 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40"
                  onClick={() => setCam({ ...cam, azimuth: 0 })}
                  disabled={!referenceAsset || loading}
                >
                  Frente
                </button>
                <button
                  className="p-3 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40"
                  onClick={() => setCam({ ...cam, azimuth: 90 })}
                  disabled={!referenceAsset || loading}
                >
                  Derecha
                </button>
                <button
                  className="p-3 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40"
                  onClick={() => setCam({ ...cam, azimuth: 180 })}
                  disabled={!referenceAsset || loading}
                >
                  Atrás
                </button>
                <button
                  className="p-3 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40"
                  onClick={() => setCam({ ...cam, azimuth: 270 })}
                  disabled={!referenceAsset || loading}
                >
                  Izquierda
                </button>
                <button
                  className="p-3 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40"
                  onClick={() => setCam({ ...cam, elevation: -30 })}
                  disabled={!referenceAsset || loading}
                >
                  Contra
                </button>
                <button
                  className="p-3 rounded-xl text-[11px] font-mono border border-white/10 bg-white/5 hover:border-white/40"
                  onClick={() => setCam({ ...cam, elevation: 60 })}
                  disabled={!referenceAsset || loading}
                >
                  Picado
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          {items.length ? (
            <div className="space-y-5">
              {/* Preview grande */}
              {selectedItem ? (
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40">
                  <img src={selectedItem.url} alt="Selected angle" className="w-full h-full object-contain" />

                  {/* Descargar (preview grande) */}
                  <a
                    href={selectedItem.url}
                    download={`camera-angle-${selectedItem.assetId}.png`}
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

              {/* Historial */}
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Historial ({items.length})
                </div>

                <div className="text-[11px] text-white/35 font-mono">
                  Click en una miniatura para previsualizar
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
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
                      <img src={it.url} alt="History item" className="w-full h-full object-cover" />

                      {/* Descargar (hover miniatura) */}
                      <a
                        href={it.url}
                        download={`camera-angle-${it.assetId}.png`}
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
            <div className="text-center text-white/20 py-10">
              <div className="font-mono text-sm">SUBE UNA IMAGEN Y ELIGE EL ÁNGULO</div>
              <div className="text-xs mt-2 text-white/30">La salida aparecerá aquí.</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default CameraAnglesTool;
