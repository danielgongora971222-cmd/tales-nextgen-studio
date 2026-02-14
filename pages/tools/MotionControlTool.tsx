import React from 'react';

const MotionControlTool: React.FC = () => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="glass-panel p-8 rounded-3xl border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-white/10 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V4" />
              <path d="M4 16h6" />
              <path d="M4 12h10" />
              <path d="M4 8h14" />
              <path d="M20 4v16" />
              <path d="M14 12l3-3 3 3" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold tracking-tighter">Motion Control</h1>
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">BETA</span>
        </div>

        <p className="text-gray-400 max-w-3xl leading-relaxed">
          Define camera movement, subject motion, and cinematic paths. This page is a placeholder so the navigation and
          hub are complete. Next step: implement the Motion Control UI + API calls and save outputs to My Creations.
        </p>
      </div>
    </div>
  );
};

export default MotionControlTool;
