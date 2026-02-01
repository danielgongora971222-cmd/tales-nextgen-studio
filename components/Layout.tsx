import React, { useState } from 'react';
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
    className={`w-full flex items-center gap-4 px-4 py-3 text-sm font-medium transition-all duration-300 rounded-xl group ${
      active 
        ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)]' 
        : 'text-white/60 hover:text-white hover:bg-white/10'
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
            <path d="m6 9 6 6 6-6"/>
          </svg>
       </div>
    ) : (
      <span className={`tracking-wide ${active ? 'font-bold' : ''}`}>{label}</span>
    )}
  </button>
);

const SubNavItem: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  status?: string;
}> = ({ label, active, onClick, status }) => (
  <button
    onClick={onClick}
    className={`w-full text-left pl-12 pr-4 py-2 text-xs font-medium transition-all rounded-r-xl border-l-2 flex justify-between items-center ${
      active 
        ? 'border-white text-white bg-white/5' 
        : 'border-white/10 text-white/40 hover:text-white hover:border-white/50'
    }`}
  >
    <span>{label}</span>
    {status === 'beta' && <span className="text-[9px] bg-white/20 px-1 rounded">BETA</span>}
  </button>
);

const Layout: React.FC<LayoutProps> = ({ children, currentRoute, onNavigate }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [imageMenuOpen, setImageMenuOpen] = useState(true);
  const { user, logout } = useAuth();

  const isImageTool = TOOLS_REGISTRY.some(tool => tool.route === currentRoute) || currentRoute === AppRoute.IMAGE_GEN_ROOT;

  return (
    <div className="relative w-full h-screen overflow-hidden flex bg-black text-white font-sans selection:bg-white selection:text-black">
      <div className="absolute inset-0 z-0"><Background3D /></div>
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-black/20 to-black/80 pointer-events-none" />

      <aside 
        className={`relative z-20 h-full transition-all duration-500 ease-out border-r border-white/10 glass-panel flex flex-col ${
          sidebarOpen ? 'w-72' : 'w-20'
        }`}
      >
        <div className="p-6 flex items-center justify-between">
          {sidebarOpen && (
            <h1 className="text-2xl font-bold tracking-tighter animate-pulse-fast">
              TALES<span className="font-light opacity-50">.AI</span>
            </h1>
          )}
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M9 3v18"/></svg>
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2 py-4 overflow-y-auto custom-scrollbar">
          <NavItem 
            label={sidebarOpen ? "Dashboard" : ""}
            active={currentRoute === AppRoute.HOME}
            onClick={() => onNavigate(AppRoute.HOME)}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>}
          />
          
          <div className="h-px bg-white/10 my-4 mx-2" />
          
          <div>
            <NavItem 
              label={sidebarOpen ? "Image Gen" : ""}
              active={isImageTool}
              onClick={() => {
                if (!sidebarOpen) setSidebarOpen(true);
                setImageMenuOpen(!imageMenuOpen);
                onNavigate(AppRoute.IMAGE_GEN_ROOT);
              }}
              expanded={sidebarOpen ? imageMenuOpen : undefined}
              icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>}
            />
            {sidebarOpen && imageMenuOpen && (
              <div className="mt-2 space-y-1 animate-in slide-in-from-top-2 duration-200">
                {TOOLS_REGISTRY.map((tool) => (
                  <SubNavItem 
                    key={tool.id}
                    label={tool.label} 
                    active={currentRoute === tool.route} 
                    onClick={() => onNavigate(tool.route)}
                    status={tool.status}
                  />
                ))}
              </div>
            )}
          </div>

          <NavItem 
            label={sidebarOpen ? "Video Gen" : ""}
            active={currentRoute === AppRoute.VIDEO_GEN}
            onClick={() => onNavigate(AppRoute.VIDEO_GEN)}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>}
          />
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className={`rounded-xl bg-white/5 border border-white/10 p-4 transition-all ${sidebarOpen ? 'opacity-100' : 'opacity-0 hidden'}`}>
            <div className="flex items-center gap-3 mb-3">
                 <img src={user?.avatarUrl} alt="User" className="w-8 h-8 rounded-full border border-white/30" />
                 <div className="overflow-hidden">
                    <p className="text-xs font-bold text-white truncate">{user?.username || 'Guest'}</p>
                    <p className="text-[10px] text-gray-400">Pro Plan</p>
                 </div>
            </div>
            <button 
                onClick={logout}
                className="w-full text-xs bg-white/10 hover:bg-white/20 py-1.5 rounded transition-colors text-gray-300"
            >
                Log Out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 relative z-10 overflow-y-auto overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;