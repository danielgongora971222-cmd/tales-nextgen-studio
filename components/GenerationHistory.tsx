import React from 'react';
import { Asset } from '../types';

interface GenerationHistoryProps {
  assets: Asset[];
  onSelect: (asset: Asset) => void;
  selectedId?: string;
  title?: string;
}

const GenerationHistory: React.FC<GenerationHistoryProps> = ({ assets, onSelect, selectedId, title = "Session History" }) => {
  if (assets.length === 0) return null;

  return (
    <div className="glass-panel rounded-3xl border border-white/10 p-4 h-full flex flex-col">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 px-2">{title}</h3>
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className={`w-full group relative aspect-square rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02] ${
              selectedId === asset.id ? 'border-white ring-2 ring-white/20' : 'border-transparent opacity-70 hover:opacity-100'
            }`}
          >
            <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                <span className="text-[10px] text-white truncate w-full text-left">{asset.prompt || asset.name}</span>
            </div>
            {asset.isPublic && (
                <div className="absolute top-2 right-2 bg-white/20 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] font-bold text-white">
                    PUBLIC
                </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default GenerationHistory;