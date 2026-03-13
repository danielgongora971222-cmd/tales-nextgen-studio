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
  onOpenReferencePicker?: () => void;
  referenceLabel?: string | null;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const wrap360 = (v: number) => {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
};

const starfieldBackground = {
  backgroundImage:
    "radial-gradient(1px 1px at 8% 16%, rgba(255,255,255,0.9), transparent), radial-gradient(1px 1px at 18% 72%, rgba(255,255,255,0.65), transparent), radial-gradient(1.3px 1.3px at 29% 38%, rgba(241,225,148,0.85), transparent), radial-gradient(1px 1px at 44% 18%, rgba(255,255,255,0.75), transparent), radial-gradient(1px 1px at 58% 64%, rgba(255,255,255,0.55), transparent), radial-gradient(1.2px 1.2px at 69% 27%, rgba(241,225,148,0.72), transparent), radial-gradient(1px 1px at 77% 82%, rgba(255,255,255,0.7), transparent), radial-gradient(1.3px 1.3px at 91% 22%, rgba(255,255,255,0.82), transparent), radial-gradient(circle at 20% 18%, rgba(91,14,20,0.48), transparent 32%), radial-gradient(circle at 82% 12%, rgba(241,225,148,0.12), transparent 18%), radial-gradient(circle at 50% 92%, rgba(91,14,20,0.34), transparent 32%), linear-gradient(180deg, rgba(8,3,6,0.92), rgba(3,1,2,0.98))",
};

const CameraAngleSimulator3D: React.FC<Props> = ({
  imageUrl,
  value,
  onChange,
  disabled,
  onOpenReferencePicker,
  referenceLabel,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
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

  const [cubeSize, setCubeSize] = useState(280);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const compute = () => {
      const width = el.clientWidth;
      const height = el.clientHeight || width;
      const next = clamp(Math.round(Math.min(width, height) * 0.46), 210, 430);
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
    const interactiveTarget = target.closest?.("button, input, a, [data-role='zoom-slider']");
    if (interactiveTarget) return;

    try {
      (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    } catch {}

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
    const rotY = -az; // Fix: 90° now visually matches RIGHT and 270° matches LEFT.
    const rotX = clamp(-el, -75, 75);
    const scale = clamp(0.8 + (zm / 10) * 0.38, 0.8, 1.18);

    return `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
  }, [az, el, zm]);

  const faceBase =
    "absolute inset-0 overflow-hidden rounded-[28px] border border-[rgba(241,225,148,0.14)] bg-[linear-gradient(180deg,rgba(23,11,14,0.94),rgba(8,3,6,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";
  const faceLabel = "text-[10px] sm:text-[11px] font-mono tracking-[0.28em] text-[rgba(241,225,148,0.62)]";

  return (
    <div className="w-full">
      <div
        ref={stageRef}
        onPointerDown={startDrag}
        className="relative aspect-square w-full overflow-hidden rounded-[34px] border border-[rgba(241,225,148,0.12)] bg-[#030102] select-none shadow-[0_40px_120px_rgba(0,0,0,0.55)]"
        style={{ cursor: disabled ? "default" : "grab" }}
      >
        <div className="absolute inset-0 opacity-95" style={starfieldBackground} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(241,225,148,0.06),transparent_20%),radial-gradient(circle_at_50%_50%,rgba(91,14,20,0.18),transparent_42%)]" />
        <div className="pointer-events-none absolute inset-x-[11%] bottom-10 h-20 rounded-full bg-[radial-gradient(circle,rgba(91,14,20,0.42),transparent_72%)] blur-2xl" />

        <div className="absolute left-4 top-4 z-20 rounded-2xl border border-[rgba(241,225,148,0.12)] bg-black/45 px-3 py-2 text-[11px] font-mono text-white/78 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-2">
            <span className="text-[rgba(241,225,148,0.7)]">AZ</span>
            <span>{Math.round(az)}°</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[rgba(241,225,148,0.7)]">EL</span>
            <span>{Math.round(el)}°</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[rgba(241,225,148,0.7)]">ZM</span>
            <span>{zm.toFixed(1)}</span>
          </div>
        </div>

        {onOpenReferencePicker ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOpenReferencePicker}
            className="absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-2xl border border-[rgba(241,225,148,0.16)] bg-[rgba(10,5,6,0.72)] px-4 py-2 text-xs font-semibold text-[rgba(255,245,220,0.92)] backdrop-blur-xl transition hover:border-[rgba(241,225,148,0.34)] hover:bg-[rgba(20,8,10,0.82)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {imageUrl ? "Cambiar referencia" : "Cargar referencia"}
          </button>
        ) : null}

        <div
          data-role="zoom-slider"
          className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-3 rounded-[24px] border border-[rgba(241,225,148,0.12)] bg-[rgba(5,2,3,0.72)] px-3 py-4 backdrop-blur-xl shadow-[0_25px_70px_rgba(0,0,0,0.34)]"
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
            className="text-[rgba(241,225,148,0.72)]"
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
            className="w-4 accent-[rgba(241,225,148,0.96)]"
            style={{
              writingMode: "bt-lr",
              WebkitAppearance: "slider-vertical" as any,
              height: "220px",
            }}
          />

          <div className="text-[11px] font-mono text-white/74">{zm.toFixed(1)}</div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center px-14 py-14 sm:px-20 sm:py-16">
          <div
            className="relative"
            style={{
              width: `${cubeSize}px`,
              height: `${cubeSize}px`,
              perspective: "1050px",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: cubeTransform,
                transformStyle: "preserve-3d",
                transition: disabled ? "transform 140ms linear" : "transform 90ms linear",
              }}
            >
              <div className={faceBase} style={{ transform: `rotateY(0deg) translateZ(${cubeDepth}px)` }}>
                {imageUrl ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.1),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.08))] p-5">
                    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[22px] border border-white/8 bg-[rgba(0,0,0,0.18)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                      <img
                        src={imageUrl}
                        alt={referenceLabel || "Reference"}
                        className="max-h-full max-w-full object-contain object-center"
                        draggable={false}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={onOpenReferencePicker}
                      className="group flex h-full w-full flex-col items-center justify-center gap-4 rounded-[22px] border border-dashed border-[rgba(241,225,148,0.18)] bg-[linear-gradient(180deg,rgba(20,8,10,0.86),rgba(8,3,6,0.96))] px-6 text-center transition hover:border-[rgba(241,225,148,0.38)] hover:bg-[linear-gradient(180deg,rgba(28,12,15,0.92),rgba(12,4,7,0.98))]"
                    >
                      <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-[rgba(241,225,148,0.16)] bg-[rgba(241,225,148,0.08)] text-[rgba(241,225,148,0.9)] transition group-hover:scale-105 group-hover:bg-[rgba(241,225,148,0.14)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[rgba(255,245,220,0.94)]">Cargar referencia</div>
                        <div className="mt-1 text-[11px] font-mono tracking-[0.22em] text-[rgba(241,225,148,0.62)]">FRONT FACE</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <div className={faceBase} style={{ transform: `rotateY(90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_35%),radial-gradient(circle_at_45%_30%,rgba(241,225,148,0.08),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>RIGHT</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateY(-90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_35%),radial-gradient(circle_at_55%_30%,rgba(241,225,148,0.08),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>LEFT</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateY(180deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>BACK</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateX(90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>UP</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateX(-90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>DOWN</div></div>
              </div>
            </div>
          </div>
        </div>

        {referenceLabel ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(5,2,3,0.74)] px-4 py-2 text-xs text-white/72 backdrop-blur-xl">
            {referenceLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CameraAngleSimulator3D;
