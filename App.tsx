import React, { useState, useEffect } from "react";
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import ImageGenHub from './pages/ImageGenHub';
import VideoGenHub from './pages/VideoGenHub';
import MyCreations from './pages/MyCreations';
import ImageGeneratorTool from './pages/tools/ImageGeneratorTool';
import RestylerTool from './pages/tools/RestylerTool';
import FaceSwapTool from './pages/tools/FaceSwapTool';
import UpscalerTool from './pages/tools/UpscalerTool';
import EditorTool from './pages/tools/EditorTool';
import CameraAnglesTool from './pages/tools/CameraAnglesTool';
import CollageTool from './pages/tools/CollageTool';
import EditVideoTool from './pages/tools/EditVideoTool';
import MotionControlTool from './pages/tools/MotionControlTool';
import VideoGeneratorTool from './pages/tools/VideoGeneratorTool';
import Background3D from './components/Background3D';
import { AppRoute } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';

const AppContent: React.FC = () => {
  const [route, setRoute] = useState<AppRoute>(AppRoute.HOME);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);
  
  const { user, isLoading: authLoading } = useAuth();
  
  const healthUrl = "/api/health";

  useEffect(() => {
    async function checkBackend() {
      try {
        const resp = await fetch(healthUrl);
        const data = await resp.json();
        setHasKey(Boolean(data?.hasKey));
      } catch (e) {
        setHasKey(false);
      } finally {
        setChecking(false);
      }
    }
    checkBackend();
  }, []);

  const handleConnect = async () => {
    // In production we keep the API key ONLY on the backend.
    // This simply re-checks the backend configuration after you update env vars.
    setChecking(true);
    try {
      const resp = await fetch(healthUrl);
      const data = await resp.json();
      setHasKey(Boolean(data?.hasKey));
    } catch (e) {
      setHasKey(false);
    } finally {
      setChecking(false);
    }
  };

  const renderPage = () => {
    switch (route) {
      case AppRoute.HOME:
        return <Home onNavigate={setRoute} />;
      
      // Image Tools
      case AppRoute.IMAGE_GEN_ROOT:
        return <ImageGenHub onNavigate={setRoute} />;
      case AppRoute.TOOL_GENERATOR:
        return <ImageGeneratorTool />;
      case AppRoute.TOOL_RESTYLER:
        return <RestylerTool />;
      case AppRoute.TOOL_FACESWAP:
        return <FaceSwapTool />;
      case AppRoute.TOOL_UPSCALER:
        return <UpscalerTool />;
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
      case AppRoute.TOOL_MOTION_CONTROL:
        return <MotionControlTool />;
      case AppRoute.MY_CREATIONS:
        return <MyCreations />;
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

  // API Key Check Barrier
  if (!hasKey) {
    return (
      <div className="relative w-full h-screen bg-black text-white overflow-hidden flex items-center justify-center font-sans">
        <div className="absolute inset-0 z-0"><Background3D /></div>
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-black/50 to-black pointer-events-none" />
        
        <div className="relative z-10 p-8 max-w-md w-full glass-panel rounded-3xl border border-white/10 text-center shadow-2xl">
           <h1 className="text-4xl font-bold mb-2 tracking-tighter">ACCESS REQUIRED</h1>
           <div className="w-16 h-1 bg-white mx-auto mb-6 rounded-full"></div>
           
           <p className="text-gray-400 mb-8 leading-relaxed">
             To generate images, TALES AI needs the backend API to be running and configured with a valid GEMINI_API_KEY (kept server-side).
           </p>
           
           <button 
             onClick={handleConnect} 
             className="w-full py-4 bg-white text-black font-bold rounded-xl hover:scale-105 transition-transform mb-6 shadow-[0_0_20px_rgba(255,255,255,0.3)]"
           >
             RETRY CONNECTION
           </button>
           
           <div className="text-xs text-gray-500">
             <p className="mb-2">Set GEMINI_API_KEY on the server and restart the API service.</p>
             <a 
               href="https://ai.google.dev/gemini-api/docs/billing" 
               target="_blank" 
               rel="noreferrer" 
               className="text-white/60 hover:text-white underline transition-colors"
             >
               Read Billing Documentation
             </a>
           </div>
        </div>
      </div>
    );
  }

  // Login Barrier
  if (!user) {
    return <Login />;
  }

  return (
    <Layout currentRoute={route} onNavigate={setRoute}>
      {renderPage()}
    </Layout>
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
