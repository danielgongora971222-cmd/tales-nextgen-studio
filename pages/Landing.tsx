import React, { useEffect, useRef } from "react";
import {
  Sparkles,
  ArrowRight,
  Video,
  ImageIcon,
  Music,
  Layers,
  Fingerprint,
  Aperture,
  RefreshCw,
  Box,
  Activity,
  Maximize,
  PlayCircle,
} from "lucide-react";

// --- SISTEMA DE PARTÍCULAS AVANZADO (Hexágonos y Reactividad de Texto) ---
const ParticleSystem: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId = 0;
    let particles: Particle[] = [];

    // El radio de explosión/repulsión
    const mouse: {
      x: number | null;
      y: number | null;
      radius: number;
      isHoveringText: boolean;
    } = { x: null, y: null, radius: 150, isHoveringText: false };

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    };

    window.addEventListener("resize", resizeCanvas);

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY + document.documentElement.scrollTop;
    };

    // Detectar cuando el ratón sale de la pantalla para calmar el sistema
    const handleMouseOut = () => {
      mouse.x = null;
      mouse.y = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseOut);

    // Función para dibujar hexágonos en lugar de círculos
    const drawHexagon = (x: number, y: number, size: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const hx = x + size * Math.cos(angle);
        const hy = y + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fill();
    };

    class Particle {
      x: number;
      y: number;
      size: number;
      baseX: number;
      baseY: number;
      density: number;
      vx: number;
      vy: number;
      color: string;
      isVolatile: boolean;
      life: number;

      constructor(x: number, y: number, isVolatile = false) {
        this.x = x;
        this.y = y;
        // Las partículas volátiles (las que se desprenden del texto) son más grandes
        this.size = isVolatile ? Math.random() * 3 + 1 : Math.random() * 1.5 + 0.5;
        this.baseX = this.x;
        this.baseY = this.y;
        this.density = Math.random() * 20 + 1; // Menos densidad para una reacción más suave

        // Movimiento base perpetuo
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;

        // Paleta más neutral
        this.color =
          Math.random() > 0.8
            ? "rgba(0, 240, 255, 0.3)"
            : `rgba(200, 200, 200, ${Math.random() * 0.5 + 0.2})`;

        this.isVolatile = isVolatile;
        this.life = isVolatile ? 80 : Number.POSITIVE_INFINITY; // Vida útil para partículas desprendidas
      }

      draw() {
        ctx.fillStyle = this.color;
        // Si es volátil o estamos cerca, dibujar hexágono, sino círculo para optimizar
        if (this.isVolatile || this.size > 1.2) {
          drawHexagon(this.x, this.y, this.size);
        } else {
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
          ctx.closePath();
          ctx.fill();
        }
      }

      update() {
        // Movimiento perpetuo sutil
        if (!this.isVolatile) {
          this.baseX += this.vx;
          this.baseY += this.vy;

          // Rebote en bordes lógicos para mantener la densidad
          if (this.baseX < 0 || this.baseX > canvas.width) this.vx *= -1;
          if (this.baseY < 0 || this.baseY > canvas.height) this.vy *= -1;
        }

        // Interacción con el ratón (Explosión/Repulsión suave)
        if (mouse.x != null && mouse.y != null) {
          const dx = mouse.x - this.x;
          const dy = mouse.y - this.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 0.0001;

          // Radio dinámico: mayor si está sobre texto interactivo
          const currentRadius = mouse.isHoveringText ? mouse.radius * 1.2 : mouse.radius;

          if (distance < currentRadius) {
            const forceDirectionX = dx / distance;
            const forceDirectionY = dy / distance;
            const force = (currentRadius - distance) / currentRadius;

            // Efecto "Explode" más suave
            const directionX = forceDirectionX * force * this.density * 0.5;
            const directionY = forceDirectionY * force * this.density * 0.5;

            this.x -= directionX;
            this.y -= directionY;
          } else {
            // Retorno al estado base (elásticos)
            if (this.x !== this.baseX) {
              const ddx = this.x - this.baseX;
              this.x -= ddx / 20;
            }
            if (this.y !== this.baseY) {
              const ddy = this.y - this.baseY;
              this.y -= ddy / 20;
            }
          }
        } else {
          // Retorno si no hay ratón
          if (this.x !== this.baseX) {
            const ddx = this.x - this.baseX;
            this.x -= ddx / 20;
          }
          if (this.y !== this.baseY) {
            const ddy = this.y - this.baseY;
            this.y -= ddy / 20;
          }
        }

        // Gestión de ciclo de vida para partículas desprendidas del texto
        if (this.isVolatile) {
          this.life--;
          this.size *= 0.95; // Se encogen más rápido
          this.x += (Math.random() - 0.5) * 3; // Movimiento errático suave
          this.y -= Math.random() * 2; // Flotan hacia arriba
        }
      }
    }

    const initParticles = () => {
      particles = [];
      const numberOfParticles = (canvas.width * canvas.height) / 8000; // Densidad balanceada
      for (let i = 0; i < numberOfParticles; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new Particle(x, y));
      }
    };

    const connect = () => {
      // Optimización: No conectar todas, solo vecinas cercanas
      for (let a = 0; a < particles.length; a++) {
        for (let b = a; b < particles.length; b++) {
          const distance =
            (particles[a].x - particles[b].x) * (particles[a].x - particles[b].x) +
            (particles[a].y - particles[b].y) * (particles[a].y - particles[b].y);

          if (distance < (canvas.width / 12) * (canvas.height / 12)) {
            const opacityValue = 1 - distance / 12000;
            ctx.strokeStyle = `rgba(200, 200, 200, ${opacityValue * 0.1})`; // Conexiones neutrales
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }
    };

    const animate = () => {
      // Trail effect ligero
      ctx.fillStyle = "rgba(10, 10, 10, 0.3)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Filtrar partículas muertas
      particles = particles.filter((p) => p.life > 0);

      // --- Lógica de Interacción con Textos ---
      mouse.isHoveringText = false;
      const interactibles = document.querySelectorAll(".interactive-text");

      interactibles.forEach((el) => {
        if (!mouse.x || !mouse.y) return;

        const rect = (el as HTMLElement).getBoundingClientRect();
        // Ajuste del bounding box para incluir scroll y tolerancia
        const tolerance = 20;
        const isOver =
          mouse.x > rect.left - tolerance &&
          mouse.x < rect.right + tolerance &&
          mouse.y > rect.top + window.scrollY - tolerance &&
          mouse.y < rect.bottom + window.scrollY + tolerance;

        const hEl = el as HTMLElement;

        if (isOver) {
          mouse.isHoveringText = true;

          // 1. Reacción Física del Texto
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2 + window.scrollY;

          const pushX = (centerX - mouse.x) * 0.05;
          const pushY = (centerY - mouse.y) * 0.05;

          hEl.style.transform = `translate(${pushX}px, ${pushY}px) scale(1.02)`;
          hEl.style.textShadow = `0 0 20px rgba(255, 255, 255, 0.3), ${pushX}px ${pushY}px 5px rgba(255, 255, 255, 0.1)`;

          // 2. Desintegración Sutil
          if (Math.random() > 0.8) {
            particles.push(
              new Particle(
                mouse.x + (Math.random() - 0.5) * 20,
                mouse.y + (Math.random() - 0.5) * 20,
                true
              )
            );
          }
        } else {
          // Retorno al estado original
          hEl.style.transform = "translate(0px, 0px) scale(1)";
          if (!hEl.classList.contains("always-glow")) {
            hEl.style.textShadow = "none";
          } else {
            hEl.style.textShadow = "0 0 30px rgba(255, 255, 255, 0.2)";
          }
        }
      });

      for (let i = 0; i < particles.length; i++) {
        particles[i].draw();
        particles[i].update();
      }

      connect();
      animationFrameId = requestAnimationFrame(animate);
    };

    resizeCanvas();
    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseOut);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ mixBlendMode: "screen" }}
    />
  );
};

type LandingProps = {
  onEnter: () => void; // cualquier acción => login
};

const Landing: React.FC<LandingProps> = ({ onEnter }) => {
  const imageGenTools = [
    { name: "General Image Generator", icon: <ImageIcon className="w-5 h-5" /> },
    { name: "Restyler", icon: <RefreshCw className="w-5 h-5" /> },
    { name: "Lightroom", icon: <Aperture className="w-5 h-5" /> },
    { name: "Camera Angles", icon: <Box className="w-5 h-5" /> },
    { name: "Restore/Upscale", icon: <Maximize className="w-5 h-5" /> },
    { name: "FaceSwapp", icon: <Fingerprint className="w-5 h-5" /> },
  ];

  const videoGenTools = [
    { name: "General Video Generator", icon: <Video className="w-5 h-5" /> },
    { name: "Ingredients to Video", icon: <Layers className="w-5 h-5" /> },
    { name: "Edit Video", icon: <PlayCircle className="w-5 h-5" /> },
    { name: "Motion Control", icon: <Activity className="w-5 h-5" /> },
    { name: "Extend Video", icon: <ArrowRight className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] font-sans overflow-x-hidden">
      <style>{`
        ::selection { background: rgba(255, 255, 255, 0.2); color: white; }

        .bg-grid {
          background-size: 100px 100px;
          background-image: linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px);
        }

        .interactive-text {
          display: inline-block;
          transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), text-shadow 0.3s ease;
          will-change: transform, text-shadow;
          cursor: default;
        }

        .always-glow { text-shadow: 0 0 30px rgba(255, 255, 255, 0.2); }

        .btn-premium {
          position: relative;
          background: rgba(25,25,25,0.8);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 100px;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        .btn-premium:hover {
          border-color: rgba(255,255,255,0.4);
          background: rgba(40,40,40,0.8);
          transform: translateY(-1px);
        }
        .btn-premium-inner {
          background: transparent;
          border-radius: inherit;
        }

        .reveal {
          opacity: 0;
          transform: translateY(30px);
          transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .reveal.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .tool-section {
          background: rgba(20, 20, 20, 0.5);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 20px;
          padding: 2rem;
          backdrop-filter: blur(10px);
          transition: all 0.3s ease;
        }

        .tool-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
          border: 1px solid transparent;
          transition: all 0.2s ease;
          cursor: pointer;
        }

        .tool-item:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
          transform: translateX(5px);
        }

        .tool-icon-wrapper {
          background: rgba(255,255,255,0.05);
          padding: 0.75rem;
          border-radius: 10px;
          color: rgba(255,255,255,0.7);
          transition: all 0.2s ease;
        }

        .tool-item:hover .tool-icon-wrapper {
          background: rgba(255,255,255,0.1);
          color: white;
        }
      `}</style>

      {/* Ambientación Global Neutral */}
      <div className="fixed inset-0 bg-grid opacity-20 pointer-events-none z-0 mix-blend-overlay"></div>
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03),transparent_70%)] pointer-events-none z-0"></div>

      <ParticleSystem />

      {/* Navegación Neutral */}
      <nav className="fixed top-0 w-full z-50 p-6 flex justify-between items-center transition-all duration-300">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A] to-transparent opacity-90 pointer-events-none"></div>

        <div
          className="relative z-10 flex items-center gap-3 cursor-pointer group"
          onClick={onEnter}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onEnter();
          }}
        >
          <div className="w-10 h-10 rounded-xl bg-white/10 p-[1px] group-hover:bg-white/20 transition-colors">
            <div className="w-full h-full bg-[#111] rounded-[11px] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white/80" />
            </div>
          </div>
          <span className="text-2xl font-black tracking-tighter text-white">Tales.Ai</span>
        </div>

        <button className="relative z-10 btn-premium py-1 px-[2px]" onClick={onEnter}>
          <div className="btn-premium-inner px-8 py-2 flex items-center gap-2">
            <span className="text-sm font-bold tracking-wide text-white/90">Iniciar Sesión</span>
          </div>
        </button>
      </nav>

      {/* HERO SECTION */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 pt-20">
        <div className="max-w-5xl w-full text-center reveal">
          <h1 className="text-[3.5rem] md:text-[6rem] lg:text-[7.5rem] font-black leading-[1] tracking-tighter mb-8 flex flex-col items-center">
            <span className="interactive-text block text-white opacity-90">YA NADA ES</span>
            <span className="interactive-text always-glow block text-white pb-4">IMPOSIBLE.</span>
          </h1>

          <p className="interactive-text text-lg md:text-2xl text-gray-400 font-light max-w-4xl mx-auto mb-16 leading-relaxed">
            El futuro es hoy. Todo lo que pienses e imagines lo podrás hacer realidad con solo describirlo.
            Genera tu propio mundo, tu propio arte a partir de lenguaje natural con los modelos de IA más avanzados
            en todo momento.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <button
              className="group relative px-10 py-4 bg-white text-black rounded-full font-bold text-lg transition-transform hover:scale-105"
              onClick={onEnter}
            >
              <span className="flex items-center justify-center gap-2">
                Comenzar <ArrowRight className="w-5 h-5" />
              </span>
            </button>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div
          className="absolute bottom-12 flex flex-col items-center gap-4 opacity-40 reveal"
          style={{ transitionDelay: "0.5s" }}
        >
          <div className="w-[1px] h-16 bg-gradient-to-b from-white to-transparent"></div>
        </div>
      </main>

      {/* ARQUITECTURA DEL SISTEMA */}
      <section className="relative z-10 py-32 px-6 md:px-12 lg:px-24">
        <div className="max-w-6xl mx-auto">
          <div className="reveal mb-20 text-center md:text-left">
            <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase mb-3">Ecosistema</h2>
            <h3 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
              <span className="interactive-text block">Arsenal Creativo</span>
            </h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Image Gen Section */}
            <div className="tool-section reveal">
              <div className="flex items-center gap-3 mb-8 border-b border-white/10 pb-4">
                <ImageIcon className="w-6 h-6 text-white/70" />
                <h4 className="text-2xl font-bold text-white">Image Gen</h4>
              </div>

              <div className="flex flex-col gap-3">
                {imageGenTools.map((tool, idx) => (
                  <div key={idx} className="tool-item" onClick={onEnter}>
                    <div className="tool-icon-wrapper">{tool.icon}</div>
                    <span className="font-medium text-gray-300">{tool.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Video Gen Section */}
            <div className="tool-section reveal" style={{ transitionDelay: "0.1s" }}>
              <div className="flex items-center gap-3 mb-8 border-b border-white/10 pb-4">
                <Video className="w-6 h-6 text-white/70" />
                <h4 className="text-2xl font-bold text-white">Video Gen</h4>
              </div>

              <div className="flex flex-col gap-3">
                {videoGenTools.map((tool, idx) => (
                  <div key={idx} className="tool-item" onClick={onEnter}>
                    <div className="tool-icon-wrapper">{tool.icon}</div>
                    <span className="font-medium text-gray-300">{tool.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Audio & 3D */}
            <div
              className="tool-section reveal lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8"
              style={{ transitionDelay: "0.2s", padding: 0, background: "transparent", border: "none" }}
            >
              <div
                className="bg-white/[0.02] border border-white/5 p-8 rounded-2xl flex flex-col items-center text-center hover:bg-white/[0.04] transition-colors cursor-pointer"
                onClick={onEnter}
              >
                <div className="p-4 bg-white/5 rounded-full mb-4">
                  <Music className="w-8 h-8 text-white/60" />
                </div>
                <h4 className="text-xl font-bold text-white mb-2">Audio Arquitectura</h4>
                <p className="text-sm text-gray-500">Composición y SFX reactivos.</p>
              </div>

              <div
                className="bg-white/[0.02] border border-white/5 p-8 rounded-2xl flex flex-col items-center text-center hover:bg-white/[0.04] transition-colors cursor-pointer"
                onClick={onEnter}
              >
                <div className="p-4 bg-white/5 rounded-full mb-4">
                  <Layers className="w-8 h-8 text-white/60" />
                </div>
                <h4 className="text-xl font-bold text-white mb-2">Escultura Neuronal</h4>
                <p className="text-sm text-gray-500">Generación de modelos 3D.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 py-32 px-6 border-t border-white/5 bg-[#0A0A0A] overflow-hidden">
        <div className="max-w-4xl mx-auto text-center relative reveal">
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            <span className="interactive-text block">Tu ADN Digital</span>
            <span className="interactive-text block text-gray-400">Comienza Aquí.</span>
          </h2>

          <p className="text-xl text-gray-500 font-light max-w-2xl mx-auto mb-12">
            Únete a la élite de creadores que están redefiniendo los límites de lo visual.
          </p>

          <button
            className="px-10 py-4 bg-white text-black rounded-full font-bold hover:bg-gray-200 transition-colors"
            onClick={onEnter}
          >
            Crear Cuenta Gratis
          </button>
        </div>
      </section>
    </div>
  );
};

export default Landing;