import React, { useState } from 'react';
import FileUploader from '../../components/FileUploader';
import { generateFaceSwap } from '../../services/geminiService';
import { Asset } from '../../types';
import ErrorModal from '../../components/ErrorModal';

const FaceSwapTool: React.FC = () => {
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [targetAsset, setTargetAsset] = useState<Asset | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwap = async () => {
    if (!sourceAsset || !targetAsset) return;
    setLoading(true);
    setError(null);
    setResultImage(null);
    try {
      const result = await generateFaceSwap(sourceAsset.url, targetAsset.url);
      setResultImage(result);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Face Swap rejected. Ensure images are clear and suitable.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (resultImage) {
      const link = document.createElement('a');
      link.href = resultImage;
      link.download = `faceswap_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="h-full flex flex-col gap-8 animate-in fade-in zoom-in duration-500">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="flex flex-col lg:flex-row gap-8 h-full">
        {/* Input Panel */}
        <div className="w-full lg:w-1/3 space-y-6">
          <div className="glass-panel p-6 rounded-3xl border border-white/10">
             <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-white/10 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4"/><path d="M12 11c0 2-2 3-5 3"/><path d="M12 11c0 2 2 3 5 3"/><path d="M5 21v-3.8c0-1.8 1.4-3.2 3.2-3.2h7.6c1.8 0 3.2 1.4 3.2 3.2V21"/></svg>
                </div>
                <h2 className="text-xl font-bold">Face Swap Studio</h2>
             </div>
             
             <div className="space-y-6">
                <FileUploader label="Source Face (Identity)" onAssetReady={setSourceAsset} />
                <FileUploader label="Target Scene (To Replace)" onAssetReady={setTargetAsset} />

                <button 
                  onClick={handleSwap}
                  disabled={loading || !sourceAsset || !targetAsset}
                  className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                    loading || !sourceAsset || !targetAsset 
                      ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                      : 'bg-white hover:scale-[1.02] shadow-[0_0_20px_white]'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                       <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                       SWAPPING...
                    </span>
                  ) : 'SWAP FACES'}
                </button>
             </div>
          </div>

          <div className="glass-panel p-6 rounded-3xl border border-white/10 opacity-60">
             <h3 className="text-sm font-bold mb-2">Instructions</h3>
             <ul className="text-xs text-gray-400 space-y-2 list-disc pl-4">
                <li>Upload a clear photo of the face you want to use (Source).</li>
                <li>Upload the photo you want to modify (Target).</li>
                <li>The AI will blend the source identity into the target environment.</li>
             </ul>
          </div>
        </div>

        {/* Result Panel */}
        <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex flex-col relative overflow-hidden min-h-[500px]">
           {resultImage && (
             <div className="absolute top-4 right-4 z-20">
               <button 
                 onClick={handleDownload}
                 className="px-6 py-2 bg-white text-black font-bold rounded-full hover:scale-105 shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-transform"
               >
                 Download Result
               </button>
             </div>
           )}

           <div className="flex-1 flex items-center justify-center relative p-8">
              {loading && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
                    <div className="w-20 h-20 border-4 border-white border-t-transparent rounded-full animate-spin mb-6"></div>
                    <p className="font-mono text-sm tracking-widest animate-pulse">PROCESSING IDENTITY...</p>
                </div>
              )}

              {resultImage ? (
                <img 
                  src={resultImage} 
                  alt="Face Swap Result" 
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in fade-in zoom-in duration-700" 
                />
              ) : (
                <div className="text-center text-white/20">
                   {!loading && (
                     <>
                        <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <p className="font-mono text-sm">READY TO PROCESS</p>
                     </>
                   )}
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default FaceSwapTool;