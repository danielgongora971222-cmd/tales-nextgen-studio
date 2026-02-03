import React, { useState, useEffect } from 'react';
import { generateImage } from '../../services/geminiService';
import { listMyAssets } from "../../services/assetsApi";
import { useAuth } from '../../contexts/AuthContext';
import { Asset, GeminiModel } from '../../types';
import GenerationHistory from '../../components/GenerationHistory';
import ErrorModal from '../../components/ErrorModal';

const ImageGeneratorTool: React.FC = () => {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(GeminiModel.IMAGE);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [error, setError] = useState<string | null>(null);
  
  // History State
  const [history, setHistory] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Load user's history for this tool (or generic images) on mount
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const images = await listMyAssets({ type: "image", limit: 50 });
        setHistory(images);
        setSelectedAsset(images.length > 0 ? images[0] : null);
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el historial.");
      }
    })();
  }, [user]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !user) return;
    
    setLoading(true);
    setError(null); // Reset error state

    try {
      await generateImage(prompt, model, { aspectRatio });

      // volver a pedir el historial desde DB (ya debe incluir la nueva imagen)
      const images = await listMyAssets({ type: "image", limit: 50 });
      setHistory(images);
      setSelectedAsset(images.length > 0 ? images[0] : null);
      
    } catch (err: any) {
      console.error(err);
      // Capture specific API error message
      const errorMessage = err.message || "The AI model rejected the request. Please try a different prompt.";
      setError(errorMessage);
    } finally {
      // Always release the button
      setLoading(false);
    }
  };

  const handlePublish = async () => {
      if (selectedAsset && !selectedAsset.isPublic) {
          await backend.social.publishAsset(selectedAsset.id);
          setSelectedAsset({ ...selectedAsset, isPublic: true });
          setHistory(prev => prev.map(a => a.id === selectedAsset.id ? { ...a, isPublic: true } : a));
      }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 animate-in fade-in zoom-in duration-500 min-h-[600px]">
      <ErrorModal error={error} onClose={() => setError(null)} />
      
      {/* 1. History Sidebar */}
      <div className="w-full lg:w-48 lg:flex-shrink-0 order-3 lg:order-1 h-32 lg:h-auto">
         <GenerationHistory 
            assets={history} 
            onSelect={setSelectedAsset} 
            selectedId={selectedAsset?.id}
         />
      </div>

      {/* 2. Controls */}
      <div className="w-full lg:w-1/4 space-y-6 order-2">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
          <div className="flex items-center gap-3 mb-6">
             <div className="p-2 bg-white/10 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
             </div>
             <h2 className="text-xl font-bold">Generator</h2>
          </div>
          
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

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Prompt</label>
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A futuristic cyberpunk city in noir style..."
                className="w-full h-32 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white resize-none text-sm"
              />
            </div>

            <button 
              onClick={handleGenerate}
              disabled={loading || !prompt}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                loading ? 'bg-gray-600' : 'bg-white hover:scale-[1.02] shadow-[0_0_20px_white]'
              }`}
            >
              {loading ? 'GENERATING...' : 'GENERATE'}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Preview Area */}
      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex flex-col relative overflow-hidden min-h-[400px] order-1 lg:order-3">
        {selectedAsset ? (
          <>
            <div className="flex-1 flex items-center justify-center p-4">
                 <img src={selectedAsset.url} alt="Generated" className="max-w-full max-h-full object-contain shadow-2xl rounded-lg animate-in fade-in" />
            </div>
            
            <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between">
                <div>
                    <p className="text-xs text-gray-400 font-mono">{new Date(selectedAsset.createdAt).toLocaleTimeString()}</p>
                    {selectedAsset.isPublic && <span className="text-[10px] text-green-400 font-bold">PUBLISHED TO COMMUNITY</span>}
                </div>
                <div className="flex gap-3">
                    <button className="text-xs font-bold text-white hover:text-gray-300">Download</button>
                    {!selectedAsset.isPublic && (
                        <button 
                            onClick={handlePublish}
                            className="text-xs bg-white text-black px-4 py-2 rounded-full font-bold hover:scale-105 transition-transform"
                        >
                            Publish
                        </button>
                    )}
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
    </div>
  );
};

export default ImageGeneratorTool;