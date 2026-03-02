import React, { useState } from 'react';
import FileUploader from '../../components/FileUploader';
import { Asset } from '../../types';

const CollageTool: React.FC = () => {
  const [assets, setAssets] = useState<(Asset|null)[]>([null, null, null, null]);

  const handleAssetUpdate = (index: number, asset: Asset) => {
      const newAssets = [...assets];
      newAssets[index] = asset;
      setAssets(newAssets);
  };

  const handleCreateCollage = () => {
      alert("Thumbnail export logic would run here. Backend required to merge buffers.");
  };

  return (
    <div className="h-full flex flex-col gap-8 animate-in fade-in zoom-in duration-500">
      <div className="glass-panel p-6 rounded-3xl border border-white/10 max-w-5xl mx-auto w-full">
         <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                YouTube Thumbnail Maker
            </h2>
            <button 
                onClick={handleCreateCollage}
                className="bg-white text-black px-6 py-2 rounded-lg font-bold hover:scale-105 transition-transform"
            >
                Export Thumbnail
            </button>
         </div>

         <div className="grid grid-cols-2 gap-4 aspect-square max-h-[600px] mx-auto bg-black border border-white/20 p-4 rounded-xl">
             {assets.map((asset, i) => (
                 <div key={i} className="relative w-full h-full bg-white/5 rounded-lg overflow-hidden border border-dashed border-white/10 hover:border-white/40 transition-colors">
                     {asset ? (
                         <div className="relative w-full h-full group">
                            <img src={asset.url} alt={`Slot ${i}`} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <button onClick={() => {
                                    const n = [...assets];
                                    n[i] = null;
                                    setAssets(n);
                                }} className="text-white text-xs hover:underline">Remove</button>
                            </div>
                         </div>
                     ) : (
                         <div className="absolute inset-0 p-4">
                             <FileUploader label={`Slot ${i+1}`} onAssetReady={(a) => handleAssetUpdate(i, a)} />
                         </div>
                     )}
                 </div>
             ))}
         </div>
      </div>
    </div>
  );
};

export default CollageTool;