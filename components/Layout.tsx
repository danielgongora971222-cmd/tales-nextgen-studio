import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Crown,
  Film,
  FolderOpen,
  Home,
  ImageIcon,
  Languages,
  LogOut,
  Menu,
  Music2,
  Plus,
  Settings2,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import { AppRoute } from "../types";
import GenerationQueueWidget from "./GenerationQueueWidget";
import Background3D from "./Background3D";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import BottomSheet from "./BottomSheet";
import Login from "../pages/Login";

interface LayoutProps {
  children: React.ReactNode;
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  authModalOpen: boolean;
  onOpenAuth: () => void;
  onCloseAuth: () => void;
}

function ActionButton({
  label,
  icon,
  onClick,
  primary = false,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition md:text-sm " +
        (primary
          ? "border-[rgba(241,225,148,0.3)] bg-[rgba(241,225,148,0.14)] text-white hover:bg-[rgba(241,225,148,0.22)]"
          : "border-white/10 bg-white/5 text-white/88 hover:bg-white/10")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SidebarRow({
  label,
  value,
  onClick,
  right,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  right?: React.ReactNode;
}) {
  const shared =
    "w-full rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 text-left transition hover:bg-white/[0.07]";

  if (!onClick) {
    return (
      <div className={shared}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{label}</div>
            {value ? <div className="mt-1 text-xs text-white/52">{value}</div> : null}
          </div>
          {right}
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={shared}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          {value ? <div className="mt-1 text-xs text-white/52">{value}</div> : null}
        </div>
        <div className="flex items-center gap-3 text-white/66">
          {right}
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </button>
  );
}

export default function Layout({
  children,
  currentRoute,
  onNavigate,
  authModalOpen,
  onOpenAuth,
  onCloseAuth,
}: LayoutProps) {
  const { user, logout } = useAuth();
  const { wallet } = useWallet();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);

  useEffect(() => {
    if (!user) setSidebarOpen(false);
  }, [user?.id]);

  const availableCredits = Number(wallet?.generationCredits ?? 0);
  const showHomeTopBar = currentRoute === AppRoute.HOME;
  const isReel = currentRoute === AppRoute.REEL_FEED;

  const isImageZone =
    currentRoute === AppRoute.IMAGE_GEN_ROOT ||
    currentRoute === AppRoute.TOOL_GENERATOR ||
    currentRoute === AppRoute.TOOL_EDITOR ||
    currentRoute === AppRoute.TOOL_RESTYLER ||
    currentRoute === AppRoute.TOOL_LIGHTROOM ||
    currentRoute === AppRoute.TOOL_FACESWAP ||
    currentRoute === AppRoute.TOOL_UPSCALER ||
    currentRoute === AppRoute.TOOL_ANGLES ||
    currentRoute === AppRoute.TOOL_COLLAGE;

  const isVideoZone =
    currentRoute === AppRoute.VIDEO_GEN ||
    currentRoute === AppRoute.TOOL_VIDEO_GENERATOR ||
    currentRoute === AppRoute.TOOL_VIDEO_EDIT ||
    currentRoute === AppRoute.TOOL_INGREDIENTS_TO_VIDEO ||
    currentRoute === AppRoute.TOOL_EXTEND_VIDEO ||
    currentRoute === AppRoute.TOOL_MOTION_CONTROL;

  const isToolRoute = isImageZone || isVideoZone;
  const plusActive = useMemo(() => isToolRoute, [isToolRoute]);

  function goProfileTab(tab: "profile" | "security" | "billing") {
    window.localStorage.setItem("tales_profile_focus", tab);
    onNavigate(AppRoute.PROFILE);
    setSidebarOpen(false);
  }

  function goAccountTab(tab: "plans" | "credits") {
    window.localStorage.setItem("tales_account_tab", tab);
    onNavigate(AppRoute.PAYWALL);
    setSidebarOpen(false);
  }

  const bottomItems = [
    {
      key: "home",
      label: "Home",
      active: currentRoute === AppRoute.HOME,
      icon: <Home className="h-[18px] w-[18px]" />,
      onClick: () => onNavigate(AppRoute.HOME),
    },
    {
      key: "reel",
      label: "Carrete",
      active: currentRoute === AppRoute.REEL_FEED,
      icon: <Film className="h-[18px] w-[18px]" />,
      onClick: () => onNavigate(AppRoute.REEL_FEED),
    },
    {
      key: "assets",
      label: "My Assets",
      active: currentRoute === AppRoute.MY_CREATIONS,
      icon: <FolderOpen className="h-[18px] w-[18px]" />,
      onClick: () => onNavigate(AppRoute.MY_CREATIONS),
    },
    {
      key: "trades",
      label: "My Trades",
      active: currentRoute === AppRoute.MY_TRADES,
      icon: <ArrowRightLeft className="h-[18px] w-[18px]" />,
      onClick: () => onNavigate(AppRoute.MY_TRADES),
    },
  ];

  const mainPaddingClass = showHomeTopBar
    ? "mx-auto max-w-[1360px] px-3 pb-[calc(env(safe-area-inset-bottom)+118px)] pt-[calc(env(safe-area-inset-top)+86px)] md:px-6 md:pb-[132px] md:pt-[calc(env(safe-area-inset-top)+94px)]"
    : isReel
    ? "h-full px-0 pb-0 pt-0"
    : isToolRoute
    ? "mx-auto max-w-[1600px] px-0 pb-0 pt-0 md:px-0 md:pb-0 md:pt-0"
    : "mx-auto max-w-[1600px] px-3 pb-[calc(env(safe-area-inset-bottom)+118px)] pt-[max(env(safe-area-inset-top),14px)] md:px-6 md:pb-[132px] md:pt-[max(env(safe-area-inset-top),18px)]";

  return (
    <div className="relative h-[100svh] min-h-[100svh] w-full overflow-hidden bg-black text-white selection:bg-white selection:text-black">
      <div className="absolute inset-0 z-0">
        <Background3D />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top,rgba(91,14,20,0.28),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.16),rgba(0,0,0,0.9))]" />

      {showHomeTopBar ? (
        <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[rgba(6,6,8,0.9)] shadow-[0_14px_38px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
          <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-3 px-3 pb-3 pt-[max(env(safe-area-inset-top),12px)] md:px-6">
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  onOpenAuth();
                  return;
                }
                setSidebarOpen(true);
              }}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/92 transition hover:bg-white/10"
              aria-label="Abrir menú"
              title="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2">
              {!user ? (
                <ActionButton label="Sign in for Credits" onClick={onOpenAuth} primary />
              ) : (
                <>
                  <ActionButton label="Upgrade" onClick={() => goAccountTab("plans")} />
                  <ActionButton
                    label="Earn Money"
                    onClick={() => onNavigate(AppRoute.EARN_MONEY)}
                    primary
                    icon={<CircleDollarSign className="h-4 w-4" />}
                  />
                </>
              )}
            </div>
          </div>
        </header>
      ) : null}

      {user ? (
        <>
          <div
            className={`fixed inset-0 z-[70] bg-black/62 backdrop-blur-[2px] transition ${
              sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={() => setSidebarOpen(false)}
          />

          <aside
            className={`fixed left-0 top-0 z-[80] h-full w-[min(92vw,360px)] transform border-r border-white/10 bg-[rgba(5,5,7,0.95)] px-4 pb-6 pt-[max(env(safe-area-inset-top),18px)] shadow-[0_30px_80px_rgba(0,0,0,0.58)] backdrop-blur-2xl transition duration-300 ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between gap-3 px-1 pb-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">Menu</div>
                <div className="mt-1 text-lg font-black tracking-tight text-white">My Space</div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/85 transition hover:bg-white/10"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto pb-10">
              <button
                type="button"
                onClick={() => goProfileTab("profile")}
                className="w-full rounded-[24px] border border-white/10 bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.07]"
              >
                <div className="flex items-center gap-4">
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="h-14 w-14 rounded-full border border-white/15 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-bold text-white">{user.username}</div>
                    <div className="mt-1 break-all text-xs text-white/50">ID {user.id}</div>
                  </div>
                  <Settings2 className="h-5 w-5 shrink-0 text-white/56" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => goAccountTab("plans")}
                className="w-full rounded-[24px] border border-[rgba(241,225,148,0.22)] bg-[linear-gradient(135deg,rgba(241,225,148,0.18),rgba(0,0,0,0.32))] p-4 text-left shadow-[0_16px_40px_rgba(0,0,0,0.28)] transition hover:bg-[linear-gradient(135deg,rgba(241,225,148,0.22),rgba(0,0,0,0.38))]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-black text-white">Upgrade your plan</div>
                    <div className="mt-1 text-sm text-white/62">More Credits & Premium Features</div>
                  </div>
                  <Crown className="mt-1 h-5 w-5 shrink-0 text-[rgba(241,225,148,0.92)]" />
                </div>
              </button>

              <SidebarRow
                label="Credits Details"
                onClick={() => goAccountTab("credits")}
                right={
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-bold text-emerald-300">
                    <Coins className="h-4 w-4" />
                    {availableCredits.toLocaleString()}
                  </div>
                }
              />

              <SidebarRow
                label="Manage your plans"
                value="Plans and extra credits"
                onClick={() => goAccountTab("plans")}
              />

              <SidebarRow
                label="Language"
                value="English"
                right={<Languages className="h-4 w-4 text-white/56" />}
              />

              <button
                type="button"
                onClick={async () => {
                  setSidebarOpen(false);
                  await logout();
                  onNavigate(AppRoute.HOME);
                }}
                className="w-full rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 text-left text-[17px] font-semibold text-[#ff6b47] transition hover:bg-white/[0.07]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>Sign out</span>
                  <LogOut className="h-4 w-4" />
                </div>
              </button>
            </div>
          </aside>
        </>
      ) : null}

      <main
        className={
          "relative z-10 h-full overflow-x-hidden " +
          (isReel ? "overflow-hidden" : "overflow-y-auto overscroll-y-contain")
        }
      >
        <div className={mainPaddingClass}>{children}</div>
      </main>

      {!isToolRoute ? (
        <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[rgba(6,6,8,0.92)] shadow-[0_-18px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <div className="mx-auto flex max-w-[920px] items-end justify-between gap-2 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),10px)] md:px-5">
            {bottomItems.slice(0, 2).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className={`pointer-events-auto flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[20px] px-2 py-2 text-[11px] font-semibold transition ${
                  item.active ? "bg-white/10 text-white" : "text-white/58 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setCreateSheetOpen(true)}
              className={`pointer-events-auto -mt-5 inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-white shadow-[0_18px_44px_rgba(0,0,0,0.48)] transition ${
                plusActive
                  ? "border-[rgba(241,225,148,0.34)] bg-[rgba(241,225,148,0.18)]"
                  : "border-white/10 bg-white/10 hover:bg-white/14"
              }`}
              aria-label="Crear"
              title="Crear"
            >
              <Plus className="h-7 w-7" />
            </button>

            {bottomItems.slice(2).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className={`pointer-events-auto flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[20px] px-2 py-2 text-[11px] font-semibold transition ${
                  item.active ? "bg-white/10 text-white" : "text-white/58 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      {user && !isReel && !isToolRoute ? <GenerationQueueWidget /> : null}

      <BottomSheet open={createSheetOpen} title="Create" onClose={() => setCreateSheetOpen(false)}>
        <div className="space-y-3 pb-2">
          <button
            type="button"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:bg-white/10"
            onClick={() => {
              setCreateSheetOpen(false);
              onNavigate(AppRoute.IMAGE_GEN_ROOT);
            }}
          >
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                <ImageIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Crear o Editar imagen</div>
                <div className="mt-1 text-xs text-white/55">Abre las herramientas de imagen</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:bg-white/10"
            onClick={() => {
              setCreateSheetOpen(false);
              onNavigate(AppRoute.VIDEO_GEN);
            }}
          >
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Crear o Editar video</div>
                <div className="mt-1 text-xs text-white/55">Abre las herramientas de video</div>
              </div>
            </div>
          </button>

          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left opacity-70">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">Smart assistant</div>
                <div className="mt-1 text-xs text-white/55">Coming soon</div>
              </div>
            </div>
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left opacity-70">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                <Music2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">Crear o Editar audio</div>
                <div className="mt-1 text-xs text-white/55">Coming soon</div>
              </div>
            </div>
          </div>
        </div>
      </BottomSheet>

      {authModalOpen ? <Login mode="modal" onClose={onCloseAuth} /> : null}
    </div>
  );
}
