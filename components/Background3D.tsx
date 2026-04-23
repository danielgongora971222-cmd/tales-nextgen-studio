import React, { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  baseOpacity: number;
  speed: number;
  twinkleSpeed: number;
  twinkleDir: number;
}

function getLowPowerMode() {
  if (typeof window === "undefined") return true;

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const coarsePointer = window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches;
  const smallScreen = window.matchMedia?.("(max-width: 767px)")?.matches;
  const lowCoreDevice = typeof navigator !== "undefined" && Number(navigator.hardwareConcurrency || 8) <= 4;

  return Boolean(reducedMotion || coarsePointer || smallScreen || lowCoreDevice);
}

const Background3D: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const smoothMouseRef = useRef({ x: -9999, y: -9999 });
  const starsRef = useRef<Star[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const lowPowerMode = getLowPowerMode();
    const targetFps = lowPowerMode ? 0 : 24;
    const frameBudget = targetFps > 0 ? 1000 / targetFps : Number.POSITIVE_INFINITY;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let rafId = 0;
    let resizeTimer = 0;
    let destroyed = false;
    let running = false;
    let lastFrame = 0;
    let time = 0;
    let forwardSpeed = 0;
    let canvasRect = canvas.getBoundingClientRect();

    const initStars = () => {
      const density = lowPowerMode ? 12000 : 8500;
      const maxStars = lowPowerMode ? 70 : 220;
      const minStars = lowPowerMode ? 24 : 56;
      const starCount = Math.max(minStars, Math.min(maxStars, Math.floor((width * height) / density)));
      const nextStars: Star[] = [];

      for (let i = 0; i < starCount; i += 1) {
        const baseOpacity = Math.random() * 0.52 + 0.12;
        nextStars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: Math.random() * 1.1 + 0.18,
          opacity: baseOpacity,
          baseOpacity,
          speed: Math.random() * 0.035 + 0.008,
          twinkleSpeed: Math.random() * 0.006 + 0.0015,
          twinkleDir: Math.random() > 0.5 ? 1 : -1,
        });
      }

      starsRef.current = nextStars;
    };

    const resize = () => {
      canvasRect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(canvasRect.width || window.innerWidth));
      height = Math.max(1, Math.floor(canvasRect.height || window.innerHeight));
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, lowPowerMode ? 1 : 1.25));

      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initStars();
      drawFrame(performance.now(), true);
    };

    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 140);
    };

    const handlePointerMove = (event: PointerEvent) => {
      mouseRef.current = {
        x: event.clientX - canvasRect.left,
        y: event.clientY - canvasRect.top,
      };
    };

    const handlePointerLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    const noise = (x: number, y: number, t: number) => {
      return Math.sin(x * 0.004 + t) * Math.cos(y * 0.004 + t * 0.5) * (lowPowerMode ? 3.5 : 6.5);
    };

    function drawFrame(timestamp: number, staticFrame = false) {
      const animate = !staticFrame && !lowPowerMode;
      const gridSize = lowPowerMode ? 72 : 58;
      const horizon = height * 0.36;
      const influenceRadius = lowPowerMode ? 0 : 150;

      ctx.fillStyle = "#020202";
      ctx.fillRect(0, 0, width, height);

      if (animate) {
        time += 0.006;
        forwardSpeed = (forwardSpeed + 0.12) % gridSize;
      }

      const targetMouse = mouseRef.current;
      smoothMouseRef.current.x += (targetMouse.x - smoothMouseRef.current.x) * 0.045;
      smoothMouseRef.current.y += (targetMouse.y - smoothMouseRef.current.y) * 0.045;

      const nebX = Math.sin(time * 0.25) * 34 + width / 2;
      const nebY = Math.cos(time * 0.18) * 18 + height / 2;
      const nebulaGrad = ctx.createRadialGradient(nebX, nebY, 0, width / 2, height / 2, width * 0.86);
      nebulaGrad.addColorStop(0, "rgba(42, 42, 52, 0.018)");
      nebulaGrad.addColorStop(0.62, "rgba(10, 10, 15, 0.005)");
      nebulaGrad.addColorStop(1, "transparent");
      ctx.fillStyle = nebulaGrad;
      ctx.fillRect(0, 0, width, height);

      for (const star of starsRef.current) {
        if (animate) {
          star.y -= star.speed;
          if (star.y < 0) {
            star.y = height;
            star.x = Math.random() * width;
          }

          star.opacity += star.twinkleSpeed * star.twinkleDir;
          if (star.opacity > star.baseOpacity + 0.08 || star.opacity < star.baseOpacity - 0.08) {
            star.twinkleDir *= -1;
          }
        }

        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, star.opacity)})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      const mx = smoothMouseRef.current.x;
      const my = smoothMouseRef.current.y;
      const isMouseActive = animate && mouseRef.current.x > -100;

      const transformPoint = (worldX: number, worldY: number) => {
        const perspective = (worldY - horizon) / Math.max(1, height - horizon);
        if (perspective <= 0) return null;

        const zScale = Math.pow(perspective, 0.9);
        let sx = width / 2 + (worldX - width / 2) * zScale;
        let sy = worldY;

        sx += noise(worldY, worldX, time * 0.78) * perspective * 0.24;
        sy += noise(worldX, worldY, time) * perspective;

        if (isMouseActive) {
          const distX = sx - mx;
          const distY = sy - my;
          const dist = Math.sqrt(distX * distX + distY * distY);

          if (dist < influenceRadius) {
            const force = 1 - dist / influenceRadius;
            const ease = force * force;
            sx += distX * ease * 0.055;
            sy += distY * ease * 0.055 - 11 * ease;
          }
        }

        return { x: sx, y: sy };
      };

      ctx.lineWidth = 1;

      const verticalColumns = Math.ceil(width / gridSize) + 4;
      const verticalStepY = lowPowerMode ? 34 : 24;
      for (let i = -4; i <= verticalColumns; i += 1) {
        const worldX = i * gridSize * 2.8 - width * 0.36;
        let started = false;
        let maxDistortion = 0;

        ctx.beginPath();
        for (let y = horizon; y < height; y += verticalStepY) {
          const p = transformPoint(worldX + width / 2, y);
          if (!p) continue;

          if (isMouseActive) {
            const d = Math.hypot(p.x - mx, p.y - my);
            if (d < influenceRadius) maxDistortion = Math.max(maxDistortion, 1 - d / influenceRadius);
          }

          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 + maxDistortion * 0.13})`;
        ctx.stroke();
      }

      const horizontalLines = lowPowerMode ? 13 : 20;
      const horizontalStepX = lowPowerMode ? 58 : 40;
      for (let j = 0; j < horizontalLines; j += 1) {
        const logicZ = j * gridSize - forwardSpeed;
        const progress = (logicZ + gridSize) / Math.max(1, horizontalLines * gridSize);
        if (progress <= 0 || progress >= 1) continue;

        const screenY = horizon + Math.pow(progress, 2.18) * (height - horizon);
        let started = false;
        let maxDistortion = 0;

        ctx.beginPath();
        for (let x = 0; x <= width; x += horizontalStepX) {
          const p = transformPoint(x, screenY);
          if (!p) continue;

          if (isMouseActive) {
            const d = Math.hypot(p.x - mx, p.y - my);
            if (d < influenceRadius) maxDistortion = Math.max(maxDistortion, 1 - d / influenceRadius);
          }

          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }

        ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, progress * 0.11 + maxDistortion * 0.2)})`;
        ctx.stroke();
      }
    }

    const stop = () => {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const loop = (timestamp: number) => {
      if (destroyed || document.visibilityState === "hidden") {
        stop();
        return;
      }

      if (!lastFrame || timestamp - lastFrame >= frameBudget) {
        drawFrame(timestamp);
        lastFrame = timestamp;
      }

      rafId = requestAnimationFrame(loop);
    };

    const start = () => {
      if (lowPowerMode || running || destroyed || document.visibilityState === "hidden") return;
      running = true;
      lastFrame = 0;
      rafId = requestAnimationFrame(loop);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }

      drawFrame(performance.now(), true);
      start();
    };

    resize();
    start();

    window.addEventListener("resize", scheduleResize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    if (!lowPowerMode) {
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerleave", handlePointerLeave, { passive: true });
      window.addEventListener("blur", handlePointerLeave);
    }

    return () => {
      destroyed = true;
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", scheduleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full opacity-60" aria-hidden="true" />;
};

export default Background3D;
