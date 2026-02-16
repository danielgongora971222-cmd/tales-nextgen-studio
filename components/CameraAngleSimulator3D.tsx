import React, { useEffect, useMemo, useRef, useState } from "react";

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
const wrap360 = (v: number) => {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
};

const CameraAngleSimulator3D: React.FC<Props> = ({ imageUrl, value, onChange, disabled }) => {
  const stageRef = useRef<HTMLDivElement>(null);

  // Mantén refs para no re-registrar listeners cada render
  const valueRef = useRef<CameraAngleValue>(value);
  const onChangeRef = useRef(onChange);

  const dragRef = useRef<
    | null
    | {
        mode: "xy" | "zoom";
        startX: number;
        startY: number;
        startAz: number;
        startEl: number;
        startZoom: number;
      }
  >(null);

  const [cubeSize, setCubeSize] = useState(240); // px

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Resize -> ajusta el cubo para que siempre “encaje”
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const compute = () => {
      const w = el.clientWidth;
      // cubo entre 170px y 320px aprox, escalando con el tamaño del panel
      const next = clamp(Math.round(w * 0.46), 170, 320);
      setCubeSize(next);
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const s = dragRef.current;

      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      if (s.mode === "zoom") {
        // Arrastrar hacia arriba = más zoom
        const nextZoom = clamp(s.startZoom + (-dy) * 0.02, 0, 10);
        onChangeRef.current({
          azimuth: valueRef.current.azimuth,
          elevation: valueRef.current.elevation,
          zoom: nextZoom,
        });
        return;
      }

      // XY: diagonal permitido (dx y dy al mismo tiempo)
      const nextAz = wrap360(s.startAz + dx * 0.35);
      const nextEl = clamp(s.startEl + (-dy) * 0.22, -30, 90);

      onChangeRef.current({
        azimuth: nextAz,
        elevation: nextEl,
        zoom: valueRef.current.zoom,
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
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    if (disabled) return;
    const stage = stageRef.current;
    if (!stage) return;

    const target = e.target as HTMLElement;
    // Mantiene el drag incluso si el cursor sale del área
    try { (e.currentTarget as any).setPointerCapture?.(e.pointerId); } catch {}

    const isZoomHandle = !!target.closest?.("[data-role='z-handle']");

    dragRef.current = {
      mode: isZoomHandle ? "zoom" : "xy",
      startX: e.clientX,
      startY: e.clientY,
      startAz: value.azimuth,
      startEl: value.elevation,
      startZoom: value.zoom,
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.4 : 0.4;
    const next = clamp(value.zoom + delta, 0, 10);
    onChange({ azimuth: value.azimuth, elevation: value.elevation, zoom: next });
  };

  const az = value.azimuth;
  const el = value.elevation;
  const zm = value.zoom;

  const sphereHandle = useMemo(() => {
    // Proyección simple de una esfera (solo para UI)
    const cx = 50;
    const cy = 50;
    const r = 42;

    const a = (az * Math.PI) / 180;
    const e = (clamp(el, -30, 90) * Math.PI) / 180;

    const y = Math.sin(e);
    const rXZ = Math.cos(e);
    const x = Math.sin(a) * rXZ;
    const z = Math.cos(a) * rXZ;

    // “Profundidad” muy ligera: si z está atrás, lo atenuamos
    const depthFade = clamp(0.55 + (z + 1) * 0.225, 0.55, 1);

    return {
      x: cx + x * r,
      y: cy - y * r,
      depthFade,
    };
  }, [az, el]);

  const cubeDepth = cubeSize / 2;

  const cubeTransform = useMemo(() => {
    // Nota: visual hint (no físico), pero consistente con los sliders
    const rotY = az;
    const rotX = clamp(-el, -75, 75);

    // zoom 0..10 => scale 0.78..1.20
    const scale = clamp(0.78 + (zm / 10) * 0.42, 0.78, 1.2);

    return `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
  }, [az, el, zm]);

  const faceBase = "absolute inset-0 rounded-2xl overflow-hidden border border-white/10 bg-black/45 flex items-center justify-center";
  const faceLabel = "text-[11px] sm:text-xs font-mono tracking-widest text-white/70";

  return (
    <div className="w-full">
      <div
        ref={stageRef}
        onPointerDown={startDrag}
        onWheel={onWheel}
        className="relative w-full aspect-square rounded-3xl overflow-hidden border border-white/10 bg-black/40 select-none"
        style={{ cursor: disabled ? "not-allowed" : "grab" }}
      >
        {/* fondo suave */}
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.08), transparent 55%), linear-gradient(to bottom, rgba(255,255,255,0.06), transparent)",
          }}
        />

        {/* esfera + ejes (SVG) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg viewBox="0 0 100 100" className="w-[94%] h-[94%]">
            {/* esfera */}
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.3" />

            {/* anillos (lat/long) */}
            <ellipse cx="50" cy="50" rx="42" ry="16" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
            <ellipse
              cx="50"
              cy="50"
              rx="16"
              ry="42"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
              transform="rotate(20 50 50)"
            />

            {/* ejes: X (rojo), Y (verde), Z (azul) */}
            <line x1="10" y1="50" x2="90" y2="50" stroke="rgba(255,80,80,0.85)" strokeWidth="1.4" />
            <line x1="50" y1="10" x2="50" y2="90" stroke="rgba(80,255,120,0.85)" strokeWidth="1.4" />
            <line x1="50" y1="50" x2="82" y2="82" stroke="rgba(80,160,255,0.9)" strokeWidth="1.4" />

            {/* labels ejes */}
            <text x="92" y="49" textAnchor="end" fontSize="4.5" fill="rgba(255,80,80,0.9)" fontFamily="monospace">
              X
            </text>
            <text x="51" y="12" textAnchor="start" fontSize="4.5" fill="rgba(80,255,120,0.9)" fontFamily="monospace">
              Y
            </text>
            <text x="84" y="84" textAnchor="start" fontSize="4.5" fill="rgba(80,160,255,0.95)" fontFamily="monospace">
              Z
            </text>

            {/* handle (posición cámara sobre la esfera) */}
            <line
              x1="50"
              y1="50"
              x2={sphereHandle.x}
              y2={sphereHandle.y}
              stroke={`rgba(255,255,255,${0.25 * sphereHandle.depthFade})`}
              strokeWidth="1"
            />
            <circle
              cx={sphereHandle.x}
              cy={sphereHandle.y}
              r="2.8"
              fill={`rgba(255,255,255,${0.85 * sphereHandle.depthFade})`}
            />
            <circle
              cx={sphereHandle.x}
              cy={sphereHandle.y}
              r="6.8"
              fill={`rgba(255,255,255,${0.12 * sphereHandle.depthFade})`}
            />
          </svg>
        </div>

        {/* cubo (CSS 3D) */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{
              width: `${cubeSize}px`,
              height: `${cubeSize}px`,
              perspective: "900px",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: cubeTransform,
                transformStyle: "preserve-3d",
                transition: disabled ? "transform 120ms linear" : "transform 80ms linear",
              }}
            >
              {/* FRONT */}
              <div
                className={faceBase}
                style={{ transform: `rotateY(0deg) translateZ(${cubeDepth}px)` }}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Reference"
                    className="absolute inset-0 w-full h-full object-contain bg-black/60"
                    draggable={false}
                  />
                ) : (
                  <div className={faceLabel}>FRONT</div>
                )}
              </div>

              {/* RIGHT */}
              <div
                className={faceBase}
                style={{ transform: `rotateY(90deg) translateZ(${cubeDepth}px)` }}
              >
                <div className={faceLabel}>RIGHT</div>
              </div>

              {/* LEFT */}
              <div
                className={faceBase}
                style={{ transform: `rotateY(-90deg) translateZ(${cubeDepth}px)` }}
              >
                <div className={faceLabel}>LEFT</div>
              </div>

              {/* BACK */}
              <div
                className={faceBase}
                style={{ transform: `rotateY(180deg) translateZ(${cubeDepth}px)` }}
              >
                <div className={faceLabel}>BACK</div>
              </div>

              {/* UP */}
              <div
                className={faceBase}
                style={{ transform: `rotateX(90deg) translateZ(${cubeDepth}px)` }}
              >
                <div className={faceLabel}>UP</div>
              </div>

              {/* DOWN */}
              <div
                className={faceBase}
                style={{ transform: `rotateX(-90deg) translateZ(${cubeDepth}px)` }}
              >
                <div className={faceLabel}>DOWN</div>
              </div>
            </div>
          </div>
        </div>

        {/* Handle Z (zoom) - SÍ acepta pointer */}
        <div
          data-role="z-handle"
          className="absolute right-[8%] bottom-[8%] w-11 h-11 rounded-2xl border border-white/15 bg-black/60 flex items-center justify-center"
          style={{ cursor: disabled ? "not-allowed" : "ns-resize" }}
        >
          <div className="text-[11px] font-mono text-white/70 leading-none text-center">
            Z
            <div className="text-[9px] text-white/35 mt-1">ZOOM</div>
          </div>
        </div>

        {/* Readout */}
        <div className="absolute top-3 left-3 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white/80">
          <div>
            Azimuth: <span className="text-white">{Math.round(az)}°</span>
          </div>
          <div>
            Elevation: <span className="text-white">{Math.round(el)}°</span>
          </div>
          <div>
            Zoom: <span className="text-white">{zm.toFixed(1)}</span>
          </div>
        </div>

        {/* Hint */}
        <div className="absolute bottom-3 left-3 right-3 px-3 py-2 rounded-xl bg-black/55 border border-white/10 text-[11px] font-mono text-white/60">
          Arrastra para mover <span className="text-white/80">X</span> (horizontal) + <span className="text-white/80">Y</span> (vertical) al mismo tiempo.
          <div className="text-white/35 mt-1">Scroll para zoom, o arrastra el handle <span className="text-white/70">Z</span>.</div>
        </div>
      </div>
    </div>
  );
};

export default CameraAngleSimulator3D;
