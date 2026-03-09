import React from "react";
import { AppRoute } from "../types";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

export default function ReelFeed({ onNavigate }: Props) {
  return (
    <div className="space-y-6 text-white">
      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(0,0,0,0.82),rgba(91,14,20,0.32))] p-6 shadow-[0_20px_56px_rgba(0,0,0,0.42)] backdrop-blur-xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
          <span className="h-2 w-2 rounded-full bg-[rgba(241,225,148,0.95)] shadow-[0_0_14px_rgba(241,225,148,0.55)]" />
          Carrete
        </div>

        <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">Feed vertical de ventas</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-white/68">
          En este lote dejamos lista la ruta, la navegación fija y el espacio para el feed tipo reels.
          En la siguiente pasada conectamos aquí el scroll vertical, la compra rápida, los likes, los comentarios
          y el botón de reusar receta.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate(AppRoute.COMMUNITY_STORE)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
          >
            Seguir en Community Store
          </button>
          <button
            type="button"
            onClick={() => onNavigate(AppRoute.HOME)}
            className="rounded-2xl border border-[rgba(241,225,148,0.24)] bg-[rgba(241,225,148,0.12)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[rgba(241,225,148,0.18)]"
          >
            Volver al Home
          </button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((card) => (
          <div
            key={card}
            className="min-h-[380px] rounded-[26px] border border-white/10 bg-[rgba(0,0,0,0.58)] p-5 shadow-[0_18px_42px_rgba(0,0,0,0.38)] backdrop-blur-xl"
          >
            <div className="flex h-full flex-col justify-between rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] p-5">
              <div>
                <div className="text-sm font-semibold text-white/72">Mock slot {card}</div>
                <div className="mt-3 text-2xl font-black text-white">Preview del reel</div>
                <p className="mt-3 text-sm leading-6 text-white/58">
                  Aquí irá cada asset en venta con caption expandible, avatar, likes, comentarios y CTA de compra o reuso.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/45">
                Preparado para la siguiente fase
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
