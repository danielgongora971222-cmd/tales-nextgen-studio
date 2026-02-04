import React, { useEffect, useMemo, useRef, useState } from "react";
import { generateImageBatch } from "../../services/geminiService";
import { listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { Asset, GeminiModel } from "../../types";
import ErrorModal from "../../components/ErrorModal";
import styles from "./ImageGeneratorTool.module.css";

type StylePreset = {
  id: string;
  name: string;
  prompt: string;
  coverUrl?: string;
  exampleUrls?: [string, string, string, string];
};

const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";
const LEGACY_STYLE_PRESET_BLOCK_START = "/* STYLE_PRESET_START */";
const LEGACY_STYLE_PRESET_BLOCK_END = "/* STYLE_PRESET_END */";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeStylePresetBlock(input: string) {
  let out = input;
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, "g");
    out = out.replace(re, "");
  }
  return out.trim();
}

function applyStylePresetToPrompt(input: string, presetPrompt: string) {
  const base = removeStylePresetBlock(input).trim();
  const block = `${STYLE_PRESET_BLOCK_START}\n${presetPrompt}\n${STYLE_PRESET_BLOCK_END}\n\n`;
  return `${block}${base}`.trim();
}

const STYLE_PRESETS: StylePreset[] = [
  {
    id: "live_action",
    name: "Live Action",
    coverUrl: "/style-presets/LiveAction/cover.png",
    exampleUrls: [
      "/style-presets/LiveAction/1.png",
      "/style-presets/LiveAction/2.jpeg",
      "/style-presets/LiveAction/3.png",
      "/style-presets/LiveAction/4.jpeg",
    ],
    prompt: `
STYLE: Apply photorealistic materials and cinematic lighting to the provided image using TEXTURE AND MATERIAL
TRANSLATION ONLY.

ABSOLUTE PRESERVATION RULE:
Preserve the original image EXACTLY as-is in design and identity. This is a material/lighting pass only.
Do not reinterpret any described traits from the text prompt. Do not reinterpret any traits shown in reference images.
Even if features are stylized, non-realistic, simplified or exaggerated, they must remain EXACTLY the same.

PRESERVE ORIGINAL CHARACTERS EXACTLY (LOCKED DESIGN):
- identical facial structure and proportions
- identical head shape and stylized geometry
- identical mouth shape and facial expressions
- identical silhouette, body proportions, and overall character identity
- identical hairstyle shape, hairline, hair volume and hair design (only add strand-level texture without changing the shape)
- identical clothing design, seams, patterns, logos, symbols, text, graphics, jewelry, accessories, props (do NOT alter, replace, add, or remove anything)

EYES AND FACIAL EXPRESSIONS ARE ABSOLUTELY LOCKED (HIGHEST PRIORITY):
- do not change eye size, eye shape, iris size, pupil size or eye spacing
- do not add shine, emotion, intensity, wetness, sparkle, reflections or realism to the eyes
- do not modify eyelids, eyebrows, lashes, or facial muscle tension
- do not change gaze direction, head tilt, micro-expression, or “mood”
- eyes and expressions must remain pixel-identical in pose and emotion to the original image
Facial expressions are the HIGHEST PRIORITY and must remain completely unchanged.

FACE PROTECTION (NO BEAUTIFICATION / NO REPAIR):
Do NOT reinterpret, redesign, enhance, beautify, “improve”, or “fix” faces.
Do NOT correct anatomy or add realism to facial features.
Do NOT change facial identity, symmetry, jawline, cheek volume, nose shape, lips shape, or skin contour.
Treat all facial geometry, eyes, and expressions as LOCKED reference design.

ALLOWED CHANGES (ONLY THESE):
Only upgrade:
- fur texture and hair strands (micro-detail only; keep original hair/fur shape and clumps)
- skin material detail (material response only; do NOT change facial features or perceived age)
- material depth (PBR-like roughness/normal depth; subtle, controlled)
- cinematic lighting and shadows applied to the scene/environment, not the face
- improved global shading coherence without altering design or colors

TEXT / LOGO / GRAPHICS LOCK:
If there is ANY text, logo, signage, UI, symbols, or typography:
- keep EXACT content, spelling, font shape, placement, size, and alignment
- do not redraw, restyle, translate, “correct”, or replace text
- do not add new text

COLOR AND LIGHTING DIRECTION (NO NIGHT CONDITION):
- cinematic color grading
- natural, film-like colors
- slightly desaturated palette
- soft highlights, controlled shadows
- NO oversaturation, NO HDR plastic look
- match the original time-of-day and scene intent from the input (day stays day, indoor stays indoor, etc.)
- preserve original light direction and key-to-fill logic; enhance it cinematically without changing mood/emotion
- avoid any dramatic face/eye lighting; keep face lighting consistent with the original

COMPOSITION & CAMERA LOCK:
Maintain original composition, pose, framing, lens feel, perspective, and emotion.
Do not crop, zoom, warp, or change camera angle.
Soft depth of field (subtle, cinematic) while preserving original focus intent.

Negative prompt:
face redesign, eye variation, expression change, emotional enhancement, eye sparkle, wet eyes, added eye reflections,
beautification, symmetry correction, anatomy correction, realistic facial anatomy conversion, new facial identity,
generic lion face, wildlife photography look, realistic lion anatomy, new accessories, removed accessories, added props,
text changes, logo changes, typography changes, oversaturated colors, HDR look, dramatic eye lighting, face relighting,
pose change, framing change, crop, zoom, perspective change
    `.trim(),
  },
  {
    id: "luxury_product",
    name: "Luxury Product",
    coverUrl: "/style-presets/luxury/cover.jpg",
    exampleUrls: ["/style-presets/luxury/1.jpg", "/style-presets/luxury/2.jpg", "/style-presets/luxury/3.jpg", "/style-presets/luxury/4.jpg"],
    prompt: `
STYLE: Luxury product advertising. Clean studio, premium reflections.
Lighting: controlled specular highlights, soft gradients, no harsh glare.
Composition: centered hero shot, elegant negative space, minimal clutter.
Quality: extremely sharp, high contrast micro-detail, commercial polish.
    `.trim(),
  },
  {
    id: "pixar_3d",
    name: "3D Pixar-ish",
    coverUrl: "/style-presets/pixar/cover.jpg",
    exampleUrls: ["/style-presets/pixar/1.jpg", "/style-presets/pixar/2.jpg", "/style-presets/pixar/3.jpg", "/style-presets/pixar/4.jpg"],
    prompt: `
STYLE: High-quality 3D animation look (family-friendly, stylized).
Materials: smooth but detailed shaders, soft bounce light, clean render.
Colors: vibrant but balanced, pleasing tones, gentle bloom.
Rules: no uncanny realism, keep shapes clean, avoid noise/artifacts.
    `.trim(),
  },
];

type Quality = "" | "1K" | "2K" | "4K";
type RefSlot = "char1" | "char2" | "char3" | "style" | "background";
type PanelKey = "reference" | "model" | "params" | "styles";

const TOOL_ID = "image-generator";
const REF_TOOL_ID = "image-generator-ref";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getStatus(err: any): number | null {
  return typeof err?.status === "number" ? err.status : typeof err?.response?.status === "number" ? err.response.status : null;
}
function getErrMsg(err: any): string {
  return err?.response?.data?.message || err?.response?.data?.error || err?.message || (typeof err === "string" ? err : "Failed to generate image.");
}
function isRetryable(err: any): boolean {
  const s = getStatus(err);
  if (s && [408, 429, 500, 502, 503, 504].includes(s)) return true;
  const m = (getErrMsg(err) || "").toLowerCase();
  return m.includes("timeout") || m.includes("failed to fetch") || m.includes("network");
}
function formatErr(err: any): string {
  const s = getStatus(err);
  const m = getErrMsg(err);
  return s ? `${m} (HTTP ${s})` : m;
}

// ===== Hidden Style Prompt =====
const STYLE_BLOCK_START = STYLE_PRESET_BLOCK_START;
const STYLE_BLOCK_END = STYLE_PRESET_BLOCK_END;

function splitStyleBlock(text: string): { cleaned: string; style: string | null } {
  const pairs = [
    { start: STYLE_BLOCK_START, end: STYLE_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    if (!text.includes(start) || !text.includes(end)) continue;
    const s = text.indexOf(start);
    const e = text.indexOf(end);
    if (s === -1 || e === -1 || e < s) continue;

    const before = text.slice(0, s).trimEnd();
    const inside = text.slice(s + start.length, e).trim();
    const after = text.slice(e + end.length).trimStart();

    const cleaned = [before, after].filter(Boolean).join("\n\n").trim();
    return { cleaned, style: inside || null };
  }
  return { cleaned: text, style: null };
}

function stripStyleBlock(text: string): string {
  return splitStyleBlock(text).cleaned;
}

function attachStyleBlock(userPrompt: string, stylePrompt: string | null): string {
  const p = (userPrompt || "").trim();
  const s = (stylePrompt || "").trim();
  if (!s) return p;

  if (
    (p.includes(STYLE_BLOCK_START) && p.includes(STYLE_BLOCK_END)) ||
    (p.includes(LEGACY_STYLE_PRESET_BLOCK_START) && p.includes(LEGACY_STYLE_PRESET_BLOCK_END))
  ) {
    return p;
  }
  return `${STYLE_BLOCK_START}\n${s}\n${STYLE_BLOCK_END}\n\n${p}`.trim();
}

function makeTempAsset(item: { assetId: string; url: string }, prompt: string, ownerId: string): Asset {
  return {
    id: item.assetId,
    url: item.url,
    type: "image",
    name: "Generated",
    prompt,
    createdAt: Date.now(),
    ownerId,
    isPublic: false,
    likes: [],
    comments: [],
  };
}

const ImageGeneratorTool: React.FC = () => {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [hiddenStylePrompt, setHiddenStylePrompt] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [model, setModel] = useState<string>(GeminiModel.IMAGE);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [count, setCount] = useState<number>(1);
  const [quality, setQuality] = useState<Quality>("1K");

  const isNanoBanana = model === GeminiModel.IMAGE;
  const isNanoBananaPro = model === GeminiModel.IMAGE_PRO;

  useEffect(() => {
    if (isNanoBananaPro) setCount(1);
  }, [isNanoBananaPro]);

  useEffect(() => {
    if (isNanoBanana) setQuality("1K");
  }, [isNanoBanana]);

  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [latestBatch, setLatestBatch] = useState<Array<{ assetId: string; url: string }>>([]);

  const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
    char1: null,
    char2: null,
    char3: null,
    style: null,
    background: null,
  });

  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const [styleModalOpen, setStyleModalOpen] = useState(false);
  const [stylePresetId, setStylePresetId] = useState<string | null>(null);

  const [panel, setPanel] = useState<PanelKey | null>(null);

  const [isPortraitUI, setIsPortraitUI] = useState(false);
  const [tileRatios, setTileRatios] = useState<Record<string, number>>({});

  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedStylePreset = useMemo(() => STYLE_PRESETS.find((s) => s.id === stylePresetId) || null, [stylePresetId]);

  const imageHistory = useMemo(() => history.filter((a) => a.type === "image" && a.url), [history]);
  const sortedHistory = useMemo(() => {
    const arr = [...imageHistory];
    arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return arr;
  }, [imageHistory]);

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return sortedHistory;
    return sortedHistory.filter((a) => (a.prompt || a.name || "").toLowerCase().includes(q));
  }, [sortedHistory, pickerQuery]);

  // UI portrait detector (para 4xN vs 1xN)
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const ratio = h / w;
      setIsPortraitUI(ratio > 1.18 || w < 860);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // autosize textarea
  const autosizePrompt = () => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 220);
    el.style.height = `${Math.max(next, 44)}px`;
  };

  useEffect(() => {
    autosizePrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  // Escape closes drawer/modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanel(null);
        setPickerSlot(null);
        setStyleModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hide style blocks if they appear in prompt
  useEffect(() => {
    if (!prompt.includes(STYLE_BLOCK_START)) return;
    const { cleaned, style } = splitStyleBlock(prompt);
    if (style) setHiddenStylePrompt(style);
    if (cleaned !== prompt) setPrompt(cleaned);
  }, [prompt]);

  // Load history
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const images = await listMyAssets({ type: "image", limit: 80 });
        const cleanImages = images.map((a) => ({ ...a, prompt: stripStyleBlock(a.prompt || "") }));
        setHistory(cleanImages);
        setSelectedAsset(cleanImages.length > 0 ? cleanImages[0] : null);
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el historial.");
      }
    })();
  }, [user]);

  const setRefSlot = (slot: RefSlot, asset: Asset | null) => setRefs((prev) => ({ ...prev, [slot]: asset }));

  const handleUploadRef = async (slot: RefSlot, file: File) => {
    if (!user) return;
    setError(null);
    try {
      const asset = await uploadUserAsset(file, REF_TOOL_ID);
      setRefSlot(slot, asset);
      setHistory((prev) => [asset, ...prev]);
    } catch (err: any) {
      setError(err?.message || "No se pudo subir la referencia.");
    }
  };

  const handleGenerate = async () => {
    const safePrompt = String(prompt ?? "").trim();
    if (!safePrompt) return;

    const safeModel = model === GeminiModel.IMAGE || model === GeminiModel.IMAGE_PRO ? model : GeminiModel.IMAGE;

    setLoading(true);
    setError(null);

    const characterAssetIds = [refs.char1, refs.char2, refs.char3].filter(Boolean).map((a) => (a as Asset).id);

    const effectiveQuality = isNanoBanana ? ("1K" as Quality) : quality;
    const effectiveCount = isNanoBananaPro ? 1 : count;

    const backgroundAutoPrompt = refs.background
      ? `
[BACKGROUND AUTO-RULES]
- Use the Background reference image as the scene/environment/backdrop.
- Match its lighting direction, color temperature, contrast, shadows, and overall mood so the subject looks naturally integrated.
- Keep the scene geometry/perspective consistent with the background reference.
- If my text prompt explicitly asks for a different background or lighting, follow my text prompt.
- If a Style reference is provided, prioritize the Style for the artistic look, but keep the environment/lighting grounded in the Background reference unless my text says otherwise.
`.trim()
      : "";

    const basePrompt = `${safePrompt}${backgroundAutoPrompt}`.trim();
    const styleText = stylePresetId ? hiddenStylePrompt : "";
    const finalPrompt = attachStyleBlock(basePrompt, styleText || null);

    const run = () =>
      generateImageBatch(finalPrompt, safeModel, {
        aspectRatio,
        count: effectiveCount,
        quality: effectiveQuality || undefined,
        tool: TOOL_ID,
        nameHint: "generated",
        characterAssetIds,
        styleAssetId: refs.style?.id,
        backgroundAssetId: refs.background?.id,
      });

    try {
      let res: any;
      try {
        res = await run();
      } catch (e1: any) {
        if (isRetryable(e1)) {
          await sleep(900);
          res = await run();
        } else {
          throw e1;
        }
      }

      setLatestBatch(res.items || []);

      if (res.items?.[0] && user) setSelectedAsset(makeTempAsset(res.items[0], safePrompt, user.id));

      try {
        const images = await listMyAssets({ type: "image", limit: 80 });
        const cleanImages = images.map((a) => ({ ...a, prompt: stripStyleBlock(a.prompt || "") }));
        setHistory(cleanImages);

        const firstId = res.items?.[0]?.assetId;
        const found = firstId ? images.find((a) => a.id === firstId) : null;
        setSelectedAsset(found || (images.length > 0 ? images[0] : null));
      } catch (histErr: any) {
        console.warn("History refresh failed:", histErr);
        setError(formatErr(histErr) || "La imagen se generó, pero falló el refresco del historial.");
      }
    } catch (err: any) {
      console.error("Generate failed:", err);
      setError(formatErr(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!selectedAsset) return;
    try {
      const makePublic = !selectedAsset.isPublic;
      const result = makePublic ? await publishAsset(selectedAsset.id) : await unpublishAsset(selectedAsset.id);

      setSelectedAsset({ ...selectedAsset, isPublic: result.isPublic });
      setHistory((prev) => prev.map((a) => (a.id === selectedAsset.id ? { ...a, isPublic: result.isPublic } : a)));
    } catch (err: any) {
      setError(err?.message || "No se pudo cambiar la visibilidad.");
    }
  };

  const handleDownload = () => {
    if (!selectedAsset?.url) return;
    const a = document.createElement("a");
    a.href = selectedAsset.url;
    a.download = `${selectedAsset.name || "image"}.png`;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePickFromBatch = (item: { assetId: string; url: string }) => {
    const found = history.find((a) => a.id === item.assetId);
    if (found) {
      setSelectedAsset(found);
      return;
    }
    if (user) setSelectedAsset(makeTempAsset(item, prompt, user.id));
  };

  const togglePanel = (k: PanelKey) => setPanel((p) => (p === k ? null : k));

  const cols = isPortraitUI ? 1 : 4;

  const onTileLoad = (id: string, img: HTMLImageElement) => {
    const r = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    setTileRatios((prev) => (prev[id] ? prev : { ...prev, [id]: r }));
  };

  const SlotCard = ({ slot, label, asset }: { slot: RefSlot; label: string; asset: Asset | null }) => {
    return (
      <div className={styles.slotCard}>
        <div className={styles.slotHead}>
          <span className={styles.slotLabel}>{label}</span>
          {asset ? (
            <button type="button" className={styles.slotClear} onClick={() => setRefSlot(slot, null)}>
              CLEAR
            </button>
          ) : null}
        </div>

        <div className={styles.slotBody}>
          <button type="button" className={styles.slotPreviewBtn} onClick={() => setPickerSlot(slot)}>
            {asset ? <img className={styles.slotPreview} src={asset.url} alt={asset.name} /> : <div className={styles.slotEmpty}>Pick from history</div>}
          </button>

          <div className={styles.slotBtns}>
            <label className={styles.slotBtn}>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadRef(slot, f);
                  e.currentTarget.value = "";
                }}
              />
              UPLOAD
            </label>

            <button type="button" className={styles.slotBtn} onClick={() => setPickerSlot(slot)}>
              PICK
            </button>
          </div>
        </div>
      </div>
    );
  };

  const StylePresetCard = () => {
    return (
      <div className={styles.slotCard}>
        <div className={styles.slotHead}>
          <span className={styles.slotLabel}>Style Preset</span>
          {stylePresetId ? (
            <button
              type="button"
              className={styles.slotClear}
              onClick={() => {
                setStylePresetId(null);
                setHiddenStylePrompt("");
                setPrompt((prev) => removeStylePresetBlock(prev).trim());
              }}
            >
              CLEAR
            </button>
          ) : null}
        </div>

        <div className={styles.slotBody}>
          <button type="button" className={styles.slotPreviewBtn} onClick={() => setStyleModalOpen(true)}>
            {selectedStylePreset?.coverUrl ? (
              <img className={styles.slotPreview} src={encodeURI(selectedStylePreset.coverUrl)} alt={selectedStylePreset.name} />
            ) : (
              <div className={styles.slotEmpty}>Choose a style</div>
            )}
          </button>

          <div className={styles.slotBtns}>
            <button type="button" className={styles.slotBtn} onClick={() => setStyleModalOpen(true)}>
              CHOOSE
            </button>
            <button type="button" className={styles.slotBtn} onClick={() => togglePanel("styles")}>
              PANEL
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`${styles.root} hud-noise`}>
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className={styles.topBar}>
        <div className={styles.title}>
          <div className={styles.titleMain}>Image Generator Tool</div>
          <div className={styles.titleSub}>Dock UI + dynamic history (new → old)</div>
        </div>

        <div className={styles.pills}>
          <div className={`${styles.pill} ${styles.pillStrong}`}>MODEL: {isNanoBananaPro ? "PRO" : "BASE"}</div>
          <div className={styles.pill}>RATIO: {aspectRatio}</div>
          <div className={styles.pill}>COUNT: {isNanoBananaPro ? 1 : count}</div>
          <div className={styles.pill}>QUALITY: {isNanoBanana ? "1K" : quality || "AUTO"}</div>
          <div className={styles.pill}>HISTORY: {sortedHistory.length}</div>
        </div>
      </div>

      <div className={styles.preview}>
        <div className={styles.previewInner}>
          {selectedAsset?.url ? (
            <img className={styles.previewImg} src={selectedAsset.url} alt="Selected" />
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyCode}>NO IMAGE SELECTED</div>
              <div className={styles.emptyText}>Generate a new image or select from history.</div>
            </div>
          )}
        </div>

        {selectedAsset && (
          <div className={styles.previewFooter}>
            <div className={styles.meta}>
              <div className={styles.metaLine}>
                {selectedAsset.createdAt ? new Date(selectedAsset.createdAt).toLocaleString() : ""}
              </div>
              {selectedAsset.isPublic ? <div className={styles.badgePublic}>PUBLISHED</div> : null}
            </div>

            <div className={styles.actions}>
              <button className={styles.actionBtn} onClick={handleDownload} type="button">
                Download
              </button>
              <button className={styles.actionBtn} onClick={handleTogglePublic} type="button">
                {selectedAsset.isPublic ? "Privatizar" : "Publicar"}
              </button>
            </div>
          </div>
        )}
      </div>

      {latestBatch.length > 0 && (
        <div className={styles.variations}>
          <div className={styles.variationsTop}>
            <div className={styles.variationsTitle}>Variations</div>
            <button type="button" className={styles.variationsClear} onClick={() => setLatestBatch([])}>
              CLEAR
            </button>
          </div>

          <div className={styles.variationRow}>
            {latestBatch.map((it) => (
              <button
                key={it.assetId}
                type="button"
                onClick={() => handlePickFromBatch(it)}
                className={`${styles.variationThumb} ${selectedAsset?.id === it.assetId ? styles.variationThumbSelected : ""}`}
              >
                <img src={it.url} alt="variation" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.historyPanel}>
        <div className={styles.historyTop}>
          <div className={styles.historyTitle}>History</div>
          <div className={styles.historyHint}>{isPortraitUI ? "Portrait: 1×N" : "Landscape: 4×N"} • New → Old</div>
        </div>

        <div className={styles.grid} style={{ ["--cols" as any]: cols }}>
          {sortedHistory.map((a, idx) => {
            const isSelected = selectedAsset?.id === a.id;
            const isNew = idx === 0;

            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedAsset(a)}
                className={`${styles.tile} ${isSelected ? styles.tileSelected : ""}`}
                style={{ aspectRatio: tileRatios[a.id] ? String(tileRatios[a.id]) : "1 / 1" }}
              >
                {isNew ? <div className={styles.tileNewTag}>NEW</div> : null}

                <img
                  src={a.url}
                  alt={a.name}
                  onLoad={(e) => onTileLoad(a.id, e.currentTarget)}
                />

                <div className={styles.tileCaption}>{a.prompt || a.name || "..."}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Drawer backdrop (click outside closes) */}
      {panel ? (
        <button type="button" className={styles.backdrop} onClick={() => setPanel(null)} aria-label="Close panel" />
      ) : null}

      <div className={styles.dockWrap}>
        {/* Drawer */}
        {panel ? (
          <div className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitle}>{panel}</div>
              <button type="button" className={styles.drawerClose} onClick={() => setPanel(null)}>
                CLOSE
              </button>
            </div>

            {panel === "reference" && (
              <div className={styles.panelGrid}>
                <SlotCard slot="char1" label="Character 1" asset={refs.char1} />
                <SlotCard slot="char2" label="Character 2" asset={refs.char2} />
                <SlotCard slot="char3" label="Character 3" asset={refs.char3} />
                <SlotCard slot="background" label="Background" asset={refs.background} />
                <SlotCard slot="style" label="Style Reference (image)" asset={refs.style} />
              </div>
            )}

            {panel === "styles" && (
              <div className={styles.panelGrid}>
                <StylePresetCard />
                <div className={styles.slotCard}>
                  <div className={styles.slotHead}>
                    <span className={styles.slotLabel}>Selected</span>
                  </div>
                  <div className={styles.slotBody}>
                    <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
                      {selectedStylePreset ? selectedStylePreset.name : "None"}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 8 }}>
                      El preset se aplica “oculto” y nunca se muestra dentro del textarea.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {panel === "model" && (
              <div className={styles.panelGrid}>
                <div className={styles.slotCard}>
                  <div className={styles.slotHead}>
                    <span className={styles.slotLabel}>Model</span>
                  </div>
                  <div className={styles.slotBody}>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      style={{
                        width: "100%",
                        borderRadius: 12,
                        padding: "10px 12px",
                        border: "1px solid rgba(241,225,148,0.16)",
                        background: "rgba(0,0,0,0.55)",
                        color: "rgba(255,255,255,0.9)",
                      }}
                    >
                      <option value={GeminiModel.IMAGE}>NanoBanana</option>
                      <option value={GeminiModel.IMAGE_PRO}>NanoBanana Pro</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {panel === "params" && (
              <div className={styles.panelGrid}>
                <div className={styles.slotCard}>
                  <div className={styles.slotHead}>
                    <span className={styles.slotLabel}>Aspect Ratio</span>
                  </div>
                  <div className={styles.slotBody}>
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value)}
                      style={{
                        width: "100%",
                        borderRadius: 12,
                        padding: "10px 12px",
                        border: "1px solid rgba(241,225,148,0.16)",
                        background: "rgba(0,0,0,0.55)",
                        color: "rgba(255,255,255,0.9)",
                      }}
                    >
                      <option value="1:1">1:1</option>
                      <option value="3:2">3:2</option>
                      <option value="2:3">2:3</option>
                      <option value="3:4">3:4</option>
                      <option value="4:3">4:3</option>
                      <option value="4:5">4:5</option>
                      <option value="5:4">5:4</option>
                      <option value="9:16">9:16</option>
                      <option value="16:9">16:9</option>
                      <option value="21:9">21:9</option>
                    </select>
                  </div>
                </div>

                <div className={styles.slotCard}>
                  <div className={styles.slotHead}>
                    <span className={styles.slotLabel}>Count</span>
                  </div>
                  <div className={styles.slotBody}>
                    <select
                      value={count}
                      onChange={(e) => setCount(parseInt(e.target.value, 10))}
                      disabled={isNanoBananaPro}
                      style={{
                        width: "100%",
                        borderRadius: 12,
                        padding: "10px 12px",
                        border: "1px solid rgba(241,225,148,0.16)",
                        background: "rgba(0,0,0,0.55)",
                        color: "rgba(255,255,255,0.9)",
                        opacity: isNanoBananaPro ? 0.5 : 1,
                      }}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                    {isNanoBananaPro ? <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Pro genera 1 imagen por request.</div> : null}
                  </div>
                </div>

                <div className={styles.slotCard}>
                  <div className={styles.slotHead}>
                    <span className={styles.slotLabel}>Quality</span>
                  </div>
                  <div className={styles.slotBody}>
                    <select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as Quality)}
                      disabled={isNanoBanana}
                      style={{
                        width: "100%",
                        borderRadius: 12,
                        padding: "10px 12px",
                        border: "1px solid rgba(241,225,148,0.16)",
                        background: "rgba(0,0,0,0.55)",
                        color: "rgba(255,255,255,0.9)",
                        opacity: isNanoBanana ? 0.5 : 1,
                      }}
                    >
                      <option value="">Auto</option>
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                    {isNanoBanana ? <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Base genera en 1K fijo.</div> : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className={styles.dock}>
          <div className={styles.dockTop}>
            <button className={`${styles.dockBtn} ${panel === "reference" ? styles.dockBtnActive : ""}`} onClick={() => togglePanel("reference")} type="button">
              Reference
            </button>
            <button className={`${styles.dockBtn} ${panel === "model" ? styles.dockBtnActive : ""}`} onClick={() => togglePanel("model")} type="button">
              Model
            </button>
            <button className={`${styles.dockBtn} ${panel === "params" ? styles.dockBtnActive : ""}`} onClick={() => togglePanel("params")} type="button">
              Parameters
            </button>
            <button className={`${styles.dockBtn} ${panel === "styles" ? styles.dockBtnActive : ""}`} onClick={() => togglePanel("styles")} type="button">
              Styles
            </button>
            <button className={styles.dockBtn} type="button" onClick={() => setStyleModalOpen(true)}>
              Style Picker
            </button>
          </div>

          <div className={styles.dockMain}>
            <div className={styles.promptBox}>
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onInput={autosizePrompt}
                placeholder="Escribe tu prompt y comienza a crear..."
                className={styles.prompt}
              />
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className={`${styles.generate} ${loading ? styles.generateLoading : ""} ${loading || !prompt.trim() ? styles.generateDisabled : ""}`}
            >
              {loading ? "GENERATING" : "GENERATE"}
            </button>
          </div>
        </div>
      </div>

      {/* Style Modal */}
      {styleModalOpen && (
        <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="hud-panel w-full max-w-3xl rounded-3xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Choose a style</p>
                <p className="text-[10px] text-white/40">Se aplica de forma oculta y no altera el textarea.</p>
              </div>
              <button type="button" onClick={() => setStyleModalOpen(false)} className="text-xs font-bold text-white/70 hover:text-white">
                CLOSE
              </button>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {STYLE_PRESETS.map((s) => {
                  const isSelected = s.id === stylePresetId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setStylePresetId(s.id);
                        setPrompt((prev) => applyStylePresetToPrompt(prev, s.prompt));
                        setStyleModalOpen(false);
                      }}
                      className={[
                        "group relative aspect-square rounded-2xl overflow-hidden border transition",
                        isSelected ? "border-white/70" : "border-white/10 hover:border-white/40",
                      ].join(" ")}
                    >
                      {s.coverUrl ? (
                        <img src={encodeURI(s.coverUrl)} alt={s.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-white/30 bg-black/40">{s.name}</div>
                      )}

                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                          {(s.exampleUrls ? Array.from(s.exampleUrls) : [null, null, null, null]).map((url, idx) => (
                            <div key={idx} className="relative w-full h-full">
                              {url ? <img src={encodeURI(url)} alt={`${s.name} ex ${idx + 1}`} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/5" />}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2">
                        <div className="text-[10px] font-bold text-white text-left">{s.name}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Picker Modal */}
      {pickerSlot && (
        <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="hud-panel w-full max-w-3xl rounded-3xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Pick reference</p>
                <p className="text-[10px] text-white/40">Slot: {pickerSlot}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPickerSlot(null);
                  setPickerQuery("");
                }}
                className="text-xs font-bold text-white/70 hover:text-white"
              >
                CLOSE
              </button>
            </div>

            <div className="p-4">
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by prompt/name..."
                className="w-full mb-4 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
              />

              {filteredPickerAssets.length === 0 ? (
                <div className="text-center text-white/30 py-10">No images in history. Generate or upload an image first.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                  {filteredPickerAssets.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setRefSlot(pickerSlot, a);
                        setPickerSlot(null);
                        setPickerQuery("");
                      }}
                      className="group relative aspect-square rounded-2xl overflow-hidden border border-white/10 hover:border-white/40 transition"
                    >
                      <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <span className="text-[10px] text-white truncate w-full text-left">{a.prompt || a.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGeneratorTool;
