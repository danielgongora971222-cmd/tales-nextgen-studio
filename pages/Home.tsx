import React, { Suspense, useEffect, useRef, useState } from "react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import styles from "./Home.module.css";
import OneNationUpIcon from "../components/brand/OneNationUpIcon";

const CommunityStore = React.lazy(() => import("./CommunityStore"));

interface HomeProps {
  onNavigate: (route: AppRoute) => void;
}

function CommunityStorePlaceholder() {
  return (
    <div className="rounded-[30px] border border-white/10 bg-black/35 p-5 text-white/60 shadow-[0_20px_48px_rgba(0,0,0,0.28)]">
      <div className="h-3 w-32 rounded-full bg-white/10" />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="aspect-[4/5] rounded-[22px] bg-white/[0.045]" />
        ))}
      </div>
    </div>
  );
}

function DeferredCommunityStore({ onNavigate }: HomeProps) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const holderRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (shouldLoad) return;

    let cancelled = false;
    let timeoutId = 0;
    let idleId: number | null = null;
    let observer: IntersectionObserver | null = null;

    const load = () => {
      if (!cancelled) setShouldLoad(true);
    };

    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout?: number }) => number)
      | undefined;
    const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;

    if ("IntersectionObserver" in window && holderRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            observer = null;
            load();
          }
        },
        { rootMargin: "720px 0px" }
      );
      observer.observe(holderRef.current);
    }

    if (requestIdle) {
      idleId = requestIdle(load, { timeout: 2600 });
    } else {
      timeoutId = window.setTimeout(load, 1400);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearTimeout(timeoutId);
      if (idleId != null && cancelIdle) cancelIdle(idleId);
    };
  }, [shouldLoad]);

  return (
    <section ref={holderRef}>
      {shouldLoad ? (
        <Suspense fallback={<CommunityStorePlaceholder />}>
          <CommunityStore onNavigate={onNavigate} />
        </Suspense>
      ) : (
        <CommunityStorePlaceholder />
      )}
    </section>
  );
}

type ConstellationEffectOptions = {
  btn: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  hoverRef: React.MutableRefObject<boolean>;
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  colors: string[];
  lineRgb: string;
};

function setupConstellationEffect(opts: ConstellationEffectOptions) {
  const { btn, canvas, hoverRef, mouseRef, colors, lineRgb } = opts;

  if (!btn || !canvas) return () => {};

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const canHover = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
  const smallScreen = window.matchMedia?.("(max-width: 767px)")?.matches;
  const shouldAnimate = Boolean(!prefersReducedMotion && canHover && !smallScreen);

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  let particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    baseRadius: number;
    radius: number;
    color: string;
    phase: number;
  }> = [];

  let raf = 0;
  let active = false;
  let destroyed = false;
  let dpr = 1;

  const resize = () => {
    const rect = btn.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width || btn.offsetWidth || 1));
    const h = Math.max(1, Math.floor(rect.height || btn.offsetHeight || 1));
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.25));

    const nextWidth = Math.floor(w * dpr);
    const nextHeight = Math.floor(h * dpr);

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    particles = [];
    const count = Math.max(10, Math.min(28, Math.floor((w * h) / 6500)));

    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.34,
        vy: (Math.random() - 0.5) * 0.34,
        baseRadius: Math.random() * 1.1 + 0.45,
        radius: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2,
      });
    }

    draw(false);
  };

  const drawLines = (interactive: boolean) => {
    const mouse = mouseRef.current;
    const connectionDistance = interactive ? 96 : 72;

    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          ctx.beginPath();
          let opacity = 1 - dist / connectionDistance;
          opacity *= interactive ? 0.48 : 0.16;
          ctx.strokeStyle = `rgba(${lineRgb}, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }

      if (interactive) {
        const mdx = particles[i].x - mouse.x;
        const mdy = particles[i].y - mouse.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);

        if (mdist < 110) {
          ctx.beginPath();
          const mOpacity = 1 - mdist / 110;
          ctx.strokeStyle = particles[i].color;
          ctx.globalAlpha = mOpacity * 0.62;
          ctx.lineWidth = 1.2;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  };

  const draw = (interactive: boolean) => {
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const mouse = mouseRef.current;

    for (const p of particles) {
      if (interactive) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > cssWidth) p.vx *= -1;
        if (p.y < 0 || p.y > cssHeight) p.vy *= -1;

        p.phase += 0.018;
        p.radius = p.baseRadius + Math.sin(p.phase) * 0.38;

        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const interactionRadius = 88;

        if (dist > 0.001 && dist < interactionRadius) {
          const fx = dx / dist;
          const fy = dy / dist;
          const force = (interactionRadius - dist) / interactionRadius;
          p.vx += fx * force * 0.012;
          p.vy += fy * force * 0.012;

          const maxSpeed = 0.9;
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (sp > maxSpeed) {
            p.vx = (p.vx / sp) * maxSpeed;
            p.vy = (p.vy / sp) * maxSpeed;
          }

          p.radius = p.baseRadius + force * 0.95;
        } else {
          p.vx *= 0.996;
          p.vy *= 0.996;
        }
      } else {
        p.radius = p.baseRadius;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = interactive ? 0.72 : 0.46;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawLines(interactive);
  };

  const stop = () => {
    active = false;
    hoverRef.current = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    draw(false);
  };

  const tick = () => {
    if (destroyed || !active || document.visibilityState === "hidden") {
      raf = 0;
      return;
    }

    draw(true);
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (!shouldAnimate || destroyed || document.visibilityState === "hidden") return;
    active = true;
    hoverRef.current = true;
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const onPointerMove = (event: PointerEvent) => {
    const rect = btn.getBoundingClientRect();
    mouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      stop();
    }
  };

  resize();

  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(btn);
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  if (shouldAnimate) {
    btn.addEventListener("pointerenter", start, { passive: true });
    btn.addEventListener("pointerleave", stop, { passive: true });
    btn.addEventListener("pointermove", onPointerMove, { passive: true });
    btn.addEventListener("focusin", start);
    btn.addEventListener("focusout", stop);
  }

  return () => {
    destroyed = true;
    stop();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
    btn.removeEventListener("pointerenter", start);
    btn.removeEventListener("pointerleave", stop);
    btn.removeEventListener("pointermove", onPointerMove);
    btn.removeEventListener("focusin", start);
    btn.removeEventListener("focusout", stop);
  };
}

function compactUsername(username?: string) {
  const raw = String(username || "Creator").trim() || "Creator";
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 12)}…`;
}

export default function Home({ onNavigate }: HomeProps) {
  const { user } = useAuth();
  const { wallet, subscription } = useWallet();

  const designsBtnRef = useRef<HTMLButtonElement | null>(null);
  const designsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const designsHoverRef = useRef(false);
  const designsMouseRef = useRef({ x: -1000, y: -1000 });

  const creatorBtnRef = useRef<HTMLDivElement | null>(null);
  const creatorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const creatorHoverRef = useRef(false);
  const creatorMouseRef = useRef({ x: -1000, y: -1000 });

  const oneNationBtnRef = useRef<HTMLButtonElement | null>(null);
  const oneNationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const oneNationHoverRef = useRef(false);
  const oneNationMouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    return setupConstellationEffect({
      btn: designsBtnRef.current,
      canvas: designsCanvasRef.current,
      hoverRef: designsHoverRef,
      mouseRef: designsMouseRef,
      colors: ["#FDE68A", "#DFB142", "#B45309", "#FFF2C2"],
      lineRgb: "255, 235, 170",
    });
  }, []);

  useEffect(() => {
    return setupConstellationEffect({
      btn: creatorBtnRef.current,
      canvas: creatorCanvasRef.current,
      hoverRef: creatorHoverRef,
      mouseRef: creatorMouseRef,
      colors: ["#FFFFFF", "#E5E7EB", "#9CA3AF", "#F9FAFB"],
      lineRgb: "255, 255, 255",
    });
  }, []);

  useEffect(() => {
    return setupConstellationEffect({
      btn: oneNationBtnRef.current,
      canvas: oneNationCanvasRef.current,
      hoverRef: oneNationHoverRef,
      mouseRef: oneNationMouseRef,
      colors: ["#7EAAED", "#DFB142", "#DE6C53", "#7D45A9"],
      lineRgb: "180, 200, 255",
    });
  }, []);

  const username = compactUsername(user?.username);
  const activePlan = subscription?.plan_name || "No plan";
  const credits = Number(wallet?.generationCredits ?? 0).toLocaleString();

  return (
    <div className="space-y-8 pb-4 md:space-y-10">
      <section className={styles.heroGrid}>
        <div
          ref={creatorBtnRef}
          className={`${styles.heroCard} ${styles.heroCardRefBase} ${styles.refHeroCard} ${styles.monoTheme} ${styles.heroCreatorCard}`}
          role="button"
          tabIndex={0}
          onClick={() => {
            window.localStorage.setItem("tales_profile_focus", "profile");
            onNavigate(AppRoute.PROFILE);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              window.localStorage.setItem("tales_profile_focus", "profile");
              onNavigate(AppRoute.PROFILE);
            }
          }}
          onMouseEnter={() => {
            creatorHoverRef.current = true;
          }}
          onMouseLeave={() => {
            creatorHoverRef.current = false;
            creatorMouseRef.current = { x: -1000, y: -1000 };
          }}
          onMouseMove={(event) => {
            const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
            creatorMouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          }}
        >
          <canvas ref={creatorCanvasRef} className={styles.refCanvas} />
          <div className={styles.refOverlay} aria-hidden="true" />
          <div className={styles.refLogoBadge} aria-hidden="true">
            <span className={styles.refLogoFallback}>C</span>
            <img
              src="/brands/creator-hub/logo.png"
              alt="Creator"
              className={styles.refLogo}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          <div className={`${styles.refFront} ${styles.creatorFront}`}>
            <div className={`${styles.refTextWrap} ${styles.creatorTextShell}`}>
              <div className={styles.creatorLayout}>
                <div className={styles.creatorIntro}>
                  <h2 className={styles.refKicker}>Your Space</h2>
                  <h1 className={styles.refTitle} title={user?.username || "Creator"}>
                    <span className={styles.refGradientText}>{username}</span>
                  </h1>
                </div>

                <div className={styles.creatorUtilityBlock}>
                  <div className={styles.creatorChipsRow}>
                    <span className={styles.creatorChip}>{credits} credits</span>
                    <span className={`${styles.creatorChip} ${styles.creatorChipMuted}`}>{activePlan}</span>
                  </div>

                  <div className={styles.creatorActionCluster}>
                    <button
                      type="button"
                      className={styles.heroCreditsButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        window.localStorage.setItem("tales_account_tab", "plans");
                        onNavigate(AppRoute.PAYWALL);
                      }}
                    >
                      Manage
                    </button>

                    <div className={`${styles.refActionRow} ${styles.creatorProfileLink}`}>
                      <span>Profile</span>
                      <svg className={styles.refArrow} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.refBottomBorder} aria-hidden="true" />
        </div>

        <button
          ref={designsBtnRef}
          type="button"
          onClick={() => onNavigate(AppRoute.IMAGE_GEN_ROOT)}
          className={`${styles.heroCard} ${styles.heroCardRefBase} ${styles.refHeroCard} ${styles.designsTheme}`}
          onMouseEnter={() => {
            designsHoverRef.current = true;
          }}
          onMouseLeave={() => {
            designsHoverRef.current = false;
            designsMouseRef.current = { x: -1000, y: -1000 };
          }}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            designsMouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          }}
        >
          <canvas ref={designsCanvasRef} className={styles.refCanvas} />
          <div className={styles.refOverlay} aria-hidden="true" />
          <div className={styles.refLogoBadge} aria-hidden="true">
            <span className={styles.refLogoFallback}>D</span>
            <img
              src="/brands/designs/logo.png"
              alt="Designs Studio"
              className={styles.refLogo}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          <div className={styles.refFront}>
            <div className={styles.refTextWrap}>
              <h2 className={styles.refKicker}>Crea con</h2>
              <h1 className={styles.refTitle}>
                <span className={styles.refGradientText}>Designs</span>
                <span className={styles.refTitleWhite}>Studio</span>
              </h1>
              <div className={styles.refActionRow}>
                <span>Open</span>
                <svg className={styles.refArrow} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.refBottomBorder} aria-hidden="true" />
        </button>

        <button
          ref={oneNationBtnRef}
          type="button"
          onClick={() => onNavigate(AppRoute.STORE)}
          className={`${styles.heroCard} ${styles.heroCardVideo} ${styles.oneNationHeroCard}`}
          onMouseEnter={() => {
            oneNationHoverRef.current = true;
          }}
          onMouseLeave={() => {
            oneNationHoverRef.current = false;
            oneNationMouseRef.current = { x: -1000, y: -1000 };
          }}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            oneNationMouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          }}
        >
          <canvas ref={oneNationCanvasRef} className={styles.oneNationCanvas} />
          <div className={styles.oneNationOverlay} aria-hidden="true" />
          <div className={styles.oneNationLogoBadge} aria-hidden="true">
            <OneNationUpIcon className={styles.oneNationLogo} alt="1NationUp" />
          </div>

          <div className={styles.oneNationFront}>
            <div className={styles.oneNationTextWrap}>
              <h2 className={styles.oneNationKicker}>Explore</h2>
              <h1 className={styles.oneNationTitle}>
                <span className={styles.oneNationGradientText}>1NationUp</span>
              </h1>
              <div className={styles.oneNationActionRow}>
                <span>Open</span>
                <svg className={styles.oneNationArrow} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.oneNationBottomBorder} aria-hidden="true" />
        </button>
      </section>

      <section>
        <DeferredCommunityStore onNavigate={onNavigate} />
      </section>
    </div>
  );
}
