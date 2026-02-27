import React, { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  baseOpacity: number;
  speed: number;
  twinkleSpeed: number;
  twinkleDir: number;
}

const Background3D: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const smoothMouseRef = useRef({ x: -9999, y: -9999 });
  const starsRef = useRef<Star[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    const initStars = () => {
      const starCount = Math.floor((width * height) / 4000); 
      const newStars: Star[] = [];
      for (let i = 0; i < starCount; i++) {
        const baseOp = Math.random() * 0.7 + 0.1;
        newStars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: Math.random() * 1.2 + 0.1,
          opacity: baseOp,
          baseOpacity: baseOp,
          speed: Math.random() * 0.05 + 0.01, // Slower stars
          twinkleSpeed: Math.random() * 0.01 + 0.002,
          twinkleDir: Math.random() > 0.5 ? 1 : -1
        });
      }
      starsRef.current = newStars;
    };
    
    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      initStars();
    };
    
    const handleMouseMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        mouseRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };
    
    const handleMouseLeave = () => {
        mouseRef.current = { x: -9999, y: -9999 };
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseout', handleMouseLeave);

    handleResize();

    let time = 0;
    
    // Grid settings
    const gridSize = 45; 
    let forwardSpeed = 0;
    
    // Interaction physics - SUBTLE & MINIMALIST
    const influenceRadius = 180; // Smaller radius
    
    // Noise function (dampened)
    const noise = (x: number, y: number, t: number) => {
        return Math.sin(x * 0.005 + t) * Math.cos(y * 0.005 + t * 0.5) * 8; // Amplitude reduced from 20 to 8
    };

    const draw = () => {
      ctx.fillStyle = '#020202'; 
      ctx.fillRect(0, 0, width, height);

      time += 0.008; // Slower time
      forwardSpeed = (forwardSpeed + 0.2) % gridSize; // Slower movement

      // Very smooth mouse interpolation
      const dx = mouseRef.current.x - smoothMouseRef.current.x;
      const dy = mouseRef.current.y - smoothMouseRef.current.y;
      smoothMouseRef.current.x += dx * 0.05;
      smoothMouseRef.current.y += dy * 0.05;

      // Nebula
      const nebX = Math.sin(time * 0.3) * 50 + width / 2;
      const nebY = Math.cos(time * 0.2) * 20 + height / 2;
      
      const nebulaGrad = ctx.createRadialGradient(nebX, nebY, 0, width / 2, height / 2, width * 0.9);
      nebulaGrad.addColorStop(0, 'rgba(40, 40, 50, 0.02)'); 
      nebulaGrad.addColorStop(0.6, 'rgba(10, 10, 15, 0.005)');
      nebulaGrad.addColorStop(1, 'transparent');
      
      ctx.fillStyle = nebulaGrad;
      ctx.fillRect(0, 0, width, height);

      // Stars
      starsRef.current.forEach(star => {
        star.y -= star.speed; 
        if (star.y < 0) {
          star.y = height;
          star.x = Math.random() * width;
        }
        star.opacity += star.twinkleSpeed * star.twinkleDir;
        if (star.opacity > star.baseOpacity + 0.1 || star.opacity < star.baseOpacity - 0.1) {
          star.twinkleDir *= -1;
        }
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, star.opacity)})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Grid Logic
      const horizon = height * 0.35; 
      const mx = smoothMouseRef.current.x;
      const my = smoothMouseRef.current.y;
      const isMouseActive = mouseRef.current.x > -100;

      const transformPoint = (wx: number, wy: number) => {
          const perspective = (wy - horizon) / (height - horizon); 
          if (perspective <= 0) return null;

          const zScale = Math.pow(perspective, 0.9); // Flatter perspective
          
          let sx = (width / 2) + (wx - width / 2) * zScale;
          let sy = wy;

          // Organic low-freq wave
          const waveY = noise(wx, wy, time) * perspective; 
          const waveX = noise(wy, wx, time * 0.8) * perspective * 0.3;
          
          sx += waveX;
          sy += waveY;

          // Subtle Mouse Interaction
          if (isMouseActive) {
              const distX = sx - mx;
              const distY = sy - my;
              const dist = Math.sqrt(distX*distX + distY*distY);

              if (dist < influenceRadius) {
                  const force = (1 - dist / influenceRadius); 
                  const ease = force * force; // Quadratic easing

                  // Gentle push
                  const pushX = distX * ease * 0.08;
                  const pushY = distY * ease * 0.08;

                  // Very subtle lift
                  const lift = -15 * ease; 

                  sx += pushX;
                  sy += pushY + lift;
              }
          }

          return { x: sx, y: sy, opacity: perspective };
      };

      ctx.lineWidth = 1;

      // Verticals
      const vCols = Math.ceil(width / gridSize) + 6;
      for (let i = -6; i <= vCols; i++) {
          const worldX = (i * gridSize * 3) - (width * 0.5);
          
          ctx.beginPath();
          let started = false;
          let maxDistortion = 0;

          for (let y = horizon; y < height; y += 20) {
             const p = transformPoint(worldX + width/2, y);
             if (!p) continue;

             if (isMouseActive) {
                const d = Math.hypot(p.x - mx, p.y - my);
                if (d < influenceRadius) maxDistortion = Math.max(maxDistortion, (1 - d/influenceRadius));
             }

             if (!started) { ctx.moveTo(p.x, p.y); started = true; } 
             else { ctx.lineTo(p.x, p.y); }
          }

          const baseAlpha = 0.05;
          const activeAlpha = 0.2; // Reduced active glow
          const alpha = baseAlpha + (maxDistortion * activeAlpha);
          
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.stroke();
      }

      // Horizontals
      const hLines = 25;
      for (let j = 0; j < hLines; j++) {
          const logicZ = (j * gridSize) - forwardSpeed;
          const progress = (logicZ + gridSize) / (hLines * gridSize);
          if (progress <= 0 || progress >= 1) continue;

          const screenY = horizon + Math.pow(progress, 2.2) * (height - horizon);
          
          ctx.beginPath();
          let started = false;
          let maxDistortion = 0;

          for (let x = 0; x <= width; x += 30) {
              const p = transformPoint(x, screenY);
              if (!p) continue;

              if (isMouseActive) {
                  const d = Math.hypot(p.x - mx, p.y - my);
                  if (d < influenceRadius) maxDistortion = Math.max(maxDistortion, (1 - d/influenceRadius));
               }

              if (!started) { ctx.moveTo(p.x, p.y); started = true; } 
              else { ctx.lineTo(p.x, p.y); }
          }

          const baseAlpha = progress * 0.15;
          const activeAlpha = 0.3;
          const alpha = Math.min(1, baseAlpha + (maxDistortion * activeAlpha));

          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.stroke();
      }

      requestAnimationFrame(draw);
    };

    const animId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseout', handleMouseLeave);
      cancelAnimationFrame(animId);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full opacity-60" />; // Reduced base opacity
};

export default Background3D;