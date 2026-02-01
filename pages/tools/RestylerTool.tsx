import React, { useState, useEffect } from 'react';
import FileUploader from '../../components/FileUploader';
import { generateRestyle } from '../../services/geminiService';
import { backend } from '../../services/backendService';
import { Asset, StylePreset } from '../../types';
import ErrorModal from '../../components/ErrorModal';

const RestylerTool: React.FC = () => {
  const [baseAsset, setBaseAsset] = useState<Asset | null>(null);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.getStyles().then(setStyles);
  }, []);

  const handleGenerate = async () => {
    if (!baseAsset) return;
    
    const selectedStyle = styles.find(s => s.id === selectedStyleId);
    if (!selectedStyle) {
        setError("Please select a style first.");
        return;
    }

    setLoading(true);
    setError(null);

    try {
      const fullPrompt = `Restyle this image to look like: ${selectedStyle.prompt}. ${customPrompt}`;
      const result = await generateRestyle(baseAsset.url, fullPrompt);
      setResultImage(result);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Restyle rejected by AI.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-8 animate-in fade-in zoom-in duration-500">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="w-full lg:w-1/3 space-y-6 flex flex-col">
        <div className="glass-panel p-6 rounded-3xl border border-white/10 flex-1 flex flex-col">
          <div className="flex items-center gap-3 mb-6">
             <div className="p-2 bg-white/10 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
             </div>
             <h2 className="text-xl font-bold">Restyler Studio</h2>
          </div>

          <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar pr-2">
            <FileUploader 
                label="Base Image Asset" 
                onAssetReady={setBaseAsset} 
            />

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Select Style</label>
              <div className="grid grid-cols-2 gap-3">
                 {styles.map(style => (
                     <button
                        key={style.id}
                        onClick={() => setSelectedStyleId(style.id)}
                        className={`relative aspect-[3/2] rounded-xl overflow-hidden group border-2 transition-all ${
                            selectedStyleId === style.id ? 'border-white scale-105' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-105'
                        }`}
                     >
                        <img src={style.coverUrl} alt={style.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent flex items-end p-2">
                             <span className="text-[10px] font-bold text-white leading-tight">{style.name}</span>
                        </div>
                     </button>
                 ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Refine (Optional)</label>
              <textarea 
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Make it darker, add rain..."
                className="w-full h-20 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white resize-none text-sm"
              />
            </div>

            <button 
              onClick={handleGenerate}
              disabled={loading || !baseAsset || !selectedStyleId}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all mt-auto ${
                loading || !baseAsset || !selectedStyleId ? 'bg-gray-600' : 'bg-white hover:scale-[1.02] shadow-[0_0_20px_white]'
              }`}
            >
              {loading ? 'APPLYING STYLE...' : 'RESTYLE IMAGE'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex items-center justify-center relative overflow-hidden min-h-[400px]">
        {resultImage ? (
          <img src={resultImage} alt="Restyled" className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" />
        ) : (
          <div className="text-center text-white/20">
             {!baseAsset ? (
                 <p className="font-mono text-sm">UPLOAD AN ASSET</p>
             ) : (
                 <p className="font-mono text-sm">SELECT A STYLE & GENERATE</p>
             )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RestylerTool;