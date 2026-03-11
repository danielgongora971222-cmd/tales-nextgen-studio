import React, { useEffect, useRef } from "react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import styles from "./Home.module.css";
import CommunityStore from "./CommunityStore";
import OneNationUpIcon from "../components/brand/OneNationUpIcon";

interface HomeProps {
  onNavigate: (route: AppRoute) => void;
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
  if (prefersReducedMotion) return () => {};

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

  const resize = () => {
    const w = btn.offsetWidth;
    const h = btn.offsetHeight;
    canvas.width = Math.max(1, Math.floor(w));
    canvas.height = Math.max(1, Math.floor(h));

    particles = [];
    const count = Math.max(14, Math.floor((canvas.width * canvas.height) / 4200));

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        baseRadius: Math.random() * 1.3 + 0.45,
        radius: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2,
      });
    }
  };

  const drawLines = () => {
    const isHovered = hoverRef.current;
    const mouse = mouseRef.current;
    const connectionDistance = isHovered ? 105 : 80;

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          ctx.beginPath();
          let opacity = 1 - dist / connectionDistance;
          opacity *= isHovered ? 0.6 : 0.22;
          ctx.strokeStyle = `rgba(${lineRgb}, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }

      if (isHovered) {
        const mdx = particles[i].x - mouse.x;
        const mdy = particles[i].y - mouse.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);

        if (mdist < 120) {
          ctx.beginPath();
          const mOpacity = 1 - mdist / 120;
          ctx.strokeStyle = particles[i].color;
          ctx.globalAlpha = mOpacity * 0.78;
          ctx.lineWidth = 1.35;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  };

  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const isHovered = hoverRef.current;
    const mouse = mouseRef.current;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      p.phase += 0.02;
      p.radius = p.baseRadius + Math.sin(p.phase) * 0.45;

      if (isHovered) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const interactionRadius = 96;

        if (dist > 0.001 && dist < interactionRadius) {
          const fx = dx / dist;
          const fy = dy / dist;
          const force = (interactionRadius - dist) / interactionRadius;
          p.vx += fx * force * 0.018;
          p.vy += fy * force * 0.018;

          const maxSpeed = 1.25;
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (sp > maxSpeed) {
            p.vx = (p.vx / sp) * maxSpeed;
            p.vy = (p.vy / sp) * maxSpeed;
          }

          p.radius = p.baseRadius + force * 1.2;
        }
      } else {
        p.vx *= 0.992;
        p.vy *= 0.992;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = isHovered ? 0.82 : 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawLines();
    raf = requestAnimationFrame(tick);
  };

  resize();
  raf = requestAnimationFrame(tick);

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
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

        <div
          ref={creatorBtnRef}
          className={`${styles.heroCard} ${styles.heroCardRefBase} ${styles.refHeroCard} ${styles.monoTheme}`}
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

          <div className={styles.refFront}>
            <div className={styles.refTextWrap}>
              <h2 className={styles.refKicker}>Your space</h2>
              <h1 className={styles.refTitle} title={user?.username || "Creator"}>
                <span className={styles.refGradientText}>{username}</span>
              </h1>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/74">
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">{credits} credits</span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">{activePlan}</span>
              </div>

              <div className="mt-3 flex items-center gap-2">
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
              </div>

              <div className={styles.refActionRow}>
                <span>Profile</span>
                <svg className={styles.refArrow} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.refBottomBorder} aria-hidden="true" />
        </div>

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
        <CommunityStore onNavigate={onNavigate} />
      </section>
    </div>
  );
}
