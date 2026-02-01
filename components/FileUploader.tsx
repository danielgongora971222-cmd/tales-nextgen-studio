import React, { useRef, useState } from 'react';
import { backend } from '../services/backendService';
import { Asset } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface FileUploaderProps {
  label: string;
  onAssetReady: (asset: Asset) => void; // Returns the full asset object
  accept?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({ label, onAssetReady, accept = "image/*" }) => {
  const { user } = useAuth();
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && user) {
      // Show immediate local preview if possible (UX)
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      
      setUploading(true);
      setProgress(10);

      try {
        // Simulate progress bar
        const interval = setInterval(() => {
          setProgress(prev => Math.min(prev + 10, 90));
        }, 150);

        // Upload to "Backend"
        const asset = await backend.uploadAsset(file, user.id);
        
        clearInterval(interval);
        setProgress(100);
        setTimeout(() => setUploading(false), 500);

        onAssetReady(asset);
      } catch (e) {
        console.error("Upload failed", e);
        setUploading(false);
        setPreview(null);
        alert("Upload failed.");
      }
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</label>
      <div 
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`w-full aspect-video rounded-xl border-2 border-dashed transition-all cursor-pointer flex items-center justify-center overflow-hidden relative group ${
            uploading ? 'border-white/50 bg-white/5 cursor-wait' : 'border-white/20 hover:border-white/50 bg-black/30 hover:bg-white/5'
        }`}
      >
        <input 
          ref={fileInputRef}
          type="file" 
          accept={accept} 
          className="hidden" 
          onChange={handleFileChange}
          disabled={uploading}
        />
        
        {uploading && (
           <div className="absolute inset-0 z-20 bg-black/80 flex flex-col items-center justify-center">
              <div className="w-1/2 h-1 bg-white/20 rounded-full overflow-hidden mb-2">
                 <div 
                    className="h-full bg-white transition-all duration-200"
                    style={{ width: `${progress}%` }}
                 />
              </div>
              <span className="text-xs font-mono">UPLOADING {progress}%</span>
           </div>
        )}
        
        {preview ? (
          <>
            <img src={preview} alt="Upload preview" className="w-full h-full object-cover" />
            {!uploading && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-xs font-bold">REPLACE ASSET</span>
                </div>
            )}
          </>
        ) : (
          <div className="text-center p-4">
            <svg className="w-8 h-8 mx-auto mb-2 text-gray-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
            </svg>
            <span className="text-xs text-gray-400">Click to Upload</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUploader;