import React, { useEffect, useMemo, useState } from 'react';
import { AppRoute, Asset } from '../types';
import { listPublicAssets } from '../services/assetsApi';
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
      // Public feed real desde tu backend (Supabase + URLs firmadas)
      const items = await listPublicAssets({ type: "image", limit: 60, fresh: true });

      // Nota: likes/comments todavía no están implementados en DB.
      // Para evitar bugs de UX, los dejamos como 0 hasta tener tablas/endpoints reales.
      const normalized = items.map((a) => ({
        ...a,
        likes: Array.isArray(a.likes) ? a.likes : [],
        comments: Array.isArray(a.comments) ? a.comments : [],
      }));

      setFeed(normalized);
    } catch {
      setFeed([]);
    }
  };

  const handleLike = async (_assetId: string) => {
    // Desactivado hasta implementar likes reales en DB (evita inconsistencias).
    return;
  };

  const handleComment = async (_assetId: string) => {
    // Desactivado hasta implementar comments reales en DB (evita inconsistencias).
    return;
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
          onClick={() => onNavigate(AppRoute.VIDEO_GEN)}
          className={`${styles.heroCard} ${styles.heroCardVideo}`}
        >
          <div className={styles.heroContent}>
            <span className={styles.heroEyebrow}>GENERAL VIDEO GENERATOR</span>
            <h2 className={styles.heroTitle}>Create Videos</h2>
            <p className={styles.heroCopy}>Produce motion-ready scenes with rich detail and cinematic pacing.</p>
            <span className={styles.heroCta}>Open Video Generator</span>
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
          {feed.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={`${generatorStyles.tile} ${styles.feedTile}`}
              onClick={() => setViewer(asset)}
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
                  {isUpscalerAsset(asset) ? 'UPSCALE' : (removeStylePresetBlock(asset.prompt || '') || asset.name || '—')}
                </span>
                <span className={styles.feedOwner}>by User_{asset.ownerId.slice(0,4)}</span>
              </div>

              <div className={styles.feedActions} onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => handleLike(asset.id)}
                  className={styles.feedActionButton}
                  disabled
                  title="Likes próximamente"
                >
                  <span className={styles.feedActionLabel}>
                    {user && asset.likes.includes(user.id) ? 'Liked' : 'Like'}
                  </span>
                  <span className={styles.feedActionCount}>{asset.likes.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewer(asset)}
                  className={styles.feedActionButton}
                >
                  <span className={styles.feedActionLabel}>Comments</span>
                  <span className={styles.feedActionCount}>{asset.comments.length}</span>
                </button>
              </div>
            </button>
          ))}

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
                  title="Likes próximamente"
                  disabled
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
                      <div className={styles.viewerSocialValue}>{viewer.likes.length}</div>
                    </div>
                    <div>
                      <div className={styles.viewerSocialLabel}>Comments</div>
                      <div className={styles.viewerSocialValue}>{viewer.comments.length}</div>
                    </div>
                  </div>

                  <div className={styles.viewerComments}>
                    {viewer.comments.map((comment) => (
                      <div key={comment.id} className={styles.viewerComment}>
                        <span className={styles.viewerCommentAuthor}>{comment.username}</span>
                        <span className={styles.viewerCommentText}>{comment.text}</span>
                      </div>
                    ))}
                  </div>

                  <div className={styles.viewerCommentInput}>
                    <input
                      type="text"
                      value={commentText[viewer.id] || ''}
                      onChange={(event) => setCommentText(prev => ({ ...prev, [viewer.id]: event.target.value }))}
                      placeholder="Comments próximamente…"
                      className={styles.viewerCommentField}
                      disabled
                    />
                    <button
                      type="button"
                      onClick={() => handleComment(viewer.id)}
                      disabled
                      className={styles.viewerCommentButton}
                      title="Comments próximamente"
                    >
                      Post
                    </button>
                  </div>
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
