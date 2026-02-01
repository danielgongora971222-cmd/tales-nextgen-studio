import React, { useState } from 'react';
import { generateImage } from '../../services/geminiService';
import { GeminiModel } from '../../types';
import ErrorModal from '../../components/ErrorModal';

const EditorTool: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | ''>('');
  const [steps, setSteps] = useState(30);
  const [guidance, setGuidance] = useState(7.5);
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedImage(null);
    try {
      const fullPrompt = `${prompt} ${negativePrompt ? `[No: ${negativePrompt}]` : ''}`;
      const result = await generateImage(fullPrompt, GeminiModel.IMAGE_PRO); 
      setGeneratedImage(result);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Editor Pro generation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="w-full lg:w-1/3 space-y-6">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
          <div className="flex items-center gap-3 mb-6">
             <div className="p-2 bg-white/10 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
             </div>
             <h2 className="text-xl font-bold">Editor AI Pro</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Positive Prompt</label>
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Detailed description of the subject..."
                className="w-full h-24 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Negative Prompt</label>
              <textarea 
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="What to exclude (e.g. blur, deformity)..."
                className="w-full h-16 bg-black/50 border border-red-900/50 rounded-xl px-4 py-3 focus:outline-none focus:border-red-500 text-sm placeholder-red-900/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Steps ({steps})</label>
                  <input 
                    type="range" min="10" max="150" value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                    className="w-full accent-white"
                  />
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Guidance ({guidance})</label>
                  <input 
                    type="range" min="1" max="20" step="0.5" value={guidance} onChange={(e) => setGuidance(Number(e.target.value))}
                    className="w-full accent-white"
                  />
               </div>
            </div>

            <div>
               <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Seed (Optional)</label>
               <input 
                  type="number" 
                  value={seed} 
                  onChange={(e) => setSeed(Number(e.target.value))}
                  placeholder="Random"
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-sm focus:border-white focus:outline-none"
               />
            </div>

            <button 
              onClick={handleGenerate}
              disabled={loading || !prompt}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                loading ? 'bg-gray-600' : 'bg-white hover:scale-[1.02] shadow-[0_0_20px_white]'
              }`}
            >
              {loading ? 'PROCESSING...' : 'GENERATE PRO'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex items-center justify-center relative overflow-hidden min-h-[500px]">
        {generatedImage ? (
          <img src={generatedImage} alt="Pro Generated" className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" />
        ) : (
          <div className="text-center text-white/20">
            <p className="font-mono text-sm">PRO MODE READY_</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorTool;