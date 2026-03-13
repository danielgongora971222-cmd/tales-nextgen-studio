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
  const [isDragging, setIsDragging] = useState(false);

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
      const next = clamp(Math.round(Math.min(width, height) * 0.52), 190, 420);
      setCubeSize(next);
    };

    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();

      const s = dragRef.current;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      const nextAz = wrap360(s.startAz + dx * 0.35);
      const nextEl = clamp(s.startEl + -dy * 0.22, -30, 90);

      onChangeRef.current({
        azimuth: nextAz,
        elevation: nextEl,
        zoom: valueRef.current.zoom,
      });
    };

    const endDrag = () => {
      dragRef.current = null;
      setIsDragging(false);
    };

    const preventTouchScroll = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("touchmove", preventTouchScroll, { passive: false });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("touchmove", preventTouchScroll);
    };
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    if (disabled) return;

    const target = e.target as HTMLElement;
    const interactiveTarget = target.closest?.("button, input, a, [data-role='zoom-slider']");
    if (interactiveTarget) return;

    e.preventDefault();

    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    } catch {
      // no-op
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startAz: value.azimuth,
      startEl: value.elevation,
    };
    setIsDragging(true);
  };

  const az = value.azimuth;
  const el = value.elevation;
  const zm = value.zoom;
  const cubeDepth = cubeSize / 2;

  const cubeTransform = useMemo(() => {
    const rotY = -az;
    const rotX = clamp(-el, -75, 75);
    const scale = clamp(0.84 + (zm / 10) * 0.34, 0.84, 1.18);

    return `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
  }, [az, el, zm]);

  const faceBase =
    "absolute inset-0 overflow-hidden rounded-[28px] border border-[rgba(241,225,148,0.1)] bg-[linear-gradient(180deg,rgba(20,10,12,0.96),rgba(7,3,5,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_48px_rgba(0,0,0,0.26)]";
  const faceLabel = "text-[10px] sm:text-[11px] font-mono tracking-[0.28em] text-[rgba(241,225,148,0.56)]";

  return (
    <div className="w-full">
      <div
        ref={stageRef}
        onPointerDown={startDrag}
        className="relative aspect-square w-full overflow-hidden rounded-[34px] bg-transparent select-none"
        style={{
          cursor: disabled ? "default" : isDragging ? "grabbing" : "grab",
          touchAction: "none",
          overscrollBehavior: "contain",
          WebkitUserSelect: "none",
        }}
      >
        <div className="absolute inset-0 rounded-[34px] opacity-95" style={starfieldBackground} />
        <div className="absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_50%_50%,rgba(241,225,148,0.05),transparent_18%),radial-gradient(circle_at_50%_55%,rgba(91,14,20,0.24),transparent_42%)]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(91,14,20,0.28),transparent_66%)] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-[14%] bottom-[9%] h-24 rounded-full bg-[radial-gradient(circle,rgba(91,14,20,0.42),transparent_72%)] blur-3xl" />

        <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full border border-[rgba(241,225,148,0.12)] bg-[rgba(8,4,5,0.68)] px-3 py-2 text-[11px] font-mono text-[rgba(255,245,220,0.88)] shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:left-4 sm:top-4">
          <span className="text-[rgba(241,225,148,0.72)]">AZ</span>
          <span>{Math.round(az)}°</span>
          <span className="mx-1 h-3.5 w-px bg-[rgba(241,225,148,0.12)]" />
          <span className="text-[rgba(241,225,148,0.72)]">EL</span>
          <span>{Math.round(el)}°</span>
        </div>

        <div
          data-role="zoom-slider"
          className="absolute left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-3 rounded-[22px] border border-[rgba(241,225,148,0.1)] bg-[rgba(8,4,5,0.62)] px-2.5 py-3 shadow-[0_22px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:left-4 sm:px-3 sm:py-4"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ touchAction: "none" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
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
              height: cubeSize < 250 ? "140px" : "188px",
            }}
          />

          <div className="text-[10px] font-mono text-white/68 sm:text-[11px]">{zm.toFixed(1)}</div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center px-12 py-12 sm:px-16 sm:py-16">
          <div
            className="relative"
            style={{
              width: `${cubeSize}px`,
              height: `${cubeSize}px`,
              perspective: "1120px",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: cubeTransform,
                transformStyle: "preserve-3d",
                transition: isDragging ? "none" : "transform 130ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <div className={faceBase} style={{ transform: `rotateY(0deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_34%),radial-gradient(circle_at_50%_26%,rgba(241,225,148,0.08),transparent_34%)]" />

                {imageUrl ? (
                  <>
                    <div className="absolute inset-[7%] overflow-hidden rounded-[22px] border border-[rgba(241,225,148,0.09)] bg-[rgba(0,0,0,0.28)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                      <img
                        src={imageUrl}
                        alt={referenceLabel || "Reference"}
                        className="h-full w-full object-contain object-center"
                        draggable={false}
                      />
                    </div>

                    {onOpenReferencePicker ? (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={onOpenReferencePicker}
                        className="absolute bottom-4 right-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(241,225,148,0.16)] bg-[rgba(8,4,5,0.8)] text-[rgba(255,245,220,0.92)] shadow-[0_16px_40px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:border-[rgba(241,225,148,0.28)] hover:bg-[rgba(18,8,10,0.9)]"
                        title="Cambiar referencia"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="absolute inset-[8%] flex items-center justify-center">
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={onOpenReferencePicker}
                      className="group flex h-full w-full flex-col items-center justify-center gap-4 rounded-[24px] border border-dashed border-[rgba(241,225,148,0.18)] bg-[linear-gradient(180deg,rgba(18,8,10,0.88),rgba(8,3,5,0.96))] px-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:border-[rgba(241,225,148,0.3)] hover:bg-[linear-gradient(180deg,rgba(25,11,14,0.92),rgba(10,4,6,0.98))]"
                    >
                      <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-[rgba(241,225,148,0.16)] bg-[rgba(241,225,148,0.08)] text-[rgba(241,225,148,0.92)] transition group-hover:scale-105 group-hover:bg-[rgba(241,225,148,0.14)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[rgba(255,245,220,0.94)] sm:text-base">Cargar referencia</div>
                        <div className="mt-2 text-[10px] font-mono tracking-[0.22em] text-[rgba(241,225,148,0.58)] sm:text-[11px]">FRONT FACE</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <div className={faceBase} style={{ transform: `rotateY(90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_34%),radial-gradient(circle_at_45%_30%,rgba(241,225,148,0.07),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>RIGHT</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateY(-90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_34%),radial-gradient(circle_at_55%_30%,rgba(241,225,148,0.07),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>LEFT</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateY(180deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>BACK</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateX(90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>UP</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateX(-90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>DOWN</div></div>
              </div>
            </div>
          </div>
        </div>

        {referenceLabel ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 max-w-[min(68vw,360px)] -translate-x-1/2 truncate rounded-full border border-[rgba(241,225,148,0.1)] bg-[rgba(8,4,5,0.72)] px-4 py-2 text-[11px] text-white/72 shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:bottom-5">
            {referenceLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CameraAngleSimulator3D;
