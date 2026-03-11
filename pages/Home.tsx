import React from "react";
import { ArrowRight, Coins, Crown, ShoppingBag, Sparkles, Wand2 } from "lucide-react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import CommunityStore from "./CommunityStore";

interface HomeProps {
  onNavigate: (route: AppRoute) => void;
}

function HomeCard({
  eyebrow,
  title,
  subtitle,
  accent,
  icon,
  onClick,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string;
  icon: React.ReactNode;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-[34px] border border-white/10 bg-[rgba(7,7,9,0.82)] p-5 text-left shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-[rgba(10,10,14,0.88)] md:p-7"
    >
      <div className={`pointer-events-none absolute inset-0 opacity-80 ${accent}`} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%,rgba(0,0,0,0.2))]" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="max-w-[80%]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/46">{eyebrow}</div>
          <h2 className="mt-3 text-[clamp(1.7rem,5vw,2.8rem)] font-black leading-[0.95] tracking-tight text-white">
            {title}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/64 md:text-base">{subtitle}</p>
        </div>

        <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] border border-white/10 bg-black/25 text-white shadow-[0_16px_36px_rgba(0,0,0,0.35)] backdrop-blur-md">
          {icon}
        </div>
      </div>

      {children ? <div className="relative mt-5">{children}</div> : null}

      <div className="relative mt-6 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/68">
          Open
        </div>
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90 transition group-hover:translate-x-0.5 group-hover:bg-white/10">
          <ArrowRight className="h-5 w-5" />
        </div>
      </div>
    </button>
  );
}

export default function Home({ onNavigate }: HomeProps) {
  const { user } = useAuth();
  const { wallet, subscription } = useWallet();

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 text-white md:space-y-6">
      <section className="space-y-4 md:space-y-5">
        <HomeCard
          eyebrow="Design Studio"
          title="Crea con Design Studio"
          subtitle="Abre tu zona principal de imagen con generador, editor, restyler, upscale y herramientas listas para producción móvil-first."
          accent="bg-[radial-gradient(circle_at_top_left,rgba(241,225,148,0.28),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(91,14,20,0.36),transparent_46%)]"
          icon={<Wand2 className="h-6 w-6" />}
          onClick={() => onNavigate(AppRoute.IMAGE_GEN_ROOT)}
        />

        <HomeCard
          eyebrow="Creator Hub"
          title="Creator Hub"
          subtitle={
            user
              ? `Gestiona tu perfil, seguridad, billing y la capa de creator economy desde un solo lugar.`
              : "Activa tu sesión para administrar perfil, seguridad, billing, créditos y próximas herramientas premium."
          }
          accent="bg-[radial-gradient(circle_at_top_right,rgba(110,168,255,0.22),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_38%)]"
          icon={<Sparkles className="h-6 w-6" />}
          onClick={() => onNavigate(AppRoute.PROFILE)}
        >
          <div className="grid gap-3 md:grid-cols-[1.2fr,1fr]">
            <div className="rounded-[26px] border border-white/10 bg-black/25 p-4 backdrop-blur-md">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">{user ? "Creator" : "Guest access"}</div>
              <div className="mt-2 text-xl font-bold text-white">{user?.username || "Sign in required"}</div>
              <div className="mt-2 text-sm leading-6 text-white/60">
                {user
                  ? `Plan activo: ${subscription?.plan_name || "Sin plan"}`
                  : "Al entrar podrás ver profile, security y billing desde el sidebar y desde esta tarjeta."}
              </div>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-black/25 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                <Coins className="h-4 w-4 text-[rgba(241,225,148,0.95)]" /> Credits
              </div>
              <div className="mt-2 text-3xl font-black tracking-tight text-white">
                {(wallet?.generationCredits ?? 0).toLocaleString()}
              </div>
              <div className="mt-2 text-sm leading-6 text-white/60">
                Plan {wallet?.gen_plan_credits ?? 0} · Extra {wallet?.gen_topup_credits ?? 0} · Bonus {wallet?.gen_bonus_credits ?? 0}
              </div>
            </div>
          </div>
        </HomeCard>

        <HomeCard
          eyebrow="1NationUp"
          title="1NationUp"
          subtitle="Explora la capa comercial del ecosistema y llévala a un formato más sólido para producto, store y monetización futura."
          accent="bg-[radial-gradient(circle_at_top_left,rgba(255,138,61,0.18),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(91,14,20,0.42),transparent_48%)]"
          icon={<ShoppingBag className="h-6 w-6" />}
          onClick={() => onNavigate(AppRoute.STORE)}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(241,225,148,0.18)] bg-[rgba(241,225,148,0.08)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/76">
            <Crown className="h-4 w-4 text-[rgba(241,225,148,0.95)]" /> Commerce layer
          </div>
        </HomeCard>
      </section>

      <section>
        <CommunityStore onNavigate={onNavigate} />
      </section>
    </div>
  );
}
