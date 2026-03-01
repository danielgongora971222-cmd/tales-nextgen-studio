import React, { useEffect, useRef, useState } from 'react';
import { AppRoute } from '../types';
import GenerationQueueWidget from './GenerationQueueWidget';
import Background3D from './Background3D';
import { TOOLS_REGISTRY } from '../config/tools';
import { VIDEO_TOOLS_REGISTRY } from '../config/videoTools';
import { useAuth } from '../contexts/AuthContext';
import OneNationUpIcon from "@/components/brand/OneNationUpIcon";

interface LayoutProps {
  children: React.ReactNode;
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const NavItem: React.FC<{
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  expanded?: boolean;
}> = ({ label, active, icon, onClick, expanded }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-4 px-4 py-3 text-sm font-medium transition-all duration-300 rounded-xl group border ${
      active
        ? 'border-[rgba(241,225,148,0.40)] bg-[rgba(241,225,148,0.12)] text-white shadow-[0_0_22px_rgba(241,225,148,0.10)]'
        : 'border-transparent text-white/55 hover:text-white hover:bg-[rgba(241,225,148,0.06)] hover:border-[rgba(241,225,148,0.18)]'
    }`}
  >
    <span className="text-xl group-hover:scale-110 transition-transform">{icon}</span>
    {expanded !== undefined ? (
      <div className="flex-1 flex justify-between items-center">
        <span className={`tracking-wide ${active ? 'font-bold' : ''}`}>{label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    ) : (
      <span className={`tracking-wide ${active ? 'font-bold' : ''}`}>{label}</span>
    )}
  </button>
);

const Layout: React.FC<LayoutProps> = ({ children, currentRoute, onNavigate }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [videoMenuOpen, setVideoMenuOpen] = useState(false);
  const [myCreationsMenuOpen, setMyCreationsMenuOpen] = useState(false);
  const [imageMenuVisible, setImageMenuVisible] = useState(false);
  const [videoMenuVisible, setVideoMenuVisible] = useState(false);
  const [myCreationsMenuVisible, setMyCreationsMenuVisible] = useState(false);
  const [imageFlyoutTop, setImageFlyoutTop] = useState<number | null>(null);
  const [videoFlyoutTop, setVideoFlyoutTop] = useState<number | null>(null);
  const [myCreationsFlyoutTop, setMyCreationsFlyoutTop] = useState<number | null>(null);
  const { user, logout } = useAuth();

  const sidebarRef = useRef<HTMLElement | null>(null);
  const imageMenuTimer = useRef<number | null>(null);
  const videoMenuTimer = useRef<number | null>(null);
  const myCreationsMenuTimer = useRef<number | null>(null);

    const isImageTool =
    TOOLS_REGISTRY.some((tool) => tool.route === currentRoute) || currentRoute === AppRoute.IMAGE_GEN_ROOT;

  const isVideoTool =
    VIDEO_TOOLS_REGISTRY.some((tool) => tool.route === currentRoute) || currentRoute === AppRoute.VIDEO_GEN;

  // Si en tu rama Motion Control ya está dentro del desplegable de Image Gen,
  // solo inyectamos "Edit Video" ahí. Si no está, agregamos ambos.
  const hasMotionControlInImageMenu = TOOLS_REGISTRY.some(
    (tool) => tool.id === 'motion-control' || tool.label.toLowerCase().includes('motion control')
  );

  const myCreationsFilters = [
    { key: 'all', label: 'Todos' },
    { key: 'favorites', label: 'Favoritos' },
    { key: 'image', label: 'Solo Imagen' },
    { key: 'video', label: 'Solo Video' },
    { key: 'lip-sync', label: 'Lip-Sync' },
    { key: 'motion-control', label: 'Motion Control' },
    { key: 'element', label: 'Element' },
    { key: 'reference', label: 'Reference' },
    { key: 'audio', label: 'Audio' },
    { key: 'extras', label: 'Extras' }
  ];

  // Auto-collapse sidebar when clicking outside (matches your mock)
  useEffect(() => {
    function onPointerDown(ev: PointerEvent) {
      if (!sidebarOpen) return;
      const el = sidebarRef.current;
      if (!el) return;
      const target = ev.target as Node | null;
      if (!target) return;
      if (el.contains(target)) return;
      setSidebarOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [sidebarOpen]);
  useEffect(() => {
    return () => {
      if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
      if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
      if (myCreationsMenuTimer.current) window.clearTimeout(myCreationsMenuTimer.current);
    };
  }, []);
  useEffect(() => {
    if (imageMenuOpen) {
      setImageMenuVisible(true);
      return;
    }
    if (imageMenuVisible) {
      const timer = window.setTimeout(() => setImageMenuVisible(false), 200);
      return () => window.clearTimeout(timer);
    }
  }, [imageMenuOpen, imageMenuVisible]);

  useEffect(() => {
    if (videoMenuOpen) {
      setVideoMenuVisible(true);
      return;
    }
    if (videoMenuVisible) {
      const timer = window.setTimeout(() => setVideoMenuVisible(false), 200);
      return () => window.clearTimeout(timer);
    }
  }, [videoMenuOpen, videoMenuVisible]);

  useEffect(() => {
    if (myCreationsMenuOpen) {
      setMyCreationsMenuVisible(true);
      return;
    }
    if (myCreationsMenuVisible) {
      const timer = window.setTimeout(() => setMyCreationsMenuVisible(false), 200);
      return () => window.clearTimeout(timer);
    }
  }, [myCreationsMenuOpen, myCreationsMenuVisible]);

  const handleImageMenuEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    if (myCreationsMenuTimer.current) window.clearTimeout(myCreationsMenuTimer.current);
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      const itemRect = event.currentTarget.getBoundingClientRect();
      const sidebarRect = sidebarEl.getBoundingClientRect();
      setImageFlyoutTop(itemRect.top - sidebarRect.top);
    }
    setVideoMenuOpen(false);
    setMyCreationsMenuOpen(false);
    setImageMenuOpen(true);
  };

  const handleImageMenuLeave = () => {
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    imageMenuTimer.current = window.setTimeout(() => setImageMenuOpen(false), 700);
  };

  const handleVideoMenuEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    if (myCreationsMenuTimer.current) window.clearTimeout(myCreationsMenuTimer.current);
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      const itemRect = event.currentTarget.getBoundingClientRect();
      const sidebarRect = sidebarEl.getBoundingClientRect();
      setVideoFlyoutTop(itemRect.top - sidebarRect.top);
    }
    setImageMenuOpen(false);
    setMyCreationsMenuOpen(false);
    setVideoMenuOpen(true);
  };

  const handleVideoMenuLeave = () => {
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    videoMenuTimer.current = window.setTimeout(() => setVideoMenuOpen(false), 700);
  };

  const handleMyCreationsEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (myCreationsMenuTimer.current) window.clearTimeout(myCreationsMenuTimer.current);
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      const itemRect = event.currentTarget.getBoundingClientRect();
      const sidebarRect = sidebarEl.getBoundingClientRect();
      setMyCreationsFlyoutTop(itemRect.top - sidebarRect.top);
    }
    setImageMenuOpen(false);
    setVideoMenuOpen(false);
    setMyCreationsMenuOpen(true);
  };

  const handleMyCreationsLeave = () => {
    if (myCreationsMenuTimer.current) window.clearTimeout(myCreationsMenuTimer.current);
    myCreationsMenuTimer.current = window.setTimeout(() => setMyCreationsMenuOpen(false), 700);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden flex bg-black text-white font-sans selection:bg-white selection:text-black">
      <div className="absolute inset-0 z-0">
        <Background3D />
      </div>
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-black/20 to-black/80 pointer-events-none" />

      <aside
        ref={sidebarRef}
        className={`relative z-20 h-full overflow-visible transition-all duration-500 ease-out flex flex-col hud-panel hud-noise ${
          sidebarOpen ? 'w-72' : 'w-20'
        }`}
      >
        <div className="p-6 flex items-center justify-between">
          {sidebarOpen && (
            <h1 className="text-2xl font-bold tracking-tighter animate-pulse-fast">
              TALES<span className="font-light opacity-50">.AI</span>
            </h1>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-full hud-btn transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2 py-4 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <NavItem
            label={sidebarOpen ? 'Dashboard' : ''}
            active={currentRoute === AppRoute.HOME}
            onClick={() => onNavigate(AppRoute.HOME)}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
              </svg>
            }
          />

          <NavItem
            label={sidebarOpen ? 'My Trades' : ''}
            active={currentRoute === AppRoute.MY_TRADES}
            onClick={() => onNavigate(AppRoute.MY_TRADES)}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l6-6 4 4 7-7" />
                <path d="M14 8h7v7" />
              </svg>
            }
          />

          <NavItem
            label={sidebarOpen ? 'Community Store' : ''}
            active={currentRoute === AppRoute.COMMUNITY_STORE}
            onClick={() => onNavigate(AppRoute.COMMUNITY_STORE)}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H3V7z" />
                <path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h9" />
              </svg>
            }
          />

          <div className="relative" onMouseEnter={handleMyCreationsEnter} onMouseLeave={handleMyCreationsLeave}>
            <NavItem
              label={sidebarOpen ? 'My Creations' : ''}
              active={currentRoute === AppRoute.MY_CREATIONS}
              onClick={() => onNavigate(AppRoute.MY_CREATIONS)}
              expanded={sidebarOpen ? myCreationsMenuOpen : undefined}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h5l2 3h11v13a2 2 0 0 1-2 2H3V3z" />
                  <path d="M7 11h8" />
                  <path d="M7 15h5" />
                </svg>
              }
            />
          </div>

          <div className="hud-divider my-4 mx-2" />

          <div className="relative" onMouseEnter={handleImageMenuEnter} onMouseLeave={handleImageMenuLeave}>
            <NavItem
              label={sidebarOpen ? 'Image Gen' : ''}
              active={isImageTool}
              onClick={() => {
                if (!sidebarOpen) setSidebarOpen(true);
                onNavigate(AppRoute.IMAGE_GEN_ROOT);
              }}
              expanded={sidebarOpen ? imageMenuOpen : undefined}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="14" x="3" y="5" rx="2" ry="2" />
                  <circle cx="9" cy="10" r="1.5" />
                  <path d="m21 16-4.2-4.2a2 2 0 0 0-2.8 0L7 18" />
                </svg>
              }
            />
          </div>

          <div className="relative" onMouseEnter={handleVideoMenuEnter} onMouseLeave={handleVideoMenuLeave}>
            <NavItem
              label={sidebarOpen ? 'Video Gen' : ''}
              active={isVideoTool}
              onClick={() => {
                if (!sidebarOpen) setSidebarOpen(true);
                onNavigate(AppRoute.VIDEO_GEN);
              }}
              expanded={sidebarOpen ? videoMenuOpen : undefined}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m22 8-6 4 6 4V8Z" />
                  <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
                </svg>
              }
            />
          </div>

          <NavItem
            label={sidebarOpen ? 'Smart Assistant' : ''}
            active={false}
            onClick={() => {}}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a7 7 0 0 0-4 12.7V18a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.3A7 7 0 0 0 12 2z" />
                <path d="M9 22h6" />
              </svg>
            }
          />

          <NavItem
            label={sidebarOpen ? 'Audio' : ''}
            active={false}
            onClick={() => {}}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            }
          />

          <NavItem
            label={sidebarOpen ? 'Extras' : ''}
            active={false}
            onClick={() => {}}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20" />
                <path d="M2 12h20" />
              </svg>
            }
          />

          <NavItem
            label={sidebarOpen ? 'All Tools' : ''}
            active={false}
            onClick={() => {}}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="7" x="3" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="3" rx="1" />
                <rect width="7" height="7" x="3" y="14" rx="1" />
                <rect width="7" height="7" x="14" y="14" rx="1" />
              </svg>
            }
          />
        </nav>

        {myCreationsMenuVisible && myCreationsFlyoutTop !== null && (
          <div
            className={`absolute left-full z-50 ml-3 w-64 rounded-2xl border border-white/10 bg-black shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-3 space-y-1 transition-all duration-200 ${
              myCreationsMenuOpen ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 -translate-x-2 scale-95 pointer-events-none'
            }`}
            style={{ top: myCreationsFlyoutTop }}
            onMouseEnter={() => {
              if (myCreationsMenuTimer.current) window.clearTimeout(myCreationsMenuTimer.current);
              setImageMenuOpen(false);
              setVideoMenuOpen(false);
              setMyCreationsMenuOpen(true);
            }}
            onMouseLeave={handleMyCreationsLeave}
          >
            {myCreationsFilters.map((filter) => (
              <button
                key={filter.key}
                onClick={() => onNavigate(AppRoute.MY_CREATIONS)}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all border border-transparent text-white/60 hover:text-white hover:bg-white/5"
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}

        {imageMenuVisible && imageFlyoutTop !== null && (
          <div
            className={`absolute left-full z-50 ml-3 w-64 rounded-2xl border border-white/10 bg-black shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-3 space-y-1 transition-all duration-200 ${
              imageMenuOpen ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 -translate-x-2 scale-95 pointer-events-none'
            }`}
            style={{ top: imageFlyoutTop }}
            onMouseEnter={() => {
              if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
              setVideoMenuOpen(false);
              setMyCreationsMenuOpen(false);
              setImageMenuOpen(true);
            }}
            onMouseLeave={handleImageMenuLeave}
          >
            {/*
              Si en tu rama "Motion Control" ya está dentro del desplegable de Image Gen,
              aquí solo agregamos "Edit Video" para que quede junto a Motion Control.

            
            {/* ✅ Fix: el hover de Image Gen debe mostrar sus herramientas (no herramientas de Video) */}
            {TOOLS_REGISTRY.map((tool) => {
              const isPrimary = tool.id === 'image-generator';
              return (
                <button
                  key={tool.id}
                  onClick={() => onNavigate(tool.route)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                    currentRoute === tool.route
                      ? 'border-[rgba(241,225,148,0.45)] text-white bg-[rgba(241,225,148,0.08)]'
                      : isPrimary
                        ? 'border-[rgba(241,225,148,0.35)] text-white bg-[rgba(241,225,148,0.14)] shadow-[0_0_18px_rgba(241,225,148,0.18)]'
                        : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{tool.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {videoMenuVisible && videoFlyoutTop !== null && (
          <div
            className={`absolute left-full z-50 ml-3 w-60 rounded-2xl border border-white/10 bg-black shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-3 space-y-1 transition-all duration-200 ${
              videoMenuOpen ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 -translate-x-2 scale-95 pointer-events-none'
            }`}
            style={{ top: videoFlyoutTop }}
            onMouseEnter={() => {
              if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
              setImageMenuOpen(false);
              setMyCreationsMenuOpen(false);
              setVideoMenuOpen(true);
            }}
            onMouseLeave={handleVideoMenuLeave}
          >
            {VIDEO_TOOLS_REGISTRY.map((tool) => {
              const isPrimary = tool.id === 'video-generator';
              return (
                <button
                  key={tool.id}
                  onClick={() => onNavigate(tool.route)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                    currentRoute === tool.route
                      ? 'border-[rgba(241,225,148,0.45)] text-white bg-[rgba(241,225,148,0.08)]'
                      : isPrimary
                        ? 'border-[rgba(241,225,148,0.35)] text-white bg-[rgba(241,225,148,0.14)] shadow-[0_0_18px_rgba(241,225,148,0.18)]'
                        : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{tool.label}</span>
                    {tool.status === 'beta' && <span className="text-[9px] bg-white/20 px-1 rounded">BETA</span>}
                    {tool.status === 'coming_soon' && <span className="text-[9px] bg-white/10 px-1 rounded text-white/70">SOON</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}


      {/* ✅ 1NationUp Store (colapsa correctamente con la sidebar) */}
      <div className={`${sidebarOpen ? "px-4" : "px-3"} pb-4`}>
        <button
          onClick={() => onNavigate(AppRoute.STORE)}
          className={`w-full flex items-center rounded-xl oneNation-sidebarPremium ${
            sidebarOpen ? "gap-3 px-4 py-3 justify-start" : "px-0 py-3 justify-center"
          } ${currentRoute === AppRoute.STORE ? "ring-1 ring-white/10" : ""}`}
          title="1NationUp Store"
        >
          {/* Logo: siempre 1 sola vez */}
          <div
            className={`grid place-items-center rounded-xl border border-white/10 bg-[rgba(11,11,15,0.72)] ${
              sidebarOpen ? "w-9 h-9" : "w-10 h-10"
            }`}
            style={{ boxShadow: "inset 0 0 20px rgba(255,255,255,0.04)" }}
            aria-hidden="true"
          >
            <OneNationUpIcon size={22} />
          </div>

          {/* Texto SOLO si sidebar está abierta */}
          {sidebarOpen && (
            <div className="flex-1 text-left leading-tight min-w-0">
              <div className="text-sm font-black tracking-wide oneNation-animatedGradientText whitespace-nowrap">
                1NationUp Store
              </div>
              <div className="text-[10px] text-white/55">
                Prints • Posters • Canvas
              </div>
            </div>
          )}
        </button>
      </div>

        <div className="p-4 border-t border-white/10">
          <div className={`rounded-xl p-4 transition-all hud-panel hud-panel--soft hud-noise ${sidebarOpen ? 'opacity-100' : 'opacity-0 hidden'}`}>
            <div className="flex items-center gap-3 mb-3">
              <img src={user?.avatarUrl} alt="User" className="w-8 h-8 rounded-full border border-white/30" />
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-white truncate">{user?.username || 'Guest'}</p>
                <p className="text-[10px] text-gray-400">Pro Plan</p>
              </div>
            </div>
            <button onClick={logout} className="w-full text-xs bg-white/10 hover:bg-white/20 py-1.5 rounded transition-colors text-gray-300">
              Log Out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 relative z-10 overflow-y-auto overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto p-4 md:p-8">{children}</div>
      </main>

      <GenerationQueueWidget />
    </div>
  );
};


export default Layout;
