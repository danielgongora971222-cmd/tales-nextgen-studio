import React, { useState } from 'react';
import { generateVideo } from '../services/geminiService';
import ErrorModal from '../components/ErrorModal';

const VideoGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setLoading(true);
    setError(null);
    setVideoUrl(null);

    try {
      const url = await generateVideo(prompt);
      setVideoUrl(url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Video generation failed. Check permissions and limits.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto relative">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold mb-4 tracking-tighter">VEO VIDEO STUDIO</h1>
        <p className="text-gray-400">Generate high-definition video clips from text descriptions using Google's Veo model.</p>
      </div>

      <div className="glass-panel p-8 rounded-3xl border border-white/10 mb-8">
        <div className="flex gap-4">
          <input 
            type="text" 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A neon hologram of a cat driving at top speed..."
            className="flex-1 bg-black/50 border border-white/20 rounded-xl px-6 py-4 focus:outline-none focus:border-white transition-all text-lg"
          />
          <button 
            onClick={handleGenerate}
            disabled={loading || !prompt}
            className={`px-8 py-4 rounded-xl font-bold text-black whitespace-nowrap transition-all ${
              loading 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-white hover:shadow-[0_0_20px_white] hover:scale-105'
            }`}
          >
            {loading ? 'RENDERING...' : 'CREATE VIDEO'}
          </button>
        </div>
      </div>

      <div className="glass-panel aspect-video rounded-3xl border border-white/10 flex items-center justify-center relative overflow-hidden bg-black/40">
        {videoUrl ? (
          <video 
            src={videoUrl} 
            controls 
            autoPlay 
            loop 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center text-white/20">
            {loading ? (
              <div className="space-y-4">
                <div className="w-12 h-12 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="font-mono text-sm">AI IS DREAMING (THIS TAKES A MINUTE)...</p>
              </div>
            ) : (
              <div>
                <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                </svg>
                <p className="font-mono text-sm">NO VIDEO GENERATED</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoGenerator;