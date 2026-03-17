import React, { useEffect, useState } from "react";
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

type CreateCardTone = "image" | "video" | "assistant" | "audio";

const CREATE_CARD_THEME: Record<
  CreateCardTone,
  {
    shell: string;
    glow: string;
    icon: string;
    badge: string;
    cta: string;
  }
> = {
  image: {
    shell: "border-[rgba(111,244,255,0.18)] hover:border-[rgba(111,244,255,0.34)]",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(96,245,255,0.24),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(56,112,255,0.18),transparent_52%)]",
    icon: "border-[rgba(111,244,255,0.28)] bg-[rgba(4,28,38,0.72)] text-[#8af7ff] shadow-[0_0_26px_rgba(91,241,255,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]",
    badge: "border-[rgba(111,244,255,0.22)] bg-[rgba(10,53,74,0.54)] text-[#a8fbff]",
    cta: "border-[rgba(111,244,255,0.42)] bg-[linear-gradient(180deg,rgba(17,98,122,0.72),rgba(7,47,62,0.88))] text-[#b8fdff] shadow-[0_0_28px_rgba(91,241,255,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]",
  },
  video: {
    shell: "border-[rgba(255,108,232,0.18)] hover:border-[rgba(255,108,232,0.34)]",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(255,93,226,0.26),transparent_44%),radial-gradient(circle_at_bottom_right,rgba(161,107,255,0.2),transparent_54%)]",
    icon: "border-[rgba(255,108,232,0.28)] bg-[rgba(43,11,46,0.76)] text-[#ff83f0] shadow-[0_0_26px_rgba(255,93,226,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]",
    badge: "border-[rgba(255,108,232,0.22)] bg-[rgba(81,19,74,0.56)] text-[#ffb2f6]",
    cta: "border-[rgba(255,108,232,0.42)] bg-[linear-gradient(180deg,rgba(138,40,132,0.74),rgba(69,17,75,0.88))] text-[#ffc0f9] shadow-[0_0_28px_rgba(255,93,226,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]",
  },
  assistant: {
    shell: "border-[rgba(245,205,92,0.18)] hover:border-[rgba(245,205,92,0.34)]",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(245,205,92,0.24),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(255,245,186,0.16),transparent_56%)]",
    icon: "border-[rgba(245,205,92,0.28)] bg-[rgba(44,30,8,0.76)] text-[#f7d96d] shadow-[0_0_26px_rgba(245,205,92,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]",
    badge: "border-[rgba(245,205,92,0.22)] bg-[rgba(84,61,18,0.56)] text-[#ffe8a6]",
    cta: "border-[rgba(245,205,92,0.34)] bg-[linear-gradient(180deg,rgba(116,86,28,0.72),rgba(62,46,15,0.88))] text-[#ffefb2] shadow-[0_0_28px_rgba(245,205,92,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]",
  },
  audio: {
    shell: "border-[rgba(102,255,197,0.18)] hover:border-[rgba(102,255,197,0.34)]",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(102,255,197,0.24),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(36,195,167,0.18),transparent_54%)]",
    icon: "border-[rgba(102,255,197,0.28)] bg-[rgba(9,39,32,0.76)] text-[#88ffd7] shadow-[0_0_26px_rgba(102,255,197,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]",
    badge: "border-[rgba(102,255,197,0.22)] bg-[rgba(11,69,55,0.56)] text-[#b9ffe8]",
    cta: "border-[rgba(102,255,197,0.38)] bg-[linear-gradient(180deg,rgba(19,108,88,0.72),rgba(10,55,46,0.88))] text-[#c8ffef] shadow-[0_0_28px_rgba(102,255,197,0.18),inset_0_1px_0_rgba(255,255,255,0.22)]",
  },
};

function CreateHeroCard({
  title,
  description,
  badge,
  icon,
  onClick,
  disabled = false,
  tone = "image",
  ctaLabel,
}: {
  title: string;
  description: string;
  badge?: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: CreateCardTone;
  ctaLabel?: string;
}) {
  const Tag = disabled ? "div" : "button";
  const theme = CREATE_CARD_THEME[tone];

  return (
    <Tag
      {...(disabled ? {} : { type: "button", onClick })}
      className={`group relative min-h-[182px] overflow-hidden rounded-[30px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.04))] p-4 text-left shadow-[0_20px_52px_rgba(0,0,0,0.34)] transition ${theme.shell} ${
        disabled
          ? "cursor-default opacity-82"
          : "hover:-translate-y-0.5 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06))]"
      }`}
    >
      <div className={`pointer-events-none absolute inset-0 opacity-95 blur-2xl ${theme.glow}`} />
      <div className="pointer-events-none absolute inset-[1px] rounded-[29px] bg-[linear-gradient(180deg,rgba(10,12,18,0.58),rgba(5,6,10,0.86))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_42%)]" />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className={`inline-flex h-12 w-12 items-center justify-center rounded-[18px] border backdrop-blur-xl transition-transform group-hover:scale-[1.03] ${theme.icon}`}>
            {icon}
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${theme.badge}`}>
            {badge || (disabled ? "Soon" : "Launch")}
          </span>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-[15px] font-semibold leading-tight text-white">{title}</div>
          <div className="text-xs leading-5 text-white/64">{description}</div>
        </div>

        <div className="mt-auto pt-5">
          <span
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] backdrop-blur-xl transition ${
              disabled
                ? "border-white/12 bg-white/[0.06] text-white/[0.44] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : `${theme.cta} group-hover:-translate-y-px`
            }`}
          >
            <span>{disabled ? "Coming soon" : ctaLabel || "Open toolset"}</span>
            <span className={`text-sm ${disabled ? "text-white/[0.35]" : "group-hover:translate-x-0.5"}`}>↗</span>
          </span>
        </div>
      </div>
    </Tag>
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
  const plusActive = createSheetOpen;

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
              className={`group pointer-events-auto relative -mt-6 inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[24px] border text-white shadow-[0_22px_50px_rgba(0,0,0,0.52)] transition ${
                plusActive
                  ? "border-[rgba(123,246,255,0.34)]"
                  : "border-white/12 hover:-translate-y-0.5 hover:border-[rgba(123,246,255,0.26)]"
              }`}
              aria-label="Crear"
              title="Crear"
            >
              <span className="pointer-events-none absolute inset-[1px] rounded-[23px] bg-[linear-gradient(180deg,rgba(14,18,26,0.96),rgba(5,7,12,0.96))]" />
              <span className={`pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_28%_20%,rgba(107,247,255,0.26),transparent_38%),radial-gradient(circle_at_74%_78%,rgba(255,88,234,0.24),transparent_42%)] transition ${plusActive ? "opacity-100" : "opacity-[0.88] group-hover:opacity-100"}`} />
              <span className="pointer-events-none absolute inset-x-3 top-1.5 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
              <span className={`relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-[18px] border backdrop-blur-xl transition ${
                plusActive
                  ? "border-[rgba(123,246,255,0.34)] bg-[rgba(8,30,42,0.7)] text-[#a5fbff] shadow-[0_0_26px_rgba(107,247,255,0.18),inset_0_1px_0_rgba(255,255,255,0.22)]"
                  : "border-white/14 bg-black/24 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] group-hover:border-[rgba(123,246,255,0.26)] group-hover:text-[#a5fbff]"
              }`}>
                <Plus className="h-7 w-7" />
              </span>
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
        <div className="pb-2">
          <div className="grid grid-cols-2 gap-3">
            <CreateHeroCard
              title="Crear o editar imagen"
              description="Generación, edición avanzada, restyling, relighting y más."
              badge="Image"
              tone="image"
              ctaLabel="Access image"
              icon={<ImageIcon className="h-5 w-5" />}
              onClick={() => {
                setCreateSheetOpen(false);
                onNavigate(AppRoute.IMAGE_GEN_ROOT);
              }}
            />

            <CreateHeroCard
              title="Crear o editar video"
              description="Generación, edición, motion control y flujos guiados por referencia."
              badge="Video"
              tone="video"
              ctaLabel="Access video"
              icon={<Video className="h-5 w-5" />}
              onClick={() => {
                setCreateSheetOpen(false);
                onNavigate(AppRoute.VIDEO_GEN);
              }}
            />

            <CreateHeroCard
              title="Smart assistant"
              description="Asistencia creativa y automatización contextual dentro del estudio."
              badge="Soon"
              tone="assistant"
              ctaLabel="Open chat"
              icon={<Sparkles className="h-5 w-5" />}
              disabled
            />

            <CreateHeroCard
              title="Crear o editar audio"
              description="Flujos premium para voz, música y postproducción dentro de la app."
              badge="Soon"
              tone="audio"
              ctaLabel="Access audio"
              icon={<Music2 className="h-5 w-5" />}
              disabled
            />
          </div>
        </div>
      </BottomSheet>

      {authModalOpen ? <Login mode="modal" onClose={onCloseAuth} /> : null}
    </div>
  );
}
