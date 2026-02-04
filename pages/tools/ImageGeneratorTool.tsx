import React, { useEffect, useMemo, useState } from "react";
import { generateImageBatch } from "../../services/geminiService";
import { listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { Asset, GeminiModel } from "../../types";
import GenerationHistory from "../../components/GenerationHistory";
import ErrorModal from "../../components/ErrorModal";

type Quality = "" | "1K" | "2K" | "4K";
type RefSlot = "char1" | "char2" | "char3" | "style" | "background";

const TOOL_ID = "image-generator";
const REF_TOOL_ID = "image-generator-ref";

function makeTempAsset(item: { assetId: string; url: string }, prompt: string, ownerId: string): Asset {
  return {
    id: item.assetId,
    url: item.url,
    type: "image",
    name: "Generated",
    prompt,
    createdAt: Date.now(),
    ownerId,
    isPublic: false,
    likes: [],
    comments: [],
  };
}

const ImageGeneratorTool: React.FC = () => {
  const { user } = useAuth();

  // Prompt + config
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(GeminiModel.IMAGE);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [count, setCount] = useState<number>(1);
  const [quality, setQuality] = useState<Quality>("2K");

  // Errors
  const [error, setError] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Latest batch (variations)
  const [latestBatch, setLatestBatch] = useState<Array<{ assetId: string; url: string }>>([]);

  // Refs
  const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
    char1: null,
    char2: null,
    char3: null,
    style: null,
    background: null,
  });

  // Picker modal state
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const imageHistory = useMemo(() => history.filter((a) => a.type === "image" && a.url), [history]);

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return imageHistory;
    return imageHistory.filter((a) => (a.prompt || a.name || "").toLowerCase().includes(q));
  }, [imageHistory, pickerQuery]);

  // Load user's history on mount
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const images = await listMyAssets({ type: "image", limit: 80 });
        setHistory(images);
        setSelectedAsset(images.length > 0 ? images[0] : null);
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el historial.");
      }
    })();
  }, [user]);

  const setRefSlot = (slot: RefSlot, asset: Asset | null) => {
    setRefs((prev) => ({ ...prev, [slot]: asset }));
  };

  const handleUploadRef = async (slot: RefSlot, file: File) => {
    if (!user) return;
    setError(null);

    try {
      const asset = await uploadUserAsset(file, REF_TOOL_ID);
      setRefSlot(slot, asset);

      // UX rápido
      setHistory((prev) => [asset, ...prev]);
    } catch (err: any) {
      setError(err?.message || "No se pudo subir la referencia.");
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || !user) return;

    setLoading(true);
    setError(null);

    try {
      const characterAssetIds = [refs.char1, refs.char2, refs.char3].filter(Boolean).map((a) => (a as Asset).id);

      const res = await generateImageBatch(prompt, model, {
        aspectRatio,
        count,
        quality: quality || undefined,
        tool: TOOL_ID,
        nameHint: "generated",
        characterAssetIds,
        styleAssetId: refs.style?.id,
        backgroundAssetId: refs.background?.id,
      });

      setLatestBatch(res.items);

      // selecciona la primera instantáneo
      if (res.items[0]) {
        setSelectedAsset(makeTempAsset(res.items[0], prompt, user.id));
      }

      // re-fetch historial
      const images = await listMyAssets({ type: "image", limit: 80 });
      setHistory(images);

      const firstId = res.items[0]?.assetId;
      const found = firstId ? images.find((a) => a.id === firstId) : null;
      setSelectedAsset(found || (images.length > 0 ? images[0] : null));
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "El modelo rechazó la solicitud. Prueba con otro prompt.");
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!selectedAsset) return;

    try {
      const makePublic = !selectedAsset.isPublic;
      const result = makePublic ? await publishAsset(selectedAsset.id) : await unpublishAsset(selectedAsset.id);

      setSelectedAsset({ ...selectedAsset, isPublic: result.isPublic });
      setHistory((prev) => prev.map((a) => (a.id === selectedAsset.id ? { ...a, isPublic: result.isPublic } : a)));
    } catch (err: any) {
      setError(err?.message || "No se pudo cambiar la visibilidad.");
    }
  };

  const handleDownload = () => {
    if (!selectedAsset?.url) return;
    const a = document.createElement("a");
    a.href = selectedAsset.url;
    a.download = `${selectedAsset.name || "image"}.png`;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePickFromBatch = (item: { assetId: string; url: string }) => {
    const found = history.find((a) => a.id === item.assetId);
    if (found) {
      setSelectedAsset(found);
      return;
    }
    if (user) setSelectedAsset(makeTempAsset(item, prompt, user.id));
  };

  const RefCard = ({ slot, label, asset }: { slot: RefSlot; label: string; asset: Asset | null }) => {
    return (
      <div className="bg-black/30 border border-white/10 rounded-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
          {asset ? (
            <button onClick={() => setRefSlot(slot, null)} className="text-[10px] font-bold text-gray-300 hover:text-white" type="button">
              CLEAR
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setPickerSlot(slot)}
          className="w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:bg-white/5 transition relative"
        >
          {asset ? (
            <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-white/30">Click to pick from history</div>
          )}
        </button>

        <div className="mt-2 flex items-center gap-2">
          <label className="flex-1">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadRef(slot, f);
                e.currentTarget.value = "";
              }}
            />
            <span className="block text-center text-[10px] font-bold py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 cursor-pointer">
              UPLOAD
            </span>
          </label>

          <button
            type="button"
            onClick={() => setPickerSlot(slot)}
            className="flex-1 text-[10px] font-bold py-2 rounded-xl bg-white text-black hover:scale-[1.02] transition"
          >
            PICK
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 animate-in fade-in zoom-in duration-500 min-h-[650px]">
      <ErrorModal error={error} onClose={() => setError(null)} />

      {/* History Sidebar */}
      <div className="w-full lg:w-48 lg:flex-shrink-0 order-3 lg:order-1 h-32 lg:h-auto">
        <GenerationHistory assets={history} onSelect={setSelectedAsset} selectedId={selectedAsset?.id} title="History" />
      </div>

      {/* Controls */}
      <div className="w-full lg:w-1/3 space-y-6 order-2">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-white/10 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                <path d="M9 18h6" />
                <path d="M10 22h4" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Image Generator</h2>
          </div>

          {/* References */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">References</h3>
              <span className="text-[10px] text-white/30">optional</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <RefCard slot="char1" label="Character 1" asset={refs.char1} />
              <RefCard slot="char2" label="Character 2" asset={refs.char2} />
              <RefCard slot="char3" label="Character 3" asset={refs.char3} />
              <RefCard slot="style" label="Style" asset={refs.style} />
              <div className="col-span-2">
                <RefCard slot="background" label="Background" asset={refs.background} />
              </div>
            </div>
          </div>

          {/* Config */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none"
                >
                  <option value={GeminiModel.IMAGE}>Flash</option>
                  <option value={GeminiModel.IMAGE_PRO}>Pro</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none"
                >
                  <option value="1:1">1:1</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Count</label>
                <select
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value, 10))}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as Quality)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none"
                >
                  <option value="">Auto</option>
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to generate..."
                className="w-full h-32 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white resize-none text-sm"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                loading ? "bg-gray-600" : "bg-white hover:scale-[1.02] shadow-[0_0_20px_white]"
              }`}
            >
              {loading ? "GENERATING..." : "GENERATE"}
            </button>
          </div>
        </div>
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex flex-col relative overflow-hidden min-h-[400px] order-1 lg:order-3">
        {selectedAsset ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
              <img src={selectedAsset.url} alt="Generated" className="max-w-full max-h-[70%] object-contain shadow-2xl rounded-lg animate-in fade-in" />

              {latestBatch.length > 0 && (
                <div className="w-full max-w-4xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Variations</span>
                    <button type="button" onClick={() => setLatestBatch([])} className="text-[10px] font-bold text-gray-300 hover:text-white">
                      CLEAR
                    </button>
                  </div>

                  <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-2">
                    {latestBatch.map((it) => (
                      <button
                        key={it.assetId}
                        type="button"
                        onClick={() => handlePickFromBatch(it)}
                        className={`relative flex-shrink-0 w-28 h-28 rounded-xl overflow-hidden border-2 transition ${
                          selectedAsset.id === it.assetId ? "border-white" : "border-white/10 hover:border-white/40"
                        }`}
                      >
                        <img src={it.url} alt="variation" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 font-mono">{new Date(selectedAsset.createdAt).toLocaleString()}</p>
                {selectedAsset.isPublic && <span className="text-[10px] text-green-400 font-bold">PUBLISHED TO COMMUNITY</span>}
              </div>

              <div className="flex gap-3 items-center">
                <button onClick={handleDownload} className="text-xs font-bold text-white hover:text-gray-300">
                  Download
                </button>
                <button onClick={handleTogglePublic} className="text-xs font-bold text-white hover:text-gray-300">
                  {selectedAsset.isPublic ? "Privatizar" : "Publicar"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-white/20">
            <div>
              <p className="font-mono text-sm mb-2">NO IMAGE SELECTED</p>
              <p className="text-xs">Generate a new image or select from history.</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-sm font-mono tracking-widest animate-pulse">CREATING...</p>
          </div>
        )}
      </div>

      {/* Picker Modal */}
      {pickerSlot && (
        <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-3xl rounded-3xl border border-white/10 overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Pick reference</p>
                <p className="text-[10px] text-white/40">Slot: {pickerSlot}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPickerSlot(null);
                  setPickerQuery("");
                }}
                className="text-xs font-bold text-white/70 hover:text-white"
              >
                CLOSE
              </button>
            </div>

            <div className="p-4">
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by prompt/name..."
                className="w-full mb-4 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
              />

              {filteredPickerAssets.length === 0 ? (
                <div className="text-center text-white/30 py-10">No images in history. Generate or upload an image first.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
                  {filteredPickerAssets.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setRefSlot(pickerSlot, a);
                        setPickerSlot(null);
                        setPickerQuery("");
                      }}
                      className="group relative aspect-square rounded-2xl overflow-hidden border border-white/10 hover:border-white/40 transition"
                    >
                      <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <span className="text-[10px] text-white truncate w-full text-left">{a.prompt || a.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGeneratorTool;
