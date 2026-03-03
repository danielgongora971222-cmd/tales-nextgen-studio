import React, { useState, useEffect, useRef } from "react";
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Landing from "./pages/Landing";
import ImageGenHub from './pages/ImageGenHub';
import VideoGenHub from './pages/VideoGenHub';
import MyCreations from './pages/MyCreations';
import Store from './pages/Store';
import CommunityStore from './pages/CommunityStore';
import MyTrades from './pages/MyTrades';
import SellListingModal from "./components/SellListingModal";
import type { Asset } from "./types";
import ImageGeneratorTool from './pages/tools/ImageGeneratorTool';
import Profile from "./pages/Profile";
import RestylerTool from './pages/tools/RestylerTool';
import LightroomTool from './pages/tools/LightroomTool';
import FaceSwapTool from './pages/tools/FaceSwapTool';
import UpscalerTool from './pages/tools/UpscalerTool';
import EditorTool from './pages/tools/EditorTool';
import CameraAnglesTool from './pages/tools/CameraAnglesTool';
import CollageTool from './pages/tools/CollageTool';
import EditVideoTool from './pages/tools/EditVideoTool';
import IngredientsToVideoTool from './pages/tools/IngredientsToVideoTool';
import ExtendVideoTool from './pages/tools/ExtendVideoTool';
import MotionControlTool from './pages/tools/MotionControlTool';
import VideoGeneratorTool from './pages/tools/VideoGeneratorTool';
import Background3D from './components/Background3D';
import { AppRoute } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GenerationQueueProvider } from './contexts/GenerationQueueContext';
import { apiUrl } from "./services/apiBase";

const AppContent: React.FC = () => {
  const [route, setRoute] = useState<AppRoute>(AppRoute.HOME);

  const [storePrefill, setStorePrefill] = useState<{ asset?: any | null }>({ asset: null });
  const [upscalerPrefill, setUpscalerPrefill] = useState<any | null>(null);

  const [sellOpen, setSellOpen] = useState<boolean>(false);
  const [sellAsset, setSellAsset] = useState<Asset | null>(null);

  const [backendOk, setBackendOk] = useState<boolean>(false);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [checking, setChecking] = useState<boolean>(true);

  const { user, isLoading: authLoading } = useAuth();

  // 👇 Controla qué ve el usuario NO logeado: primero Landing, luego Login si toca cualquier botón
  const [unauthView, setUnauthView] = useState<"landing" | "login">("landing");
  const prevUserRef = useRef<typeof user>(null);

  // Si venías logeado y te deslogueas => volver a Landing como primera pantalla
  useEffect(() => {
    const prev = prevUserRef.current;
    if (prev && !user) {
      setUnauthView("landing");
    }
    prevUserRef.current = user;
  }, [user]);

  const healthUrl = apiUrl("/api/health");

  useEffect(() => {
    async function checkBackend() {
      try {
        const resp = await fetch(healthUrl);
        const data = await resp.json();

        setCapabilities(data?.capabilities || null);

        // Backend “OK” si responde y tiene Supabase server-side configurado (imprescindible)
        const ok = Boolean(resp.ok && data?.ok && data?.capabilities?.supabase);
        setBackendOk(ok);
      } catch {
        setCapabilities(null);
        setBackendOk(false);
      } finally {
        setChecking(false);
      }
    }
    checkBackend();
  }, []);

  useEffect(() => {
  const onOpenStore = (ev: any) => {
    const asset = ev?.detail?.asset || null;
    setStorePrefill({ asset });
    setRoute(AppRoute.STORE);
  };

  window.addEventListener("tales:open-store", onOpenStore as any);
  return () => window.removeEventListener("tales:open-store", onOpenStore as any);
}, []);

useEffect(() => {
  const onOpenSell = (ev: any) => {
    const asset = (ev?.detail?.asset || null) as Asset | null;
    setSellAsset(asset);
    setSellOpen(true);
  };

  window.addEventListener("tales:open-sell", onOpenSell as any);
  return () => window.removeEventListener("tales:open-sell", onOpenSell as any);
}, []);

  const handleConnect = async () => {
    setChecking(true);
    try {
      const resp = await fetch(healthUrl);
      const data = await resp.json();

      setCapabilities(data?.capabilities || null);

      const ok = Boolean(resp.ok && data?.ok && data?.capabilities?.supabase);
      setBackendOk(ok);
    } catch {
      setCapabilities(null);
      setBackendOk(false);
    } finally {
      setChecking(false);
    }
  };

  const renderPage = () => {
    switch (route) {
      case AppRoute.HOME:
        return <Home onNavigate={(r) => { setStorePrefill({ asset: null }); setRoute(r); }} />;

      case AppRoute.STORE:
        return (
          <Store
            onNavigate={(r) => { setStorePrefill({ asset: null }); setRoute(r); }}
            prefill={storePrefill}
            onRequestUpscale={(asset) => {
              setUpscalerPrefill(asset);
              setStorePrefill({ asset: null });
              setRoute(AppRoute.TOOL_UPSCALER);
            }}
          />
        );

      case AppRoute.COMMUNITY_STORE:
        return <CommunityStore onNavigate={(r) => { setStorePrefill({ asset: null }); setRoute(r); }} />;

      case AppRoute.MY_TRADES:
        return <MyTrades onNavigate={(r) => { setStorePrefill({ asset: null }); setRoute(r); }} />;

      
      // Image Tools
      case AppRoute.IMAGE_GEN_ROOT:
        return <ImageGenHub onNavigate={setRoute} />;
      case AppRoute.TOOL_GENERATOR:
        return <ImageGeneratorTool />;
      case AppRoute.TOOL_RESTYLER:
        return <RestylerTool />;
      case AppRoute.TOOL_LIGHTROOM:
        return <LightroomTool />;
      case AppRoute.TOOL_FACESWAP:
        return <FaceSwapTool />;
      case AppRoute.TOOL_UPSCALER:
        return <UpscalerTool prefillAsset={upscalerPrefill} />;
      case AppRoute.TOOL_EDITOR:
        return <EditorTool />;
      case AppRoute.TOOL_ANGLES:
        return <CameraAnglesTool />;
      case AppRoute.TOOL_COLLAGE:
        return <CollageTool />;

      case AppRoute.VIDEO_GEN:
        return <VideoGenHub onNavigate={setRoute} />;

      case AppRoute.TOOL_VIDEO_GENERATOR:
        return <VideoGeneratorTool />;
      case AppRoute.TOOL_VIDEO_EDIT:
        return <EditVideoTool />;
      case AppRoute.TOOL_INGREDIENTS_TO_VIDEO:
        return <IngredientsToVideoTool />;
      case AppRoute.TOOL_EXTEND_VIDEO:
        return <ExtendVideoTool />;
      case AppRoute.TOOL_MOTION_CONTROL:
        return <MotionControlTool />;
      case AppRoute.MY_CREATIONS:
        return <MyCreations />;

      case AppRoute.PROFILE:
        return <Profile onNavigate={(r) => { setStorePrefill({ asset: null }); setRoute(r); }} />;

      case AppRoute.CHAT:
        return (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">TALES CHAT</h2>
              <p>Coming Soon</p>
            </div>
          </div>
        );
      default:
        return <Home onNavigate={setRoute} />;
    }
  };

  if (checking || authLoading) {
    return (
      <div className="relative w-full h-screen bg-black text-white flex items-center justify-center">
        <div className="absolute inset-0 z-0 opacity-50"><Background3D /></div>
        <div className="z-10 animate-pulse font-mono tracking-widest">INITIALIZING STUDIO...</div>
      </div>
    );
  }

  // Backend Check Barrier (no bloquea por Gemini si hay otros providers; pero sí exige Supabase server-side)
  if (!backendOk) {
    return (
      <div className="relative w-full h-screen bg-black text-white overflow-hidden flex items-center justify-center font-sans">
        <div className="absolute inset-0 z-0"><Background3D /></div>
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-black/50 to-black pointer-events-none" />

        <div className="relative z-10 p-8 max-w-md w-full glass-panel rounded-3xl border border-white/10 text-center shadow-2xl">
          <h1 className="text-4xl font-bold mb-2 tracking-tighter">BACKEND OFFLINE</h1>
          <div className="w-16 h-1 bg-white mx-auto mb-6 rounded-full"></div>

          <p className="text-gray-400 mb-6 leading-relaxed">
            El frontend no puede conectarse al backend, o el backend no tiene Supabase server-side configurado
            (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
          </p>

          <div className="text-left text-xs text-gray-400 mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="font-semibold text-white/80 mb-2">capabilities detectadas:</div>
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(capabilities, null, 2)}</pre>
          </div>

          <button
            onClick={handleConnect}
            className="w-full py-4 bg-white text-black font-bold rounded-xl hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.3)]"
          >
            RETRY CONNECTION
          </button>

          <div className="text-xs text-gray-500 mt-6">
            <p>Revisa variables de entorno en Render y que CORS permita tu dominio de Vercel.</p>
          </div>
        </div>
      </div>
    );
  }

  // Unauth Barrier: primero Landing, y cualquier acción => Login
  if (!user) {
    if (unauthView === "landing") {
      return <Landing onEnter={() => setUnauthView("login")} />;
    }
    return <Login />;
  }

  return (
    <GenerationQueueProvider>
      <Layout currentRoute={route} onNavigate={setRoute}>
        {renderPage()}
      </Layout>

      <SellListingModal
        open={sellOpen}
        asset={sellAsset}
        onClose={() => {
          setSellOpen(false);
          setSellAsset(null);
        }}
      />
    </GenerationQueueProvider>
  );
};

const App: React.FC = () => {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}

export default App;
