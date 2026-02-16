import React, { useEffect, useRef, useState } from 'react';
import { uploadUserAsset } from '../services/assetsApi';
import { Asset } from '../types';

interface FileUploaderProps {
  label: string;
  onAssetReady: (asset: Asset) => void; // Returns the full asset object
  accept?: string;
  uploadTool?: string;
  uploadCategory?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({ label, onAssetReady, accept = "image/*", uploadTool = "upload", uploadCategory }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "video" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview?.url) {
        try { URL.revokeObjectURL(preview.url); } catch {}
      }
    };
  }, [preview]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setError(null);
    setUploading(true);

    try {
      const objectUrl = URL.createObjectURL(file);
      setPreview({ url: objectUrl, kind: file.type.startsWith("video") ? "video" : "image" });

      const asset = await uploadUserAsset(file, { tool: uploadTool, category: uploadCategory, name: file.name });
      onAssetReady(asset);
    } catch (err: any) {
      setError(err.message || "Upload failed");
      console.error(err);
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</label>
      
      <div className="relative group">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept={accept}
          className="hidden"
        />
        
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="relative w-full aspect-video rounded-2xl border-2 border-dashed border-white/10 hover:border-white/20 transition-colors bg-black/30 overflow-hidden"
        >
          {preview ? (
          <>
            {preview.kind === "video" ? (
              <video
                src={preview.url}
                className="w-full h-full object-cover"
                muted
                playsInline
                loop
                autoPlay
              />
            ) : (
              <img src={preview.url} alt="Upload preview" className="w-full h-full object-cover" />
            )}
            {!uploading && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-xs font-bold">REPLACE ASSET</span>
              </div>
            )}
          </>
        ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                  <span className="text-xs font-bold text-white/60">UPLOADING...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                    <svg className="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-white/60">CLICK TO UPLOAD</span>
                </div>
              )}
            </div>
          )}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
};

export default FileUploader;
