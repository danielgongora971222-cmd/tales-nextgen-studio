import React from "react";
import { AppRoute } from "../types";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

const ways = [
  {
    title: "Vender creaciones",
    copy:
      "Publica tus mejores recetas y assets en Community Store para generar ventas recurrentes dentro del ecosistema de Tales.AI.",
  },
  {
    title: "Vender Art Deco 1NationUp",
    copy:
      "Convierte tus conceptos visuales en piezas listas para la tienda de 1NationUp y abre una nueva línea de ingresos creativos.",
  },
  {
    title: "Referidos",
    copy:
      "Invita a nuevos creadores y gana comisiones cuando activan planes o compran dentro de la plataforma.",
  },
];

export default function EarnMoney({ onNavigate }: Props) {
  return (
    <div className="space-y-6 text-white">
      <section className="rounded-[28px] border border-[rgba(241,225,148,0.18)] bg-[linear-gradient(145deg,rgba(91,14,20,0.34),rgba(0,0,0,0.82))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl md:p-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.55)]" />
          Monetización
        </div>

        <div className="mt-4 max-w-3xl">
          <h1 className="text-3xl font-black tracking-tight text-white md:text-5xl">
            Tales.AI no es solo una plataforma de generación con IA.
          </h1>
          <p className="mt-3 text-base leading-7 text-white/68 md:text-lg">
            Aquí también puedes construir ingresos pasivos con tus recetas, tus publicaciones y tu alcance.
            En esta primera versión dejamos listas las 3 vías principales de monetización para desarrollarlas a fondo después.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate(AppRoute.COMMUNITY_STORE)}
            className="rounded-2xl border border-[rgba(241,225,148,0.24)] bg-[rgba(241,225,148,0.12)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[rgba(241,225,148,0.18)]"
          >
            Ir a Community Store
          </button>
          <button
            type="button"
            onClick={() => onNavigate(AppRoute.MY_TRADES)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
          >
            Abrir My Trades
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {ways.map((way, index) => (
          <article
            key={way.title}
            className="rounded-[24px] border border-white/10 bg-[rgba(0,0,0,0.58)] p-5 shadow-[0_18px_42px_rgba(0,0,0,0.36)] backdrop-blur-xl"
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-black text-white/90">
              0{index + 1}
            </div>
            <h2 className="mt-4 text-xl font-bold text-white">{way.title}</h2>
            <p className="mt-3 text-sm leading-6 text-white/65">{way.copy}</p>
            <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-white/45">
              Próxima fase de detalle
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
