import React, { useEffect, useMemo, useRef, useState } from "react";

export type CameraAngleValue = {
  azimuth: number;   // visual orbit state 0..360
  elevation: number; // -30..90
  zoom: number;      // 0..10
};

type Props = {
  imageUrl?: string | null;
  value: CameraAngleValue;
  onChange: (next: CameraAngleValue) => void;
  disabled?: boolean;
  onOpenReferencePicker?: () => void;
  referenceLabel?: string | null;
  displayAzimuth?: number;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const wrap360 = (v: number) => {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
};

const starfieldBackground = {
  backgroundImage:
    "radial-gradient(1px 1px at 8% 16%, rgba(255,255,255,0.9), transparent), radial-gradient(1px 1px at 18% 72%, rgba(255,255,255,0.62), transparent), radial-gradient(1.2px 1.2px at 29% 38%, rgba(241,225,148,0.82), transparent), radial-gradient(1px 1px at 44% 18%, rgba(255,255,255,0.72), transparent), radial-gradient(1px 1px at 58% 64%, rgba(255,255,255,0.52), transparent), radial-gradient(1.15px 1.15px at 69% 27%, rgba(241,225,148,0.7), transparent), radial-gradient(1px 1px at 77% 82%, rgba(255,255,255,0.66), transparent), radial-gradient(1.25px 1.25px at 91% 22%, rgba(255,255,255,0.8), transparent), radial-gradient(circle at 18% 14%, rgba(91,14,20,0.42), transparent 30%), radial-gradient(circle at 82% 12%, rgba(241,225,148,0.08), transparent 18%), radial-gradient(circle at 50% 96%, rgba(91,14,20,0.34), transparent 30%), linear-gradient(180deg, rgba(8,3,6,0.95), rgba(3,1,2,0.995))",
};

const CameraAngleSimulator3D: React.FC<Props> = ({
  imageUrl,
  value,
  onChange,
  disabled,
  onOpenReferencePicker,
  referenceLabel,
  displayAzimuth,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<CameraAngleValue>(value);
  const onChangeRef = useRef(onChange);
  const pointerIdRef = useRef<number | null>(null);
  const dragRef = useRef<
    | null
    | {
        startX: number;
        startY: number;
        startAz: number;
        startEl: number;
      }
  >(null);

  const [cubeSize, setCubeSize] = useState(300);
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
      const width = el.clientWidth || 0;
      const height = el.clientHeight || width || 0;
      const compact = width < 640;
      const widthBudget = width - (compact ? 46 : 118);
      const heightBudget = height - (compact ? 132 : 104);
      const base = Math.min(widthBudget, heightBudget);
      const next = clamp(Math.round(base), compact ? 212 : 240, 520);
      setCubeSize(next);
    };

    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", compute);

    return () => {
      ro.disconnect();
      viewport?.removeEventListener("resize", compute);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();

      const s = dragRef.current;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      const nextAz = wrap360(s.startAz + dx * 0.34);
      const nextEl = clamp(s.startEl - dy * 0.22, -30, 90);

      onChangeRef.current({
        azimuth: nextAz,
        elevation: nextEl,
        zoom: valueRef.current.zoom,
      });
    };

    const endDrag = (e?: PointerEvent) => {
      if (e && pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;

      if (pointerIdRef.current !== null) {
        try {
          stageRef.current?.releasePointerCapture?.(pointerIdRef.current);
        } catch {
          // no-op
        }
      }

      pointerIdRef.current = null;
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

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType !== "touch" && e.button !== 0) return;

    const target = e.target as HTMLElement;
    const interactiveTarget = target.closest?.("button, input, a, textarea, [data-role='zoom-slider']");
    if (interactiveTarget) return;

    e.preventDefault();
    e.stopPropagation();

    pointerIdRef.current = e.pointerId;

    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
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

  const semanticAz = typeof displayAzimuth === "number" ? wrap360(displayAzimuth) : wrap360(value.azimuth);
  const az = value.azimuth;
  const el = value.elevation;
  const zm = value.zoom;
  const cubeDepth = cubeSize / 2;

  const cubeTransform = useMemo(() => {
    const rotY = az;
    const rotX = clamp(-el, -75, 75);
    const scale = clamp(0.86 + (zm / 10) * 0.28, 0.86, 1.14);

    return `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
  }, [az, el, zm]);

  const faceBase =
    "absolute inset-0 overflow-hidden rounded-[26px] border border-[rgba(241,225,148,0.08)] bg-[linear-gradient(180deg,rgba(18,8,10,0.92),rgba(7,3,5,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_24px_60px_rgba(0,0,0,0.28)] sm:rounded-[30px]";
  const faceLabel = "text-[10px] font-mono tracking-[0.28em] text-[rgba(241,225,148,0.5)] sm:text-[11px]";

  return (
    <div className="h-full w-full">
      <div
        ref={stageRef}
        onPointerDown={startDrag}
        className="relative h-full min-h-[280px] w-full overflow-hidden rounded-[32px] bg-transparent select-none sm:min-h-[520px] sm:rounded-[40px]"
        style={{
          cursor: disabled ? "default" : isDragging ? "grabbing" : "grab",
          touchAction: "none",
          overscrollBehavior: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        <div className="absolute inset-0 opacity-95" style={starfieldBackground} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(241,225,148,0.06),transparent_16%),radial-gradient(circle_at_50%_64%,rgba(91,14,20,0.26),transparent_40%)]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[76%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(91,14,20,0.26),transparent_68%)] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-[18%] bottom-[8%] h-24 rounded-full bg-[radial-gradient(circle,rgba(91,14,20,0.46),transparent_74%)] blur-[56px]" />

        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 sm:top-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(241,225,148,0.1)] bg-[rgba(8,4,5,0.62)] px-3 py-2 text-[10px] font-mono text-[rgba(255,245,220,0.86)] shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:px-4 sm:text-[11px]">
            <span className="text-[rgba(241,225,148,0.72)]">AZ</span>
            <span>{Math.round(semanticAz)}°</span>
            <span className="mx-1 h-3.5 w-px bg-[rgba(241,225,148,0.12)]" />
            <span className="text-[rgba(241,225,148,0.72)]">EL</span>
            <span>{Math.round(el)}°</span>
          </div>
        </div>

        <div
          data-role="zoom-slider"
          className="absolute left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-2.5 rounded-[22px] border border-[rgba(241,225,148,0.08)] bg-[rgba(8,4,5,0.54)] px-2.5 py-3 shadow-[0_24px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:left-5 sm:gap-3 sm:px-3 sm:py-4"
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
              height: cubeSize < 260 ? "132px" : "176px",
            }}
          />

          <div className="text-[10px] font-mono text-white/64 sm:text-[11px]">{zm.toFixed(1)}</div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center px-10 py-16 sm:px-16 sm:py-14">
          <div
            className="relative"
            style={{
              width: `${cubeSize}px`,
              height: `${cubeSize}px`,
              perspective: "1180px",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: cubeTransform,
                transformStyle: "preserve-3d",
                transition: isDragging ? "none" : "transform 120ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <div className={faceBase} style={{ transform: `rotateY(0deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_34%),radial-gradient(circle_at_50%_24%,rgba(241,225,148,0.08),transparent_36%)]" />

                {imageUrl ? (
                  <>
                    <div className="absolute inset-[6%] overflow-hidden rounded-[22px] border border-[rgba(241,225,148,0.08)] bg-[rgba(0,0,0,0.26)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                      <div className="flex h-full w-full items-center justify-center p-3 sm:p-4">
                        <img
                          src={imageUrl}
                          alt={referenceLabel || "Reference"}
                          className="h-full w-full object-contain object-center"
                          draggable={false}
                        />
                      </div>
                    </div>

                    {onOpenReferencePicker ? (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={onOpenReferencePicker}
                        className="absolute bottom-4 right-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(241,225,148,0.14)] bg-[rgba(8,4,5,0.78)] text-[rgba(255,245,220,0.9)] shadow-[0_18px_40px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:border-[rgba(241,225,148,0.24)] hover:bg-[rgba(16,7,9,0.9)]"
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
                  <div className="absolute inset-[7%] flex items-center justify-center">
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={onOpenReferencePicker}
                      className="group flex h-full w-full flex-col items-center justify-center gap-4 rounded-[24px] border border-dashed border-[rgba(241,225,148,0.16)] bg-[linear-gradient(180deg,rgba(17,8,10,0.88),rgba(7,3,5,0.96))] px-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition hover:border-[rgba(241,225,148,0.26)] hover:bg-[linear-gradient(180deg,rgba(22,10,12,0.92),rgba(9,4,6,0.98))]"
                    >
                      <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-[rgba(241,225,148,0.16)] bg-[rgba(241,225,148,0.08)] text-[rgba(241,225,148,0.92)] transition group-hover:scale-[1.03] group-hover:bg-[rgba(241,225,148,0.12)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[rgba(255,245,220,0.94)] sm:text-base">Cargar referencia</div>
                        <div className="mt-2 text-[10px] font-mono tracking-[0.22em] text-[rgba(241,225,148,0.54)] sm:text-[11px]">FRONT FACE</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <div className={faceBase} style={{ transform: `rotateY(-90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_34%),radial-gradient(circle_at_48%_30%,rgba(241,225,148,0.06),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>RIGHT</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateY(90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_34%),radial-gradient(circle_at_52%_30%,rgba(241,225,148,0.06),transparent_35%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>LEFT</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateY(180deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_34%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>BACK</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateX(90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_34%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>UP</div></div>
              </div>

              <div className={faceBase} style={{ transform: `rotateX(-90deg) translateZ(${cubeDepth}px)` }}>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_34%)]" />
                <div className="absolute inset-0 flex items-center justify-center"><div className={faceLabel}>DOWN</div></div>
              </div>
            </div>
          </div>
        </div>

        {referenceLabel ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 max-w-[min(72vw,360px)] -translate-x-1/2 truncate rounded-full border border-[rgba(241,225,148,0.08)] bg-[rgba(8,4,5,0.68)] px-4 py-2 text-[11px] text-white/70 shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:bottom-5">
            {referenceLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CameraAngleSimulator3D;
