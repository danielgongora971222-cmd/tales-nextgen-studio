import React, { useState } from 'react';
import FileUploader from '../../components/FileUploader';
import { generateUpscale } from '../../services/geminiService';
import { Asset } from '../../types';
import ErrorModal from '../../components/ErrorModal';

const UpscalerTool: React.FC = () => {
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [scaleFactor, setScaleFactor] = useState(2);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'result'>('result');
  const [error, setError] = useState<string | null>(null);

  const handleUpscale = async () => {
    if (!sourceAsset) return;
    setLoading(true);
    setError(null);
    setResultImage(null);
    try {
        const result = await generateUpscale(sourceAsset.url, scaleFactor);
        setResultImage(result);
    } catch (err: any) {
        console.error(err);
        setError(err.message || "Upscale failed. Please check the image format.");
    } finally {
        setLoading(false);
    }
  };

  const handleDownload = () => {
    if (resultImage) {
      const link = document.createElement('a');
      link.href = resultImage;
      link.download = `upscaled_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-8 animate-in fade-in zoom-in duration-500">
      <ErrorModal error={error} onClose={() => setError(null)} />

      {/* Controls Section */}
      <div className="w-full lg:w-1/3 space-y-6">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
           <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-white/10 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </div>
              <h2 className="text-xl font-bold">Image Upscaler</h2>
           </div>
           
           <div className="space-y-6">
              <FileUploader label="Original Image" onAssetReady={(asset) => { setSourceAsset(asset); setResultImage(null); }} />
              
              <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Enhancement Factor</label>
                  <div className="flex gap-4">
                      {[2, 4].map(scale => (
                          <button 
                              key={scale}
                              onClick={() => setScaleFactor(scale)}
                              className={`flex-1 py-3 rounded-xl border transition-all ${
                                  scaleFactor === scale 
                                  ? 'bg-white text-black border-white font-bold' 
                                  : 'bg-transparent border-white/20 text-white/60 hover:border-white'
                              }`}
                          >
                              {scale}x
                          </button>
                      ))}
                  </div>
              </div>

              <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                 <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Details</h4>
                 <div className="flex justify-between text-sm text-gray-300">
                    <span>Target Resolution:</span>
                    <span className="font-mono text-white">{scaleFactor === 2 ? 'High (2K)' : 'Ultra (4K)'}</span>
                 </div>
                 <div className="flex justify-between text-sm text-gray-300 mt-1">
                    <span>Est. Time:</span>
                    <span className="font-mono text-white">~5-8s</span>
                 </div>
              </div>

              <button 
                onClick={handleUpscale}
                disabled={loading || !sourceAsset}
                className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                  loading || !sourceAsset ? 'bg-gray-600 cursor-not-allowed' : 'bg-white hover:scale-105 shadow-[0_0_20px_white]'
                }`}
              >
                {loading ? 'ENHANCING...' : 'UPSCALE NOW'}
              </button>
           </div>
        </div>
      </div>

      {/* Preview Section */}
      <div className="flex-1 glass-panel rounded-3xl border border-white/10 relative overflow-hidden flex flex-col">
          <div className="absolute top-4 right-4 z-20 flex gap-2">
            {resultImage && (
              <>
                 <button 
                   onClick={() => setViewMode(viewMode === 'result' ? 'split' : 'result')}
                   className="px-4 py-2 bg-black/50 border border-white/20 text-white text-xs rounded-lg hover:bg-black/80 backdrop-blur-md"
                 >
                    {viewMode === 'result' ? 'Split View' : 'Full Result'}
                 </button>
                 <button 
                   onClick={handleDownload}
                   className="px-4 py-2 bg-white text-black text-xs font-bold rounded-lg hover:scale-105"
                 >
                    Download
                 </button>
              </>
            )}
          </div>

          <div className="flex-1 relative flex items-center justify-center bg-black/40">
            {!sourceAsset && (
                <div className="text-center text-white/20">
                    <p className="font-mono text-sm">UPLOAD AN IMAGE</p>
                </div>
            )}

            {sourceAsset && !resultImage && !loading && (
                 <img src={sourceAsset.url} alt="Original" className="max-w-full max-h-full object-contain opacity-50 grayscale hover:grayscale-0 transition-all duration-500" />
            )}

            {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10">
                    <div className="w-64 h-2 bg-white/20 rounded-full overflow-hidden mb-4">
                        <div className="h-full bg-white animate-[progress_2s_ease-in-out_infinite]"></div>
                    </div>
                    <p className="font-mono text-sm animate-pulse">ADDING PIXELS...</p>
                </div>
            )}

            {resultImage && viewMode === 'result' && (
                <img src={resultImage} alt="Upscaled" className="max-w-full max-h-full object-contain" />
            )}

            {resultImage && sourceAsset && viewMode === 'split' && (
                <div className="relative w-full h-full flex items-center justify-center">
                   <div className="relative max-w-full max-h-full aspect-video flex">
                      <div className="w-1/2 overflow-hidden border-r border-white/50 relative">
                          <img src={sourceAsset.url} className="absolute inset-0 w-[200%] max-w-none h-full object-cover object-left" alt="Original" />
                          <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 text-[10px] rounded text-white">ORIGINAL</div>
                      </div>
                      <div className="w-1/2 overflow-hidden relative">
                          <img src={resultImage} className="absolute inset-0 w-[200%] max-w-none h-full object-cover object-right transform -translate-x-1/2" alt="Upscaled" />
                          <div className="absolute top-2 right-2 bg-white/80 px-2 py-1 text-[10px] rounded text-black font-bold">ENHANCED</div>
                      </div>
                   </div>
                </div>
            )}
          </div>
      </div>
    </div>
  );
};

export default UpscalerTool;