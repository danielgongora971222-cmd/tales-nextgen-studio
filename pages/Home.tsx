import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppRoute, Asset, Comment } from '../types';
import { listPublicAssets } from '../services/assetsApi';
import { toggleLike, listComments, createComment } from '../services/socialApi';
import { useAuth } from '../contexts/AuthContext';
import styles from './Home.module.css';
import generatorStyles from './tools/ImageGeneratorTool.module.css';
import OneNationUpIcon from "@/components/brand/OneNationUpIcon";
import CommunityStore from './CommunityStore';

interface HomeProps {
  onNavigate: (route: AppRoute) => void;
}

const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [feed, setFeed] = useState<Asset[]>([]);
  const [commentText, setCommentText] = useState<{[key:string]: string}>({}); // Map assetId -> text
  const [viewer, setViewer] = useState<Asset | null>(null);

  const [viewerComments, setViewerComments] = useState<Comment[]>([]);
  const [viewerLoadingComments, setViewerLoadingComments] = useState<boolean>(false);

  // ===============================
  // Anti-spam / Anti-abuso (Frontend)
  // ===============================
  const LIKE_COOLDOWN_MS = 650;      // evita spam de like/unlike
  const COMMENT_COOLDOWN_MS = 2000;  // 1 comment cada 2s por asset (frontend)

  const [likeBusy, setLikeBusy] = useState<Record<string, boolean>>({});
  const [likeCooldownUntil, setLikeCooldownUntil] = useState<Record<string, number>>({});

  const [commentBusy, setCommentBusy] = useState<Record<string, boolean>>({});
  const [commentCooldownUntil, setCommentCooldownUntil] = useState<Record<string, number>>({});

  const [socialNotice, setSocialNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const pushNotice = (msg: string) => {
    setSocialNotice(msg);

    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }

    noticeTimerRef.current = window.setTimeout(() => {
      setSocialNotice(null);
      noticeTimerRef.current = null;
    }, 2500);
  };

  const oneNationBtnRef = useRef<HTMLButtonElement | null>(null);
  const oneNationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const oneNationHoverRef = useRef<boolean>(false);
  const oneNationMouseRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 });

  const validateComment = (raw: string) => {
    const text = (raw || "").trim();

    if (!text) return { ok: false as const, reason: "El comentario está vacío." };
    if (text.length > 500) return { ok: false as const, reason: "Máximo 500 caracteres." };

    // Bloqueo básico de links (spam típico)
    const lower = text.toLowerCase();
    if (lower.includes("http://") || lower.includes("https://") || lower.includes("www.")) {
      return { ok: false as const, reason: "Links no permitidos por seguridad (anti-spam)." };
    }

    // Bloqueo básico de flood (mismo char repetido muchas veces)
    if (/(\S)\1{10,}/.test(text)) {
      return { ok: false as const, reason: "Texto inválido (flood detectado)." };
    }

    return { ok: true as const, text };
  };

  function escapeRegExp(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function removeStylePresetBlock(input: string) {
    let out = input;
    const pairs = [
      { start: '[[STYLE_PRESET_START]]', end: '[[STYLE_PRESET_END]]' },
      { start: '/* STYLE_PRESET_START */', end: '/* STYLE_PRESET_END */' },

      // Lightroom hidden lighting block
      { start: '[[LIGHTING_PRESET_START]]', end: '[[LIGHTING_PRESET_END]]' },

      // Upscaler hidden master block
      { start: '[[UPSCALE_MASTER_START]]', end: '[[UPSCALE_MASTER_END]]' }
    ];

    for (const { start, end } of pairs) {
      const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, 'g');
      out = out.replace(re, '');
    }
    return out.trim();
  }

  function isUpscalerAsset(asset: Asset) {
    const meta = (asset as any)?.meta || {};
    return typeof meta.tool === 'string' && meta.tool === 'upscaler';
  }

  function prettyModelLabel(modelId: string | null) {
    if (!modelId) return 'Unknown';
    return modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

    useEffect(() => {
    const btn = oneNationBtnRef.current;
    const canvas = oneNationCanvasRef.current;
    if (!btn || !canvas) return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = ['#7EAAED', '#DFB142', '#DE6C53', '#7D45A9']; // exactamente como el TXT :contentReference[oaicite:5]{index=5}
    let particles: Array<{
      x: number; y: number;
      vx: number; vy: number;
      baseRadius: number; radius: number;
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
      const count = Math.max(18, Math.floor((canvas.width * canvas.height) / 4000)); // similar al TXT :contentReference[oaicite:6]{index=6}
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          baseRadius: Math.random() * 1.5 + 0.5,
          radius: 1,
          color: colors[Math.floor(Math.random() * colors.length)],
          phase: Math.random() * Math.PI * 2
        });
      }
    };

    const drawLines = () => {
      const isHovered = oneNationHoverRef.current;
      const mouse = oneNationMouseRef.current;
      const connectionDistance = isHovered ? 110 : 80;

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < connectionDistance) {
            ctx.beginPath();
            let opacity = 1 - (dist / connectionDistance);
            opacity *= isHovered ? 0.6 : 0.2;
            ctx.strokeStyle = `rgba(180, 200, 255, ${opacity})`;
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
            const mOpacity = 1 - (mdist / 120);
            ctx.strokeStyle = particles[i].color;
            ctx.globalAlpha = mOpacity * 0.8;
            ctx.lineWidth = 1.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        }
      }
    };

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isHovered = oneNationHoverRef.current;
      const mouse = oneNationMouseRef.current;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        p.phase += 0.02;
        p.radius = p.baseRadius + Math.sin(p.phase) * 0.5;

        if (isHovered) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const interactionRadius = 100;

          if (dist > 0.001 && dist < interactionRadius) {
            const fx = dx / dist;
            const fy = dy / dist;
            const force = (interactionRadius - dist) / interactionRadius;

            p.vx += fx * force * 0.02;
            p.vy += fy * force * 0.02;

            const maxSpeed = 1.5;
            const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (sp > maxSpeed) {
              p.vx = (p.vx / sp) * maxSpeed;
              p.vy = (p.vy / sp) * maxSpeed;
            }

            p.radius = p.baseRadius + (force * 1.5);
          }
        } else {
          p.vx *= 0.99;
          p.vy *= 0.99;
          if (Math.abs(p.vx) < 0.1) p.vx += (Math.random() - 0.5) * 0.05;
          if (Math.abs(p.vy) < 0.1) p.vy += (Math.random() - 0.5) * 0.05;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = isHovered ? 0.8 : 0.5;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      drawLines();
      raf = requestAnimationFrame(tick);
    };

    const onResize = () => resize();

    resize();
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    loadFeed();
  }, []);

  const loadFeed = async () => {
    try {
      const items = await listPublicAssets({ type: "image", limit: 60, fresh: true });
      setFeed(items);
    } catch {
      setFeed([]);
    }
  };

  const handleLike = async (assetId: string) => {
    if (!user) {
      pushNotice("Debes iniciar sesión para dar Like.");
      return;
    }

    const now = Date.now();
    const cooldownUntil = likeCooldownUntil[assetId] || 0;
    if (likeBusy[assetId]) return;

    if (cooldownUntil > now) {
      pushNotice("Espera un momento antes de volver a dar Like.");
      return;
    }

    // Bloqueo inmediato (evita doble click / spam)
    setLikeBusy((prev) => ({ ...prev, [assetId]: true }));
    setLikeCooldownUntil((prev) => ({ ...prev, [assetId]: now + LIKE_COOLDOWN_MS }));

    try {
      const { liked, likesCount } = await toggleLike(assetId);

      setFeed((prev) =>
        prev.map((a) =>
          a.id === assetId
            ? {
                ...a,
                likedByMe: liked,
                likesCount,
                likes: liked ? [user.id] : [],
              }
            : a
        )
      );

      setViewer((prev) =>
        prev && prev.id === assetId
          ? {
              ...prev,
              likedByMe: liked,
              likesCount,
              likes: liked ? [user.id] : [],
            }
          : prev
      );
    } catch {
      pushNotice("No se pudo dar Like. Intenta de nuevo.");
      return;
    } finally {
      setLikeBusy((prev) => ({ ...prev, [assetId]: false }));
    }
  };

  const handleComment = async (assetId: string) => {
    if (!user) {
      pushNotice("Debes iniciar sesión para comentar.");
      return;
    }

    const now = Date.now();
    const cooldownUntil = commentCooldownUntil[assetId] || 0;
    if (commentBusy[assetId]) return;

    if (cooldownUntil > now) {
      pushNotice("Cooldown: espera 2 segundos antes de comentar de nuevo.");
      return;
    }

    const raw = commentText[assetId] || "";
    const validated = validateComment(raw);
    if (!validated.ok) {
      pushNotice(validated.reason);
      return;
    }

    // Bloqueo inmediato (evita doble click / spam)
    setCommentBusy((prev) => ({ ...prev, [assetId]: true }));
    setCommentCooldownUntil((prev) => ({ ...prev, [assetId]: now + COMMENT_COOLDOWN_MS }));

    try {
      const { comment, commentsCount } = await createComment(assetId, validated.text);

      setCommentText((prev) => ({ ...prev, [assetId]: "" }));

      setViewerComments((prev) => [...prev, comment]);

      setFeed((prev) =>
        prev.map((a) => (a.id === assetId ? { ...a, commentsCount } : a))
      );

      setViewer((prev) =>
        prev && prev.id === assetId ? { ...prev, commentsCount } : prev
      );
    } catch {
      pushNotice("No se pudo comentar. Intenta de nuevo.");
      return;
    } finally {
      setCommentBusy((prev) => ({ ...prev, [assetId]: false }));
    }
  };

    const openViewer = async (asset: Asset) => {
    setViewer(asset);
    setViewerComments([]);
    setViewerLoadingComments(true);

    try {
      const { comments, commentsCount } = await listComments(asset.id, { limit: 80, offset: 0 });

      setViewerComments(comments);

      setFeed((prev) =>
        prev.map((a) => (a.id === asset.id ? { ...a, commentsCount } : a))
      );

      setViewer((prev) =>
        prev && prev.id === asset.id ? { ...prev, commentsCount } : prev
      );
    } catch {
      setViewerComments([]);
    } finally {
      setViewerLoadingComments(false);
    }
  };

  const viewerRecipeInfo = useMemo(() => {
    if (!viewer) return null;
    const meta = (viewer as any).meta || {};
    const modelId = typeof meta.model === 'string' ? meta.model : null;
    const aspectRatio = typeof meta.aspectRatio === 'string' ? meta.aspectRatio : null;
    const quality = typeof meta.quality === 'string' ? meta.quality : null;
    const count =
      typeof meta.count === 'number'
        ? meta.count
        : typeof meta.count === 'string'
          ? parseInt(meta.count, 10)
          : null;

    return {
      modelId,
      aspectRatio,
      quality,
      count,
      styleName: removeStylePresetBlock(viewer.prompt || '') ? 'Custom' : 'None'
    };
  }, [viewer]);

  return (
    <div className="space-y-12 pb-20">
      {/* Hero Section */}
      <section className={styles.heroGrid}>
        <button
          type="button"
          onClick={() => onNavigate(AppRoute.TOOL_GENERATOR)}
          className={`${styles.heroCard} ${styles.heroCardImage}`}
        >
          <div className={styles.heroContent}>
            <span className={styles.heroEyebrow}>GENERAL IMAGE GENERATOR</span>
            <h2 className={styles.heroTitle}>Create Images</h2>
            <p className={styles.heroCopy}>Launch your next visual with cinematic presets and community-ready output.</p>
            <span className={styles.heroCta}>Open Image Generator</span>
          </div>
        </button>

        <button
          ref={oneNationBtnRef}
          type="button"
          onClick={() => onNavigate(AppRoute.STORE)}
          className={`${styles.heroCard} ${styles.heroCardVideo} ${styles.oneNationHeroCard}`}
          onMouseEnter={() => { oneNationHoverRef.current = true; }}
          onMouseLeave={() => {
            oneNationHoverRef.current = false;
            oneNationMouseRef.current = { x: -1000, y: -1000 };
          }}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
            oneNationMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          }}
        >
          {/* Canvas constelaciones/ADN tecnológico (igual al TXT) */}
          <canvas ref={oneNationCanvasRef} className={styles.oneNationCanvas} />

          {/* Overlay para legibilidad (igual al TXT) */}
          <div className={styles.oneNationOverlay} aria-hidden="true" />

          {/* Logo fijo en esquina superior izquierda */}
          <div className={styles.oneNationLogoBadge} aria-hidden="true">
            <img
              src="/brands/1nation-up/logo.png"
              alt="1NationUp Logo"
              className={styles.oneNationLogo}
              loading="lazy"
              decoding="async"
            />
          </div>

          {/* Contenido frontal (solo texto, 100% responsive) */}
          <div className={styles.oneNationFront}>
            <div className={styles.oneNationTextWrap}>
              <h2 className={styles.oneNationKicker}>Explora la</h2>

              <h1 className={styles.oneNationTitle}>
                <span className={styles.oneNationGradientText}>1NationUp</span>
                <span className={styles.oneNationTitleWhite}>Store</span>
              </h1>

              <div className={styles.oneNationActionRow}>
                <span>Acceder a la tienda</span>
                <svg className={styles.oneNationArrow} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Borde brillante inferior (igual al TXT) */}
          <div className={styles.oneNationBottomBorder} aria-hidden="true" />
        </button>

        <div className={`${styles.heroCard} ${styles.heroCardCredits}`}>
          <div className={styles.heroContent}>
            <span className={styles.heroEyebrow}>WELCOME</span>
            <h2 className={styles.heroTitle}>{user?.username || 'Creator'}</h2>
            <p className={styles.heroCopy}>Track your available credits and upgrade when you need more power.</p>
            <div className={styles.heroCreditsRow}>
              <div>
                <div className={styles.heroCreditsLabel}>Credits</div>
                <div className={styles.heroCreditsValue}>0</div>
              </div>
              <button type="button" className={styles.heroCreditsButton}>
                Get More Credits
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Community Feed */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Community Feed <span className="text-xs bg-white/10 px-2 py-1 rounded-full text-gray-400 font-normal">LIVE</span>
          </h2>
        </div>
        
        <div className={`${generatorStyles.grid} ${styles.feedGrid}`}>
          {feed.map((asset) => {
            const likeDisabled =
              !user ||
              Boolean(likeBusy[asset.id]) ||
              (likeCooldownUntil[asset.id] || 0) > Date.now();

            return (
              <div
                key={asset.id}
                role="button"
                tabIndex={0}
                onClick={() => openViewer(asset)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openViewer(asset);
                  }
                }}
                className={`${generatorStyles.tile} ${styles.feedTile}`}
              >
                <img
                  src={asset.url}
                  alt={asset.name}
                  className={`${generatorStyles.tileImg} ${styles.feedImage}`}
                  loading="lazy"
                  decoding="async"
                />

                <div className={generatorStyles.tileMeta}>
                  <span className={generatorStyles.tileCaption}>
                    {isUpscalerAsset(asset)
                      ? "UPSCALE"
                      : (removeStylePresetBlock(asset.prompt || "") || asset.name || "—")}
                  </span>
                  <span className={styles.feedOwner}>by User_{asset.ownerId.slice(0, 4)}</span>
                </div>

                <div className={styles.feedActions} onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleLike(asset.id)}
                    className={styles.feedActionButton}
                    disabled={likeDisabled}
                    title={!user ? "Inicia sesión" : (likeDisabled ? "Cooldown anti-spam" : "Like")}
                  >
                    <span className={styles.feedActionLabel}>
                      {asset.likedByMe ? "Liked" : "Like"}
                    </span>
                    <span className={styles.feedActionCount}>{asset.likesCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openViewer(asset)}
                    className={styles.feedActionButton}
                    title="Ver comentarios"
                  >
                    <span className={styles.feedActionLabel}>Comments</span>
                    <span className={styles.feedActionCount}>{asset.commentsCount}</span>
                  </button>
                </div>
              </div>
            );
          })}

          {feed.length === 0 && (
              <div className="col-span-full py-20 text-center text-gray-500">
                  <p>No public generations yet. Be the first to publish!</p>
              </div>
          )}
        </div>
      </section>

      {viewer && (
        <div className={generatorStyles.viewerBackdrop} onClick={() => setViewer(null)}>
          <div className={generatorStyles.viewer} onClick={(event) => event.stopPropagation()}>
            <div className={generatorStyles.viewerTop}>
              <div className={generatorStyles.viewerTitle}>
                <span className={generatorStyles.viewerKicker}>COMMUNITY</span>
                <span className={generatorStyles.viewerSub}>PUBLIC</span>
              </div>
              <div className={generatorStyles.viewerTopActions}>
                <button
                  type="button"
                  className={generatorStyles.iconBtn}
                  onClick={() => handleLike(viewer.id)}
                  title={!user ? "Inicia sesión" : "Like"}
                  disabled={
                    !user ||
                    Boolean(likeBusy[viewer.id]) ||
                    (likeCooldownUntil[viewer.id] || 0) > Date.now()
                  }
                >
                  ❤
                </button>
                <button type="button" className={generatorStyles.closeBtn} onClick={() => setViewer(null)} title="Cerrar">
                  ✕
                </button>
              </div>
            </div>

            <div className={generatorStyles.viewerBody}>
              <div className={generatorStyles.viewerImageWrap}>
                <img className={generatorStyles.viewerImage} src={viewer.url} alt={viewer.name} />
              </div>

              <div className={generatorStyles.viewerRecipe}>
                <div className={generatorStyles.viewerRecipeTitle}>RECIPE</div>
                <div className={generatorStyles.recipeGrid}>
                  <div className={generatorStyles.recipeItem}>
                    <div className={generatorStyles.recipeLabel}>Model</div>
                    <div className={generatorStyles.recipeValue}>
                      {prettyModelLabel(viewerRecipeInfo?.modelId || null)}
                    </div>
                  </div>
                  <div className={generatorStyles.recipeItem}>
                    <div className={generatorStyles.recipeLabel}>Aspect</div>
                    <div className={generatorStyles.recipeValue}>{viewerRecipeInfo?.aspectRatio || '—'}</div>
                  </div>
                  <div className={generatorStyles.recipeItem}>
                    <div className={generatorStyles.recipeLabel}>Quality</div>
                    <div className={generatorStyles.recipeValue}>{viewerRecipeInfo?.quality || '—'}</div>
                  </div>
                  <div className={generatorStyles.recipeItem}>
                    <div className={generatorStyles.recipeLabel}>Count</div>
                    <div className={generatorStyles.recipeValue}>
                      {viewerRecipeInfo?.count != null ? String(viewerRecipeInfo.count) : '—'}
                    </div>
                  </div>
                  <div className={generatorStyles.recipeItemWide}>
                    <div className={generatorStyles.recipeLabel}>Style</div>
                    <div className={generatorStyles.recipeValue}>{viewerRecipeInfo?.styleName || 'None'}</div>
                  </div>
                </div>

                <div className={generatorStyles.recipeBlock}>
                  <div className={generatorStyles.recipeLabel}>Prompt</div>
                  <div className={generatorStyles.recipeValue}>
                    {isUpscalerAsset(viewer) ? 'Hidden' : (removeStylePresetBlock(viewer.prompt || '') || '—')}
                  </div>
                </div>

                <div className={styles.viewerSocial}>
                  <div className={styles.viewerSocialHeader}>
                    <div>
                      <div className={styles.viewerSocialLabel}>Likes</div>
                      <div className={styles.viewerSocialValue}>{viewer.likesCount}</div>
                    </div>
                    <div>
                      <div className={styles.viewerSocialLabel}>Comments</div>
                      <div className={styles.viewerSocialValue}>{viewer.commentsCount}</div>
                    </div>
                  </div>

                  <div className={styles.viewerComments}>
                    {viewerLoadingComments ? (
                      <div className={styles.viewerComment}>
                        <span className={styles.viewerCommentAuthor}>Loading…</span>
                        <span className={styles.viewerCommentText}>Fetching comments</span>
                      </div>
                    ) : (
                      viewerComments.map((comment) => (
                        <div key={comment.id} className={styles.viewerComment}>
                          <span className={styles.viewerCommentAuthor}>{comment.username}</span>
                          <span className={styles.viewerCommentText}>{comment.text}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className={styles.viewerCommentInput}>
                    <input
                      type="text"
                      value={commentText[viewer.id] || ''}
                      onChange={(event) =>
                        setCommentText((prev) => ({
                          ...prev,
                          [viewer.id]: event.target.value.slice(0, 500),
                        }))
                      }
                      placeholder="Leave a thought..."
                      className={styles.viewerCommentField}
                      maxLength={500}
                    />
                      <button
                        type="button"
                        onClick={() => handleComment(viewer.id)}
                        disabled={
                          !user ||
                          Boolean(commentBusy[viewer.id]) ||
                          (commentCooldownUntil[viewer.id] || 0) > Date.now() ||
                          !commentText[viewer.id]?.trim()
                        }
                        className={styles.viewerCommentButton}
                        title={!user ? "Inicia sesión" : "Anti-spam activado"}
                      >
                        Post
                      </button>
                  </div>
                  {socialNotice && (
                    <div className={styles.socialNotice}>{socialNotice}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
