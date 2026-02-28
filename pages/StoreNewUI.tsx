import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Maximize, Layers, Check, ShoppingCart, CreditCard, ChevronRight, Image as ImageIcon, Sparkles, Scissors, ShieldCheck, Truck, Edit2, Info } from 'lucide-react';
import { Asset, AppRoute } from "../types";
import { uploadUserAsset } from "../services/assetsApi";
import { supabase } from "../services/supabaseClient";
import { apiUrl } from "../services/apiBase";

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
type StoreNewUIProps = {
  onNavigate: (route: AppRoute) => void;
  onRequestUpscale?: (asset: Asset) => void;
};

export default function StoreNewUI({ onNavigate, onRequestUpscale }: StoreNewUIProps) {
  const [image, setImage] = useState<string | null>(null); // preview (dataUrl)
  const [asset, setAsset] = useState<Asset | null>(null);  // asset subido (storage)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [is4kOk, setIs4kOk] = useState<boolean>(false);
  const [dimsLoading, setDimsLoading] = useState<boolean>(false);
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null);
  const [imageOrientation, setImageOrientation] = useState('portrait'); 
  
  // Flujo Secuencial (Acordeón)
  const [activeStep, setActiveStep] = useState('UPLOAD'); 
  
  // Estados Finales (Confirmados)
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [isCropped, setIsCropped] = useState(false);

  // Estados Previos (Para visualización en 2 tiempos antes de confirmar)
  const [previewMaterial, setPreviewMaterial] = useState(null);
  const [previewSize, setPreviewSize] = useState(null);
  
  // Estado riguroso para el editor de recorte
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [finalCrop, setFinalCrop] = useState(null); 
  
  // Refs
  const imageWrapperRef = useRef(null);

  // Formulario de Checkout
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', method: 'shipping', address: '', apt: '', city: '', state: '', zip: '', notes: '' });
  const [orderCode, setOrderCode] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');

// Manejar subida de imagen
function is4K(d: { w: number; h: number } | null): boolean {
  if (!d) return false;
  return d.w >= 3840 && d.h >= 2160;
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

const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setDims(null);
  setIs4kOk(false);
  setDimsLoading(true);

  try {
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const d = await loadImgDimsFromDataUrl(dataUrl);
    setDims(d);

    const ok = is4K(d);
    setIs4kOk(ok);

    const img = new Image();
    img.onload = () => {
      setImageOrientation(img.width > img.height ? 'landscape' : 'portrait');
      setImage(dataUrl);
    };
    img.src = dataUrl;

    setActiveStep('VERIFYING');
    setCroppedDataUrl(null);

    if (ok) {
      const uploaded = await uploadUserAsset(file, {
        tool: "store",
        category: "1nationup",
        name: file.name,
        type: "image",
      });
      setAsset(uploaded);
    } else {
      setAsset(null);
    }

    setTimeout(() => {
      setActiveStep('MATERIAL');
    }, 1500);
  } catch {
    setDims(null);
    setIs4kOk(false);
    setAsset(null);
    setActiveStep('UPLOAD');
  } finally {
    setDimsLoading(false);
    e.target.value = "";
  }
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


  const handleMouseDown = (e) => {
    if (activeStep !== 'CROP' || !selectedSize) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropRect.x, y: e.clientY - cropRect.y });
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (!isDragging || activeStep !== 'CROP' || !imageWrapperRef.current) return;
      
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

    const handleGlobalMouseUp = () => {
      if (isDragging) setIsDragging(false);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStart, cropRect, activeStep]);


  // Acciones de cambio de pasos (Acordeón Navigation)
  const handleEditStep = (step) => {
    if (step === 'CROP' || step === 'SIZE' || step === 'MATERIAL') {
       setIsCropped(false); 
       setFinalCrop(null);
    }
    
    if (step === 'MATERIAL') setPreviewMaterial(null);
    if (step === 'SIZE') setPreviewSize(null);
    
    setActiveStep(step);
  };

  const handleConfirmMaterial = () => {
    setSelectedMaterial(previewMaterial);
    setActiveStep('SIZE');
  };

  const handleConfirmSize = () => {
    setSelectedSize(previewSize);
    setIsCropped(false);
    setActiveStep('CROP');
  };

  async function makeCroppedDataUrl(
  originalDataUrl: string,
  crop: { x: number; y: number; w: number; h: number }
): Promise<string> {
  const img = new Image();
  img.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = originalDataUrl;
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
  return canvas.toDataURL("image/png");
}

  const handleConfirmCrop = async () => {
    const wrapper = imageWrapperRef.current;
    if (wrapper) {
       const rect = wrapper.getBoundingClientRect();
       const imgW = rect.width;
       const imgH = rect.height;
       
       if (imgW > 0 && imgH > 0 && cropRect.w > 0) {
          setFinalCrop({
            x: cropRect.x / imgW,
            y: cropRect.y / imgH,
            w: cropRect.w / imgW,
            h: cropRect.h / imgH
          });

          // NUEVO: generar la imagen recortada real (best-effort)
          if (image && imgW > 0 && imgH > 0 && cropRect.w > 0 && cropRect.h > 0) {
            try {
              const norm = {
                x: cropRect.x / imgW,
                y: cropRect.y / imgH,
                w: cropRect.w / imgW,
                h: cropRect.h / imgH,
              };
              const cdu = await makeCroppedDataUrl(image, norm);
              setCroppedDataUrl(cdu);
            } catch {
              setCroppedDataUrl(null);
            }
          }
       }
    }

    setIsCropped(true);
    setActiveStep('CHECKOUT');
  };

  const calculateTotal = () => {
    const targetSize = previewSize || selectedSize;
    const targetMaterial = previewMaterial || selectedMaterial;
    if (!targetSize || !targetMaterial) return 0;
    return (targetSize.basePrice * targetMaterial.multiplier).toFixed(2);
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

  setActiveStep('PROCESSING');

  try {
    // 1) token supabase para Authorization Bearer (tu backend lo exige)
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSubmitError('Debes iniciar sesión para comprar.');
      setActiveStep('CHECKOUT');
      return;
    }

    // 2) calcular fitMode (si confirmaste recorte -> "crop", si no -> "perfect")
    const fitMode = finalCrop ? 'crop' : 'perfect';

    // 3) costos (copiados del Store actual del repo)
    const shippingCost = formData.method === 'pickup' ? 0 : 15;
    const smartFillAddon = 0; // esta UI no usa smart_fill aún
    const basePrice = Number(selectedSize.basePrice || 0);
    const total = basePrice + shippingCost + smartFillAddon;

    // 4) armar payload EXACTO que espera el backend (StoreOrderSchema)
    const payload: any = {
      assetId: asset.id,
      assetUrl: asset.url,
      assetName: asset.name,

      imageDims: dims ? { w: dims.w, h: dims.h } : null,
      require4k: true,

      material: selectedMaterial.id,              // "metal" | "acrylic" | "canvas" | "paper"
      materialLabel: selectedMaterial.name,       // texto

      size: {
        id: selectedSize.id,
        wIn: Number(selectedSize.w),
        hIn: Number(selectedSize.h),
        label: selectedSize.label,
      },

      fitMode,
      crop: null,
      cropNormalized: finalCrop ? finalCrop : null,
      croppedImageDataUrl: croppedDataUrl ? croppedDataUrl : undefined,

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

        address1: formData.method === 'pickup'
          ? null
          : String(formData.address || '').trim() + (formData.apt ? ` Apt ${String(formData.apt).trim()}` : ''),
        city: formData.method === 'pickup' ? null : String(formData.city || '').trim(),
        state: formData.method === 'pickup' ? null : String(formData.state || '').trim(),
        zip: formData.method === 'pickup' ? null : String(formData.zip || '').trim(),
      },

      notes: String(formData.notes || '').trim(),
      flags: {},
    };

    // 5) POST real
    const resp = await fetch(apiUrl('/api/store/order'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!resp.ok || !data?.ok) {
      const msg = data?.error?.message || `Error al crear orden (HTTP ${resp.status})`;
      setSubmitError(msg);
      setActiveStep('CHECKOUT');
      return;
    }

    // 6) éxito real
    setOrderCode(String(data.orderId || ''));
    setActiveStep('SUCCESS');
  } catch (err: any) {
    setSubmitError(err?.message || 'Error inesperado al procesar el pedido.');
    setActiveStep('CHECKOUT');
  }
};
  // --- COMPONENTES VISUALES DINÁMICOS DEL LADO IZQUIERDO ---

  // Visualizador 3D del Material
  const renderMaterialInfographic = () => {
    if (!previewMaterial) {
      return (
        <div className="flex flex-col items-center justify-center animate-in fade-in duration-500">
           <Layers className="w-16 h-16 text-gray-500 mb-4 opacity-50"/>
           <p className="text-gray-400 font-medium">Selecciona un material para ver su composición 3D</p>
        </div>
      );
    }

    const matId = previewMaterial.id;
    const isPortrait = imageOrientation === 'portrait';
    const baseClass = `iso-layer rounded-lg overflow-hidden bg-cover bg-center`;
    
    return (
      <div className="flex flex-col items-center justify-center w-full h-full animate-in zoom-in-95 duration-500">
         <div className="w-full max-w-sm mb-12 text-center relative z-10 bg-black/50 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
            <h3 className="text-2xl font-bold text-white mb-2 flex justify-center items-center">
              {previewMaterial.icon} <span className="ml-2">{previewMaterial.label}</span>
            </h3>
            <p className="text-sm text-[#DFB142]">{previewMaterial.desc}</p>
         </div>

         <div className={`relative iso-container ${isPortrait ? 'w-[200px] h-[280px]' : 'w-[280px] h-[200px]'} mb-10`}>
            {matId === 'acrylic' && (
              <>
                <div className={`${baseClass} shadow-[0_20px_50px_rgba(0,0,0,0.8)]`} style={{ transform: 'translateZ(-40px)', backgroundColor: '#111' }}>
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-xs text-gray-600 font-mono">Backing</div>
                </div>
                <div className={`${baseClass}`} style={{ transform: 'translateZ(0px)', backgroundImage: `url(${image})` }}></div>
                <div className={`${baseClass} border border-white/20`} style={{ transform: 'translateZ(20px)', background: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.1) 100%)', backdropFilter: 'blur(1px)' }}>
                   <div className="absolute top-2 right-2 flex text-[10px] text-white/50"><Info className="w-3 h-3 mr-1"/> Acrílico 1/4"</div>
                </div>
              </>
            )}
            {matId === 'canvas' && (
              <>
                <div className={`${baseClass} shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-[8px] border-[#3e2723]`} style={{ transform: 'translateZ(-30px)', backgroundColor: '#e0c097' }}>
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center text-xs text-[#3e2723] font-mono font-bold">Wood Frame</div>
                </div>
                <div className={`${baseClass} border-4 border-black/10`} style={{ transform: 'translateZ(10px)', backgroundImage: `url(${image})`, filter: 'sepia(0.1) contrast(0.95)' }}>
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/canvas-orange.png')] opacity-30 mix-blend-multiply"></div>
                </div>
              </>
            )}
            {matId === 'metal' && (
              <>
                <div className={`${baseClass} shadow-[0_30px_60px_rgba(0,0,0,0.9)]`} style={{ transform: 'translateZ(-50px)', backgroundColor: '#222', width: '50%', height: '50%', top: '25%', left: '25%' }}>
                   <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500 font-mono">Wall Mount</div>
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
           <p className="text-gray-400 font-medium">Selecciona una medida para visualizar a escala de render</p>
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
         
         {/* Badge Flotante Superior */}
         <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-6 py-2 rounded-full backdrop-blur-xl border border-white/10 z-20 flex items-center space-x-2 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
            <Maximize className="w-4 h-4 text-[#DFB142]" />
            <span className="text-white font-bold tracking-widest text-sm uppercase">Simulación Realista</span>
         </div>

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

         <div className="w-full h-[65vh] flex items-center justify-center relative mt-6">
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
             </div>
         </div>
         
         <p className="mt-6 text-gray-400 text-sm flex items-center">
           <Info className="w-4 h-4 mr-2"/>
           Esta es la previsualización exacta del encuadre que se enviará a la fábrica.
         </p>
      </div>
    );
  };

  const renderCropper = () => {
    return (
      <div 
          ref={imageWrapperRef} 
          className="relative inline-block max-w-full max-h-[75vh] shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-md"
      >
        <img 
          src={image} 
          alt="Upload" 
          onLoad={updateCropSize}
          className="max-w-full max-h-[75vh] object-contain pointer-events-none select-none block"
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
            className={`absolute transition-transform z-20 ${activeStep !== 'CROP' ? 'pointer-events-none' : 'cursor-move hover:scale-[1.01]'}`}
            style={{
              left: `${cropRect.x}px`,
              top: `${cropRect.y}px`,
              width: `${cropRect.w}px`,
              height: `${cropRect.h}px`,
            }}
            onMouseDown={handleMouseDown}
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
    );
  };

  const renderVisualEditor = () => {
    if (!image) return null;

    return (
      <div className="relative w-full h-[80vh] flex items-center justify-center bg-black/40 rounded-3xl border border-white/5 overflow-hidden backdrop-blur-sm shadow-2xl p-6 transition-all duration-500">
        
        {activeStep === 'VERIFYING' && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#7EAAED] to-[#7D45A9]">
              Analizando resolución 4K...
            </h3>
          </div>
        )}

        {/* Lógica de Renderizado Dinámico */}
        {activeStep === 'MATERIAL' && renderMaterialInfographic()}
        {activeStep === 'SIZE' && renderSizeMockup()}
        {activeStep === 'CROP' && renderCropper()}
        {(activeStep === 'CHECKOUT' || activeStep === 'SUCCESS' || activeStep === 'PROCESSING') && renderFinalCropPreview()}
        
      </div>
    );
  };

  // --- RENDER DEL SIDEBAR (ACORDEÓN CONTINUO) ---
  const renderSidebar = () => {
    if (activeStep === 'PROCESSING') {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-6">
          <div className="w-20 h-20 border-4 border-[#DFB142] border-t-transparent rounded-full animate-spin shadow-[0_0_30px_rgba(223,177,66,0.3)]"></div>
          <h2 className="text-2xl font-bold text-white">Procesando Orden...</h2>
          <p className="text-gray-400 text-center text-sm">Conectando con la fábrica e inicializando pasarela de pago.</p>
        </div>
      );
    }
    
    if (activeStep === 'SUCCESS') {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-6 text-center animate-in zoom-in duration-500">
          <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center border-2 border-green-500 mb-4 shadow-[0_0_50px_rgba(34,197,94,0.4)]">
            <Check className="w-12 h-12 text-green-400" />
          </div>
          <h2 className="text-3xl font-bold text-white">¡Creación Exitosa!</h2>
          <p className="text-gray-400">Hemos bloqueado tu encuadre y enviado las coordenadas a la fábrica.</p>
          <div className="bg-black/50 border border-white/10 p-6 rounded-xl w-full mt-4">
            <span className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Código de Fábrica</span>
            <span className="block text-2xl font-mono text-[#7EAAED] tracking-widest font-bold">{orderCode || '1NUP-UNKNOWN'}</span>
          </div>
          <button onClick={() => window.location.reload()} className="text-sm text-[#DFB142] hover:text-white transition-colors mt-8 flex items-center">
            Comenzar una nueva creación
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col space-y-4 h-full overflow-y-auto pr-2 custom-scrollbar pb-10">
        
        {/* PASO 1: MATERIAL */}
        <div className={`rounded-2xl border transition-all duration-500 overflow-hidden flex-shrink-0 ${activeStep === 'MATERIAL' ? 'border-[#DE6C53] bg-black/60 shadow-[0_0_20px_rgba(222,108,83,0.2)]' : selectedMaterial ? 'border-white/20 bg-black/40' : 'border-white/5 bg-black/20 opacity-50'}`}>
          <div 
            className={`p-5 flex justify-between items-center ${selectedMaterial && activeStep !== 'MATERIAL' ? 'cursor-pointer hover:bg-white/5' : ''}`}
            onClick={() => { if (selectedMaterial && activeStep !== 'MATERIAL') handleEditStep('MATERIAL') }}
          >
            <div className="flex items-center space-x-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${activeStep === 'MATERIAL' ? 'bg-[#DE6C53] text-black' : selectedMaterial ? 'bg-green-500 text-black' : 'bg-white/10 text-white'}`}>
                {selectedMaterial && activeStep !== 'MATERIAL' ? <Check className="w-5 h-5"/> : '1'}
              </div>
              <div>
                <h3 className={`font-bold ${activeStep === 'MATERIAL' ? 'text-xl text-white' : 'text-lg text-gray-300'}`}>Material</h3>
                {selectedMaterial && activeStep !== 'MATERIAL' && <p className="text-sm text-[#DE6C53]">{selectedMaterial.label}</p>}
              </div>
            </div>
            {selectedMaterial && activeStep !== 'MATERIAL' && <Edit2 className="w-4 h-4 text-gray-400 hover:text-white transition-colors"/>}
          </div>

          {activeStep === 'MATERIAL' && (
            <div className="p-5 pt-0 animate-in slide-in-from-top-2 duration-300">
              <p className="text-gray-400 text-sm mb-4">Haz clic en un material para visualizar su infografía 3D.</p>
              <div className="grid grid-cols-1 gap-3 mb-4">
                {MATERIALS.map(mat => (
                  <button 
                    key={mat.id} 
                    onClick={() => setPreviewMaterial(mat)} 
                    className={`w-full flex items-center p-4 rounded-xl border transition-all text-left group ${previewMaterial?.id === mat.id ? 'bg-[#DE6C53]/20 border-[#DE6C53] shadow-[0_0_15px_rgba(222,108,83,0.3)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <div className={`p-2 rounded-lg mr-4 transition-colors ${previewMaterial?.id === mat.id ? 'bg-[#DE6C53] text-black' : 'text-white bg-black/30 group-hover:text-[#DE6C53]'}`}>{mat.icon}</div>
                    <div>
                      <span className="block font-bold text-white">{mat.label}</span>
                      <span className="block text-xs text-gray-400">{mat.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
              
              {/* Botón de Confirmar */}
              <div className={`overflow-hidden transition-all duration-500 ${previewMaterial ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'}`}>
                 <button onClick={handleConfirmMaterial} className="w-full py-4 rounded-xl font-bold bg-[#DE6C53] text-black hover:bg-[#eb7d65] transition-colors shadow-[0_0_20px_rgba(222,108,83,0.4)] flex items-center justify-center">
                    Confirmar Material <ChevronRight className="w-5 h-5 ml-1"/>
                 </button>
              </div>
            </div>
          )}
        </div>

        {/* PASO 2: MEDIDA */}
        <div className={`rounded-2xl border transition-all duration-500 overflow-hidden flex-shrink-0 ${activeStep === 'SIZE' ? 'border-[#7EAAED] bg-black/60 shadow-[0_0_20px_rgba(126,170,237,0.2)]' : selectedSize ? 'border-white/20 bg-black/40' : 'border-white/5 bg-black/20 opacity-50'}`}>
          <div 
            className={`p-5 flex justify-between items-center ${selectedSize && activeStep !== 'SIZE' ? 'cursor-pointer hover:bg-white/5' : ''}`}
            onClick={() => { if (selectedSize && activeStep !== 'SIZE') handleEditStep('SIZE') }}
          >
            <div className="flex items-center space-x-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${activeStep === 'SIZE' ? 'bg-[#7EAAED] text-black' : selectedSize ? 'bg-green-500 text-black' : 'bg-white/10 text-white'}`}>
                {selectedSize && activeStep !== 'SIZE' ? <Check className="w-5 h-5"/> : '2'}
              </div>
              <div>
                <h3 className={`font-bold ${activeStep === 'SIZE' ? 'text-xl text-white' : 'text-lg text-gray-300'}`}>Medida</h3>
                {selectedSize && activeStep !== 'SIZE' && <p className="text-sm text-[#7EAAED]">{selectedSize.label}</p>}
              </div>
            </div>
            {selectedSize && activeStep !== 'SIZE' && <Edit2 className="w-4 h-4 text-gray-400 hover:text-white transition-colors"/>}
          </div>

          {activeStep === 'SIZE' && (
            <div className="p-5 pt-0 animate-in slide-in-from-top-2 duration-300">
              <p className="text-gray-400 text-sm mb-4">Toca una medida para ver cómo luce en escala real.</p>
              <div className="grid grid-cols-1 gap-2 mb-4">
                {SIZES.map(size => (
                  <button 
                    key={size.id} 
                    onClick={() => setPreviewSize(size)} 
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all group ${previewSize?.id === size.id ? 'bg-[#7EAAED]/20 border-[#7EAAED] shadow-[0_0_15px_rgba(126,170,237,0.3)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <span className="font-bold text-white flex items-center"><Maximize className={`w-4 h-4 mr-2 ${previewSize?.id === size.id ? 'text-[#7EAAED]' : 'text-gray-500 group-hover:text-[#7EAAED]'}`}/> {size.label}</span>
                    <span className="text-[#DFB142] font-bold">${(size.basePrice * (selectedMaterial?.multiplier || 1)).toFixed(2)}</span>
                  </button>
                ))}
              </div>

              {/* Botón de Confirmar */}
              <div className={`overflow-hidden transition-all duration-500 ${previewSize ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'}`}>
                 <button onClick={handleConfirmSize} className="w-full py-4 rounded-xl font-bold bg-[#7EAAED] text-black hover:bg-[#8ebfff] transition-colors shadow-[0_0_20px_rgba(126,170,237,0.4)] flex items-center justify-center">
                    Confirmar Medida <ChevronRight className="w-5 h-5 ml-1"/>
                 </button>
              </div>
            </div>
          )}
        </div>

        {/* PASO 3: ENCUADRE (CROP) */}
        <div className={`rounded-2xl border transition-all duration-500 overflow-hidden flex-shrink-0 ${activeStep === 'CROP' ? 'border-[#DFB142] bg-black/60 shadow-[0_0_20px_rgba(223,177,66,0.2)]' : isCropped ? 'border-white/20 bg-black/40' : 'border-white/5 bg-black/20 opacity-50'}`}>
          <div 
            className={`p-5 flex justify-between items-center ${isCropped && activeStep !== 'CROP' ? 'cursor-pointer hover:bg-white/5' : ''}`}
            onClick={() => { if (isCropped && activeStep !== 'CROP') handleEditStep('CROP') }}
          >
            <div className="flex items-center space-x-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${activeStep === 'CROP' ? 'bg-[#DFB142] text-black' : isCropped ? 'bg-green-500 text-black' : 'bg-white/10 text-white'}`}>
                {isCropped && activeStep !== 'CROP' ? <Check className="w-5 h-5"/> : '3'}
              </div>
              <div>
                <h3 className={`font-bold ${activeStep === 'CROP' ? 'text-xl text-white' : 'text-lg text-gray-300'}`}>Encuadre</h3>
                {isCropped && activeStep !== 'CROP' && <p className="text-sm text-[#DFB142]">Recorte Confirmado</p>}
              </div>
            </div>
            {isCropped && activeStep !== 'CROP' && <Edit2 className="w-4 h-4 text-gray-400 hover:text-white transition-colors"/>}
          </div>

          {activeStep === 'CROP' && (
            <div className="p-5 pt-0 animate-in slide-in-from-top-2 duration-300">
              <div className="bg-[#DFB142]/10 border border-[#DFB142]/30 rounded-lg p-4 mb-5 text-center">
                 <Scissors className="w-8 h-8 text-[#DFB142] mx-auto mb-2" />
                 <p className="text-sm text-white font-medium mb-1">Ajusta tu diseño en la pantalla izquierda</p>
                 <p className="text-xs text-gray-400">Arrastra el área iluminada. Lo que quede oscurecido se desechará.</p>
              </div>
              
              <button 
                onClick={handleConfirmCrop}
                className="group relative w-full p-1 rounded-2xl animate-[pulse_1.5s_ease-in-out_infinite]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#DFB142] to-[#DE6C53] rounded-2xl blur opacity-70 group-hover:opacity-100 transition duration-500"></div>
                <div className="relative flex items-center justify-center space-x-2 px-6 py-4 bg-[#0a0a0a] rounded-xl text-white font-bold">
                  <Check className="w-5 h-5 text-[#DFB142] group-hover:scale-125 transition-transform" />
                  <span>Confirmar Recorte</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* PASO 4: CHECKOUT */}
        <div className={`rounded-2xl border transition-all duration-500 overflow-hidden flex-shrink-0 ${activeStep === 'CHECKOUT' ? 'border-green-500 bg-black/60 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-white/5 bg-black/20 opacity-50'}`}>
          <div className="p-5 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${activeStep === 'CHECKOUT' ? 'bg-green-500 text-black' : 'bg-white/10 text-white'}`}>
                4
              </div>
              <h3 className={`font-bold ${activeStep === 'CHECKOUT' ? 'text-xl text-white' : 'text-lg text-gray-300'}`}>Finalizar</h3>
            </div>
          </div>

          {activeStep === 'CHECKOUT' && (
            <div className="p-5 pt-0 animate-in slide-in-from-top-2 duration-300">
              
              <div className="bg-white/5 rounded-xl p-4 mb-6 border border-white/10">
                <div className="flex justify-between items-center text-sm text-gray-300 mb-2">
                  <span>{selectedMaterial?.label} ({selectedSize?.label})</span>
                </div>
                <div className="flex justify-between items-center text-lg font-bold text-white border-t border-white/10 pt-2">
                  <span>Total</span>
                  <span className="text-[#DFB142]">${calculateTotal()}</span>
                </div>
              </div>

              <form onSubmit={handleCheckoutSubmit} className="space-y-4">
                {submitError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-white">
                    {submitError}
                  </div>
                )}
                <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Nombre Completo" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
                <input required type="email" className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Correo Electrónico" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}/>
                <input required type="tel" className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Número de Teléfono" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}/>
                
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setFormData({...formData, method: 'shipping'})} className={`py-3 rounded-lg border flex flex-col items-center justify-center space-y-1 transition-all ${formData.method === 'shipping' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                    <Truck className="w-5 h-5" />
                    <span className="text-xs font-medium">Envío</span>
                  </button>
                  <button type="button" onClick={() => setFormData({...formData, method: 'pickup'})} className={`py-3 rounded-lg border flex flex-col items-center justify-center space-y-1 transition-all ${formData.method === 'pickup' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                    <ShoppingCart className="w-5 h-5" />
                    <span className="text-xs font-medium">Recoger</span>
                  </button>
                </div>

                {formData.method === 'shipping' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-3 gap-2">
                       <input required type="text" className="col-span-2 w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Dirección de Envío" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}/>
                       <input type="text" className="col-span-1 w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Apt/Suite (Opcional)" value={formData.apt} onChange={e => setFormData({...formData, apt: e.target.value})}/>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Ciudad" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}/>
                      <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Estado" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})}/>
                      <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm" placeholder="Cód. Postal" value={formData.zip} onChange={e => setFormData({...formData, zip: e.target.value})}/>
                    </div>
                  </div>
                )}

                <textarea className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500 transition-colors text-sm h-20 resize-none" placeholder="Notas adicionales para la fábrica o envío (Opcional)..." value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}></textarea>

                <button type="submit" className="w-full relative group rounded-xl overflow-hidden mt-4">
                  <div className="absolute inset-0 bg-gradient-to-r from-green-500 to-emerald-700 transition-transform duration-300 group-hover:scale-105"></div>
                  <div className="relative px-6 py-4 flex items-center justify-center space-x-3 text-white font-bold text-lg">
                    <CreditCard className="w-6 h-6" />
                    <span>Pagar (${calculateTotal()})</span>
                  </div>
                </button>
              </form>
            </div>
          )}
        </div>

      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] font-sans text-white overflow-hidden flex flex-col relative">
      <ParticleBackground />
      
      <header className="relative z-10 p-5 lg:px-8 flex justify-between items-center border-b border-white/5 bg-black/40 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#7EAAED] to-[#7D45A9] rounded-xl flex items-center justify-center font-bold text-xl shadow-lg">1N</div>
          <h1 className="text-2xl font-extrabold tracking-tight hidden sm:block">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#7EAAED] via-[#DFB142] to-[#7D45A9]">1NationUp</span>
            <span className="text-white ml-2">Studio</span>
          </h1>
        </div>
        <div className="flex items-center text-sm text-gray-400 font-medium">
          <ShieldCheck className="w-4 h-4 mr-2 text-green-500"/> Calidad Garantizada
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col lg:flex-row w-full max-w-[1800px] mx-auto overflow-hidden">
        
        {/* PANEL IZQUIERDO: Editor Visual Fijo */}
        <div className="flex-[1.3] p-6 lg:p-8 flex flex-col items-center justify-center relative border-b lg:border-b-0 lg:border-r border-white/5">
          {!image ? (
            <div className="w-full max-w-2xl h-[60vh] border-2 border-dashed border-white/20 rounded-3xl flex flex-col items-center justify-center bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-[#7EAAED] transition-all duration-300 group cursor-pointer relative overflow-hidden shadow-2xl">
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-[#7EAAED]/10 to-[#7D45A9]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:shadow-[0_0_40px_rgba(126,170,237,0.4)] transition-all duration-500">
                <Upload className="w-12 h-12 text-[#7EAAED]" />
              </div>
              <h2 className="text-4xl font-bold mb-3">Carga tu obra maestra</h2>
              <p className="text-gray-400 text-lg">Arrastra tu imagen o haz clic aquí (Requiere 4K)</p>
            </div>
          ) : (
            renderVisualEditor()
          )}
        </div>

        {/* PANEL DERECHO: Sidebar Acordeón Dinámico */}
        <div className={`flex-[0.7] w-full lg:max-w-[500px] p-6 lg:p-8 bg-black/40 backdrop-blur-xl transition-all duration-700 relative ${!image ? 'opacity-0 translate-x-20 pointer-events-none absolute right-0' : 'opacity-100 translate-x-0'}`}>
           {renderSidebar()}
        </div>
      </main>

      {/* Estilos CSS Adicionales para el 3D Isométrico y Scrollbars */}
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

        /* Utilidades para 3D Isométrico */
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