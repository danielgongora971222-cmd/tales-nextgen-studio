import React from 'react';
import { AppRoute } from '../types';
import { TOOLS_REGISTRY } from '../config/tools';

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

type ImageToolTone = {
  frame: string;
  glow: string;
  icon: string;
  badge: string;
  cta: string;
  chip: string;
};

const IMAGE_TOOL_THEMES: Record<string, ImageToolTone> = {
  generator: {
    frame: 'border-[rgba(111,244,255,0.16)] hover:border-[rgba(111,244,255,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(96,245,255,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(56,112,255,0.16),transparent_34%)]',
    icon: 'border-[rgba(111,244,255,0.24)] bg-[rgba(7,28,40,0.78)] text-[#8af7ff] shadow-[0_0_26px_rgba(91,241,255,0.14),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(111,244,255,0.16)] bg-[rgba(10,53,74,0.44)] text-[#b5fdff]',
    cta: 'border-[rgba(111,244,255,0.4)] bg-[linear-gradient(180deg,rgba(17,98,122,0.7),rgba(7,47,62,0.88))] text-[#c7feff] shadow-[0_0_28px_rgba(91,241,255,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'IMAGE TOOL',
  },
  editor: {
    frame: 'border-[rgba(167,126,255,0.16)] hover:border-[rgba(167,126,255,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(167,126,255,0.22),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(95,81,255,0.16),transparent_36%)]',
    icon: 'border-[rgba(167,126,255,0.24)] bg-[rgba(27,19,46,0.78)] text-[#c8b0ff] shadow-[0_0_26px_rgba(167,126,255,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(167,126,255,0.16)] bg-[rgba(57,37,107,0.46)] text-[#e1d4ff]',
    cta: 'border-[rgba(167,126,255,0.38)] bg-[linear-gradient(180deg,rgba(84,54,160,0.72),rgba(39,26,89,0.88))] text-[#eee8ff] shadow-[0_0_28px_rgba(167,126,255,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'PRO EDIT',
  },
  restyler: {
    frame: 'border-[rgba(255,108,232,0.16)] hover:border-[rgba(255,108,232,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(255,93,226,0.22),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(161,107,255,0.16),transparent_36%)]',
    icon: 'border-[rgba(255,108,232,0.24)] bg-[rgba(43,11,46,0.78)] text-[#ff83f0] shadow-[0_0_26px_rgba(255,93,226,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(255,108,232,0.16)] bg-[rgba(81,19,74,0.46)] text-[#ffc0f8]',
    cta: 'border-[rgba(255,108,232,0.38)] bg-[linear-gradient(180deg,rgba(138,40,132,0.74),rgba(69,17,75,0.88))] text-[#ffd0fa] shadow-[0_0_28px_rgba(255,93,226,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'RESTYLE',
  },
  lightroom: {
    frame: 'border-[rgba(245,205,92,0.16)] hover:border-[rgba(245,205,92,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(245,205,92,0.22),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(255,245,186,0.14),transparent_38%)]',
    icon: 'border-[rgba(245,205,92,0.24)] bg-[rgba(44,30,8,0.78)] text-[#f7d96d] shadow-[0_0_26px_rgba(245,205,92,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(245,205,92,0.16)] bg-[rgba(84,61,18,0.46)] text-[#ffefb2]',
    cta: 'border-[rgba(245,205,92,0.34)] bg-[linear-gradient(180deg,rgba(116,86,28,0.72),rgba(62,46,15,0.88))] text-[#fff4c6] shadow-[0_0_28px_rgba(245,205,92,0.16),inset_0_1px_0_rgba(255,255,255,0.22)]',
    chip: 'RELIGHT',
  },
  faceswap: {
    frame: 'border-[rgba(255,141,141,0.16)] hover:border-[rgba(255,141,141,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(255,141,141,0.18),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(255,96,96,0.14),transparent_36%)]',
    icon: 'border-[rgba(255,141,141,0.24)] bg-[rgba(49,19,19,0.78)] text-[#ffb5b5] shadow-[0_0_26px_rgba(255,141,141,0.14),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(255,141,141,0.16)] bg-[rgba(86,26,26,0.44)] text-[#ffd3d3]',
    cta: 'border-[rgba(255,141,141,0.34)] bg-[linear-gradient(180deg,rgba(135,49,49,0.72),rgba(72,24,24,0.88))] text-[#ffe2e2] shadow-[0_0_28px_rgba(255,141,141,0.16),inset_0_1px_0_rgba(255,255,255,0.22)]',
    chip: 'IDENTITY',
  },
  upscaler: {
    frame: 'border-[rgba(102,255,197,0.16)] hover:border-[rgba(102,255,197,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(102,255,197,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(36,195,167,0.16),transparent_36%)]',
    icon: 'border-[rgba(102,255,197,0.24)] bg-[rgba(9,39,32,0.78)] text-[#88ffd7] shadow-[0_0_26px_rgba(102,255,197,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(102,255,197,0.16)] bg-[rgba(11,69,55,0.44)] text-[#cbffef]',
    cta: 'border-[rgba(102,255,197,0.36)] bg-[linear-gradient(180deg,rgba(19,108,88,0.72),rgba(10,55,46,0.88))] text-[#ddfff4] shadow-[0_0_28px_rgba(102,255,197,0.18),inset_0_1px_0_rgba(255,255,255,0.22)]',
    chip: 'DETAIL',
  },
  angles: {
    frame: 'border-[rgba(114,197,255,0.16)] hover:border-[rgba(114,197,255,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(114,197,255,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(71,116,255,0.16),transparent_34%)]',
    icon: 'border-[rgba(114,197,255,0.24)] bg-[rgba(13,27,49,0.78)] text-[#9dd4ff] shadow-[0_0_26px_rgba(114,197,255,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(114,197,255,0.16)] bg-[rgba(18,54,89,0.46)] text-[#cce8ff]',
    cta: 'border-[rgba(114,197,255,0.36)] bg-[linear-gradient(180deg,rgba(29,92,155,0.72),rgba(14,48,88,0.88))] text-[#e2f2ff] shadow-[0_0_28px_rgba(114,197,255,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]',
    chip: 'CAMERA',
  },
  collage: {
    frame: 'border-[rgba(255,174,103,0.16)] hover:border-[rgba(255,174,103,0.3)]',
    glow: 'bg-[radial-gradient(circle_at_top_left,rgba(255,174,103,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(255,122,90,0.14),transparent_34%)]',
    icon: 'border-[rgba(255,174,103,0.24)] bg-[rgba(51,28,14,0.78)] text-[#ffc48a] shadow-[0_0_26px_rgba(255,174,103,0.16),inset_0_1px_0_rgba(255,255,255,0.2)]',
    badge: 'border-[rgba(255,174,103,0.16)] bg-[rgba(96,48,16,0.46)] text-[#ffe1c3]',
    cta: 'border-[rgba(255,174,103,0.36)] bg-[linear-gradient(180deg,rgba(154,82,33,0.72),rgba(78,40,14,0.88))] text-[#ffeddc] shadow-[0_0_28px_rgba(255,174,103,0.16),inset_0_1px_0_rgba(255,255,255,0.22)]',
    chip: 'THUMBNAIL',
  },
};

const fallbackImageTheme = IMAGE_TOOL_THEMES.generator;

const ImageGenHub: React.FC<ImageGenHubProps> = ({ onNavigate }) => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-700">
      <div className="mb-10 space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tighter md:text-5xl">AI IMAGE STUDIO</h1>
        <p className="mx-auto max-w-2xl text-gray-400">
          Select a specialized tool to begin your creative journey. From text-to-image generation to advanced photo manipulation.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:gap-5">
        {TOOLS_REGISTRY.map((tool) => {
          const theme = IMAGE_TOOL_THEMES[tool.id] || fallbackImageTheme;
          const ctaLabel = tool.status === 'coming_soon' ? 'Preview tool' : 'Access tool';

          return (
            <button
              key={tool.id}
              onClick={() => onNavigate(tool.route)}
              className={`group relative overflow-hidden rounded-[30px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))] p-4 text-left shadow-[0_22px_60px_rgba(0,0,0,0.32)] transition-all hover:-translate-y-1 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))] ${theme.frame}`}
            >
              <div className={`pointer-events-none absolute inset-0 ${theme.glow}`} />
              <div className="pointer-events-none absolute inset-[1px] rounded-[29px] bg-[linear-gradient(180deg,rgba(8,10,16,0.62),rgba(5,6,10,0.86))]" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

              <div className="relative z-10 flex h-full min-h-[220px] flex-col">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className={`inline-flex h-14 w-14 items-center justify-center rounded-[20px] border backdrop-blur-xl transition-transform group-hover:scale-105 ${theme.icon}`}>
                    {getIconForTool(tool.id)}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${theme.badge}`}>
                      {tool.status === 'beta' ? 'Beta' : 'Ready'}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/46">
                      {theme.chip}
                    </span>
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-base font-semibold tracking-tight text-white md:text-xl">{tool.label}</h3>
                  <p className="mt-2 text-xs leading-5 text-white/62 md:text-sm">
                    {tool.description}
                  </p>
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

export default ImageGenHub;
