import React from 'react';

const EditVideoTool: React.FC = () => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="glass-panel p-8 rounded-3xl border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-white/10 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold tracking-tighter">Edit Video</h1>
          <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full font-bold text-white/70">COMING SOON</span>
        </div>

        <p className="text-gray-400 max-w-3xl leading-relaxed">
          This tool is already wired in the UI and navigation. Next step is connecting the editor workflow to your
          video-edit API (upload/select a video, choose edits, render, and save to My Creations).
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled className="px-4 py-2 rounded-xl bg-white/10 text-white/40 cursor-not-allowed border border-white/10">
            Upload video (soon)
          </button>
          <button disabled className="px-4 py-2 rounded-xl bg-white/10 text-white/40 cursor-not-allowed border border-white/10">
            Select from My Creations (soon)
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditVideoTool;
