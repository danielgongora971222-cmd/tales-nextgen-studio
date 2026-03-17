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
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-700">
      <div className="mb-10 space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tighter md:text-5xl">AI VIDEO STUDIO</h1>
        <p className="mx-auto max-w-2xl text-gray-400">
          Choose a video tool to start generating or editing. General generation, motion-directed control, and future editing workflows.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:gap-5">
        {VIDEO_TOOLS_REGISTRY.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onNavigate(tool.route)}
            className={`group relative overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))] p-4 text-left shadow-[0_22px_60px_rgba(0,0,0,0.32)] transition-all hover:-translate-y-1 hover:border-white/30 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))] ${
              VIDEO_TOOLS_REGISTRY.length % 2 === 1 && VIDEO_TOOLS_REGISTRY[VIDEO_TOOLS_REGISTRY.length - 1]?.id === tool.id
                ? "col-span-2"
                : ""
            }`}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(113,197,255,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(165,129,255,0.14),transparent_34%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

            <div className="relative z-10 flex h-full min-h-[220px] flex-col">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-[20px] border border-white/12 bg-black/30 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-transform group-hover:scale-105">
                  {getIconForVideoTool(tool.id)}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {tool.status === 'beta' ? (
                    <span className="rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">
                      Beta
                    </span>
                  ) : null}
                  {tool.status === 'coming_soon' ? (
                    <span className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/62">
                      Soon
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex-1">
                <h3 className="text-base font-semibold tracking-tight text-white md:text-xl">{tool.label}</h3>
                <p className="mt-2 text-xs leading-5 text-white/62 md:text-sm">{tool.description}</p>
              </div>

              <div className="mt-6 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em] text-white/58">
                <span>{tool.status === 'coming_soon' ? 'Preview' : 'Launch tool'}</span>
                <span className="transition-transform group-hover:translate-x-1 group-hover:text-white">↗</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default VideoGenHub;
