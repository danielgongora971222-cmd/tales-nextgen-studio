import React, { useEffect } from "react";

export default function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl border border-white/10 bg-[#0b0b0b] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">{title || "Menu"}</div>
          <button className="text-white/70 hover:text-white" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
        <div className="pb-4">{children}</div>
      </div>
    </div>
  );
}