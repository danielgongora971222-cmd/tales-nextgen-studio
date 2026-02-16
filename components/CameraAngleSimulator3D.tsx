import React, { useEffect, useMemo, useRef } from "react";

export type CameraAngleValue = {
  azimuth: number;   // 0..360 (0=front, 90=right, 180=back, 270=left)
  elevation: number; // -30..90 (-30=low angle looking up, 0=eye-level, 90=top-down)
  zoom: number;      // 0..10 (0=wide, 10=close)
};

type Props = {
  imageUrl?: string | null;
  value: CameraAngleValue;
  onChange: (next: CameraAngleValue) => void;

  disabled?: boolean;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function angleFromPointer(rect: DOMRect, clientX: number, clientY: number) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;

  // 0° = top (front), 90° = right, 180° = bottom (back), 270° = left
  const rad = Math.atan2(dx, -dy);
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

const CameraAngleSimulator3D: React.FC<Props> = ({ imageUrl, value, onChange, disabled }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | null
    | {
        mode: "azimuth" | "elevation";
        startX: number;
        startY: number;
        startAz: number;
        startEl: number;
      }
  >(null);

  const az = value.azimuth;
  const el = value.elevation;
  const zm = value.zoom;

  const dotPos = useMemo(() => {
    const r = 40;
    const rad = (az * Math.PI) / 180;
    // dot on a circle where 0° is up
    const x = 50 + Math.sin(rad) * r;
    const y = 50 - Math.cos(rad) * r;
    return { x, y };
  }, [az]);

  const previewTransform = useMemo(() => {
    // Visual hint only (NOT physically correct): small tilt based on azimuth/elevation
    const rad = (az * Math.PI) / 180;
    const tiltY = Math.sin(rad) * 22;
    const tiltX = clamp(-el * 0.35, -22, 22);
    const z = clamp(1 + (zm - 5) * 0.03, 0.82, 1.18);
    return `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${z})`;
  }, [az, el, zm]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const s = dragRef.current;

      if (s.mode === "azimuth") {
        const rect = stage.getBoundingClientRect();
        const nextAz = angleFromPointer(rect, e.clientX, e.clientY);
        onChange({
          azimuth: nextAz,
          elevation: value.elevation,
          zoom: value.zoom,
        });
        return;
      }

      // elevation mode
      const deltaY = s.startY - e.clientY; // drag up => positive => higher elevation
      const nextEl = clamp(s.startEl + deltaY * 0.25, -30, 90);
      onChange({
        azimuth: value.azimuth,
        elevation: nextEl,
        zoom: value.zoom,
      });
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    stage.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      stage.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onChange, value.azimuth, value.elevation, value.zoom]);

  const startDrag = (e: React.PointerEvent) => {
    if (disabled) return;
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = Math.min(rect.width, rect.height) / 2;

    // Si estás cerca del borde => azimuth (giro alrededor)
    // Si estás cerca del centro => elevation (subir/bajar cámara)
    const mode: "azimuth" | "elevation" = dist > radius * 0.55 ? "azimuth" : "elevation";

    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startAz: value.azimuth,
      startEl: value.elevation,
    };

    if (mode === "azimuth") {
      const nextAz = angleFromPointer(rect, e.clientX, e.clientY);
      onChange({ azimuth: nextAz, elevation: value.elevation, zoom: value.zoom });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.4 : 0.4;
    const next = clamp(value.zoom + delta, 0, 10);
    onChange({ azimuth: value.azimuth, elevation: value.elevation, zoom: next });
  };

  return (
    <div className="w-full">
      <div
        ref={stageRef}
        onPointerDown={startDrag}
        onWheel={onWheel}
        className="relative w-full aspect-square rounded-3xl overflow-hidden border border-white/10 bg-black/40 select-none"
        style={{ cursor: disabled ? "not-allowed" : "grab" }}
      >
        {/* Background grid (gives 3D “space” vibe) */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.10) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
            transform: "perspective(800px) rotateX(55deg)",
            transformOrigin: "50% 65%",
          }}
        />

        {/* Center image “billboard” */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative w-[62%] aspect-square rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
            style={{ transform: previewTransform, transformStyle: "preserve-3d" }}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="Reference" className="absolute inset-0 w-full h-full object-contain bg-black/60" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white/30">
                <div className="text-center">
                  <div className="text-sm font-mono">SUBE UNA IMAGEN</div>
                  <div className="text-xs mt-1">para activar la simulación 3D</div>
                </div>
              </div>
            )}

            {/* Hint */}
            <div className="absolute bottom-2 left-2 right-2 text-[11px] text-white/40 font-mono">
              Arrastra en el <span className="text-white/70">centro</span> para subir/bajar (elevación)
            </div>
          </div>
        </div>

        {/* Orbit ring + camera handle */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg viewBox="0 0 100 100" className="w-[92%] h-[92%]">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
            <circle cx="50" cy="10" r="2" fill="rgba(255,255,255,0.55)" />
            <text x="50" y="6" textAnchor="middle" fontSize="4" fill="rgba(255,255,255,0.55)" fontFamily="monospace">
              FRONT 0°
            </text>

            {/* camera dot */}
            <circle cx={dotPos.x} cy={dotPos.y} r="2.8" fill="rgba(255,255,255,0.95)" />
            <circle cx={dotPos.x} cy={dotPos.y} r="7.5" fill="rgba(255,255,255,0.12)" />
          </svg>
        </div>

        {/* Readout */}
        <div className="absolute top-3 left-3 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white/80">
          <div>Azimuth: <span className="text-white">{Math.round(az)}°</span></div>
          <div>Elevation: <span className="text-white">{Math.round(el)}°</span></div>
          <div>Zoom: <span className="text-white">{zm.toFixed(1)}</span></div>
        </div>

        {/* Hint for azimuth */}
        <div className="absolute bottom-3 right-3 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono text-white/60">
          Arrastra cerca del borde para girar (azimuth)
          <div className="text-white/35 mt-1">Scroll para zoom</div>
        </div>
      </div>
    </div>
  );
};

export default CameraAngleSimulator3D;
