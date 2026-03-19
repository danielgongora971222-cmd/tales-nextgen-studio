import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Maximize, Layers, Check, ShoppingCart, CreditCard, Image as ImageIcon, Sparkles, ShieldCheck, Truck } from 'lucide-react';
import { AppRoute, type Asset, type StoreArtDecoListing, type StoreArtDecoPayload, type StorePrefill } from "../types";
import { listMyAssets } from "../services/assetsApi";
import { supabase } from "../services/supabaseClient";
import { apiUrl } from "../services/apiBase";
import { createArtDecoListing } from "../services/communityStoreApi";
import { useWallet } from "../contexts/WalletContext";
import OneNationUpIcon from "../components/brand/OneNationUpIcon";
import ConfirmDollarPurchaseModal from "@/components/ConfirmDollarPurchaseModal";
import ToolExitMenu from "../components/ToolExitMenu";

// --- CONFIGURACIÓN DE PRODUCTOS ---
const SIZES = [
  { id: '16x20', label: '16" x 20"', w: 16, h: 20, ratio: 16/20, basePrice: 85 },
  { id: '16x24', label: '16" x 24"', w: 16, h: 24, ratio: 16/24, basePrice: 95 },
  { id: '18x24', label: '18" x 24"', w: 18, h: 24, ratio: 18/24, basePrice: 115 },
  { id: '24x24', label: '24" x 24" (Cuadrado)', w: 24, h: 24, ratio: 1, basePrice: 135 },
  { id: '20x30', label: '20" x 30"', w: 20, h: 30, ratio: 20/30, basePrice: 145 },
  { id: '24x30', label: '24" x 30"', w: 24, h: 30, ratio: 24/30, basePrice: 160 },
  { id: '24x36', label: '24" x 36"', w: 24, h: 36, ratio: 24/36, basePrice: 175 },
  { id: '30x40', label: '30" x 40"', w: 30, h: 40, ratio: 30/40, basePrice: 220 },
  { id: '32x48', label: '32" x 48"', w: 32, h: 48, ratio: 32/48, basePrice: 275 },
  { id: '36x48', label: '36" x 48"', w: 36, h: 48, ratio: 36/48, basePrice: 310 },
  { id: '30x60', label: '30" x 60"', w: 30, h: 60, ratio: 30/60, basePrice: 330 },
  { id: '40x60', label: '40" x 60"', w: 40, h: 60, ratio: 40/60, basePrice: 420 },
  { id: '48x72', label: '48" x 72"', w: 48, h: 72, ratio: 48/72, basePrice: 600 },
  { id: '48x96', label: '48" x 96"', w: 48, h: 96, ratio: 48/96, basePrice: 850 },
];

const MATERIALS = [
  { id: 'acrylic', label: 'Acrílico Premium', desc: 'Brillo profundo, efecto 3D moderno.', multiplier: 1.5, icon: <Layers className="w-5 h-5" /> },
  { id: 'canvas', label: 'Canvas de Galería', desc: 'Textura clásica, bordes envueltos.', multiplier: 1.0, icon: <ImageIcon className="w-5 h-5" /> },
  { id: 'metal', label: 'Metal HD', desc: 'Colores vibrantes, ultra duradero.', multiplier: 1.3, icon: <ShieldCheck className="w-5 h-5" /> },
  { id: 'paper', label: 'Papel Fine Art', desc: 'Acabado mate, calidad museo.', multiplier: 0.8, icon: <Sparkles className="w-5 h-5" /> },
];

const DEFAULT_SIZE = SIZES.find((item) => item.id === '24x36') || SIZES[0];

// --- COMPONENTE DE FONDO DE PARTÍCULAS ---
const ParticleBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let particles = [];
    const colors = ['#7EAAED', '#DFB142', '#DE6C53', '#7D45A9'];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      baseRadius: number;
      radius: number;
      color: string;
      phase: number;

      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.baseRadius = Math.random() * 1.5 + 0.5;
        this.radius = this.baseRadius;
        this.color = colors[Math.floor(Math.random() * colors.length)];
        this.phase = Math.random() * Math.PI * 2;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
        this.phase += 0.01;
        this.radius = this.baseRadius + Math.sin(this.phase) * 0.5;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    const init = () => {
      particles = [];
      const numParticles = (canvas.width * canvas.height) / 10000;
      for (let i = 0; i < numParticles; i++) particles.push(new Particle());
    };
    init();

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].draw();
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(126, 170, 237, ${0.1 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0 bg-[#050505]" />;
};

// --- APLICACIÓN PRINCIPAL ---
type Step = 'UPLOAD' | 'VERIFYING' | 'CONFIRM' | 'MATERIAL' | 'SIZE' | 'CROP' | 'MODE' | 'CHECKOUT' | 'PROCESSING' | 'SUCCESS';

const SHIPPING_FEE = 15;

function roundUsd(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatUsd(value: number) {
  return `$${roundUsd(value).toFixed(2)} USD`;
}

function resolveMaterial(materialId?: string | null) {
  return MATERIALS.find((item) => item.id === materialId) || null;
}

function resolveSize(sizeId?: string | null) {
  return SIZES.find((item) => item.id === sizeId) || null;
}

type StoreNewUIProps = {
  onNavigate: (route: AppRoute) => void;
  onRequestUpscale?: (asset: Asset) => void;
  prefill?: StorePrefill;
};

export default function StoreNewUI({ onNavigate, onRequestUpscale, prefill }: StoreNewUIProps) {
  const { subscription } = useWallet();
  const [image, setImage] = useState<string | null>(null); // preview (dataUrl)
  const [asset, setAsset] = useState<Asset | null>(null);  // asset subido (storage)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [historyImages, setHistoryImages] = useState<Asset[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [is4kOk, setIs4kOk] = useState<boolean>(false);
  const [dimsLoading, setDimsLoading] = useState<boolean>(false);
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null);
  const [cropGenError, setCropGenError] = useState<string | null>(null);
  const [cropProcessing, setCropProcessing] = useState(false);
  const [imageOrientation, setImageOrientation] = useState('portrait');
  const transientImageUrlRef = useRef<string | null>(null);
  const checkoutFormRef = useRef<HTMLFormElement | null>(null);
  const [selectorPanel, setSelectorPanel] = useState<'material' | 'size' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const clearTransientImageUrl = useCallback((preserve: string | null = null) => {
    const current = transientImageUrlRef.current;
    if (current && current !== preserve) {
      try {
        URL.revokeObjectURL(current);
      } catch {
        // noop
      }
    }

    transientImageUrlRef.current = preserve && preserve.startsWith('blob:') ? preserve : null;
  }, []);

  useEffect(() => {
    return () => {
      clearTransientImageUrl();
    };
  }, [clearTransientImageUrl]);

  useEffect(() => {
  let alive = true;

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      // IMPORTANTE (estabilidad):
      // - 500 items + fresh suele ser demasiado pesado y dispara fallos de red (fetch TypeError).
      // - Preferimos pedir imágenes directamente y con un límite más seguro.
      // - Si por cualquier motivo tu DB tuviera assets antiguos sin type="image", hacemos fallback.
      let items: Asset[] = [];

      try {
        items = await listMyAssets({ type: "image", limit: 250 });
        if (!items || items.length === 0) {
          items = await listMyAssets({ limit: 250 });
        }
      } catch {
        items = await listMyAssets({ limit: 250 });
      }


      // 1) excluir assets que no pertenecen al historial útil para 1NationUp
      const usableHistory = (items || []).filter((a: any) => {
        const tool = a?.tool || a?.meta?.tool || null;
        const source = typeof a?.meta?.source === "string" ? a.meta.source.toLowerCase() : "";
        if (tool === "camera-angles") return false;
        if (tool === "1nationup") return false;
        if (source === "upload" || source === "user_upload" || source === "user_upload_direct") return false;
        return true;
      });

      // 2) quedarnos solo con "imágenes"
      // (evitamos videos y cualquier cosa rara)
      const onlyImages = usableHistory.filter((a: any) => {
        const t = typeof a?.type === "string" ? a.type.toLowerCase() : "";
        const mime = typeof a?.meta?.mime === "string" ? a.meta.mime.toLowerCase() : "";
        const url = typeof a?.url === "string" ? a.url.toLowerCase() : "";

        // casos comunes: type="image"
        if (t === "image") return true;

        // si guardaron mime en meta
        if (mime.startsWith("image/")) return true;

        // fallback por extensión
        if (url.match(/\.(png|jpg|jpeg|webp|gif)(\?|#|$)/)) return true;

        // si no hay type pero sí url, asumimos imagen (mejor que dejar vacío)
        if (!t && !!url) return true;

        return false;
      });

      const sorted = [...onlyImages].sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      if (!alive) return;
      setHistoryImages(sorted);
    } catch (e: any) {
      if (!alive) return;
      setHistoryError(e?.message || "No se pudo cargar tu historial.");
    } finally {
      if (!alive) return;
      setHistoryLoading(false);
    }
  }

  loadHistory();
  return () => {
    alive = false;
  };
}, []);
  
  // Flujo Secuencial (Acordeón)
  const [activeStep, setActiveStep] = useState<Step>('UPLOAD'); 
  
  // Estados Finales (Confirmados)
  const [selectedMaterial, setSelectedMaterial] = useState<(typeof MATERIALS)[number] | null>(null);
  const [selectedSize, setSelectedSize] = useState<(typeof SIZES)[number] | null>(null);
  const [isCropped, setIsCropped] = useState(false);

  // Estados Previos (Para visualización en 2 tiempos antes de confirmar)
  const [previewMaterial, setPreviewMaterial] = useState<(typeof MATERIALS)[number] | null>(null);
  const [previewSize, setPreviewSize] = useState<(typeof SIZES)[number] | null>(null);
  
  // Estado riguroso para el editor de recorte
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [finalCrop, setFinalCrop] = useState<{ x: number; y: number; w: number; h: number; aspect: number } | null>(null); 
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  const [purchaseMode, setPurchaseMode] = useState<'buy' | 'sell' | null>(null);
  const [successMode, setSuccessMode] = useState<'order' | 'listing'>('order');
  const [publishedListingId, setPublishedListingId] = useState<string>('');
  const [prefillArtDeco, setPrefillArtDeco] = useState<StoreArtDecoListing | null>(null);
  const [listingForm, setListingForm] = useState({ name: '', description: '', priceUsd: '' });
  
  // Refs
  const imageWrapperRef = useRef<HTMLDivElement | null>(null);
  const stepsScrollRef = useRef<HTMLDivElement | null>(null);
  const materialStepRef = useRef<HTMLDivElement | null>(null);
  const sizeStepRef = useRef<HTMLDivElement | null>(null);
  const cropStepRef = useRef<HTMLDivElement | null>(null);
  const checkoutStepRef = useRef<HTMLDivElement | null>(null);

  // Formulario de Checkout
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', method: 'shipping', address: '', apt: '', city: '', state: '', zip: '', notes: '' });
  const [orderCode, setOrderCode] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');

  // Confirmación requerida para compras en USD
  const [confirmPayOpen, setConfirmPayOpen] = useState(false);
  const [confirmPayInfo, setConfirmPayInfo] = useState<{ itemLabel: string; amountLabel: string; note?: string | null; action: () => Promise<void> } | null>(null);

// Manejar subida de imagen
function is4K(d: { w: number; h: number } | null): boolean {
  if (!d) return false;
  const maxSide = Math.max(d.w, d.h);
  const minSide = Math.min(d.w, d.h);
  return maxSide >= 3840 && minSide >= 2160;
}

function approxDataUrlBytes(dataUrl: string): number {
  // data:image/...;base64,XXXX
  const i = dataUrl.indexOf(",");
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  // bytes aproximados base64: len * 3/4 (menos padding)
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}


function loadImgDimsFromUrl(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = reject;
    img.src = url;
  });
}

const sellerEnabled = false && Boolean(subscription?.can_sell);
const isLockedArtDecoPurchase = Boolean(prefillArtDeco?.id);
const selectedBasePrice = useMemo(() => {
  if (!selectedSize || !selectedMaterial) return 0;
  return roundUsd(Number(selectedSize.basePrice || 0) * Number(selectedMaterial.multiplier || 1));
}, [selectedMaterial, selectedSize]);
const lockedBasePrice = useMemo(() => roundUsd(Number(prefillArtDeco?.artDecoPayload?.pricing?.basePrice || 0)), [prefillArtDeco]);
const lockedSalePrice = useMemo(() => roundUsd(Number(prefillArtDeco?.priceUsd || prefillArtDeco?.artDecoPayload?.pricing?.salePrice || 0)), [prefillArtDeco]);
const shippingCost = formData.method === 'pickup' ? 0 : SHIPPING_FEE;
const checkoutUnitPrice = isLockedArtDecoPurchase ? lockedSalePrice : selectedBasePrice;
const checkoutTotal = roundUsd(checkoutUnitPrice + shippingCost);
const minimumSellPrice = selectedBasePrice;
const listingPriceUsdValue = roundUsd(Number(listingForm.priceUsd || 0));
const listingProfit = roundUsd(Math.max(0, listingPriceUsdValue - minimumSellPrice));
const showModeStep = false;
const checkoutStepNumber = 4;
const canPublishListing = false && sellerEnabled && !isLockedArtDecoPurchase && !!asset && !!selectedMaterial && !!selectedSize && !!finalCrop && listingPriceUsdValue > minimumSellPrice;

const scrollToActiveStep = useCallback((step: Step) => {
  const container = stepsScrollRef.current;
  const target =
    step === 'MATERIAL' ? materialStepRef.current :
    step === 'SIZE' ? sizeStepRef.current :
    step === 'CROP' ? cropStepRef.current :
    step === 'CHECKOUT' ? checkoutStepRef.current :
    null;

  if (!container || !target) return;
  window.requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - 8;
    container.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  });
}, []);

useEffect(() => {
  if (!image) return;
  if (activeStep !== 'MATERIAL' && activeStep !== 'SIZE' && activeStep !== 'CROP' && activeStep !== 'CHECKOUT') return;
  scrollToActiveStep(activeStep);
}, [activeStep, image, scrollToActiveStep]);

const resetFlowForNewImage = () => {
  setSelectorPanel(null);
  setUploadError(null);
  setPickerOpen(false);
  setSelectedMaterial(null);
  setSelectedSize(null);
  setPreviewMaterial(null);
  setPreviewSize(null);
  setIsCropped(false);
  setFinalCrop(null);
  setCropRect({ x: 0, y: 0, w: 0, h: 0 });
  setCroppedDataUrl(null);
  setOrderCode("");
  setSubmitError("");
  setPurchaseMode('buy');
  setSuccessMode('order');
  setPublishedListingId('');
  setActivePointerId(null);
  setIsDragging(false);
  setCropGenError(null);
  setPrefillArtDeco(null);
  setConfirmPayOpen(false);
  setConfirmPayInfo(null);
  setFormData({ name: '', email: '', phone: '', method: 'shipping', address: '', apt: '', city: '', state: '', zip: '', notes: '' });
  setListingForm({ name: '', description: '', priceUsd: '' });
};

const handleSelectFromHistory = async (a: Asset) => {
  clearTransientImageUrl();
  resetFlowForNewImage();

  setAsset(a);
  setImage(a.url);

  setDims(null);
  setIs4kOk(false);
  setDimsLoading(true);
  setActiveStep("VERIFYING");

  try {
    const d = await loadImgDimsFromUrl(a.url);
    setDims(d);

    const ok = is4K(d);
    setIs4kOk(ok);
    setImageOrientation(d.w > d.h ? "landscape" : "portrait");
    setActiveStep("CONFIRM");
  } catch {
    setDims(null);
    setIs4kOk(false);
    setImage(null);
    setAsset(null);
    setActiveStep("UPLOAD");
    setUploadError("No se pudo preparar esta imagen. Prueba con otra creación.");
  } finally {
    setDimsLoading(false);
  }
};

const hydrateArtDecoPrefill = useCallback((listing: StoreArtDecoListing) => {
  const payload = listing?.artDecoPayload;
  if (!payload) return;

  resetFlowForNewImage();
  setPrefillArtDeco(listing);

  const lockedMaterial = resolveMaterial(payload.material);
  const lockedSize = resolveSize(payload.size?.id) || resolveSize(String(payload.size?.label || '').split(' ')[0]) || null;
  const imageDims = payload.imageDims || null;
  const previewSource = payload.croppedImageDataUrl || listing.previewUrl || payload.assetUrl || null;

  if (previewSource) setImage(previewSource);
  setAsset({
    id: payload.assetId || listing.id,
    url: payload.assetUrl,
    type: 'image',
    name: payload.assetName || listing.name || 'Art Deco',
    createdAt: Date.now(),
    ownerId: listing.sellerId || '',
    isPublic: false,
    likedByMe: false,
    likesCount: 0,
    commentsCount: 0,
    likes: [],
    comments: [],
  } as Asset);
  setDims(imageDims);
  setIs4kOk(Boolean(imageDims ? is4K(imageDims) : true));
  setDimsLoading(false);
  setImageOrientation(imageDims && imageDims.w > imageDims.h ? 'landscape' : 'portrait');
  setSelectedMaterial(lockedMaterial);
  setPreviewMaterial(lockedMaterial);
  setSelectedSize(lockedSize);
  setPreviewSize(lockedSize);
  const lockedCrop = payload.cropNormalized
    ? {
        x: Number(payload.cropNormalized.x || 0),
        y: Number(payload.cropNormalized.y || 0),
        w: Number(payload.cropNormalized.w || 1),
        h: Number(payload.cropNormalized.h || 1),
        aspect: Number(payload.cropNormalized.aspect || (lockedSize ? lockedSize.ratio : 1) || 1),
      }
    : null;
  setFinalCrop(lockedCrop);
  setCroppedDataUrl(payload.croppedImageDataUrl || listing.previewUrl || null);
  setIsCropped(Boolean(lockedCrop));
  setPurchaseMode('buy');
  setListingForm({
    name: listing.name || payload.assetName || 'Art Deco listing',
    description: listing.description || 'Creación física lista para producción y envío.',
    priceUsd: String(roundUsd(Number(listing.priceUsd || payload.pricing?.salePrice || 0))),
  });
  setPickerOpen(false);
  setActiveStep('CHECKOUT');
}, []);

useEffect(() => {
  const listing = prefill?.artDecoListing || null;
  if (!listing?.id) return;
  hydrateArtDecoPrefill(listing);
}, [hydrateArtDecoPrefill, prefill?.artDecoListing?.id]);

useEffect(() => {
  if (prefill?.artDecoListing?.id) return;
  const a = prefill?.asset || null;
  if (!a) return;

  handleSelectFromHistory(a);
  setPickerOpen(false);
}, [prefill?.asset, prefill?.artDecoListing?.id]);

useEffect(() => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('tales:store-immersive', { detail: { immersive: Boolean(image) } }));

  return () => {
    window.dispatchEvent(new CustomEvent('tales:store-immersive', { detail: { immersive: false } }));
  };
}, [image]);

const handleGoToUpscale = () => {
  if (!asset) return;
  if (onRequestUpscale) {
    onRequestUpscale(asset);
    return;
  }
  // fallback si no te están pasando onRequestUpscale desde arriba
  onNavigate(AppRoute.TOOL_UPSCALER);
};

const openHistoryPicker = () => {
  setUploadError(null);
  setPickerOpen(true);
};

const resetToLanding = () => {
  clearTransientImageUrl();
  resetFlowForNewImage();
  setImage(null);
  setAsset(null);
  setDims(null);
  setIs4kOk(false);
  setDimsLoading(false);
  setActiveStep('UPLOAD');
};

useEffect(() => {
  if (activeStep !== 'SIZE' || isLockedArtDecoPurchase) return;
  const nextSize = selectedSize || previewSize || DEFAULT_SIZE;
  if (!selectedSize) setSelectedSize(nextSize);
  if (!previewSize) setPreviewSize(nextSize);
}, [activeStep, isLockedArtDecoPurchase, selectedSize, previewSize]);

useEffect(() => {
  if (selectorPanel === 'material' && activeStep !== 'MATERIAL') setSelectorPanel(null);
  if (selectorPanel === 'size' && activeStep !== 'SIZE') setSelectorPanel(null);
}, [activeStep, selectorPanel]);

  // --- LÓGICA DE RECORTE ESTRICTA Y VINCULADA ---
  const updateCropSize = useCallback(() => {
    if (!selectedSize || !imageWrapperRef.current) return;
    
    const wrapper = imageWrapperRef.current;
    const rect = wrapper.getBoundingClientRect();
    const imgW = rect.width;
    const imgH = rect.height;
    
    if (imgW === 0 || imgH === 0) return;

    let targetW = selectedSize.w;
    let targetH = selectedSize.h;

    // Auto-orientar si la foto es apaisada vs retrato
    if (imageOrientation === 'landscape' && targetW < targetH) {
       targetW = selectedSize.h;
       targetH = selectedSize.w;
    } else if (imageOrientation === 'portrait' && targetW > targetH) {
       targetW = selectedSize.h;
       targetH = selectedSize.w;
    }

    const targetRatio = targetW / targetH;
    const imgRatio = imgW / imgH;
    
    let cw, ch;
    if (targetRatio > imgRatio) {
        cw = imgW;
        ch = imgW / targetRatio;
    } else {
        ch = imgH;
        cw = imgH * targetRatio;
    }
    
    setCropRect(prev => {
        let newX = (imgW - cw) / 2;
        let newY = (imgH - ch) / 2;
        
        if (prev.w !== 0 && activeStep === 'CROP') {
            newX = Math.max(0, Math.min(prev.x, imgW - cw));
            newY = Math.max(0, Math.min(prev.y, imgH - ch));
        }

        return { w: cw, h: ch, x: newX, y: newY };
    });
  }, [selectedSize, imageOrientation, activeStep]);

  useEffect(() => {
    const wrapper = imageWrapperRef.current;
    if (!wrapper) return;

    const resizeObserver = new ResizeObserver(() => {
      updateCropSize();
    });

    resizeObserver.observe(wrapper);
    return () => resizeObserver.disconnect();
  }, [updateCropSize]);

  useEffect(() => {
    updateCropSize();
  }, [selectedSize, updateCropSize]);


  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeStep !== 'CROP' || !selectedSize || isLockedArtDecoPurchase) return;
    e.preventDefault();
    setIsDragging(true);
    setActivePointerId(e.pointerId);
    setDragStart({ x: e.clientX - cropRect.x, y: e.clientY - cropRect.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (!isDragging || activeStep !== 'CROP' || !imageWrapperRef.current) return;
      if (activePointerId != null && e.pointerId !== activePointerId) return;
      if (e.cancelable) e.preventDefault();

      const wrapper = imageWrapperRef.current;
      const rect = wrapper.getBoundingClientRect();
      const imgW = rect.width;
      const imgH = rect.height;

      let newX = e.clientX - dragStart.x;
      let newY = e.clientY - dragStart.y;

      newX = Math.max(0, Math.min(newX, imgW - cropRect.w));
      newY = Math.max(0, Math.min(newY, imgH - cropRect.h));

      setCropRect(prev => ({ ...prev, x: newX, y: newY }));
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      if (activePointerId != null && e.pointerId !== activePointerId) return;
      if (isDragging) setIsDragging(false);
      setActivePointerId(null);
    };

    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: false });
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerUp);
    };
  }, [isDragging, dragStart, cropRect, activeStep, activePointerId]);


  // Acciones de cambio de pasos (Acordeón Navigation)
  const handleEditStep = (step: Step) => {
    if (isLockedArtDecoPurchase && (step === 'MATERIAL' || step === 'SIZE' || step === 'CROP' || step === 'MODE')) return;

    if (step === 'CROP' || step === 'SIZE' || step === 'MATERIAL') {
       setIsCropped(false); 
       setFinalCrop(null);
       setPurchaseMode('buy');
    }
    
    if (step === 'MATERIAL') setPreviewMaterial(null);
    if (step === 'SIZE') setPreviewSize(null);
    
    setActiveStep(step);
  };

  const handleConfirmMaterial = () => {
    if (!previewMaterial) return;
    setSelectedMaterial(previewMaterial);
    setActiveStep('SIZE');
  };

  const handleConfirmSize = () => {
    if (!previewSize) return;
    setSelectedSize(previewSize);
    setIsCropped(false);
    setActiveStep('CROP');
  };

async function makeCroppedDataUrl(
  originalUrlOrDataUrl: string,
  crop: { x: number; y: number; w: number; h: number }
): Promise<string> {
  // Si viene una URL remota, la descargamos como Blob y creamos un blob: URL
  // Esto evita muchos problemas de CORS/tainted canvas (best-effort).
  let blobUrl: string | null = null;

  try {
    let src = originalUrlOrDataUrl;

    const isDataUrl = /^data:image\/[^;]+;base64,/.test(originalUrlOrDataUrl);

    if (!isDataUrl) {
      const resp = await fetch(originalUrlOrDataUrl, { mode: "cors", credentials: "omit" });
      if (!resp.ok) throw new Error(`Failed to fetch image for crop: ${resp.status}`);
      const blob = await resp.blob();
      blobUrl = URL.createObjectURL(blob);
      src = blobUrl;
    }

    const img = new Image();
    img.decoding = "async";
    // Importante para CORS: si el servidor permite CORS, esto permite leer pixels
    img.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = src;
    });

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;

    const sx = Math.max(0, Math.min(sw - 1, Math.round(crop.x * sw)));
    const sy = Math.max(0, Math.min(sh - 1, Math.round(crop.y * sh)));
    const cw = Math.max(1, Math.min(sw - sx, Math.round(crop.w * sw)));
    const ch = Math.max(1, Math.min(sh - sy, Math.round(crop.h * sh)));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas context");

    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch);

    // Si el recorte es enorme, lo bajamos manteniendo el encuadre exacto.
    // Esto evita payloads gigantes.
    const MAX_SIDE = 2200; // puedes subir/bajar (más alto = más peso)
    const maxSide = Math.max(canvas.width, canvas.height);

    let outCanvas = canvas;

    if (maxSide > MAX_SIDE) {
      const scale = MAX_SIDE / maxSide;
      const w2 = Math.max(1, Math.round(canvas.width * scale));
      const h2 = Math.max(1, Math.round(canvas.height * scale));

      const scaled = document.createElement("canvas");
      scaled.width = w2;
      scaled.height = h2;

      const ctx2 = scaled.getContext("2d");
      if (!ctx2) throw new Error("No canvas context (scaled)");

      ctx2.drawImage(canvas, 0, 0, w2, h2);
      outCanvas = scaled;
    }

    // JPEG reduce muchísimo el peso frente a PNG.
    // (Para fábrica igual adjuntamos la original 4K + coordenadas; esto es preview exacto)
    return outCanvas.toDataURL("image/jpeg", 0.9);
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

const handleConfirmCrop = async () => {
  if (cropProcessing) return;

  const wrapper = imageWrapperRef.current;

  if (!wrapper || !image || !selectedSize) {
    setCropGenError("No se pudo preparar el recorte. Reintenta.");
    setActiveStep("CROP");
    return;
  }

  const rect = wrapper.getBoundingClientRect();
  const imgW = rect.width;
  const imgH = rect.height;

  if (!(imgW > 0 && imgH > 0) || !(cropRect.w > 0 && cropRect.h > 0)) {
    setCropGenError("Selecciona un área de recorte válida antes de confirmar.");
    setActiveStep("CROP");
    return;
  }

  setCropProcessing(true);
  setCropGenError(null);

  try {
    let targetW = selectedSize.w;
    let targetH = selectedSize.h;

    if (imageOrientation === "landscape" && targetW < targetH) {
      targetW = selectedSize.h;
      targetH = selectedSize.w;
    } else if (imageOrientation === "portrait" && targetW > targetH) {
      targetW = selectedSize.h;
      targetH = selectedSize.w;
    }

    const aspect = targetW / targetH;
    const normalized = {
      x: cropRect.x / imgW,
      y: cropRect.y / imgH,
      w: cropRect.w / imgW,
      h: cropRect.h / imgH,
    };

    setFinalCrop({ ...normalized, aspect });

    try {
      const cdu = await makeCroppedDataUrl(image, normalized);
      if (cdu && typeof cdu === "string") {
        setCroppedDataUrl(cdu);
      } else {
        setCroppedDataUrl(null);
      }
      setCropGenError(null);
    } catch (e: any) {
      console.warn('[1NationUp] No se pudo generar preview local del recorte; se usará el encuadre confirmado.', e);
      setCroppedDataUrl(null);
      setCropGenError(null);
    }

    setIsCropped(true);
    setPurchaseMode('buy');
    setActiveStep('CROP');
  } catch (e: any) {
    setCroppedDataUrl(null);
    setFinalCrop(null);
    setIsCropped(false);
    setIsDragging(false);
    setActivePointerId(null);
    setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    setCropGenError(e?.message ? String(e.message) : String(e));
    setActiveStep("CROP");
  } finally {
    setCropProcessing(false);
  }
};

const buildArtDecoPayload = (): StoreArtDecoPayload => {
  if (!asset || !selectedMaterial || !selectedSize || !finalCrop) {
    throw new Error('Completa material, tamaño y encuadre antes de publicar.');
  }

  const salePrice = listingPriceUsdValue;
  return {
    assetId: asset.id,
    assetUrl: asset.url,
    assetName: asset.name,
    imageDims: dims ? { w: dims.w, h: dims.h } : null,
    material: selectedMaterial.id as StoreArtDecoPayload['material'],
    materialLabel: selectedMaterial.label,
    size: {
      id: selectedSize.id,
      wIn: Number(selectedSize.w),
      hIn: Number(selectedSize.h),
      label: selectedSize.label,
    },
    fitMode: 'crop',
    cropNormalized: finalCrop,
    croppedImageDataUrl: croppedDataUrl || null,
    pricing: {
      basePrice: selectedBasePrice,
      salePrice,
      sellerProfit: roundUsd(salePrice - selectedBasePrice),
      currency: 'USD',
    },
  };
};

const handlePublishArtDeco = async () => {
  setSubmitError('');

  if (!sellerEnabled) {
    setSubmitError('Necesitas plan Pro o superior para vender Art Deco en Community Store.');
    return;
  }
  if (!canPublishListing) {
    setSubmitError(`Debes publicar por encima del costo base ${formatUsd(minimumSellPrice)}.`);
    return;
  }

  try {
    setPurchaseMode('sell');
    setActiveStep('PROCESSING');
    const payload = buildArtDecoPayload();
    const result = await createArtDecoListing({
      previewAssetId: asset!.id,
      name: listingForm.name.trim() || `${asset?.name || 'Creación'} · Art Deco`,
      description:
        listingForm.description.trim() ||
        'Edición Art Deco lista para producción física. El comprador recibirá la pieza real con el encuadre validado por el creador.',
      priceUsd: listingPriceUsdValue,
      currency: 'USD',
      artDecoPayload: payload,
    });
    setPublishedListingId(result.listingId);
    setSuccessMode('listing');
    setPurchaseMode('sell');
    setOrderCode(result.listingId);
    setActiveStep('SUCCESS');
  } catch (e: any) {
    setSubmitError(e?.message || 'No se pudo publicar el Art Deco.');
    setActiveStep('MODE');
  }
};

const handleCheckoutSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setSubmitError('');

  // Bloqueo fuerte: no seguimos si no es 4K o no hay asset subido
  if (!is4kOk) {
    setSubmitError('Tu imagen debe ser 4K mínimo (3840×2160). Usa otra imagen o escala con IA.');
    return;
  }
  if (!asset) {
    setSubmitError('No se encontró el archivo subido. Vuelve a subir la imagen.');
    return;
  }
  if (!selectedMaterial || !selectedSize) {
    setSubmitError('Falta seleccionar material y tamaño.');
    return;
  }

  // Bloqueo fuerte: no permitir completar orden si no hay coordenadas de recorte confirmadas
  if (!finalCrop) {
    setSubmitError("No se detectó un encuadre confirmado. Vuelve al paso 3 y confirma el recorte.");
    setActiveStep("CROP");
    return;
  }

  // Validaciones simples (evita fallos tontos)
  const email = String(formData.email || '').trim();
  const phone = String(formData.phone || '').trim();
  if (!email.includes('@') || !email.includes('.')) {
    setSubmitError('Email inválido. Revisa el correo.');
    return;
  }
  const onlyDigits = phone.replace(/\D/g, '');
  if (onlyDigits.length < 10) {
    setSubmitError('Teléfono inválido. Debe tener al menos 10 dígitos.');
    return;
  }

  

  // Confirmación previa (compra en USD)
  const shippingCostPreview = formData.method === 'pickup' ? 0 : SHIPPING_FEE;
  const smartFillAddonPreview = 0;
  const basePricePreview = checkoutUnitPrice;
  const totalPreview = roundUsd(basePricePreview + shippingCostPreview + smartFillAddonPreview);

  const itemLabel = isLockedArtDecoPurchase
    ? `Compra Art Deco (${String(prefillArtDeco?.name || asset?.name || 'Pieza física')})`
    : `Pedido 1NationUp (${String(selectedMaterial?.label || 'Material')} · ${String(selectedSize?.label || selectedSize?.id || 'Tamaño')})`;
  const amountLabel = formatUsd(totalPreview);
  const note =
    formData.method === 'pickup'
      ? 'Retiro (pickup). El total mostrado incluye cualquier cargo aplicable.'
      : isLockedArtDecoPurchase
        ? 'Estás comprando una creación Art Deco física. Al finalizar, recibirás confirmación y la fábrica recibirá el encuadre original.'
        : 'El total mostrado incluye envío estimado.';

  setConfirmPayInfo({
    itemLabel,
    amountLabel,
    note,
    action: async () => {
      setSubmitError('');
      setPurchaseMode('buy');
      setActiveStep('PROCESSING');

      try {
        // Validaciones (por si cambió estado desde que abrimos la confirmación)
        if (!is4kOk) throw new Error('Tu imagen debe ser 4K mínimo (3840×2160). Usa otra imagen o escala con IA.');
        if (!asset) throw new Error('No se encontró el archivo subido. Vuelve a subir la imagen.');
        if (!selectedMaterial || !selectedSize) throw new Error('Falta seleccionar material y tamaño.');
        if (!finalCrop) throw new Error('No se detectó un encuadre confirmado. Vuelve al paso 3 y confirma el recorte.');

        const email = String(formData.email || '').trim();
        const phone = String(formData.phone || '').trim();
        if (!email.includes('@') || !email.includes('.')) throw new Error('Email inválido. Revisa el correo.');
        const onlyDigits = phone.replace(/\D/g, '');
        if (onlyDigits.length < 10) throw new Error('Teléfono inválido. Debe tener al menos 10 dígitos.');

        // 1) token supabase para Authorization Bearer (tu backend lo exige)
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Debes iniciar sesión para comprar.');

        // 2) calcular fitMode (si confirmaste recorte -> "crop", si no -> "perfect")
        const fitMode = finalCrop ? 'crop' : (prefillArtDeco?.artDecoPayload?.fitMode || 'perfect');

        const shippingCost = formData.method === 'pickup' ? 0 : SHIPPING_FEE;
        const smartFillAddon = 0;
        const basePrice = checkoutUnitPrice;
        const total = roundUsd(basePrice + shippingCost + smartFillAddon);

        if (!selectedMaterial?.label) throw new Error('Material inválido: falta label.');

        const payload: any = {
          assetId: asset.id,
          assetUrl: asset.url,
          assetName: asset.name,

          imageDims: dims ? { w: dims.w, h: dims.h } : null,
          require4k: true,

          material: selectedMaterial.id,
          materialLabel: selectedMaterial.label,

          size: {
            id: selectedSize.id,
            wIn: Number(selectedSize.w),
            hIn: Number(selectedSize.h),
            label: selectedSize.label,
          },

          fitMode,
          crop: null,
          cropNormalized: finalCrop ? finalCrop : null,
          croppedImageDataUrl:
            croppedDataUrl && approxDataUrlBytes(croppedDataUrl) <= 8 * 1024 * 1024 ? croppedDataUrl : undefined,

          pricing: {
            basePrice,
            shipping: shippingCost,
            smartFillAddon,
            total,
          },

          delivery: {
            method: formData.method === 'pickup' ? 'pickup' : 'ship',
            customerName: String(formData.name || '').trim(),
            email,
            phone,

            address1:
              formData.method === 'pickup'
                ? null
                : String(formData.address || '').trim() + (formData.apt ? ` Apt ${String(formData.apt).trim()}` : ''),
            city: formData.method === 'pickup' ? null : String(formData.city || '').trim(),
            state: formData.method === 'pickup' ? null : String(formData.state || '').trim(),
            zip: formData.method === 'pickup' ? null : String(formData.zip || '').trim(),
          },

          notes: String(formData.notes || '').trim(),
          flags: {},
        };

        if (isLockedArtDecoPurchase && prefillArtDeco?.id) {
          const authoritativeBase = roundUsd(Number(prefillArtDeco.artDecoPayload?.pricing?.basePrice || lockedBasePrice));
          const salePriceUsd = roundUsd(Number(prefillArtDeco.priceUsd || prefillArtDeco.artDecoPayload?.pricing?.salePrice || basePrice));
          payload.artDeco = {
            listingId: prefillArtDeco.id,
            sellerId: prefillArtDeco.sellerId || null,
            sellerUsername: prefillArtDeco.sellerUsername || undefined,
            salePriceUsd,
            basePriceUsd: authoritativeBase,
            sellerProfitUsd: roundUsd(Math.max(0, salePriceUsd - authoritativeBase)),
            currency: prefillArtDeco.currency || prefillArtDeco.artDecoPayload?.pricing?.currency || 'USD',
          };
        }

        const resp = await fetch(apiUrl('/api/store/order'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const text = await resp.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }

        if (!resp.ok || !data?.ok) {
          const msg = data?.error?.message || `Error al crear orden (HTTP ${resp.status})`;
          throw new Error(msg);
        }

        setSuccessMode('order');
        setOrderCode(String(data.orderId || ''));
        setActiveStep('SUCCESS');
      } catch (err: any) {
        const msg = err?.message || 'Error inesperado al procesar el pedido.';
        setSubmitError(msg);
        setActiveStep('CHECKOUT');
        throw new Error(msg);
      }
    },
  });

  setConfirmPayOpen(true);
  return;
};
  // --- COMPONENTES VISUALES DINÁMICOS DEL LADO IZQUIERDO ---

  // Visualizador 3D del Material
  const renderMaterialInfographic = () => {
    if (!previewMaterial) {
      return (
        <div className="flex flex-col items-center justify-center animate-in fade-in duration-500">
           <Layers className="w-16 h-16 text-gray-500 mb-4 opacity-50"/>
           <p className="text-gray-400 font-medium">Material</p>
        </div>
      );
    }

    const matId = previewMaterial.id;
    const isPortrait = imageOrientation === 'portrait';
    const baseClass = `iso-layer rounded-lg overflow-hidden bg-cover bg-center`;
    
    return (
      <div className="flex flex-col items-center justify-center w-full h-full animate-in zoom-in-95 duration-500">
         <div className={`relative iso-container ${isPortrait ? 'w-[150px] h-[210px] sm:w-[200px] sm:h-[280px]' : 'w-[210px] h-[150px] sm:w-[280px] sm:h-[200px]'} mb-10`}>
            {matId === 'acrylic' && (
              <>
                <div className={`${baseClass} shadow-[0_20px_50px_rgba(0,0,0,0.8)]`} style={{ transform: 'translateZ(-40px)', backgroundColor: '#111' }}>
                </div>
                <div className={`${baseClass}`} style={{ transform: 'translateZ(0px)', backgroundImage: `url(${image})` }}></div>
                <div className={`${baseClass} border border-white/20`} style={{ transform: 'translateZ(20px)', background: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.1) 100%)', backdropFilter: 'blur(1px)' }}>
                </div>
              </>
            )}
            {matId === 'canvas' && (
              <>
                <div className={`${baseClass} shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-[8px] border-[#3e2723]`} style={{ transform: 'translateZ(-30px)', backgroundColor: '#e0c097' }}>
                </div>
                <div className={`${baseClass} border-4 border-black/10`} style={{ transform: 'translateZ(10px)', backgroundImage: `url(${image})`, filter: 'sepia(0.1) contrast(0.95)' }}>
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/canvas-orange.png')] opacity-30 mix-blend-multiply"></div>
                </div>
              </>
            )}
            {matId === 'metal' && (
              <>
                <div className={`${baseClass} shadow-[0_30px_60px_rgba(0,0,0,0.9)]`} style={{ transform: 'translateZ(-50px)', backgroundColor: '#222', width: '50%', height: '50%', top: '25%', left: '25%' }}>
                </div>
                <div className={`${baseClass} border border-white/10`} style={{ transform: 'translateZ(0px)', backgroundImage: `url(${image})`, filter: 'contrast(1.1) saturate(1.2)' }}>
                   <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent"></div>
                </div>
              </>
            )}
            {matId === 'paper' && (
              <>
                <div className={`${baseClass} shadow-[0_15px_30px_rgba(0,0,0,0.6)] border-[10px] border-[#111]`} style={{ transform: 'translateZ(-20px)', backgroundColor: '#fff' }}>
                </div>
                <div className={`${baseClass} m-6 shadow-inner`} style={{ transform: 'translateZ(-19px)', backgroundImage: `url(${image})` }}></div>
                <div className={`${baseClass} border-[10px] border-[#111]`} style={{ transform: 'translateZ(10px)', background: 'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 100%)' }}></div>
              </>
            )}
         </div>
        </div>
    );
  };

  // Visualizador 2.5D Hiperrealista (Luxury Estética)
  const renderSizeMockup = () => {
    if (!previewSize) {
      return (
        <div className="flex flex-col items-center justify-center animate-in fade-in duration-500">
           <Maximize className="w-16 h-16 text-gray-500 mb-4 opacity-50"/>
           <p className="text-gray-400 font-medium">Medida</p>
        </div>
      );
    }

    // Escala 1 a 1: 1 unidad de SVG = 1 pulgada real.
    let mockupW = previewSize.w;
    let mockupH = previewSize.h;

    // Auto-orientar si la foto es apaisada
    if (imageOrientation === 'landscape' && mockupW < mockupH) {
       const temp = mockupW;
       mockupW = mockupH;
       mockupH = temp;
    } else if (imageOrientation === 'portrait' && mockupW > mockupH) {
       const temp = mockupW;
       mockupW = mockupH;
       mockupH = temp;
    }

    // --- ALGORITMO DE PREVENCIÓN DE SUPERPOSICIÓN ---
    // La TV 42" tiene Height=21. Posicionada sobre la mesa (Y=98). Su parte superior es 98-21 = Y=77.
    // Damos un margen de seguridad de 5 pulgadas.
    const safeBottomY = 72; 
    const idealCenterY = 45; 
    
    let picY = idealCenterY - mockupH / 2;

    // Proteger cuadros grandes
    if (picY + mockupH > safeBottomY) {
       picY = safeBottomY - mockupH;
    }
    
    const picX = 100 - mockupW / 2;

    // CÁLCULO DE TECHO DINÁMICO
    const minRequiredY = picY - 20;
    const defaultMinY = -20;
    const currentMinY = Math.min(defaultMinY, minRequiredY);
    const viewBoxHeight = 150 - currentMinY; 
    
    const dynamicViewBox = `0 ${currentMinY} 200 ${viewBoxHeight}`;

    return (
      <div className="flex flex-col w-full h-full relative overflow-hidden bg-[#0a0a0c] rounded-3xl animate-in zoom-in-95 duration-500 shadow-inner">
         
         {/* SVG Principal - Render 3D Simulado */}
         <div className="flex-1 w-full h-full flex items-center justify-center p-0">
           <svg viewBox={dynamicViewBox} preserveAspectRatio="xMidYMid slice" className="w-full h-full drop-shadow-2xl overflow-visible">
              <defs>
                 {/* Textura de Pared (Ruido sutil para simular concreto/yeso) */}
                 <filter id="wallNoise" x="0%" y="0%" width="100%" height="100%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" stitchTiles="stitch" />
                    <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.03 0" />
                 </filter>
                 
                 {/* Iluminación de Galería (Foco sobre el cuadro) */}
                 <radialGradient id="galleryLight" cx="50%" cy="40%" r="70%">
                    <stop offset="0%" stopColor="#2a2d34" />
                    <stop offset="100%" stopColor="#0f1015" />
                 </radialGradient>
                 
                 {/* Sombreado HD (Drop Shadow Pesado) */}
                 <filter id="shadowHD" x="-20%" y="-20%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#000" floodOpacity="0.9"/>
                 </filter>
                 <filter id="shadowSoft" x="-20%" y="-20%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.5"/>
                 </filter>

                 {/* Materiales Lujosos */}
                 <linearGradient id="goldMaterial" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#C5A059"/>
                    <stop offset="50%" stopColor="#8B6914"/>
                    <stop offset="100%" stopColor="#E2C77D"/>
                 </linearGradient>

                 <linearGradient id="woodWalnut" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#1e1511"/>
                    <stop offset="50%" stopColor="#2a1e18"/>
                    <stop offset="100%" stopColor="#1e1511"/>
                 </linearGradient>

                 <linearGradient id="tvScreen" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#0b101d"/>
                    <stop offset="100%" stopColor="#020306"/>
                 </linearGradient>

                 <linearGradient id="glassGlare" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.08"/>
                    <stop offset="35%" stopColor="white" stopOpacity="0.0"/>
                 </linearGradient>

                 <linearGradient id="floorMarble" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#0a0a0c"/>
                    <stop offset="100%" stopColor="#15151a"/>
                 </linearGradient>

                 {/* Flechas Doradas Premium */}
                 <marker id="tickGold" markerWidth="4" markerHeight="4" refX="2" refY="2">
                    <line x1="0" y1="0" x2="4" y2="4" stroke="#DFB142" strokeWidth="0.5" />
                    <line x1="4" y1="0" x2="0" y2="4" stroke="#DFB142" strokeWidth="0.5" />
                 </marker>
              </defs>

              {/* Pared Hiperrealista */}
              <rect x="0" y={currentMinY} width="200" height={120 - currentMinY} fill="url(#galleryLight)" />
              <rect x="0" y={currentMinY} width="200" height={120 - currentMinY} fill="url(#wallNoise)" />
              
              {/* Rodapié y Suelo de Mármol Oscuro */}
              <rect x="0" y="118" width="200" height="2" fill="#050505" />
              <polygon points="0,120 200,120 200,150 0,150" fill="url(#floorMarble)" />
              <polygon points="0,120 200,120 200,150 0,150" fill="url(#wallNoise)" opacity="0.5" />
              
              {/* Reflejo base en el piso */}
              <polygon points="0,120 200,120 200,125 0,125" fill="white" opacity="0.02" />

              {/* Lámpara de Diseño (Latón Cepillado) - Izquierda */}
              <g transform="translate(0, 0)">
                 {/* Base pesada de mármol */}
                 <ellipse cx="25" cy="120" rx="8" ry="2" fill="#111" />
                 <path d="M 18,118 Q 25,115 32,118 L 33,120 L 17,120 Z" fill="#222" />
                 {/* Poste principal dorado */}
                 <rect x="24.5" y="45" width="1" height="73" fill="url(#goldMaterial)" filter="url(#shadowSoft)" />
                 {/* Brazo curvo */}
                 <path d="M 25,45 Q 35,35 45,45" fill="none" stroke="url(#goldMaterial)" strokeWidth="1" />
                 {/* Cabezal tipo cono */}
                 <path d="M 40,45 L 50,45 L 48,40 L 42,40 Z" fill="#111" />
                 {/* Foco de Luz */}
                 <polygon points="42,45 48,45 60,120 20,120" fill="#E2C77D" opacity="0.04" /> 
              </g>

              {/* Consola Flotante Luxury (Nogal Oscuro) */}
              <g transform="translate(0, 0)">
                 <rect x="60" y="98" width="80" height="12" fill="url(#woodWalnut)" rx="1.5" filter="url(#shadowHD)" />
                 <rect x="60" y="98" width="80" height="0.5" fill="#3a2a22" /> {/* Luz en el borde superior */}
                 {/* Cajones Seamless */}
                 <line x1="86" y1="98" x2="86" y2="110" stroke="#000" strokeWidth="0.5" opacity="0.6" />
                 <line x1="112" y1="98" x2="112" y2="110" stroke="#000" strokeWidth="0.5" opacity="0.6" />
                 {/* Tiras LED debajo de la consola */}
                 <rect x="65" y="110" width="70" height="4" fill="#E2C77D" opacity="0.1" filter="url(#shadowSoft)" />
              </g>

              {/* TV OLED 42" A Escala (37" ancho x 21" alto) */}
              <g transform="translate(0, 0)">
                 {/* Soporte Metálico Central */}
                 <path d="M 92,98 L 108,98 L 105,95 L 95,95 Z" fill="#111" />
                 <rect x="99.5" y="85" width="1" height="10" fill="#222" />
                 
                 {/* Panel OLED (Ultrafino y Glossy) */}
                 <rect x="81.5" y="77" width="37" height="21" rx="0.5" fill="#020202" filter="url(#shadowHeavy)" />
                 <rect x="81.8" y="77.3" width="36.4" height="20.4" fill="url(#tvScreen)" />
                 
                 {/* Texto en Pantalla */}
                 <text x="100" y="88.5" fill="rgba(255,255,255,0.6)" fontSize="2.5" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1" fontWeight="300">42" OLED 4K</text>
                 
                 {/* Reflejo del Cristal */}
                 <polygon points="81.8,77.3 118.2,77.3 118.2,97.7 81.8,77.3" fill="url(#glassGlare)" pointerEvents="none" />
                 <line x1="81.5" y1="77" x2="118.5" y2="77" stroke="#333" strokeWidth="0.2" />
              </g>

              {/* PS5 (Consola Next-Gen) */}
              <g transform="translate(0, 0)">
                 {/* Cuerpo blanco curvado */}
                 <rect x="123" y="82" width="4" height="16" rx="2" fill="#e2e8f0" filter="url(#shadowSoft)" />
                 {/* Núcleo Negro */}
                 <rect x="124" y="82.5" width="2" height="15" fill="#000" />
                 {/* Tira LED Azul Neón */}
                 <rect x="124.5" y="82.5" width="0.4" height="15" fill="#3b82f6" filter="url(#shadowSoft)" />
              </g>

              {/* Planta Premium (Maceta de Concreto y Hojas Monstera) */}
              <g transform="translate(0, 0)">
                 {/* Maceta Cilíndrica Concreto */}
                 <polygon points="146,120 160,120 162,95 144,95" fill="#2d2d30" filter="url(#shadowHD)" />
                 <ellipse cx="153" cy="95" rx="9" ry="2" fill="#111" />
                 
                 {/* Follaje Orgánico Profundo */}
                 <ellipse cx="153" cy="80" rx="7" ry="22" fill="#1b362c" transform="rotate(-15 153 80)" />
                 <ellipse cx="153" cy="85" rx="8" ry="18" fill="#244d3d" transform="rotate(20 153 85)" />
                 <ellipse cx="153" cy="75" rx="6" ry="15" fill="#2c634e" />
                 <ellipse cx="153" cy="88" rx="8" ry="16" fill="#172b23" transform="rotate(-35 153 88)" />
                 <ellipse cx="153" cy="86" rx="7" ry="14" fill="#2c634e" transform="rotate(45 153 86)" />
              </g>

              {/* TU CUADRO DINÁMICO */}
              <g>
                <foreignObject x={picX} y={picY} width={mockupW} height={mockupH}>
                  <div 
                    className="w-full h-full bg-cover bg-center shadow-[0_25px_50px_rgba(0,0,0,0.95)] border border-[#222]"
                    style={{ backgroundImage: `url(${image})` }}
                  />
                </foreignObject>
                
                {/* Cotas Arquitectónicas Luxury (Cobre/Dorado) */}
                <line x1={picX} y1={picY - 3} x2={picX + mockupW} y2={picY - 3} stroke="#DFB142" strokeWidth="0.4" markerStart="url(#tickGold)" markerEnd="url(#tickGold)" opacity="0.8" />
                <text x={picX + mockupW/2} y={picY - 4.5} fill="#DFB142" fontSize="3.5" textAnchor="middle" fontWeight="bold" letterSpacing="0.5">{mockupW}"</text>

                <line x1={picX - 3} y1={picY} x2={picX - 3} y2={picY + mockupH} stroke="#DFB142" strokeWidth="0.4" markerStart="url(#tickGold)" markerEnd="url(#tickGold)" opacity="0.8" />
                <text x={picX - 4.5} y={picY + mockupH/2} fill="#DFB142" fontSize="3.5" textAnchor="middle" fontWeight="bold" transform={`rotate(-90, ${picX - 4.5}, ${picY + mockupH/2})`} letterSpacing="0.5">{mockupH}"</text>
              </g>
           </svg>
         </div>

         {/* Leyenda Arquitectónica (Dark Mode Lujoso) */}
         <div className="w-full bg-[#050507] border-t border-[#1a1a24] p-4 lg:p-5 flex justify-between items-center text-[10px] sm:text-xs z-30">
            <div className="flex items-center space-x-6">
               <div className="flex items-center space-x-2 hidden lg:flex">
                  <div className="w-2.5 h-2.5 bg-[#C5A059] rounded-sm shadow-sm border border-[#fff]/10"></div>
                  <span className="text-[#888]">Lámpara Diseño: <b className="text-[#ccc] font-medium">Arc 65"</b></span>
               </div>
               <div className="flex items-center space-x-2 hidden sm:flex">
                  <div className="w-2.5 h-2.5 bg-[#2a1e18] rounded-sm shadow-sm border border-[#fff]/10"></div>
                  <span className="text-[#888]">Consola Flotante: <b className="text-[#ccc] font-medium">80" x 12"</b></span>
               </div>
               <div className="flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 bg-[#0b101d] rounded-sm shadow-sm border border-[#fff]/10"></div>
                  <span className="text-[#888]">Smart TV: <b className="text-[#ccc] font-medium">42" (37" x 21")</b></span>
               </div>
            </div>
            
            {/* Tag Resaltado del Cuadro */}
            <div className="flex items-center space-x-2 bg-[#DFB142]/10 px-4 py-2 rounded-lg border border-[#DFB142]/30 flex-shrink-0">
               <div className="w-2 h-2 rounded-full bg-[#DFB142] animate-pulse shadow-[0_0_8px_rgba(223,177,66,0.8)]"></div>
               <span className="text-[#DFB142] font-semibold tracking-wide uppercase text-[10px]">
                  Tu Arte: <b className="text-white ml-1">{mockupW}" x {mockupH}"</b>
               </span>
            </div>
         </div>
      </div>
    );
  };

  // Visualizador Definitivo del Corte (Se muestra en Checkout para dar seguridad)
  const renderFinalCropPreview = () => {
    if (!finalCrop) return null;
    return (
      <div className="flex flex-col items-center justify-center w-full h-full animate-in zoom-in duration-500">
         <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-green-500/20 text-green-400 px-6 py-2 rounded-full backdrop-blur-md border border-green-500/30 z-20 flex items-center space-x-2">
            <Check className="w-4 h-4" />
            <span className="font-bold tracking-widest">Encuadre Exacto Confirmado</span>
         </div>

         <div className="w-full flex-1 min-h-0 flex items-center justify-center relative mt-4">
             <div 
               className="relative overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.8)] border-[3px] border-[#22c55e] rounded-xl bg-[#0a0a0a]"
               style={{ 
                   // Aseguramos que el contenedor respete el aspect ratio de la medida seleccionada y ocupe el mayor espacio posible
                   width: finalCrop.aspect > 1 ? '100%' : 'auto',
                   height: finalCrop.aspect > 1 ? 'auto' : '100%',
                   aspectRatio: finalCrop.aspect,
                   maxHeight: '100%',
                   maxWidth: '100%'
               }}
             >
                {/* Matemáticas CSS puras para ampliar y aislar solo la parte cortada */}
                  {croppedDataUrl ? (
                    <img
                      src={croppedDataUrl}
                      alt="Cropped Final"
                      className="w-full h-full object-cover"
                      style={{ position: "absolute", inset: 0 }}
                    />
                  ) : (
                    <img
                      src={image}
                      style={{
                        position: 'absolute',
                        left: `-${(finalCrop.x / finalCrop.w) * 100}%`,
                        top: `-${(finalCrop.y / finalCrop.h) * 100}%`,
                        width: `${100 / finalCrop.w}%`,
                        height: `${100 / finalCrop.h}%`,
                        maxWidth: 'none',
                        maxHeight: 'none',
                      }}
                      alt="Cropped Final"
                    />
                  )}
             </div>
         </div>
         
               </div>
    );
  };

  const renderCropper = () => {
    return (
      <div className="w-full h-full min-h-0 flex items-center justify-center overflow-hidden overscroll-contain px-1 sm:px-3 pb-1 sm:pb-2">
        <div 
          ref={imageWrapperRef} 
          className="relative inline-flex items-center justify-center max-w-full max-h-full shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-md overflow-hidden touch-none select-none"
          style={{ maxHeight: '100%', maxWidth: '100%' }}
        >
        <img 
          src={image} 
          alt="Upload" 
          onLoad={updateCropSize}
          className="block max-w-full max-h-full object-contain pointer-events-none select-none touch-none"
          draggable={false}
        />

        {selectedSize && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 transition-opacity duration-300">
              <defs>
                  <mask id="crop-mask">
                      <rect width="100%" height="100%" fill="white" />
                      <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
                  </mask>
              </defs>
              <rect 
                width="100%" 
                height="100%" 
                fill="rgba(0,0,0,0.65)" 
                mask="url(#crop-mask)" 
                className="transition-all duration-500"
              />
          </svg>
        )}

        {selectedSize && (
          <div 
            className={`absolute transition-transform z-20 ${activeStep !== 'CROP' ? 'pointer-events-none' : isLockedArtDecoPurchase ? 'cursor-default' : 'cursor-move hover:scale-[1.01]'}`}
            style={{
              left: `${cropRect.x}px`,
              top: `${cropRect.y}px`,
              width: `${cropRect.w}px`,
              height: `${cropRect.h}px`,
              touchAction: 'none',
              overscrollBehavior: 'contain',
            }}
            onPointerDown={handlePointerDown}
          >
            <svg className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-300 ${activeStep === 'CROP' ? 'opacity-100' : 'opacity-0'}`}>
               <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="white" strokeWidth="2.5" strokeDasharray="10 10" className="animate-marching-ants drop-shadow-md" />
            </svg>
            
            <div className={`absolute inset-0 border-2 transition-all duration-300 ${activeStep === 'CHECKOUT' || activeStep === 'SUCCESS' ? 'border-solid border-green-400 opacity-100 shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'opacity-0'}`}></div>
            
            {isDragging && activeStep === 'CROP' && (
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-60">
                <div className="border-r border-b border-white/50"></div>
                <div className="border-r border-b border-white/50"></div>
                <div className="border-b border-white/50"></div>
                <div className="border-r border-b border-white/50"></div>
                <div className="border-r border-b border-white/50"></div>
                <div className="border-b border-white/50"></div>
                <div className="border-r border-white/50"></div>
                <div className="border-r border-white/50"></div>
                <div></div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    );
  };

  const renderConfirmationPreview = () => {
    if (!image) return null;

    return (
      <div className="w-full h-full min-h-0 flex items-center justify-center p-2 sm:p-4 lg:p-6">
        <div className="relative w-full h-full rounded-[30px] overflow-hidden border border-white/12 bg-black/55 shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
          <img src={image} alt={asset?.name || 'Imagen cargada'} className="w-full h-full object-contain" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/55 to-transparent px-4 sm:px-6 py-5 sm:py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.34em] text-white/45">Paso 1 · Confirmar imagen</div>
                <div className="mt-2 text-base sm:text-xl font-semibold text-white">{asset?.name || 'Tu creación está lista para avanzar'}</div>
              </div>
              {dims ? (
                <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs sm:text-sm font-semibold ${is4kOk ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/35 bg-amber-500/10 text-amber-100'}`}>
                  <span>{dims.w}×{dims.h}</span>
                  <span className="h-1 w-1 rounded-full bg-current/80" />
                  <span>{is4kOk ? '4K lista' : 'Requiere upscale'}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderVisualEditor = () => {
    if (!image) return null;

    return (
      <div className={`relative w-full h-full min-h-0 rounded-[30px] border border-white/8 bg-black/40 overflow-hidden backdrop-blur-sm shadow-2xl ${activeStep === 'CROP' && !isCropped ? 'p-2 sm:p-3 lg:p-4' : 'p-3 sm:p-4 lg:p-6'}`}>
        {activeStep === 'VERIFYING' && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#7EAAED] to-[#7D45A9]">
              Analizando resolución 4K...
            </h3>
          </div>
        )}

        {image && !dimsLoading && dims && !is4kOk && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/82 backdrop-blur-sm animate-in fade-in duration-300 p-4 text-center">
            <div className="max-w-xl w-full rounded-3xl border border-red-500/30 bg-black/60 p-5 shadow-[0_0_40px_rgba(239,68,68,0.15)]">
              <h3 className="text-2xl font-extrabold text-white">Resolución insuficiente</h3>
              <p className="text-gray-300 mt-2">
                Tu imagen es <span className="text-white font-bold">{dims.w}×{dims.h}</span>. Se requiere <span className="text-white font-bold">4K (3840×2160)</span>.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                <button
                  type="button"
                  onClick={handleGoToUpscale}
                  className="px-5 py-3 rounded-2xl bg-[#DFB142] text-black font-extrabold hover:brightness-110 transition"
                >
                  Ir a Upscale
                </button>

                <button
                  type="button"
                  onClick={resetToLanding}
                  className="px-5 py-3 rounded-2xl bg-white/10 text-white font-bold hover:bg-white/20 transition"
                >
                  Elegir otra imagen
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="w-full h-full min-h-0 flex items-center justify-center overflow-hidden">
          {activeStep === 'CONFIRM' && renderConfirmationPreview()}
          {activeStep === 'MATERIAL' && renderMaterialInfographic()}
          {activeStep === 'SIZE' && renderSizeMockup()}
          {activeStep === 'CROP' && (isCropped ? renderFinalCropPreview() : renderCropper())}
          {(activeStep === 'MODE' || activeStep === 'CHECKOUT' || activeStep === 'SUCCESS' || activeStep === 'PROCESSING') && (finalCrop ? renderFinalCropPreview() : renderConfirmationPreview())}
        </div>
      </div>
    );
  };

  const renderCheckoutFormCard = () => {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/10 bg-black/55 backdrop-blur-xl shadow-[0_22px_80px_rgba(0,0,0,0.42)] overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-white/10">
          <div className="text-[10px] uppercase tracking-[0.34em] text-white/45">Paso final</div>
          <div className="mt-2 text-xl font-semibold text-white">Checkout</div>
        </div>

        <div className="flex-1 min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6 custom-scrollbar">
          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
            <div className="flex justify-between items-center text-sm text-gray-300 mb-2 gap-3">
              <span className="min-w-0 truncate">{isLockedArtDecoPurchase ? (prefillArtDeco?.name || 'Art Deco físico') : `${selectedMaterial?.label} (${selectedSize?.label})`}</span>
            </div>
            <div className="space-y-2 border-t border-white/10 pt-3 text-sm">
              <div className="flex justify-between items-center text-gray-300"><span>{isLockedArtDecoPurchase ? 'Precio Art Deco' : 'Costo de producción'}</span><span>{formatUsd(checkoutUnitPrice)}</span></div>
              <div className="flex justify-between items-center text-gray-300"><span>{formData.method === 'pickup' ? 'Retiro' : 'Envío'}</span><span>{formatUsd(shippingCost)}</span></div>
              <div className="flex justify-between items-center text-lg font-bold text-white pt-2"><span>Total</span><span className="text-[#DFB142]">{formatUsd(checkoutTotal)}</span></div>
            </div>
          </div>

          <form ref={checkoutFormRef} onSubmit={handleCheckoutSubmit} className="space-y-4">
            {submitError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-white">
                {submitError}
              </div>
            )}
            <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Nombre completo" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
            <input required type="email" className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Correo electrónico" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}/>
            <input required type="tel" className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Número de teléfono" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}/>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFormData({...formData, method: 'shipping'})} className={`py-3 rounded-2xl border flex flex-col items-center justify-center space-y-1 transition-all ${formData.method === 'shipping' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                <Truck className="w-5 h-5" />
                <span className="text-xs font-medium">Envío</span>
              </button>
              <button type="button" onClick={() => setFormData({...formData, method: 'pickup'})} className={`py-3 rounded-2xl border flex flex-col items-center justify-center space-y-1 transition-all ${formData.method === 'pickup' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                <ShoppingCart className="w-5 h-5" />
                <span className="text-xs font-medium">Recoger</span>
              </button>
            </div>

            {formData.method === 'shipping' && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="grid grid-cols-3 gap-2">
                  <input required type="text" className="col-span-2 w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Dirección" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}/>
                  <input type="text" className="col-span-1 w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Apt/Suite" value={formData.apt} onChange={e => setFormData({...formData, apt: e.target.value})}/>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Ciudad" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}/>
                  <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Estado" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})}/>
                  <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Cód. postal" value={formData.zip} onChange={e => setFormData({...formData, zip: e.target.value})}/>
                </div>
              </div>
            )}

            <textarea className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm h-20 resize-none" placeholder="Notas (opcional)" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}></textarea>
            <button type="submit" className="hidden" aria-hidden="true" />
          </form>
        </div>
      </div>
    );
  };

  const renderSelectorSheet = () => {
    if (!selectorPanel) return null;
    const isMaterialPanel = selectorPanel === 'material';

    return (
      <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:p-4">
        <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSelectorPanel(null)} aria-label="Cerrar selector" />
        <div className="relative w-full sm:max-w-4xl max-h-[78dvh] rounded-t-[30px] sm:rounded-[30px] border border-white/10 bg-[#060608]/95 shadow-[0_30px_120px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10">
            <div>
              <div className="text-[10px] uppercase tracking-[0.34em] text-white/45">{isMaterialPanel ? 'Paso 2' : 'Paso 3'}</div>
              <div className="mt-1 text-lg font-semibold text-white">{isMaterialPanel ? 'Selecciona el material' : 'Selecciona la medida'}</div>
            </div>
            <button type="button" onClick={() => setSelectorPanel(null)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition">
              Cerrar
            </button>
          </div>

          <div className="max-h-[calc(78dvh-86px)] overflow-y-auto p-5 custom-scrollbar">
            {isMaterialPanel ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {MATERIALS.map((mat) => {
                  const active = selectedMaterial?.id === mat.id;
                  return (
                    <button
                      key={mat.id}
                      type="button"
                      onClick={() => {
                        setPreviewMaterial(mat);
                        setSelectedMaterial(mat);
                        setSelectorPanel(null);
                      }}
                      className={`rounded-[24px] border p-4 sm:p-5 text-left transition-all ${active ? 'border-[#DE6C53] bg-[#DE6C53]/15 shadow-[0_0_30px_rgba(222,108,83,0.18)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`mt-1 flex h-11 w-11 items-center justify-center rounded-2xl ${active ? 'bg-[#DE6C53] text-black' : 'bg-black/40 text-white'}`}>{mat.icon}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-base font-semibold text-white">{mat.label}</div>
                            {active ? <Check className="h-4 w-4 text-[#DE6C53]" /> : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-white/60">{mat.desc}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {SIZES.map((size) => {
                  const active = selectedSize?.id === size.id;
                  const price = size.basePrice * (selectedMaterial?.multiplier || previewMaterial?.multiplier || 1);
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => {
                        setPreviewSize(size);
                        setSelectedSize(size);
                        setIsCropped(false);
                        setFinalCrop(null);
                        setCroppedDataUrl(null);
                        setSelectorPanel(null);
                      }}
                      className={`rounded-[24px] border p-4 sm:p-5 text-left transition-all ${active ? 'border-[#7EAAED] bg-[#7EAAED]/15 shadow-[0_0_30px_rgba(126,170,237,0.18)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-white">{size.label}</div>
                          <div className="mt-2 text-sm text-white/55">{size.w}" × {size.h}"</div>
                        </div>
                        {active ? <Check className="mt-1 h-4 w-4 text-[#7EAAED]" /> : null}
                      </div>
                      <div className="mt-4 text-sm font-bold text-[#DFB142]">{formatUsd(price)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderBottomDock = () => {
    if (activeStep === 'VERIFYING' || activeStep === 'PROCESSING' || activeStep === 'SUCCESS' || !image) return null;

    const secondaryBtn = 'h-14 rounded-[22px] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';
    const primaryBtn = 'h-14 rounded-[22px] px-4 text-sm font-black transition disabled:opacity-40 disabled:cursor-not-allowed';

    if (activeStep === 'CONFIRM') {
      return (
        <div className="grid grid-cols-2 gap-2 rounded-[28px] border border-white/10 bg-black/65 p-3 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
          <button type="button" onClick={resetToLanding} className={secondaryBtn}>Atrás</button>
          <button type="button" onClick={() => setActiveStep('MATERIAL')} disabled={!is4kOk || !asset} className={`${primaryBtn} bg-gradient-to-r from-[#7EAAED] to-[#DFB142] text-black`}>
            Continuar
          </button>
        </div>
      );
    }

    if (activeStep === 'MATERIAL') {
      const materialLabel = selectedMaterial?.label || 'Seleccionar material';
      return (
        <div className="grid grid-cols-[0.8fr_1.35fr_0.9fr] gap-2 rounded-[28px] border border-white/10 bg-black/65 p-3 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
          <button type="button" onClick={() => setActiveStep('CONFIRM')} className={secondaryBtn}>Regresar</button>
          <button
            type="button"
            onClick={() => setSelectorPanel((value) => value === 'material' ? null : 'material')}
            className={`min-w-0 h-14 rounded-[22px] border px-4 text-left transition ${selectedMaterial ? 'border-[#DE6C53]/45 bg-[#DE6C53]/12 text-white' : 'border-[#DE6C53]/65 bg-[#DE6C53]/14 text-white animate-[pulse_1.8s_ease-in-out_infinite] shadow-[0_0_30px_rgba(222,108,83,0.18)]'}`}
          >
            <div className="truncate text-[10px] uppercase tracking-[0.28em] text-white/45">Material</div>
            <div className="truncate text-sm font-semibold">{materialLabel}</div>
          </button>
          <button type="button" onClick={() => setActiveStep('SIZE')} disabled={!selectedMaterial} className={`${primaryBtn} bg-gradient-to-r from-[#DE6C53] to-[#DFB142] text-black`}>
            Continuar
          </button>
        </div>
      );
    }

    if (activeStep === 'SIZE') {
      const sizeLabel = previewSize?.label || selectedSize?.label || DEFAULT_SIZE.label;
      return (
        <div className="grid grid-cols-[0.8fr_1.35fr_0.95fr] gap-2 rounded-[28px] border border-white/10 bg-black/65 p-3 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
          <button type="button" onClick={() => setActiveStep('MATERIAL')} className={secondaryBtn}>Regresar</button>
          <button
            type="button"
            onClick={() => setSelectorPanel((value) => value === 'size' ? null : 'size')}
            className="min-w-0 h-14 rounded-[22px] border border-[#7EAAED]/45 bg-[#7EAAED]/12 px-4 text-left text-white transition hover:bg-[#7EAAED]/16"
          >
            <div className="truncate text-[10px] uppercase tracking-[0.28em] text-white/45">Medidas</div>
            <div className="truncate text-sm font-semibold">{sizeLabel}</div>
          </button>
          <button
            type="button"
            onClick={() => {
              const nextSize = previewSize || selectedSize || DEFAULT_SIZE;
              setPreviewSize(nextSize);
              setSelectedSize(nextSize);
              setIsCropped(false);
              setCropGenError(null);
              setActiveStep('CROP');
            }}
            className={`${primaryBtn} bg-gradient-to-r from-[#7EAAED] to-[#7D45A9] text-white`}
          >
            Seleccionar medida
          </button>
        </div>
      );
    }

    if (activeStep === 'CROP') {
      return (
        <div className={`grid gap-2 rounded-[28px] border border-white/10 bg-black/65 p-3 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.35)] ${isCropped ? 'grid-cols-[0.8fr_1fr_0.8fr]' : 'grid-cols-[0.95fr_1.2fr]'}`}>
          <button
            type="button"
            onClick={() => {
              setIsCropped(false);
              setFinalCrop(null);
              setCroppedDataUrl(null);
              setActiveStep('SIZE');
            }}
            className={secondaryBtn}
          >
            Regresar
          </button>

          <button
            type="button"
            onClick={() => {
              if (isCropped) {
                setIsCropped(false);
                setCropGenError(null);
                return;
              }
              void handleConfirmCrop();
            }}
            disabled={cropProcessing}
            className={`${primaryBtn} ${isCropped ? 'bg-white/10 text-white border border-white/10' : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white'} `}
          >
            {cropProcessing ? 'Procesando...' : isCropped ? 'Reajustar recorte' : 'Confirmar recorte'}
          </button>

          {isCropped ? (
            <button type="button" onClick={() => setActiveStep('CHECKOUT')} className={`${primaryBtn} bg-gradient-to-r from-[#DFB142] to-[#DE6C53] text-black`}>
              Continuar
            </button>
          ) : null}
        </div>
      );
    }

    if (activeStep === 'CHECKOUT') {
      return (
        <div className="grid grid-cols-[0.85fr_1.15fr] gap-2 rounded-[28px] border border-white/10 bg-black/65 p-3 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
          <button type="button" onClick={() => setActiveStep('CROP')} className={secondaryBtn}>Regresar</button>
          <button type="button" onClick={() => checkoutFormRef.current?.requestSubmit()} className={`${primaryBtn} bg-gradient-to-r from-green-500 to-emerald-700 text-white flex items-center justify-center gap-2`}>
            <CreditCard className="w-4 h-4" />
            <span>{`Pay ${formatUsd(checkoutTotal)}`}</span>
          </button>
        </div>
      );
    }

    return null;
  };

  const renderTerminalState = () => {
    if (activeStep === 'PROCESSING') {
      return (
        <div className="flex-1 min-h-0 rounded-[32px] border border-white/10 bg-black/45 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] flex flex-col items-center justify-center text-center px-6 py-10">
          <div className="w-20 h-20 border-4 border-[#DFB142] border-t-transparent rounded-full animate-spin shadow-[0_0_30px_rgba(223,177,66,0.3)]"></div>
          <h2 className="mt-8 text-3xl font-bold text-white">Procesando orden...</h2>
          <p className="mt-3 max-w-xl text-sm sm:text-base text-white/65">Estamos registrando tu pedido físico y preparando la confirmación final.</p>
        </div>
      );
    }

    if (activeStep === 'SUCCESS') {
      const isListingSuccess = successMode === 'listing';
      return (
        <div className="flex-1 min-h-0 rounded-[32px] border border-white/10 bg-black/45 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] flex flex-col items-center justify-center text-center px-6 py-10">
          <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center border-2 border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.4)]">
            <Check className="w-12 h-12 text-green-400" />
          </div>
          <h2 className="mt-8 text-3xl font-bold text-white">{isListingSuccess ? '¡Art Deco publicado!' : '¡Pedido confirmado!'}</h2>
          <div className="mt-6 w-full max-w-xl rounded-3xl border border-white/10 bg-black/50 p-6">
            <span className="block text-xs text-gray-500 uppercase tracking-widest mb-2">{isListingSuccess ? 'Listing ID' : 'Código de fábrica'}</span>
            <span className="block text-2xl font-mono text-[#7EAAED] tracking-widest font-bold">{orderCode || publishedListingId || '1NUP-UNKNOWN'}</span>
          </div>
          <button type="button" onClick={resetToLanding} className="mt-6 text-sm text-[#DFB142] hover:text-white transition-colors">
            Comenzar una nueva creación
          </button>
        </div>
      );
    }

    return null;
  };

  const renderLandingHero = () => {
    return (
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-[calc(env(safe-area-inset-bottom)+112px)] sm:pb-8">
        <div className="relative min-h-full overflow-hidden rounded-[30px] sm:rounded-[36px] border border-white/10 bg-black/35 shadow-[0_30px_140px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(126,170,237,0.16),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(222,108,83,0.14),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(223,177,66,0.10),transparent_32%)]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/40 to-transparent" />

          <div className="relative flex min-h-full flex-col items-center justify-center px-5 py-8 text-center sm:px-10 sm:py-10">
            <div className="w-full max-w-4xl">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border border-white/10 bg-white/5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur sm:h-24 sm:w-24 sm:rounded-[28px]">
                <OneNationUpIcon size={58} className="h-12 w-12 object-contain sm:h-14 sm:w-14" alt="1NationUp" />
              </div>

              <div className="mt-6 sm:mt-8">
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/45 sm:text-[11px] sm:tracking-[0.36em]">1NationUp</div>
                <h1 className="mt-4 text-[1.95rem] font-black leading-[1.08] text-white sm:text-5xl lg:text-6xl">
                  Con 1NationUp podrás convertir tus ideas creativas en un producto real de la más alta calidad
                </h1>

                <button
                  type="button"
                  onClick={openHistoryPicker}
                  className="mt-7 inline-flex min-h-[64px] w-full items-center justify-center rounded-[24px] bg-gradient-to-r from-[#7EAAED] via-[#DFB142] to-[#DE6C53] px-6 py-4 text-base font-black text-black shadow-[0_25px_80px_rgba(126,170,237,0.22)] transition hover:scale-[1.01] sm:mt-8 sm:w-auto sm:px-10 sm:text-lg"
                >
                  Carga aquí tu creación y hazla realidad
                </button>

                <p className="mt-5 mx-auto max-w-3xl text-sm leading-6 text-white/68 sm:mt-6 sm:text-base sm:leading-7">
                  Para convertir tus creaciones de imagen en producto real, tu imagen debe cumplir con los requerimientos de resolución. Si la imagen que cargues no cumple, podrá redirigirte a la herramienta de upscale y con un simple click quedará lista.
                </p>

                {uploadError ? (
                  <div className="mt-5 mx-auto max-w-xl rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {uploadError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  };

  const isLandingView = !image && activeStep === 'UPLOAD';
  const isCropFocusView = Boolean(image && activeStep === 'CROP' && !isCropped);

  return (
    <div className="h-[100dvh] min-h-screen bg-[#050505] font-sans text-white overflow-hidden flex flex-col relative">
      <ParticleBackground />
      <ConfirmDollarPurchaseModal
        open={confirmPayOpen}
        itemLabel={confirmPayInfo?.itemLabel || ""}
        amountLabel={confirmPayInfo?.amountLabel || ""}
        note={confirmPayInfo?.note || null}
        onClose={() => {
          setConfirmPayOpen(false);
          setConfirmPayInfo(null);
        }}
        onConfirm={async () => {
          if (!confirmPayInfo) return;
          await confirmPayInfo.action();
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-end gap-3 px-3 sm:px-6 lg:px-8 pt-4">
        {isLandingView ? (
          <button
            type="button"
            onClick={openHistoryPicker}
            className="pointer-events-auto rounded-full border border-white/10 bg-black/55 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70"
          >
            Cargar imagen
          </button>
        ) : null}

        <ToolExitMenu
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/60 text-xl text-white/92 backdrop-blur transition hover:bg-black/80"
          title="Close"
          ariaLabel="Open tool exit menu"
          onBeforeNavigate={(route) => {
            setPickerOpen(false);
            setSelectorPanel(null);
            onNavigate(route);
          }}
        >
          ×
        </ToolExitMenu>
      </div>

      {isLandingView ? (
        renderLandingHero()
      ) : (
        <main className={`relative z-10 flex-1 min-h-0 px-3 sm:px-6 lg:px-8 pt-20 pb-4 ${isCropFocusView ? 'pb-3' : 'pb-4'}`}>
          <div className="h-full flex flex-col gap-4">
            {activeStep === 'PROCESSING' || activeStep === 'SUCCESS' ? (
              renderTerminalState()
            ) : (
              <>
                {activeStep === 'CHECKOUT' ? (
                  <div className="flex-1 min-h-0">
                    {renderCheckoutFormCard()}
                  </div>
                ) : (
                  <div className={`flex-1 min-h-[260px] ${isCropFocusView ? 'min-h-[46dvh]' : ''}`}>
                    {renderVisualEditor()}
                  </div>
                )}
                {renderBottomDock()}
              </>
            )}
          </div>
        </main>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
          <div className="w-full h-[100dvh] sm:h-auto sm:max-w-6xl sm:max-h-[85vh] rounded-none sm:rounded-3xl border border-white/10 bg-black/60 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-4">
              <div>
                <div className="text-xl font-extrabold">Selecciona una imagen</div>
                <div className="mt-1 text-xs text-gray-400">
                  Solo puedes usar imágenes de tu historial de generaciones.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition text-sm font-bold"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
              {historyLoading && <div className="text-gray-300">Cargando historial...</div>}
              {historyError && <div className="text-red-400">{historyError}</div>}

              {!historyLoading && !historyError && historyImages.length === 0 && (
                <div className="text-gray-400">No hay imágenes disponibles en tu historial.</div>
              )}

              {!historyLoading && !historyError && historyImages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {historyImages.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setPickerOpen(false);
                        void handleSelectFromHistory(a);
                      }}
                      className="group relative aspect-square rounded-2xl overflow-hidden border border-white/10 bg-black/40 hover:border-[#7EAAED] transition"
                      title={a.prompt || a.name}
                    >
                      <img src={a.url} alt={a.name} className="w-full h-full object-cover" />

                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/85 via-transparent to-transparent flex items-end p-2">
                        <span className="text-[10px] text-white/90 line-clamp-2 text-left">
                          {a.prompt || a.name}
                        </span>
                      </div>

                      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-1 px-2 py-1 rounded-xl bg-black/60 border border-white/10 backdrop-blur-sm">
                          <OneNationUpIcon size={14} />
                          <span className="text-[10px] text-white font-bold">1NationUp</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-white/10 text-xs text-gray-400">
              Requisito para avanzar: <span className="text-white font-bold">mínimo 4K (3840×2160)</span>.
            </div>
          </div>
        </div>
      )}

      {renderSelectorSheet()}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

        @keyframes marching-ants {
          to { stroke-dashoffset: -20; }
        }
        .animate-marching-ants {
          animation: marching-ants 1s linear infinite;
        }

        .iso-container {
          transform-style: preserve-3d;
          transform: rotateX(55deg) rotateZ(-45deg);
        }
        .iso-layer {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}} />
    </div>
  );
}
