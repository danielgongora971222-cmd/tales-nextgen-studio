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

type VideoToolTone = {
  frame: string;
  glow: string;
  icon: string;
  badge: string;
  cta: string;
  chip: string;
};

const VIDEO_TOOL_THEMES: Record<string, VideoToolTone> = {
  'video-generator': {
    frame: 'border-[rgba(255,108,232,0.16)] hover:border-[rgba(255,108,232,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(255,93,226,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(161,107,255,0.16),transparent_34%)]',
    icon: 'border-[rgba(255,108,232,0.24)] bg-[rgba(43,11,46,0.78)] text-[#ff83f0] shadow-[0_0_26px_rgba(255,93,226,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(255,108,232,0.16)] bg-[rgba(81,19,74,0.46)] text-[#ffc0f8]',
    cta: 'border-[rgba(255,108,232,0.38)] bg-[linear-gradient(180deg,rgba(138,40,132,0.74),rgba(69,17,75,0.88))] text-[#ffd0fa] shadow-[0_0_28px_rgba(255,93,226,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'VIDEO TOOL',
  },
  'video-edit': {
    frame: 'border-[rgba(113,197,255,0.16)] hover:border-[rgba(113,197,255,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(113,197,255,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(76,120,255,0.16),transparent_34%)]',
    icon: 'border-[rgba(113,197,255,0.24)] bg-[rgba(13,27,49,0.78)] text-[#9dd4ff] shadow-[0_0_26px_rgba(113,197,255,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(113,197,255,0.16)] bg-[rgba(18,54,89,0.46)] text-[#cce8ff]',
    cta: 'border-[rgba(113,197,255,0.36)] bg-[linear-gradient(180deg,rgba(29,92,155,0.72),rgba(14,48,88,0.88))] text-[#e2f2ff] shadow-[0_0_28px_rgba(113,197,255,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'EDIT',
  },
  'ingredients-to-video': {
    frame: 'border-[rgba(255,168,94,0.16)] hover:border-[rgba(255,168,94,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(255,168,94,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(255,105,78,0.14),transparent_34%)]',
    icon: 'border-[rgba(255,168,94,0.24)] bg-[rgba(51,28,14,0.78)] text-[#ffc48a] shadow-[0_0_26px_rgba(255,168,94,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(255,168,94,0.16)] bg-[rgba(96,48,16,0.46)] text-[#ffe1c3]',
    cta: 'border-[rgba(255,168,94,0.36)] bg-[linear-gradient(180deg,rgba(154,82,33,0.72),rgba(78,40,14,0.88))] text-[#ffeddc] shadow-[0_0_28px_rgba(255,168,94,0.16),inset_0_1px_0_rgba(255,255,255,0.22)]',
    chip: 'MULTISHOT',
  },
  'extend-video': {
    frame: 'border-[rgba(102,255,197,0.16)] hover:border-[rgba(102,255,197,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(102,255,197,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(36,195,167,0.16),transparent_36%)]',
    icon: 'border-[rgba(102,255,197,0.24)] bg-[rgba(9,39,32,0.78)] text-[#88ffd7] shadow-[0_0_26px_rgba(102,255,197,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(102,255,197,0.16)] bg-[rgba(11,69,55,0.44)] text-[#cbffef]',
    cta: 'border-[rgba(102,255,197,0.36)] bg-[linear-gradient(180deg,rgba(19,108,88,0.72),rgba(10,55,46,0.88))] text-[#ddfff4] shadow-[0_0_28px_rgba(102,255,197,0.18),inset_0_1px_0_rgba(255,255,255,0.22)]',
    chip: 'EXTEND',
  },
  'motion-control': {
    frame: 'border-[rgba(170,124,255,0.16)] hover:border-[rgba(170,124,255,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(170,124,255,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(86,111,255,0.14),transparent_34%)]',
    icon: 'border-[rgba(170,124,255,0.24)] bg-[rgba(27,19,46,0.78)] text-[#d0b6ff] shadow-[0_0_26px_rgba(170,124,255,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(170,124,255,0.16)] bg-[rgba(57,37,107,0.46)] text-[#e6d9ff]',
    cta: 'border-[rgba(170,124,255,0.36)] bg-[linear-gradient(180deg,rgba(93,58,168,0.72),rgba(43,27,92,0.88))] text-[#f0eaff] shadow-[0_0_28px_rgba(170,124,255,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'MOTION',
  },
};

const fallbackVideoTheme = VIDEO_TOOL_THEMES['video-generator'];

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
        {VIDEO_TOOLS_REGISTRY.map((tool) => {
          const theme = VIDEO_TOOL_THEMES[tool.id] || fallbackVideoTheme;
          const ctaLabel = tool.status === 'coming_soon' ? 'Preview tool' : 'Access tool';

          return (
            <button
              key={tool.id}
              onClick={() => onNavigate(tool.route)}
              className={`group relative overflow-hidden rounded-[30px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))] p-4 text-left shadow-[0_22px_60px_rgba(0,0,0,0.32)] transition-all hover:-translate-y-1 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))] ${theme.frame} ${
                VIDEO_TOOLS_REGISTRY.length % 2 === 1 && VIDEO_TOOLS_REGISTRY[VIDEO_TOOLS_REGISTRY.length - 1]?.id === tool.id
                  ? 'col-span-2'
                  : ''
              }`}
            >
              <div className={`pointer-events-none absolute inset-0 ${theme.glow}`} />
              <div className="pointer-events-none absolute inset-[1px] rounded-[29px] bg-[linear-gradient(180deg,rgba(8,10,16,0.62),rgba(5,6,10,0.86))]" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

              <div className="relative z-10 flex h-full min-h-[220px] flex-col">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className={`inline-flex h-14 w-14 items-center justify-center rounded-[20px] border backdrop-blur-xl transition-transform group-hover:scale-105 ${theme.icon}`}>
                    {getIconForVideoTool(tool.id)}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      {tool.status === 'beta' ? (
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${theme.badge}`}>
                          Beta
                        </span>
                      ) : null}
                      {tool.status === 'coming_soon' ? (
                        <span className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/62">
                          Soon
                        </span>
                      ) : null}
                      {tool.status === 'ready' ? (
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${theme.badge}`}>
                          Ready
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/46">
                      {theme.chip}
                    </span>
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-base font-semibold tracking-tight text-white md:text-xl">{tool.label}</h3>
                  <p className="mt-2 text-xs leading-5 text-white/62 md:text-sm">{tool.description}</p>
                </div>

                <div className="mt-6">
                  <span className={`inline-flex min-h-[46px] items-center gap-2 rounded-full border px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.24em] backdrop-blur-xl transition group-hover:-translate-y-px ${theme.cta}`}>
                    <span>{ctaLabel}</span>
                    <span className="text-sm transition-transform group-hover:translate-x-0.5">↗</span>
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default VideoGenHub;
