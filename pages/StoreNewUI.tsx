import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Maximize, Layers, Check, ShoppingCart, CreditCard, ChevronRight, Image as ImageIcon, Sparkles, Scissors, ShieldCheck, Truck } from 'lucide-react';
import type { Asset, AppRoute, StoreArtDecoListing, StoreArtDecoPayload, StorePrefill } from "../types";
import { listMyAssets } from "../services/assetsApi";
import { supabase } from "../services/supabaseClient";
import { apiUrl } from "../services/apiBase";
import { createArtDecoListing } from "../services/communityStoreApi";
import { useWallet } from "../contexts/WalletContext";
import ConfirmDollarPurchaseModal from "@/components/ConfirmDollarPurchaseModal";

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
type Step = 'UPLOAD' | 'VERIFYING' | 'MATERIAL' | 'SIZE' | 'CROP' | 'MODE' | 'CHECKOUT' | 'PROCESSING' | 'SUCCESS';

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
        items = await listMyAssets({ type: "image", limit: 250, fresh: true });
        if (!items || items.length === 0) {
          items = await listMyAssets({ limit: 250, fresh: true });
        }
      } catch {
        items = await listMyAssets({ limit: 250 });
      }


      // 1) excluir camera-angles
      const noCameraAngles = (items || []).filter((a: any) => {
        const tool = a?.tool || a?.meta?.tool || null;
        return tool !== "camera-angles";
      });

      // 2) quedarnos solo con "imágenes"
      // (evitamos videos y cualquier cosa rara)
      const onlyImages = noCameraAngles.filter((a: any) => {
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
  const [expandedStep, setExpandedStep] = useState<Step | null>(null);
  
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

function loadImgDimsFromDataUrl(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = reject;
    img.src = dataUrl;
  });
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
  setExpandedStep(null);
  setPrefillArtDeco(null);
  setListingForm({ name: '', description: '', priceUsd: '' });
};

const handleSelectFromHistory = async (a: Asset) => {
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

    // Gate estricto: si no es 4K, NO avanza a MATERIAL
    if (!ok) {
      setExpandedStep(null);
      setActiveStep('UPLOAD');
      return;
    }

    // Si es 4K, sí avanza
    setTimeout(() => {
      setActiveStep('MATERIAL');
      setExpandedStep('MATERIAL');
    }, 500);
  } catch {
    setDims(null);
    setIs4kOk(false);
    setExpandedStep(null);
    setActiveStep('UPLOAD');
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
  setExpandedStep('CHECKOUT');
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

const handleGoToUpscale = () => {
  if (!asset) return;
  if (onRequestUpscale) {
    onRequestUpscale(asset);
    return;
  }
  // fallback si no te están pasando onRequestUpscale desde arriba
  onNavigate(AppRoute.TOOL_UPSCALER);
};

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
    setActiveStep(step);
    setExpandedStep(step);
  };

  const handleConfirmMaterial = () => {
    if (!previewMaterial) return;
    setSelectedMaterial(previewMaterial);
    setExpandedStep(null);
  };

  const handleConfirmSize = () => {
    if (!previewSize) return;
    setSelectedSize(previewSize);
    setIsCropped(false);
    setFinalCrop(null);
    setCroppedDataUrl(null);
    setExpandedStep(null);
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
    } catch {
      setCroppedDataUrl(null);
      setCropGenError(null);
    }

    setIsCropped(true);
    setPurchaseMode('buy');
    setExpandedStep('CHECKOUT');
    setActiveStep('CHECKOUT');
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
  // --- INTERFAZ TIPO EDITOR PARA 1NATIONUP ---
  const stepItems = [
    { step: 'MATERIAL' as Step, label: 'Material', color: '#DE6C53', icon: <Layers className="w-4 h-4" /> },
    { step: 'SIZE' as Step, label: 'Medida', color: '#7EAAED', icon: <Maximize className="w-4 h-4" /> },
    { step: 'CROP' as Step, label: 'Encuadre', color: '#DFB142', icon: <Scissors className="w-4 h-4" /> },
    { step: 'CHECKOUT' as Step, label: 'Pago', color: '#22c55e', icon: <CreditCard className="w-4 h-4" /> },
  ];

  const getStepStatus = (step: Step) => {
    switch (step) {
      case 'MATERIAL':
        return selectedMaterial ? 'done' : activeStep === 'MATERIAL' ? 'current' : 'pending';
      case 'SIZE':
        return selectedSize ? 'done' : activeStep === 'SIZE' ? 'current' : 'pending';
      case 'CROP':
        return finalCrop ? 'done' : activeStep === 'CROP' ? 'current' : 'pending';
      case 'CHECKOUT':
        return activeStep === 'CHECKOUT' ? 'current' : finalCrop ? 'ready' : 'pending';
      default:
        return 'pending';
    }
  };

  const canOpenStep = (step: Step) => {
    if (!image || !is4kOk) return false;
    if (step === 'MATERIAL') return true;
    if (step === 'SIZE') return Boolean(selectedMaterial);
    if (step === 'CROP') return Boolean(selectedMaterial && selectedSize);
    if (step === 'CHECKOUT') return Boolean(finalCrop || isLockedArtDecoPurchase);
    return false;
  };

  const getOrientedSize = (size: (typeof SIZES)[number] | null) => {
    if (!size) return null;
    let w = Number(size.w || 1);
    let h = Number(size.h || 1);
    if (imageOrientation === 'landscape' && w < h) {
      [w, h] = [h, w];
    } else if (imageOrientation === 'portrait' && w > h) {
      [w, h] = [h, w];
    }
    return { w, h, aspect: w / h };
  };

  const displayMaterial = previewMaterial || selectedMaterial;
  const displaySize = previewSize || selectedSize;
  const orientedDisplaySize = getOrientedSize(displaySize);
  const displayAspect = finalCrop?.aspect || orientedDisplaySize?.aspect || (dims ? dims.w / Math.max(1, dims.h) : 1);

  const handleMaterialPick = (mat: (typeof MATERIALS)[number]) => {
    setPreviewMaterial(mat);
    setSelectedMaterial(mat);
    setExpandedStep(null);
  };

  const handleSizePick = (size: (typeof SIZES)[number]) => {
    const changed = selectedSize?.id !== size.id;
    setPreviewSize(size);
    setSelectedSize(size);
    if (changed) {
      setIsCropped(false);
      setFinalCrop(null);
      setCroppedDataUrl(null);
      setCropGenError(null);
    }
    setExpandedStep(null);
  };

  const openStep = (step: Step) => {
    if (!canOpenStep(step)) return;
    setActiveStep(step);
    setExpandedStep(step);
  };

  const handleNextStep = async () => {
    if (activeStep === 'MATERIAL') {
      if (!selectedMaterial) return;
      setActiveStep('SIZE');
      setExpandedStep('SIZE');
      return;
    }
    if (activeStep === 'SIZE') {
      if (!selectedSize) return;
      setActiveStep('CROP');
      setExpandedStep('CROP');
      return;
    }
    if (activeStep === 'CROP') {
      await handleConfirmCrop();
    }
  };

  const primaryAction = (() => {
    if (activeStep === 'MATERIAL') {
      return {
        label: selectedMaterial ? 'Siguiente: medida' : 'Selecciona un material',
        disabled: !selectedMaterial,
      };
    }
    if (activeStep === 'SIZE') {
      return {
        label: selectedSize ? 'Siguiente: encuadre' : 'Selecciona una medida',
        disabled: !selectedSize,
      };
    }
    if (activeStep === 'CROP') {
      return {
        label: cropProcessing ? 'Confirmando encuadre...' : 'Confirmar encuadre',
        disabled: cropProcessing || !selectedSize || !image,
      };
    }
    return null;
  })();

  const renderArtworkFrame = () => {
    if (!image) return null;
    const frameClasses = displayMaterial?.id === 'acrylic'
      ? 'border-white/25 shadow-[0_20px_60px_rgba(255,255,255,0.08)]'
      : displayMaterial?.id === 'metal'
      ? 'border-slate-200/20 shadow-[0_20px_60px_rgba(148,163,184,0.14)]'
      : displayMaterial?.id === 'paper'
      ? 'border-[#efe6d0]/35 shadow-[0_24px_70px_rgba(0,0,0,0.45)]'
      : 'border-[#8a5c3c]/28 shadow-[0_20px_60px_rgba(0,0,0,0.45)]';

    const surfaceClasses = displayMaterial?.id === 'acrylic'
      ? 'bg-black/30 after:absolute after:inset-0 after:bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_38%,transparent_65%)] after:pointer-events-none'
      : displayMaterial?.id === 'metal'
      ? 'bg-[#0f1115] after:absolute after:inset-0 after:bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.12),transparent_68%)] after:pointer-events-none'
      : displayMaterial?.id === 'paper'
      ? 'bg-[#f4efe4] after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.45),transparent_52%)] after:pointer-events-none'
      : 'bg-[#201512] after:absolute after:inset-0 after:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_28%)] after:pointer-events-none';

    return (
      <div className="w-full h-full flex items-center justify-center p-3 sm:p-6 lg:p-8">
        <div
          className="relative flex items-center justify-center w-full h-full"
          style={{ maxHeight: '100%', maxWidth: '100%' }}
        >
          <div
            className={`relative w-full max-w-[min(92vw,1200px)] max-h-full rounded-[28px] border ${frameClasses} bg-black/60 p-2 sm:p-3 lg:p-4 overflow-hidden`}
            style={{ aspectRatio: Math.max(0.5, Math.min(2, displayAspect || 1)) }}
          >
            <div className={`relative w-full h-full rounded-[22px] overflow-hidden ${surfaceClasses}`}>
              <img
                src={croppedDataUrl || image}
                alt={asset?.name || 'Artwork preview'}
                className={`w-full h-full ${finalCrop || activeStep === 'CHECKOUT' ? 'object-cover' : 'object-contain'} select-none pointer-events-none`}
                draggable={false}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCropper = () => {
    return (
      <div className="w-full h-full min-h-0 flex items-center justify-center overflow-hidden overscroll-contain p-3 sm:p-6">
        <div
          ref={imageWrapperRef}
          className="relative flex items-center justify-center max-w-full max-h-full rounded-[26px] overflow-hidden touch-none select-none bg-black/35 border border-white/10 shadow-[0_20px_70px_rgba(0,0,0,0.45)]"
          style={{ width: '100%', height: '100%' }}
        >
          <img
            src={image || undefined}
            alt="Upload"
            onLoad={updateCropSize}
            className="block w-auto h-auto max-w-full max-h-full object-contain pointer-events-none select-none touch-none"
            draggable={false}
          />

          {selectedSize && (
            <>
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                <defs>
                  <mask id="crop-mask">
                    <rect width="100%" height="100%" fill="white" />
                    <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#crop-mask)" />
              </svg>

              <div
                className={`absolute z-20 ${isLockedArtDecoPurchase ? 'cursor-default' : 'cursor-move'}`}
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
                <div className="absolute inset-0 rounded-[18px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
                <div className="absolute inset-0 rounded-[18px] border border-white/35" />
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-55">
                  <div className="border-r border-b border-white/55"></div>
                  <div className="border-r border-b border-white/55"></div>
                  <div className="border-b border-white/55"></div>
                  <div className="border-r border-b border-white/55"></div>
                  <div className="border-r border-b border-white/55"></div>
                  <div className="border-b border-white/55"></div>
                  <div className="border-r border-white/55"></div>
                  <div className="border-r border-white/55"></div>
                  <div></div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderViewport = () => {
    if (!image) {
      return (
        <div className="w-full h-full rounded-[30px] border border-white/10 bg-white/5 backdrop-blur-sm shadow-2xl overflow-hidden p-6 flex flex-col items-center justify-center text-center">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-white/10 hover:bg-white/18 border border-white/10 hover:border-[#7EAAED] transition flex items-center justify-center shadow-2xl"
          >
            <ImageIcon size={40} className="text-white/90" />
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-6 px-6 py-3 rounded-2xl bg-[#7EAAED] text-black font-extrabold hover:brightness-110 transition"
          >
            Cargar imagen
          </button>
          <div className="mt-3 text-xs text-white/55">4K mínimo · 3840 × 2160</div>
        </div>
      );
    }

    return (
      <div className="relative w-full h-full rounded-[30px] border border-white/8 bg-black/35 overflow-hidden backdrop-blur-sm shadow-2xl">
        <div className="absolute top-3 left-3 z-30">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded-full border border-white/10 bg-black/60 px-3 py-2 text-[11px] font-semibold text-white/90 backdrop-blur hover:bg-black/75 transition"
          >
            Cambiar imagen
          </button>
        </div>

        {activeStep === 'VERIFYING' && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#7EAAED] to-[#7D45A9]">
              Analizando resolución 4K...
            </h3>
          </div>
        )}

        {image && !dimsLoading && dims && !is4kOk && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/82 backdrop-blur-sm p-4 text-center">
            <div className="max-w-xl w-full rounded-3xl border border-red-500/30 bg-black/60 p-5 shadow-[0_0_40px_rgba(239,68,68,0.15)]">
              <h3 className="text-2xl font-extrabold text-white">Resolución insuficiente</h3>
              <p className="text-gray-300 mt-2">
                Tu imagen es <span className="text-white font-bold">{dims.w}×{dims.h}</span>. Se requiere <span className="text-white font-bold">4K (3840×2160)</span>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                <button type="button" onClick={handleGoToUpscale} className="px-5 py-3 rounded-2xl bg-[#DFB142] text-black font-extrabold hover:brightness-110 transition">
                  Ir a Upscale
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setAsset(null);
                    setDims(null);
                    setIs4kOk(false);
                    setExpandedStep(null);
                    setActiveStep('UPLOAD');
                  }}
                  className="px-5 py-3 rounded-2xl bg-white/10 text-white font-bold hover:bg-white/20 transition"
                >
                  Elegir otra imagen
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="w-full h-full">
          {activeStep === 'CROP' ? renderCropper() : renderArtworkFrame()}
        </div>
      </div>
    );
  };

  const renderStepOverlayContent = () => {
    if (!expandedStep) return null;

    if (expandedStep === 'MATERIAL') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {MATERIALS.map((mat) => {
            const selected = selectedMaterial?.id === mat.id;
            return (
              <button
                key={mat.id}
                type="button"
                onClick={() => handleMaterialPick(mat)}
                className={`rounded-2xl border p-4 text-left transition-all ${selected ? 'border-[#DE6C53] bg-[#DE6C53]/18 shadow-[0_0_24px_rgba(222,108,83,0.18)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
              >
                <div className={`mb-3 inline-flex rounded-2xl p-3 ${selected ? 'bg-[#DE6C53] text-black' : 'bg-black/35 text-white'}`}>{mat.icon}</div>
                <div className="font-bold text-white">{mat.label}</div>
                <div className="mt-1 text-sm text-white/62">{mat.desc}</div>
              </button>
            );
          })}
        </div>
      );
    }

    if (expandedStep === 'SIZE') {
      return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {SIZES.map((size) => {
            const selected = selectedSize?.id === size.id;
            return (
              <button
                key={size.id}
                type="button"
                onClick={() => handleSizePick(size)}
                className={`rounded-2xl border p-4 text-left transition-all ${selected ? 'border-[#7EAAED] bg-[#7EAAED]/18 shadow-[0_0_24px_rgba(126,170,237,0.18)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white">{size.label}</div>
                    <div className="mt-1 text-sm text-white/62">Proporción {Number(size.w)}:{Number(size.h)}</div>
                  </div>
                  <Maximize className={`w-5 h-5 ${selected ? 'text-[#7EAAED]' : 'text-white/45'}`} />
                </div>
                <div className="mt-3 text-[#DFB142] font-bold">${(size.basePrice * (selectedMaterial?.multiplier || 1)).toFixed(2)}</div>
              </button>
            );
          })}
        </div>
      );
    }

    if (expandedStep === 'CROP') {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/76">
            Arrastra el encuadre directamente sobre la imagen. La foto siempre se muestra completa dentro del viewport para que puedas alcanzar cualquier borde antes de confirmar.
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                updateCropSize();
                setIsCropped(false);
                setFinalCrop(null);
                setCroppedDataUrl(null);
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 transition"
            >
              Centrar encuadre
            </button>
            <button
              type="button"
              disabled={cropProcessing || !selectedSize}
              onClick={handleConfirmCrop}
              className={`rounded-2xl px-5 py-3 text-sm font-extrabold transition ${cropProcessing || !selectedSize ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-[#DFB142] text-black hover:brightness-110'}`}
            >
              {cropProcessing ? 'Confirmando...' : 'Confirmar encuadre'}
            </button>
          </div>
        </div>
      );
    }

    if (expandedStep === 'CHECKOUT') {
      return (
        <div className="space-y-5">
          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
            <div className="flex justify-between items-center text-sm text-gray-300 mb-2">
              <span>{isLockedArtDecoPurchase ? (prefillArtDeco?.name || 'Art Deco físico') : `${selectedMaterial?.label} · ${selectedSize?.label}`}</span>
            </div>
            <div className="space-y-2 border-t border-white/10 pt-3 text-sm">
              <div className="flex justify-between items-center text-gray-300"><span>{isLockedArtDecoPurchase ? 'Precio Art Deco' : 'Costo de producción'}</span><span>{formatUsd(checkoutUnitPrice)}</span></div>
              <div className="flex justify-between items-center text-gray-300"><span>{formData.method === 'pickup' ? 'Retiro' : 'Envío'}</span><span>{formatUsd(shippingCost)}</span></div>
              <div className="flex justify-between items-center text-lg font-bold text-white pt-2"><span>Total</span><span className="text-[#DFB142]">{formatUsd(checkoutTotal)}</span></div>
            </div>
          </div>

          <form onSubmit={handleCheckoutSubmit} className="space-y-4">
            {submitError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-white">
                {submitError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Nombre completo" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
              <input required type="email" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Correo electrónico" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}/>
              <input required type="tel" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Número de teléfono" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}/>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFormData({...formData, method: 'shipping'})} className={`py-3 rounded-xl border flex flex-col items-center justify-center space-y-1 transition-all ${formData.method === 'shipping' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                <Truck className="w-5 h-5" />
                <span className="text-xs font-medium">Envío</span>
              </button>
              <button type="button" onClick={() => setFormData({...formData, method: 'pickup'})} className={`py-3 rounded-xl border flex flex-col items-center justify-center space-y-1 transition-all ${formData.method === 'pickup' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                <ShoppingCart className="w-5 h-5" />
                <span className="text-xs font-medium">Recoger</span>
              </button>
            </div>

            {formData.method === 'shipping' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input required type="text" className="md:col-span-2 w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Dirección" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}/>
                  <input type="text" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Apt / Suite" value={formData.apt} onChange={e => setFormData({...formData, apt: e.target.value})}/>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Ciudad" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}/>
                  <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Estado" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})}/>
                  <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Código postal" value={formData.zip} onChange={e => setFormData({...formData, zip: e.target.value})}/>
                </div>
              </div>
            )}

            <textarea className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm h-24 resize-none" placeholder="Notas (opcional)" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}></textarea>

            <button type="submit" className="w-full rounded-2xl bg-gradient-to-r from-green-500 to-emerald-700 px-6 py-4 text-lg font-extrabold text-white hover:brightness-110 transition">
              {`Pagar ${formatUsd(checkoutTotal)}`}
            </button>
          </form>
        </div>
      );
    }

    return null;
  };

  const renderStepOverlay = () => {
    if (!expandedStep || !image || activeStep === 'PROCESSING' || activeStep === 'SUCCESS') return null;
    const item = stepItems.find((entry) => entry.step === expandedStep);
    return (
      <div className="fixed inset-x-0 bottom-[102px] sm:bottom-[108px] z-40 px-2 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-[1800px] rounded-[28px] border border-white/12 bg-[#090909]/92 backdrop-blur-2xl shadow-[0_30px_90px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 sm:px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5" style={{ color: item?.color }}>
                {item?.icon}
              </div>
              <div>
                <div className="text-sm font-semibold text-white">{item?.label}</div>
                <div className="text-xs text-white/55">{expandedStep === 'CHECKOUT' ? 'Completa tu compra' : 'Selecciona y continúa'}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExpandedStep(null)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 hover:bg-white/10 transition"
            >
              Cerrar
            </button>
          </div>
          <div className="max-h-[min(48dvh,560px)] overflow-y-auto p-4 sm:p-6 custom-scrollbar">
            {renderStepOverlayContent()}
          </div>
        </div>
      </div>
    );
  };

  const renderStepBar = () => {
    if (!image || activeStep === 'PROCESSING' || activeStep === 'SUCCESS') return null;
    return (
      <div className="relative z-30 border-t border-white/8 bg-black/72 backdrop-blur-2xl">
        <div className="mx-auto max-w-[1800px] px-2 sm:px-4 lg:px-6 py-3 sm:py-4">
          {primaryAction && (
            <button
              type="button"
              disabled={primaryAction.disabled}
              onClick={() => { void handleNextStep(); }}
              className={`mb-3 sm:mb-4 w-full rounded-2xl px-5 py-4 text-base font-extrabold transition ${primaryAction.disabled ? 'bg-white/10 text-white/35 cursor-not-allowed' : activeStep === 'CROP' ? 'bg-[#DFB142] text-black hover:brightness-110' : 'bg-white text-black hover:brightness-110'}`}
            >
              <span className="inline-flex items-center gap-2">
                {primaryAction.label}
                {!primaryAction.disabled && activeStep !== 'CROP' ? <ChevronRight className="w-5 h-5" /> : null}
              </span>
            </button>
          )}

          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {stepItems.map((item, index) => {
              const status = getStepStatus(item.step);
              const enabled = canOpenStep(item.step);
              const selected = activeStep === item.step || expandedStep === item.step;
              return (
                <button
                  key={item.step}
                  type="button"
                  disabled={!enabled}
                  onClick={() => openStep(item.step)}
                  className={`rounded-2xl border px-2 py-3 sm:px-4 sm:py-4 text-left transition-all ${selected ? 'border-white/18 bg-white/10' : status === 'done' ? 'border-white/12 bg-white/6' : 'border-white/8 bg-white/[0.03]'} ${enabled ? 'hover:bg-white/10' : 'opacity-45 cursor-not-allowed'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl text-white" style={{ background: status === 'done' ? '#22c55e' : `${item.color}22`, color: status === 'done' ? '#04130a' : item.color }}>
                      {status === 'done' ? <Check className="w-4 h-4" /> : item.icon}
                    </div>
                    <span className="text-[11px] font-semibold text-white/45">0{index + 1}</span>
                  </div>
                  <div className="mt-3 text-sm font-bold text-white">{item.label}</div>
                  <div className="mt-1 text-[11px] text-white/52">
                    {item.step === 'MATERIAL' && (selectedMaterial?.label || 'Pendiente')}
                    {item.step === 'SIZE' && (selectedSize?.label || 'Pendiente')}
                    {item.step === 'CROP' && (finalCrop ? 'Confirmado' : 'Pendiente')}
                    {item.step === 'CHECKOUT' && (finalCrop || isLockedArtDecoPurchase ? 'Listo para pagar' : 'Bloqueado')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryPicker = () => {
    if (!pickerOpen) return null;
    return (
      <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
        <div className="w-full h-[100dvh] sm:h-auto sm:max-w-6xl sm:max-h-[85vh] rounded-none sm:rounded-3xl border border-white/10 bg-black/70 shadow-2xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="text-xl font-extrabold">Selecciona una imagen</div>
              <div className="text-xs text-gray-400 mt-1">Se muestran todas tus imágenes 4K recientes disponibles en historial.</div>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition text-sm font-bold"
            >
              Cerrar
            </button>
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
                      <span className="text-[10px] text-white/90 line-clamp-2 text-left">{a.prompt || a.name}</span>
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
    );
  };

  const renderSuccess = () => {
    const isListingSuccess = successMode === 'listing';
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center px-4 text-center bg-black/55 backdrop-blur-md">
        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center border-2 border-green-500 mb-6 shadow-[0_0_50px_rgba(34,197,94,0.4)]">
          <Check className="w-12 h-12 text-green-400" />
        </div>
        <h2 className="text-3xl font-bold text-white">{isListingSuccess ? '¡Art Deco publicado!' : '¡Pedido confirmado!'}</h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/45 px-6 py-5">
          <div className="text-xs uppercase tracking-[0.25em] text-white/45">{isListingSuccess ? 'Listing ID' : 'Código de fábrica'}</div>
          <div className="mt-2 text-2xl font-mono font-bold text-[#7EAAED]">{orderCode || publishedListingId || '1NUP-UNKNOWN'}</div>
        </div>
        <button onClick={() => window.location.reload()} className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 transition">
          Comenzar una nueva creación
        </button>
      </div>
    );
  };

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

      <main className="relative z-10 flex-1 min-h-0 w-full max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-2 sm:py-4 lg:py-6 overflow-hidden">
        <div className="relative h-full min-h-0">
          {renderViewport()}
          {activeStep === 'PROCESSING' && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center space-y-6 text-center px-4 bg-black/50 backdrop-blur-md">
              <div className="w-20 h-20 border-4 border-[#DFB142] border-t-transparent rounded-full animate-spin shadow-[0_0_30px_rgba(223,177,66,0.3)]"></div>
              <h2 className="text-2xl font-bold text-white">Procesando orden...</h2>
              <p className="text-gray-300 text-sm max-w-md">Estamos registrando tu pedido físico y preparando la confirmación.</p>
            </div>
          )}
          {activeStep === 'SUCCESS' ? renderSuccess() : null}
        </div>
      </main>

      {renderStepOverlay()}
      {renderStepBar()}
      {renderHistoryPicker()}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}} />
    </div>
  );
}
