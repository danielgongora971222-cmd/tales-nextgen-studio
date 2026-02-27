import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppRoute, Asset, Comment } from '../types';
import { listPublicAssets } from '../services/assetsApi';
import { toggleLike, listComments, createComment } from '../services/socialApi';
import { useAuth } from '../contexts/AuthContext';
import styles from './Home.module.css';
import generatorStyles from './tools/ImageGeneratorTool.module.css';

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
          type="button"
          onClick={() => onNavigate(AppRoute.STORE)}
          className={`${styles.heroCard} ${styles.heroCardVideo}`}
        >
          <div className={styles.heroContent}>
            <span className={styles.heroEyebrow}>1NATIONUP STORE</span>
            <h2 className={styles.heroTitle}>1NationUp Store</h2>
            <p className={styles.heroCopy}>
              Be original—turn your own art into reality: decorate your home or gift something crafted millimeter by millimeter by you.
            </p>
            <span className={styles.heroCta}>Open 1NationUp Store</span>
          </div>
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
