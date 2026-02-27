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
        startX: number;
        startY: number;
        startAz: number;
        startEl: number;
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

      // Rotación XY: diagonal permitido (dx y dy al mismo tiempo)
      const nextAz = wrap360(s.startAz + dx * 0.35);
      const nextEl = clamp(s.startEl + (-dy) * 0.22, -30, 90);

      // Importante: aquí NO tocamos el zoom (solo lo mueve el slider de la izquierda)
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

    // Si el usuario está interactuando con el slider de zoom, no iniciamos drag del cubo
    const target = e.target as HTMLElement;
    const isZoomSlider = !!target.closest?.("[data-role='zoom-slider']");
    if (isZoomSlider) return;

    // Mantiene el drag incluso si el cursor sale del área
    try { (e.currentTarget as any).setPointerCapture?.(e.pointerId); } catch {}

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startAz: value.azimuth,
      startEl: value.elevation,
    };
  };


  const az = value.azimuth;
  const el = value.elevation;
  const zm = value.zoom;

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

        {/* Zoom slider (solo aquí se cambia el zoom) */}
        <div
          data-role="zoom-slider"
          className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 rounded-2xl bg-black/60 border border-white/10 px-2 py-3 pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-white/70"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>

          <input
            aria-label="Zoom"
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={zm}
            onChange={(e) =>
              onChangeRef.current({
                azimuth: valueRef.current.azimuth,
                elevation: valueRef.current.elevation,
                zoom: Number(e.target.value),
              })
            }
            className="w-4 accent-white"
            style={{
              writingMode: "bt-lr",
              WebkitAppearance: "slider-vertical" as any,
              height: "170px",
            }}
          />

          <div className="text-[10px] font-mono text-white/70">{zm.toFixed(1)}</div>
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
          Arrastra el cubo para cambiar <span className="text-white/80">Azimuth</span> (horizontal) + <span className="text-white/80">Elevation</span> (vertical) al mismo tiempo.
          <div className="text-white/35 mt-1">El zoom se ajusta solo con la barra de la izquierda.</div>
        </div>
      </div>
    </div>
  );
};

export default CameraAngleSimulator3D;
