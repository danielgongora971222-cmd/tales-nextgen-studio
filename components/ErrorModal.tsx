import React from 'react';

interface ErrorModalProps {
  error: string | null;
  onClose: () => void;
}

const ErrorModal: React.FC<ErrorModalProps> = ({ error, onClose }) => {
  if (!error) return null;

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md p-6 bg-[#0a0a0a] border border-red-900/50 rounded-2xl shadow-[0_0_50px_rgba(220,38,38,0.2)] animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3 className="text-lg font-bold tracking-wider uppercase">Generation Rejected</h3>
        </div>

        {/* Content */}
        <div className="mb-8">
          <p className="text-gray-300 text-sm leading-relaxed border-l-2 border-red-900/50 pl-4 py-1">
            {error}
          </p>
        </div>

        {/* Action */}
        <div className="flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-white text-black text-xs font-bold uppercase rounded-lg hover:bg-gray-200 hover:scale-105 transition-all"
          >
            Acknowledge
          </button>
        </div>

        {/* Decorative Grid */}
        <div className="absolute inset-0 border border-white/5 rounded-2xl pointer-events-none" />
      </div>
    </div>
  );
};

export default ErrorModal;