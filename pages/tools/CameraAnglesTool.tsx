import React, { useState } from 'react';
import { generateImage } from '../../services/geminiService';
import { GeminiModel } from '../../types';
import ErrorModal from '../../components/ErrorModal';

const angles = [
    { id: 'wide', label: 'Wide Shot', prompt: 'wide angle shot, establishing shot, cinematic panorama' },
    { id: 'closeup', label: 'Close Up', prompt: 'extreme close up, macro photography, detailed focus' },
    { id: 'low', label: 'Low Angle', prompt: 'low angle shot, looking up, imposing perspective, hero shot' },
    { id: 'high', label: 'High Angle', prompt: 'high angle shot, bird\'s eye view, looking down, drone shot' },
    { id: 'dutch', label: 'Dutch Angle', prompt: 'dutch angle, tilted camera, dynamic tension, uneasiness' },
    { id: 'fisheye', label: 'Fisheye', prompt: 'fisheye lens, distorted perspective, 8mm camera' },
];

const CameraAnglesTool: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [selectedAngle, setSelectedAngle] = useState(angles[0].id);
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedImage(null);
    try {
      const angleConfig = angles.find(a => a.id === selectedAngle);
      const fullPrompt = `Cinematic photography: ${prompt}. Camera technique: ${angleConfig?.prompt}. 8k resolution, highly detailed.`;
      const result = await generateImage(fullPrompt, GeminiModel.IMAGE);
      setGeneratedImage(result);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate shot.");
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
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
             </div>
             <h2 className="text-xl font-bold">Camera Angles</h2>
          </div>
          
          <div className="space-y-4">
             <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Subject</label>
                <input 
                   type="text"
                   value={prompt}
                   onChange={(e) => setPrompt(e.target.value)}
                   placeholder="e.g. A cyberpunk samurai in the rain"
                   className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
                />
             </div>

             <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Camera Perspective</label>
                <div className="grid grid-cols-2 gap-2">
                    {angles.map(angle => (
                        <button
                            key={angle.id}
                            onClick={() => setSelectedAngle(angle.id)}
                            className={`p-3 rounded-lg text-xs font-medium border transition-all ${
                                selectedAngle === angle.id 
                                ? 'bg-white text-black border-white' 
                                : 'bg-white/5 border-white/10 hover:border-white/40'
                            }`}
                        >
                            {angle.label}
                        </button>
                    ))}
                </div>
             </div>

            <button 
              onClick={handleGenerate}
              disabled={loading || !prompt}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                loading ? 'bg-gray-600' : 'bg-white hover:scale-[1.02] shadow-[0_0_20px_white]'
              }`}
            >
              {loading ? 'SHOOTING SCENE...' : 'GENERATE SHOT'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex items-center justify-center relative overflow-hidden min-h-[400px]">
        {generatedImage ? (
          <img src={generatedImage} alt="Angle Shot" className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" />
        ) : (
          <div className="text-center text-white/20">
             <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
            <p className="font-mono text-sm">SELECT ANGLE & SUBJECT</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraAnglesTool;