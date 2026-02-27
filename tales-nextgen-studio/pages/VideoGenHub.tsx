import React from 'react';
import { AppRoute } from '../types';
import { VIDEO_TOOLS_REGISTRY } from '../config/videoTools';

interface VideoGenHubProps {
  onNavigate: (route: AppRoute) => void;
}

const getIconForVideoTool = (id: string) => {
  switch (id) {
    case 'video-generator':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9l5 3-5 3V9z" />
        </svg>
      );
    case 'video-edit':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
        case 'ingredients-to-video':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
          <path d="M9 7v10" />
        </svg>
      );
    case 'extend-video':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6h10" />
          <path d="M4 12h16" />
          <path d="M4 18h10" />
          <path d="M14 6l6 6-6 6" />
        </svg>
      );
    case 'motion-control':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 20V4" />
          <path d="M4 16h6" />
          <path d="M4 12h10" />
          <path d="M4 8h14" />
          <path d="M20 4v16" />
          <path d="M14 12l3-3 3 3" />
        </svg>
      );
    default:
      return <div />;
  }
};

const VideoGenHub: React.FC<VideoGenHubProps> = ({ onNavigate }) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tighter">AI VIDEO STUDIO</h1>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Choose a video tool to start generating or editing. General generation, motion-directed control, and future editing workflows.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {VIDEO_TOOLS_REGISTRY.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onNavigate(tool.route)}
            className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 text-left transition-all hover:border-white/40 hover:bg-white/10 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:-translate-y-1"
          >
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/5 blur-3xl transition-all group-hover:bg-white/10" />

            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-white shadow-inner ring-1 ring-white/20 transition-transform group-hover:scale-110">
                {getIconForVideoTool(tool.id)}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xl font-bold tracking-tight">{tool.label}</h3>
                  {tool.status === 'beta' && (
                    <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-bold">BETA</span>
                  )}
                  {tool.status === 'coming_soon' && (
                    <span className="text-[9px] bg-white/10 px-2 py-0.5 rounded-full font-bold text-white/70">
                      COMING SOON
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{tool.description}</p>
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

export default VideoGenHub;
