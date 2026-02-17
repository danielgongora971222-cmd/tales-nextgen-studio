import React from 'react';
import { AppRoute } from '../types';
import { TOOLS_REGISTRY, ToolDefinition } from '../config/tools';

interface ImageGenHubProps {
  onNavigate: (route: AppRoute) => void;
}

const getIconForTool = (id: string) => {
    switch(id) {
        case 'generator': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
        );
        case 'editor': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        );
        case 'restyler': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2.5 2.24 0 .46.62.82 1 .82a3 3 0 0 0 3-3 3 3 0 0 0 3-3c0-1.67-1.34-3.02-3-3.02z"/></svg>
        );
        case 'lightroom': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 3v2"/>
              <path d="M12 19v2"/>
              <path d="M3 12h2"/>
              <path d="M19 12h2"/>
              <path d="M5.6 5.6l1.4 1.4"/>
              <path d="M17 17l1.4 1.4"/>
              <path d="M18.4 5.6 17 7"/>
              <path d="M7 17l-1.4 1.4"/>
              <circle cx="12" cy="12" r="4"/>
            </svg>
        );
        case 'faceswap': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="7" r="4"/><path d="M12 11c0 2-2 3-5 3"/><path d="M12 11c0 2 2 3 5 3"/><path d="M5 21v-3.8c0-1.8 1.4-3.2 3.2-3.2h7.6c1.8 0 3.2 1.4 3.2 3.2V21"/></svg>
        );
        case 'upscaler': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        );
        case 'angles': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        );
        case 'collage': return (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        );
        default: return <div />;
    }
}

const ImageGenHub: React.FC<ImageGenHubProps> = ({ onNavigate }) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tighter">AI IMAGE STUDIO</h1>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Select a specialized tool to begin your creative journey. From text-to-image generation to advanced photo manipulation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {TOOLS_REGISTRY.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onNavigate(tool.route)}
            className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 text-left transition-all hover:border-white/40 hover:bg-white/10 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:-translate-y-1"
          >
            {/* Background Gradient Effect */}
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/5 blur-3xl transition-all group-hover:bg-white/10" />

            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-white shadow-inner ring-1 ring-white/20 transition-transform group-hover:scale-110">
                {getIconForTool(tool.id)}
              </div>

              <div className="flex-1">
                 <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xl font-bold tracking-tight">{tool.label}</h3>
                    {tool.status === 'beta' && (
                        <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-bold">BETA</span>
                    )}
                 </div>
                 <p className="text-sm text-gray-400 leading-relaxed">
                    {tool.description}
                 </p>
              </div>

              <div className="mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60 group-hover:text-white transition-colors">
                Launch Tool
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ImageGenHub;