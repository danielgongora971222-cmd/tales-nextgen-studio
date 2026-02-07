import React, { useEffect, useRef, useState } from 'react';
import { AppRoute } from '../types';
import Background3D from './Background3D';
import { TOOLS_REGISTRY } from '../config/tools';
import { useAuth } from '../contexts/AuthContext';

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
  const [imageMenuVisible, setImageMenuVisible] = useState(false);
  const [videoMenuVisible, setVideoMenuVisible] = useState(false);
  const [imageFlyoutTop, setImageFlyoutTop] = useState<number | null>(null);
  const [videoFlyoutTop, setVideoFlyoutTop] = useState<number | null>(null);
  const { user, logout } = useAuth();

  const sidebarRef = useRef<HTMLElement | null>(null);
  const imageMenuTimer = useRef<number | null>(null);
  const videoMenuTimer = useRef<number | null>(null);

  const isImageTool =
    TOOLS_REGISTRY.some((tool) => tool.route === currentRoute) || currentRoute === AppRoute.IMAGE_GEN_ROOT;
  const videoTools = [
    {
      id: 'general-video',
      label: 'General Video Generator',
      status: 'ready' as const
    },
    {
      id: 'motion-control',
      label: 'Motion Control',
      status: 'beta' as const
    }
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

  const handleImageMenuEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      const itemRect = event.currentTarget.getBoundingClientRect();
      const sidebarRect = sidebarEl.getBoundingClientRect();
      setImageFlyoutTop(itemRect.top - sidebarRect.top);
    }
    setVideoMenuOpen(false);
    setImageMenuOpen(true);
  };

  const handleImageMenuLeave = () => {
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    imageMenuTimer.current = window.setTimeout(() => setImageMenuOpen(false), 700);
  };

  const handleVideoMenuEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      const itemRect = event.currentTarget.getBoundingClientRect();
      const sidebarRect = sidebarEl.getBoundingClientRect();
      setVideoFlyoutTop(itemRect.top - sidebarRect.top);
    }
    setImageMenuOpen(false);
    setVideoMenuOpen(true);
  };

  const handleVideoMenuLeave = () => {
    if (videoMenuTimer.current) window.clearTimeout(videoMenuTimer.current);
    videoMenuTimer.current = window.setTimeout(() => setVideoMenuOpen(false), 700);
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

          <div className="relative mx-1">
            <div className="sidebar-galaxy rounded-2xl border border-white/10" />
          </div>

          <NavItem
            label={sidebarOpen ? 'My Creations' : ''}
            active={currentRoute === AppRoute.MY_CREATIONS}
            onClick={() => onNavigate(AppRoute.MY_CREATIONS)}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h5l2 3h11v13a2 2 0 0 1-2 2H3V3z" />
                <path d="M7 11h8" />
                <path d="M7 15h5" />
              </svg>
            }
          />

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
              active={currentRoute === AppRoute.VIDEO_GEN}
              onClick={() => onNavigate(AppRoute.VIDEO_GEN)}
              expanded={sidebarOpen ? videoMenuOpen : undefined}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m22 8-6 4 6 4V8Z" />
                  <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
                </svg>
              }
            />
          </div>
        </nav>

        {imageMenuVisible && imageFlyoutTop !== null && (
          <div
            className={`absolute left-full z-50 ml-3 w-64 rounded-2xl border border-white/10 bg-black shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-3 space-y-1 transition-all duration-200 ${
              imageMenuOpen ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 -translate-x-2 scale-95 pointer-events-none'
            }`}
            style={{ top: imageFlyoutTop }}
            onMouseEnter={() => {
              if (imageMenuTimer.current) window.clearTimeout(imageMenuTimer.current);
              setVideoMenuOpen(false);
              setImageMenuOpen(true);
            }}
            onMouseLeave={handleImageMenuLeave}
          >
            {TOOLS_REGISTRY.map((tool) => {
              const isPrimary = tool.id === 'generator';
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
              setVideoMenuOpen(true);
            }}
            onMouseLeave={handleVideoMenuLeave}
          >
            {videoTools.map((tool) => {
              const isPrimary = tool.id === 'general-video';
              return (
                <button
                  key={tool.id}
                  onClick={() => onNavigate(AppRoute.VIDEO_GEN)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                    isPrimary
                      ? 'border-[rgba(241,225,148,0.35)] text-white bg-[rgba(241,225,148,0.14)] shadow-[0_0_18px_rgba(241,225,148,0.18)]'
                      : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{tool.label}</span>
                    {tool.status === 'beta' && <span className="text-[9px] bg-white/20 px-1 rounded">BETA</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

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
    </div>
  );
};

export default Layout;
