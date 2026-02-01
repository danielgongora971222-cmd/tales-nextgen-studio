import React, { useState } from 'react';
import { generateImage } from '../services/geminiService';
import { GeminiModel } from '../types';

const ImageGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [model, setModel] = useState<string>(GeminiModel.IMAGE);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setGeneratedImage(null);
    try {
      const result = await generateImage(prompt, model);
      setGeneratedImage(result);
    } catch (error) {
      console.error(error);
      alert("Failed to generate image. Ensure API Key is valid.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-8">
      {/* Controls */}
      <div className="w-full lg:w-1/3 space-y-6">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
            Configure
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Model</label>
              <select 
                value={model} 
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all text-sm"
              >
                <option value={GeminiModel.IMAGE}>Nano Banana (Fast)</option>
                <option value={GeminiModel.IMAGE_PRO}>Nano Banana Pro (High Quality)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Prompt</label>
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A futuristic cyberpunk city in noir style, rain reflections..."
                className="w-full h-32 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all resize-none text-sm leading-relaxed"
              />
            </div>

            <button 
              onClick={handleGenerate}
              disabled={loading || !prompt}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                loading || !prompt 
                  ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                  : 'bg-white hover:shadow-[0_0_20px_white] hover:scale-[1.02]'
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                  Processing...
                </span>
              ) : 'GENERATE'}
            </button>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-3xl border border-white/10 opacity-60">
          <h3 className="text-sm font-bold mb-2">Tips</h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Use descriptive adjectives. Mention lighting (e.g., "volumetric lighting"), style (e.g., "noir", "photorealistic"), and perspective (e.g., "wide angle").
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex items-center justify-center relative overflow-hidden min-h-[400px]">
        {generatedImage ? (
          <img 
            src={generatedImage} 
            alt="Generated" 
            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg animate-in fade-in zoom-in duration-500"
          />
        ) : (
          <div className="text-center text-white/20">
            <svg className="w-24 h-24 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            <p className="font-mono text-sm">WAITING FOR INPUT_</p>
          </div>
        )}
        
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4 mx-auto"></div>
              <p className="text-sm font-mono tracking-widest animate-pulse">GENERATING PIXELS...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageGenerator;
