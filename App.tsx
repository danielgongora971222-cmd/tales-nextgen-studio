import React, { Suspense, useCallback, useEffect, useState } from "react";
import Layout from "./components/Layout";
import SellListingModal from "./components/SellListingModal";
import Background3D from "./components/Background3D";
import { AppRoute, type Asset, type StorePrefill } from "./types";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { GenerationQueueProvider } from "./contexts/GenerationQueueContext";
import { apiUrl } from "./services/apiBase";
import { billingMe, getStripeCheckoutStatus } from "./services/billingApi";
import { WalletProvider } from "@/contexts/WalletContext";
import InsufficientCreditsModal from "@/components/InsufficientCreditsModal";
import PlanRequiredModal from "@/components/PlanRequiredModal";
import { EVENT_INSUFFICIENT_CREDITS, EVENT_PLAN_REQUIRED, emitWalletRefresh } from "@/services/appEvents";
import StripeCheckoutStatusModal from "@/components/StripeCheckoutStatusModal";
import { clearBillingSearchParams, clearPendingStripeCheckout, hasStripeCheckoutSearchParams, isStripeCheckoutSessionTemplate, readPendingStripeCheckout } from "@/services/stripeCheckoutState";

const Home = React.lazy(() => import("./pages/Home"));
const ImageGenHub = React.lazy(() => import("./pages/ImageGenHub"));
const VideoGenHub = React.lazy(() => import("./pages/VideoGenHub"));
const MyCreations = React.lazy(() => import("./pages/MyCreations"));
const Store = React.lazy(() => import("./pages/Store"));
const CommunityStore = React.lazy(() => import("./pages/CommunityStore"));
const MyTrades = React.lazy(() => import("./pages/MyTrades"));
const Profile = React.lazy(() => import("./pages/Profile"));
const Paywall = React.lazy(() => import("./pages/Paywall"));
const EarnMoney = React.lazy(() => import("./pages/EarnMoney"));
const ReelFeed = React.lazy(() => import("./pages/ReelFeed"));

const ImageGeneratorTool = React.lazy(() => import("./pages/tools/ImageGeneratorTool"));
const RestylerTool = React.lazy(() => import("./pages/tools/RestylerTool"));
const LightroomTool = React.lazy(() => import("./pages/tools/LightroomTool"));
const FaceSwapTool = React.lazy(() => import("./pages/tools/FaceSwapTool"));
const UpscalerTool = React.lazy(() => import("./pages/tools/UpscalerTool"));
const EditorTool = React.lazy(() => import("./pages/tools/EditorTool"));
const CameraAnglesTool = React.lazy(() => import("./pages/tools/CameraAnglesTool"));
const CollageTool = React.lazy(() => import("./pages/tools/CollageTool"));
const EditVideoTool = React.lazy(() => import("./pages/tools/EditVideoTool"));
const IngredientsToVideoTool = React.lazy(() => import("./pages/tools/IngredientsToVideoTool"));
const ExtendVideoTool = React.lazy(() => import("./pages/tools/ExtendVideoTool"));
const MotionControlTool = React.lazy(() => import("./pages/tools/MotionControlTool"));
const VideoGeneratorTool = React.lazy(() => import("./pages/tools/VideoGeneratorTool"));

const RouteLoader = () => (
  <div className="flex min-h-[54vh] items-center justify-center px-6 text-center text-white/70">
    <div className="rounded-2xl border border-white/10 bg-black/35 px-5 py-4 text-xs font-semibold uppercase tracking-[0.24em] shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
      Loading studio…
    </div>
  </div>
);

type CheckoutOverlayState =
  | null
  | {
      phase: "confirming" | "success" | "notice" | "error";
      title: string;
      message: string;
      mode?: "subscription" | "payment" | null;
      actionLabel?: string;
    };

const PUBLIC_ROUTES = new Set<AppRoute>([
  AppRoute.HOME,
  AppRoute.COMMUNITY_STORE,
  AppRoute.REEL_FEED,
]);

const AppContent: React.FC = () => {
  const [route, setRoute] = useState<AppRoute>(AppRoute.HOME);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [storePrefill, setStorePrefill] = useState<StorePrefill>({ asset: null, artDecoListing: null });
  const [upscalerPrefill, setUpscalerPrefill] = useState<any | null>(null);

  const [sellOpen, setSellOpen] = useState<boolean>(false);
  const [sellAsset, setSellAsset] = useState<Asset | null>(null);

  const [backendOk, setBackendOk] = useState<boolean>(false);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [checking, setChecking] = useState<boolean>(true);

  const [billingChecked, setBillingChecked] = useState(false);
  const [subscription, setSubscription] = useState<any | null>(null);

  const [insufficientOpen, setInsufficientOpen] = useState(false);
  const [insufficientDetails, setInsufficientDetails] = useState<any | null>(null);

  const [planRequiredOpen, setPlanRequiredOpen] = useState(false);
  const [planRequiredMessage, setPlanRequiredMessage] = useState<string | null>(null);
  const [checkoutOverlay, setCheckoutOverlay] = useState<CheckoutOverlayState>(null);
  const [checkoutOverlayBusy, setCheckoutOverlayBusy] = useState(false);
  const [hasStripeReturnParams, setHasStripeReturnParams] = useState<boolean>(() => hasStripeCheckoutSearchParams());

  const { user, isLoading: authLoading } = useAuth();
  const healthUrl = apiUrl("/api/health");

  const navigate = useCallback(
    (nextRoute: AppRoute) => {
      if (!user && !PUBLIC_ROUTES.has(nextRoute)) {
        setAuthModalOpen(true);
        return;
      }
      setRoute(nextRoute);
    },
    [user]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const routeParam = params.get("route");
    if (!routeParam) return;

    const nextRoute = routeParam as AppRoute;
    if ((Object.values(AppRoute) as string[]).includes(nextRoute)) {
      setRoute(nextRoute);
    }
  }, []);

  useEffect(() => {
    async function checkBackend() {
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
    }
    checkBackend();
  }, [healthUrl]);

  useEffect(() => {
    const onOpenStore = (ev: any) => {
      const asset = ev?.detail?.asset || null;
      const artDecoListing = ev?.detail?.artDecoListing || null;
      setStorePrefill({ asset, artDecoListing });
      navigate(AppRoute.STORE);
    };

    window.addEventListener("tales:open-store", onOpenStore as any);
    return () => window.removeEventListener("tales:open-store", onOpenStore as any);
  }, [navigate]);

  useEffect(() => {
    const onNavigate = (ev: any) => {
      const nextRoute = ev?.detail?.route;
      if (!nextRoute) return;
      navigate(nextRoute as AppRoute);
    };

    window.addEventListener("tales:navigate", onNavigate as any);
    return () => window.removeEventListener("tales:navigate", onNavigate as any);
  }, [navigate]);

  useEffect(() => {
    const onOpenSell = (ev: any) => {
      if (!user) {
        setAuthModalOpen(true);
        return;
      }

      const asset = (ev?.detail?.asset || null) as Asset | null;
      const hasExistingListing = Boolean((asset as any)?.communityListing?.id);

      if (!hasExistingListing && !subscription?.canSell) {
        setPlanRequiredMessage("Para publicar y vender en Community Store necesitas un plan Pro o superior activo.");
        setPlanRequiredOpen(true);
        return;
      }

      setSellAsset(asset);
      setSellOpen(true);
    };

    window.addEventListener("tales:open-sell", onOpenSell as any);
    return () => window.removeEventListener("tales:open-sell", onOpenSell as any);
  }, [subscription?.canSell, user?.id]);

  useEffect(() => {
    const handler = (ev: any) => {
      setInsufficientDetails(ev?.detail || null);
      setInsufficientOpen(true);
    };

    window.addEventListener(EVENT_INSUFFICIENT_CREDITS, handler as any);
    return () => window.removeEventListener(EVENT_INSUFFICIENT_CREDITS, handler as any);
  }, []);

  useEffect(() => {
    const handler = (ev: any) => {
      const msg = ev?.detail?.message ? String(ev.detail.message) : "Para comenzar a generar, necesitas un plan activo.";
      setPlanRequiredMessage(msg);
      setPlanRequiredOpen(true);
    };

    window.addEventListener(EVENT_PLAN_REQUIRED, handler as any);
    return () => window.removeEventListener(EVENT_PLAN_REQUIRED, handler as any);
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!user) {
        setSubscription(null);
        setBillingChecked(true);
        return;
      }

      setBillingChecked(false);
      try {
        const sub = await billingMe();
        if (!alive) return;
        setSubscription(sub || null);
      } catch {
        if (!alive) return;
        setSubscription(null);
      } finally {
        if (!alive) return;
        setBillingChecked(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get("stripe_status");
    const sessionIdFromUrl = params.get("session_id");
    const pendingCheckout = readPendingStripeCheckout();
    const sessionId = isStripeCheckoutSessionTemplate(sessionIdFromUrl)
      ? pendingCheckout?.sessionId || ""
      : String(sessionIdFromUrl || "").trim() || pendingCheckout?.sessionId || "";

    setHasStripeReturnParams(Boolean(stripeStatus || sessionId));
    if (!stripeStatus) return;

    let cancelled = false;
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    (async () => {
      if (stripeStatus === "cancel") {
        clearPendingStripeCheckout();
        setCheckoutOverlay({
          phase: "notice",
          title: "Pago cancelado",
          message: "No se realizó ningún cobro. Puedes intentarlo de nuevo cuando quieras.",
          mode: pendingCheckout?.mode || null,
          actionLabel: "Entendido",
        });
        clearBillingSearchParams();
        setHasStripeReturnParams(false);
        return;
      }

      if (stripeStatus !== "success") {
        clearPendingStripeCheckout();
        clearBillingSearchParams();
        setHasStripeReturnParams(false);
        return;
      }

      if (!sessionId) {
        clearPendingStripeCheckout();
        setCheckoutOverlay({
          phase: "error",
          title: "No pudimos confirmar la compra",
          message: "Stripe cerró el checkout, pero no recibí el identificador de la sesión para verificar la operación.",
          mode: pendingCheckout?.mode || null,
          actionLabel: "Entendido",
        });
        clearBillingSearchParams();
        setHasStripeReturnParams(false);
        return;
      }

      setRoute(AppRoute.HOME);
      setCheckoutOverlay({
        phase: "confirming",
        title: "Estamos confirmando tu compra",
        message:
          pendingCheckout?.mode === "payment"
            ? "Estamos validando el pago y acreditando tus créditos extra."
            : "Estamos validando el pago y activando tu nuevo plan.",
        mode: pendingCheckout?.mode || null,
      });

      try {
        for (let attempt = 0; attempt < 15; attempt += 1) {
          const status = await getStripeCheckoutStatus(sessionId);
          if (cancelled) return;

          if (status?.fulfilled || status?.state === "fulfilled") {
            clearPendingStripeCheckout();
            emitWalletRefresh();
            try {
              const fresh = await billingMe(true, true);
              if (!cancelled) {
                setSubscription(fresh || null);
                setBillingChecked(true);
              }
            } catch {
              // ignore sync read errors here; modal still informs the user.
            }
            setCheckoutOverlay({
              phase: "success",
              title: status?.mode === "payment" ? "Créditos acreditados" : "Compra confirmada",
              message:
                status?.mode === "payment"
                  ? "Tus créditos extra ya fueron aplicados correctamente."
                  : "Tu plan ya quedó activo y los cambios fueron aplicados.",
              mode: status?.mode || pendingCheckout?.mode || null,
              actionLabel: "OK",
            });
            clearBillingSearchParams();
            setHasStripeReturnParams(false);
            return;
          }

          if (status?.state === "expired") {
            clearPendingStripeCheckout();
            setCheckoutOverlay({
              phase: "notice",
              title: "La sesión expiró",
              message: "La sesión de pago expiró antes de completarse. Puedes iniciar la compra de nuevo.",
              mode: status?.mode || pendingCheckout?.mode || null,
              actionLabel: "Entendido",
            });
            clearBillingSearchParams();
            setHasStripeReturnParams(false);
            return;
          }

          await sleep(1600);
        }

        emitWalletRefresh();
        try {
          const fresh = await billingMe(true, true);
          if (!cancelled) {
            setSubscription(fresh || null);
            setBillingChecked(true);
          }
        } catch {
          // ignore
        }
        setCheckoutOverlay({
          phase: "notice",
          title: "Seguimos sincronizando",
          message: "El pago ya fue aceptado por Stripe. Si no ves el cambio todavía, vuelve a revisar en unos segundos.",
          mode: pendingCheckout?.mode || null,
          actionLabel: "Entendido",
        });
        clearBillingSearchParams();
        setHasStripeReturnParams(false);
      } catch (e: any) {
        if (cancelled) return;
        clearPendingStripeCheckout();
        setCheckoutOverlay({
          phase: "error",
          title: "No pudimos confirmar la compra",
          message: e?.message || "No se pudo confirmar el estado del pago con Stripe.",
          mode: pendingCheckout?.mode || null,
          actionLabel: "Entendido",
        });
        clearBillingSearchParams();
        setHasStripeReturnParams(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  async function handleCheckoutOverlayAction() {
    if (!checkoutOverlay) return;

    if (checkoutOverlay.phase !== "success") {
      setCheckoutOverlay(null);
      return;
    }

    setCheckoutOverlayBusy(true);
    try {
      emitWalletRefresh();
      const fresh = await billingMe(true, true);
      setSubscription(fresh || null);
      setBillingChecked(true);
      setRoute(AppRoute.HOME);
      setCheckoutOverlay(null);
    } catch (e: any) {
      setCheckoutOverlay({
        phase: "notice",
        title: "Compra confirmada",
        message: e?.message || "La compra ya fue confirmada. Si no ves el cambio reflejado, recarga la app en unos segundos.",
        mode: checkoutOverlay.mode || null,
        actionLabel: "Entendido",
      });
    } finally {
      setCheckoutOverlayBusy(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setAuthModalOpen(false);
      if (!PUBLIC_ROUTES.has(route)) {
        setRoute(AppRoute.HOME);
      }
      return;
    }

    setAuthModalOpen(false);
  }, [user?.id, route]);

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

  const routeWithReset = (nextRoute: AppRoute) => {
    setStorePrefill({ asset: null, artDecoListing: null });
    navigate(nextRoute);
  };

  const renderPage = () => {
    switch (route) {
      case AppRoute.HOME:
        return <Home onNavigate={routeWithReset} />;

      case AppRoute.STORE:
        return (
          <Store
            onNavigate={routeWithReset}
            prefill={storePrefill}
            onRequestUpscale={(asset) => {
              setUpscalerPrefill(asset);
              setStorePrefill({ asset: null, artDecoListing: null });
              navigate(AppRoute.TOOL_UPSCALER);
            }}
          />
        );

      case AppRoute.COMMUNITY_STORE:
        return <CommunityStore onNavigate={routeWithReset} />;

      case AppRoute.REEL_FEED:
        return <ReelFeed onNavigate={routeWithReset} />;

      case AppRoute.MY_TRADES:
        return <MyTrades onNavigate={routeWithReset} />;

      case AppRoute.EARN_MONEY:
        return <EarnMoney onNavigate={routeWithReset} />;

      case AppRoute.IMAGE_GEN_ROOT:
        return <ImageGenHub onNavigate={navigate} />;
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
        return <VideoGenHub onNavigate={navigate} />;

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

      case AppRoute.PAYWALL:
        return (
          <Paywall
            onSubscribed={async () => {
              try {
                const s = await billingMe();
                setSubscription(s || null);
              } catch {
                setSubscription(null);
              }
              setRoute(AppRoute.HOME);
            }}
            onContinueExploring={() => setRoute(AppRoute.HOME)}
          />
        );

      case AppRoute.PROFILE:
        return <Profile onNavigate={routeWithReset} />;

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
        return <Home onNavigate={navigate} />;
    }
  };

  if (checking || authLoading) {
    return (
      <div className="relative w-full h-screen bg-black text-white flex items-center justify-center">
        <div className="absolute inset-0 z-0 opacity-50">
          <Background3D />
        </div>
        <div className="z-10 animate-pulse font-mono tracking-widest">INITIALIZING STUDIO...</div>
      </div>
    );
  }

  if (!backendOk) {
    return (
      <div className="relative w-full h-screen bg-black text-white overflow-hidden flex items-center justify-center font-sans">
        <div className="absolute inset-0 z-0">
          <Background3D />
        </div>
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

  if (user && !billingChecked && !hasStripeReturnParams) {
    return (
      <div className="relative w-full h-screen bg-black text-white flex items-center justify-center">
        <div className="absolute inset-0 z-0 opacity-50">
          <Background3D />
        </div>
        <div className="z-10 animate-pulse font-mono tracking-widest">CHECKING PLAN...</div>
      </div>
    );
  }

  return (
    <GenerationQueueProvider>
      <WalletProvider>
        <Layout
          currentRoute={route}
          onNavigate={navigate}
          authModalOpen={authModalOpen}
          onOpenAuth={() => setAuthModalOpen(true)}
          onCloseAuth={() => setAuthModalOpen(false)}
        >
          <Suspense fallback={<RouteLoader />}>{renderPage()}</Suspense>
        </Layout>

        <SellListingModal
          open={sellOpen}
          asset={sellAsset}
          onClose={() => {
            setSellOpen(false);
            setSellAsset(null);
          }}
        />

        <InsufficientCreditsModal
          open={insufficientOpen}
          details={insufficientDetails}
          onClose={() => setInsufficientOpen(false)}
          onGoProfile={() => {
            setInsufficientOpen(false);
            window.localStorage.setItem("tales_account_tab", "credits");
            setRoute(AppRoute.PAYWALL);
          }}
        />

        <PlanRequiredModal
          open={planRequiredOpen}
          message={planRequiredMessage}
          onClose={() => setPlanRequiredOpen(false)}
          onGoPlans={() => {
            setPlanRequiredOpen(false);
            window.localStorage.setItem("tales_account_tab", "plans");
            setRoute(AppRoute.PAYWALL);
          }}
        />


        <StripeCheckoutStatusModal
          open={!!checkoutOverlay}
          phase={checkoutOverlay?.phase || "notice"}
          title={checkoutOverlay?.title || ""}
          message={checkoutOverlay?.message || ""}
          mode={checkoutOverlay?.mode || null}
          busy={checkoutOverlayBusy}
          actionLabel={checkoutOverlay?.actionLabel || "OK"}
          onAction={handleCheckoutOverlayAction}
        />
      </WalletProvider>
    </GenerationQueueProvider>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
