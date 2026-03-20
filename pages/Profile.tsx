import React, { useEffect, useRef, useState } from "react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import { apiUrl } from "../services/apiBase";
import { supabase } from "../services/supabaseClient";
import { profileMe, type ProfileMeResponse } from "../services/profileApi";
import { billingMe, billingPlans, createStripePortal, mockCancel, ownerForceSelfCancelLocal } from "../services/billingApi";
import { emitProfileRefresh, emitWalletRefresh } from "../services/appEvents";
import { ownerAssignMockPlanByEmail, ownerCancelPlanByEmail, ownerFetchSystemStatus, ownerGrantCreditsByEmail, type OwnerSystemStatusResponse } from "../services/ownerAdminApi";

type TabKey = "profile" | "security" | "billing";

function formatQueueAge(seconds?: number | null) {
  if (!Number.isFinite(Number(seconds))) return "—";
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
}

function formatProviderSummary(value: Record<string, number> | undefined) {
  const entries = Object.entries(value || {});
  if (!entries.length) return "—";
  return entries
    .slice(0, 3)
    .map(([key, count]) => `${key}: ${count}`)
    .join(" · ");
}

function clearProfileSearchParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("route");
  url.searchParams.delete("portal");
  url.searchParams.delete("portal_flow");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function Profile({ onNavigate }: { onNavigate: (r: AppRoute) => void }) {
  const { user } = useAuth();
  const { refresh: refreshWallet } = useWallet();

  const [tab, setTab] = useState<TabKey>("profile");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [portalSyncing, setPortalSyncing] = useState(false);
  const [err, setErr] = useState<string>("");

  const [me, setMe] = useState<ProfileMeResponse | null>(null);
  const [sub, setSub] = useState<any | null>(null);
  const [availablePlans, setAvailablePlans] = useState<any[]>([]);

  const [displayName, setDisplayName] = useState<string>(user?.username || "");
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const [passMsg, setPassMsg] = useState<string>("");

  const [ownerTargetEmail, setOwnerTargetEmail] = useState("");
  const [ownerPlanSlug, setOwnerPlanSlug] = useState("");
  const [ownerCredits, setOwnerCredits] = useState("100");
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerMsg, setOwnerMsg] = useState("");
  const [ownerSystem, setOwnerSystem] = useState<OwnerSystemStatusResponse | null>(null);
  const [ownerSystemBusy, setOwnerSystemBusy] = useState(false);
  const [portalMessage, setPortalMessage] = useState("");

  useEffect(() => {
    const focus = window.localStorage.getItem("tales_profile_focus");
    if (focus === "profile" || focus === "security" || focus === "billing") setTab(focus as TabKey);
    window.localStorage.removeItem("tales_profile_focus");
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("portal") !== "return") return;

    const portalFlow = params.get("portal_flow") || "general";
    let cancelled = false;
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    (async () => {
      setErr("");
      setPortalSyncing(true);
      setPortalMessage("Sincronizando tu cuenta con Stripe...");

      try {
        let settled = false;
        let lastStillHasStripePlan = false;
        let lastCancelAtPeriodEnd = false;
        const maxAttempts = portalFlow === "cancel" ? 3 : 2;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (cancelled) return;

          const currentSub = (await billingMe(true, true)) || null;
          if (cancelled) return;
          setSub(currentSub);

          const stillHasStripePlan = currentSub?.provider === "stripe" && !!currentSub?.stripeSubscriptionId;
          lastStillHasStripePlan = stillHasStripePlan;
          lastCancelAtPeriodEnd = currentSub?.cancelAtPeriodEnd === true;

          if (!stillHasStripePlan) {
            settled = true;
            break;
          }

          if (portalFlow !== "cancel" && !lastCancelAtPeriodEnd) {
            settled = true;
            break;
          }

          if (attempt < maxAttempts - 1) {
            await sleep(1200);
          }
        }

        if (cancelled) return;
        await refreshWallet({ silent: true });
        if (cancelled) return;

        if (portalFlow !== "cancel" && lastStillHasStripePlan && lastCancelAtPeriodEnd) {
          settled = false;
        }

        setPortalMessage(
          settled
            ? "Stripe terminó correctamente y tu cuenta ya quedó sincronizada."
            : "Stripe ya respondió, pero la app sigue validando el estado final. Revisa de nuevo en unos segundos."
        );
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || "No se pudo sincronizar el estado tras volver de Stripe.");
      } finally {
        if (!cancelled) {
          setPortalSyncing(false);
          clearProfileSearchParams();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!portalMessage || portalSyncing) return;
    const t = window.setTimeout(() => setPortalMessage(""), 4200);
    return () => window.clearTimeout(t);
  }, [portalMessage, portalSyncing]);

  useEffect(() => {
    if (ownerPlanSlug) return;
    if (!availablePlans.length) return;
    const first = availablePlans[0];
    if (first?.slug) setOwnerPlanSlug(String(first.slug));
  }, [availablePlans, ownerPlanSlug]);

  async function loadOwnerSystemStatus(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    if (!silent) setOwnerSystemBusy(true);

    try {
      const data = await ownerFetchSystemStatus();
      setOwnerSystem(data);
    } catch (e: any) {
      if (!silent) setErr(e?.message || "No se pudo cargar el estado del sistema.");
    } finally {
      if (!silent) setOwnerSystemBusy(false);
    }
  }

  async function loadAll(opts?: { syncStripe?: boolean; strictSync?: boolean; background?: boolean }) {
    const background = opts?.background === true;
    if (background) setRefreshing(true);
    else setLoading(true);
    setErr("");

    try {
      const [pR, sR, plansR] = await Promise.allSettled([
        profileMe(),
        billingMe(opts?.syncStripe === true, opts?.strictSync === true),
        billingPlans(),
      ]);

      if (pR.status === "fulfilled") {
        setMe(pR.value);
        setDisplayName(pR.value.displayName || user?.username || "");

        if (pR.value.ownerAdmin) {
          if (!background) {
            try {
              const system = await ownerFetchSystemStatus();
              setOwnerSystem(system);
            } catch {
              setOwnerSystem(null);
            }
          }
        } else {
          setOwnerSystem(null);
        }
      } else {
        setErr(pR.reason?.message || "No se pudo cargar tu perfil.");
        setOwnerSystem(null);
      }

      if (sR.status === "fulfilled") setSub(sR.value || null);
      if (plansR.status === "fulfilled") setAvailablePlans(Array.isArray(plansR.value) ? plansR.value : []);

      return {
        profile: pR.status === "fulfilled" ? pR.value : null,
        subscription: sR.status === "fulfilled" ? sR.value || null : null,
        plans: plansR.status === "fulfilled" ? (Array.isArray(plansR.value) ? plansR.value : []) : [],
      };
    } finally {
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }

  async function saveName() {
    const next = displayName.trim();
    if (!next) return setErr("El nombre no puede estar vacío.");

    setBusy(true);
    setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ data: { username: next, display_name: next } });
      if (error) throw error;
      emitProfileRefresh();
      setMe(await profileMe());
    } catch (e: any) {
      setErr(e?.message || "No se pudo guardar el nombre.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutorefill(next: boolean) {
    setBusy(true);
    setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ data: { autorefill_enabled: next } });
      if (error) throw error;
      emitProfileRefresh();
      setMe(await profileMe());
    } catch (e: any) {
      setErr(e?.message || "No se pudo actualizar Auto-refill.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    const okType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!okType) return setErr("Formato inválido. Usa PNG, JPG o WEBP.");

    const maxBytes = 1_500_000;
    if (file.size > maxBytes) return setErr("La imagen es muy pesada. Máximo 1.5MB.");

    setErr("");
    setAvatarUploading(true);
    setAvatarPreview(URL.createObjectURL(file));

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesión inválida.");

      const presignResp = await fetch(apiUrl("/api/assets/presign-upload"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tool: "avatar",
          name: file.name || "avatar",
          type: "image",
          category: "avatar",
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          expiresSeconds: 15 * 60,
        }),
      });

      const presignText = await presignResp.text();
      const presignData = JSON.parse(presignText);

      if (!presignResp.ok || presignData?.ok !== true || !presignData?.upload?.storagePath) {
        const msg = presignData?.error?.message || `Presign failed (${presignResp.status})`;
        throw new Error(msg);
      }

      const upload = presignData.upload;

      if (upload.provider === "r2") {
        const putResp = await fetch(upload.url, {
          method: upload.method || "PUT",
          headers: upload.headers || { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putResp.ok) throw new Error(`R2 upload failed (${putResp.status})`);
      } else if (upload.provider === "supabase") {
        if (!upload.bucket || !upload.path || !upload.token) throw new Error("Supabase upload incompleto.");

        const anySb: any = supabase as any;
        const fn = anySb?.storage?.from?.(upload.bucket)?.uploadToSignedUrl;
        if (typeof fn !== "function") throw new Error("supabase-js no soporta uploadToSignedUrl en el cliente.");

        const { error: upErr } = await supabase.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type || "application/octet-stream" });

        if (upErr) throw new Error(upErr.message);
      } else {
        throw new Error(`Proveedor de upload desconocido: ${String(upload.provider)}`);
      }

      const { error: upMetaErr } = await supabase.auth.updateUser({ data: { avatar_storage_path: upload.storagePath } });
      if (upMetaErr) throw upMetaErr;

      emitProfileRefresh();
      setMe(await profileMe());
    } catch (e: any) {
      setErr(e?.message || "No se pudo subir el avatar.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function changePassword() {
    setPassMsg("");
    setErr("");

    const a = newPass.trim();
    const b = newPass2.trim();
    if (!a || a.length < 8) return setErr("La contraseña debe tener al menos 8 caracteres.");
    if (a !== b) return setErr("Las contraseñas no coinciden.");

    setPassBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: a });
      if (error) throw error;
      setNewPass("");
      setNewPass2("");
      setPassMsg("Contraseña actualizada.");
    } catch (e: any) {
      setErr(e?.message || "No se pudo actualizar la contraseña.");
    } finally {
      setPassBusy(false);
    }
  }

  async function ownerAssignPlan() {
    if (!me?.ownerAdmin) return;

    const email = ownerTargetEmail.trim();
    if (!email) return setErr("Escribe el email del usuario al que quieres asignarle el plan.");
    if (!ownerPlanSlug) return setErr("Selecciona un plan.");

    setOwnerBusy(true);
    setOwnerMsg("");
    setErr("");

    try {
      const data = await ownerAssignMockPlanByEmail(email, ownerPlanSlug);
      const planName = data?.plan?.name || ownerPlanSlug;
      setOwnerMsg(`Plan asignado: ${planName} -> ${data?.user?.email || email}`);
      await refreshWallet();
      await loadAll({ background: true });
    } catch (e: any) {
      setErr(e?.message || "No se pudo asignar el plan.");
    } finally {
      setOwnerBusy(false);
    }
  }

  async function ownerGrantCredits() {
    if (!me?.ownerAdmin) return;

    const email = ownerTargetEmail.trim();
    const amount = Math.floor(Number(ownerCredits));

    if (!email) return setErr("Escribe el email del usuario al que quieres asignarle créditos.");
    if (!Number.isFinite(amount) || amount <= 0) return setErr("Los créditos deben ser un número mayor que 0.");

    setOwnerBusy(true);
    setOwnerMsg("");
    setErr("");

    try {
      const data = await ownerGrantCreditsByEmail(email, amount);
      setOwnerMsg(`Créditos agregados: +${amount} -> ${data?.email || email}`);
      await refreshWallet();
      await loadAll({ background: true });
    } catch (e: any) {
      setErr(e?.message || "No se pudo agregar créditos.");
    } finally {
      setOwnerBusy(false);
    }
  }

  async function ownerCancelPlan(wipeGenerationCredits: boolean) {
    if (!me?.ownerAdmin) return;

    const email = ownerTargetEmail.trim();
    if (!email) return setErr("Escribe el email del usuario al que quieres cancelar el plan.");

    const ok = window.confirm(
      wipeGenerationCredits
        ? `Cancelar el plan de ${email} y borrar sus créditos de generación.`
        : `Cancelar el plan de ${email} manteniendo sus créditos de generación.`
    );
    if (!ok) return;

    setOwnerBusy(true);
    setOwnerMsg("");
    setErr("");

    try {
      const data = await ownerCancelPlanByEmail(email, { wipeGenerationCredits });
      setOwnerMsg(`Plan cancelado para ${data?.user?.email || email}.`);
      await refreshWallet();
      await loadAll({ background: true });
    } catch (e: any) {
      setErr(e?.message || "No se pudo cancelar el plan del usuario.");
    } finally {
      setOwnerBusy(false);
    }
  }

  async function openBillingPortal(flow: "general" | "cancel" | "payment_method_update" | "update" = "general") {
    setErr("");
    setPortalMessage("");

    try {
      window.localStorage.setItem("tales_profile_focus", "billing");
      const data = await createStripePortal(flow);
      window.location.assign(data.url);
    } catch (e: any) {
      setErr(e?.message || "No se pudo abrir el portal de facturación.");
    }
  }

  async function cancelSubscription(opts?: { wipeGenerationCredits?: boolean }) {
    const wipeGenerationCredits = opts?.wipeGenerationCredits === true;
    const isStripeManaged = sub?.provider === "stripe" && !!sub?.stripeSubscriptionId;

    if (isStripeManaged) {
      const okStripe = window.confirm(
        "Te llevaré al portal de Stripe para confirmar la cancelación. Cuando Stripe la cierre, la app sincronizará el plan y reiniciará tus créditos de generación a cero. ¿Deseas continuar?"
      );
      if (!okStripe) return;

      setErr("");
      try {
        await openBillingPortal("cancel");
      } catch (e: any) {
        setErr(e?.message || "No se pudo abrir el portal de cancelación de Stripe.");
      }
      return;
    }

    const ok = window.confirm(
      wipeGenerationCredits
        ? "Esto cancelará tu plan activo de inmediato y borrará tus créditos de generación (plan, topup y bonus). Tus earnings no se borran, pero seguirán bloqueados hasta volver a un plan elegible. ¿Deseas continuar?"
        : "Esto cancelará tu plan activo de inmediato. Tus créditos de generación y earnings se conservarán, pero no podrás usar créditos de generación sin plan activo, tus listings públicos se ocultarán si pierdes Pro+ y tus códigos de referido dejarán de funcionar si pierdes Partner+. ¿Deseas continuar?"
    );
    if (!ok) return;

    setErr("");
    try {
      await mockCancel({ wipeGenerationCredits });
      emitWalletRefresh();
      await refreshWallet();
      setSub((await billingMe(false, false)) || null);
    } catch (e: any) {
      setErr(e?.message || "No se pudo cancelar el plan.");
    }
  }

  async function forceLocalCancelForOwner(opts?: { wipeGenerationCredits?: boolean }) {
    if (!me?.ownerAdmin) return;
    const wipeGenerationCredits = opts?.wipeGenerationCredits === true;
    const ok = window.confirm(
      wipeGenerationCredits
        ? "Forzar desactivación local del plan y borrar créditos de generación. Esto es solo para pruebas internas y no sustituye una cancelación real en Stripe. ¿Deseas continuar?"
        : "Forzar desactivación local del plan conservando créditos. Esto es solo para pruebas internas y no sustituye una cancelación real en Stripe. ¿Deseas continuar?"
    );
    if (!ok) return;

    setErr("");
    try {
      await ownerForceSelfCancelLocal({ wipeGenerationCredits });
      emitWalletRefresh();
      await refreshWallet();
      setSub((await billingMe(false, false)) || null);
    } catch (e: any) {
      setErr(e?.message || "No se pudo forzar la cancelación local.");
    }
  }

  const avatarSrc = me?.avatarUrl || avatarPreview || user?.avatarUrl || "";
  const email = me?.email || "";
  const handle = email ? email.split("@")[0] : "";
  const ownerWorkers = ownerSystem?.checks?.workers?.active || {};
  const ownerImageWorkers = ownerWorkers.image || { active: 0, total: 0, latestAt: null };
  const ownerVideoWorkers = ownerWorkers.video || { active: 0, total: 0, latestAt: null };
  const ownerImageQueue = ownerSystem?.checks?.queue?.summary?.image || null;
  const ownerVideoQueue = ownerSystem?.checks?.queue?.summary?.video || null;

  if (loading) return <div className="p-6 text-white">Cargando...</div>;

  return (
    <div className="p-6 text-white max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <div className="text-sm text-white/60 mt-1">Profile · Security · Billing</div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10"
          onClick={() => onNavigate(AppRoute.HOME)}
        >
          Back
        </button>
      </div>

      {err ? <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40">{err}</div> : null}
      {portalMessage ? (
        <div
          className={`mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            portalSyncing ? "bg-sky-500/12 border-sky-400/30 text-sky-100" : "bg-white/5 border-white/10 text-white/80"
          }`}
        >
          <span
            className={`mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
              portalSyncing ? "animate-pulse bg-sky-300" : "bg-emerald-300"
            }`}
          />
          <div className="min-w-0">{portalMessage}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={() => setTab("profile")}
          className={`px-4 py-2 rounded-xl border text-sm ${
            tab === "profile" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
          }`}
        >
          Profile
        </button>
        <button
          type="button"
          onClick={() => setTab("security")}
          className={`px-4 py-2 rounded-xl border text-sm ${
            tab === "security" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
          }`}
        >
          Security
        </button>
        <button
          type="button"
          onClick={() => setTab("billing")}
          className={`px-4 py-2 rounded-xl border text-sm ${
            tab === "billing" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
          }`}
        >
          Billing
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => void loadAll({ background: true })}
          disabled={refreshing || portalSyncing}
          className={`px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm ${(refreshing || portalSyncing) ? "opacity-60 pointer-events-none" : ""}`}
        >
          {refreshing || portalSyncing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {tab === "profile" ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-bold">Profile</div>
          <div className="text-sm text-white/60 mt-1">Avatar y nombre público</div>

          <div className="mt-6 flex flex-col sm:flex-row gap-6">
            <div className="shrink-0">
              <div className="w-20 h-20 rounded-full overflow-hidden border border-white/15 bg-black/40">
                {avatarSrc ? <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover" /> : null}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadAvatar(f);
                  e.currentTarget.value = "";
                }}
              />

              <button
                type="button"
                className={`mt-3 px-3 py-2 rounded-xl border border-white/10 bg-white/10 hover:bg-white/15 text-sm ${
                  avatarUploading ? "opacity-50 pointer-events-none" : ""
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarUploading ? "Uploading..." : "Upload avatar"}
              </button>

              <div className="text-[11px] text-white/45 mt-2">PNG/JPG/WEBP · Max 1.5MB</div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-semibold mb-2">Name</div>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 focus:outline-none focus:border-white/25"
                    placeholder="Your public name"
                  />
                </div>

                <div>
                  <div className="text-sm font-semibold mb-2">Username</div>
                  <input value={handle} readOnly className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 opacity-80" />
                </div>

                <div className="sm:col-span-2">
                  <div className="text-sm font-semibold mb-2">Email</div>
                  <input value={email} readOnly className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 opacity-80" />
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className={`px-4 py-2 rounded-xl bg-white text-black font-bold ${busy ? "opacity-50 pointer-events-none" : ""}`}
                  onClick={() => void saveName()}
                >
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "security" ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-bold">Security</div>
          <div className="text-sm text-white/60 mt-1">Reset password</div>

          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-semibold mb-2">New password</div>
              <input
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 focus:outline-none focus:border-white/25"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">Confirm new password</div>
              <input
                type="password"
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 focus:outline-none focus:border-white/25"
              />
            </div>
          </div>

          {passMsg ? <div className="mt-4 text-sm text-emerald-200">{passMsg}</div> : null}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              className={`px-4 py-2 rounded-xl bg-white text-black font-bold ${passBusy ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => void changePassword()}
            >
              {passBusy ? "Updating..." : "Update password"}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "billing" ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-bold">Billing</div>
          <div className="text-sm text-white/60 mt-1">Subscription & billing settings</div>

          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="text-sm text-white/60">Active plan</div>
              <div className="text-lg font-extrabold mt-1">{sub?.planName || "Ninguno"}</div>
              <div className="text-sm text-white/60 mt-1">Billing: {sub?.billingPeriod || "—"}</div>
              <div className="text-sm text-white/60 mt-1">Provider: {sub?.provider || "—"}</div>
              {sub?.currentPeriodEnd ? (
                <div className="text-sm text-white/60 mt-1">
                  {sub?.cancelAtPeriodEnd ? "Access until" : "Next renewal"}: {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Auto-refill</div>
                  <div className="text-xs text-white/55 mt-1">Preferencia de cuenta.</div>
                </div>

                <button
                  type="button"
                  className={`w-12 h-7 rounded-full border border-white/15 p-1 transition-colors ${
                    me?.autoRefillEnabled ? "bg-emerald-500/50" : "bg-white/10"
                  } ${busy ? "opacity-60 pointer-events-none" : ""}`}
                  onClick={() => void toggleAutorefill(!me?.autoRefillEnabled)}
                  title="Auto-refill"
                >
                  <div className={`w-5 h-5 rounded-full bg-white transition-transform ${me?.autoRefillEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="text-sm font-semibold">Billing information</div>
              <div className="text-xs text-white/55 mt-2">{handle}</div>
              <div className="text-xs text-white/55">{email}</div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className={`px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm ${sub?.provider === "stripe" ? "hover:bg-white/15" : "opacity-60 cursor-not-allowed"}`}
                  onClick={() => void openBillingPortal("payment_method_update")}
                  disabled={sub?.provider !== "stripe"}
                  title={sub?.provider === "stripe" ? "Gestionar método de pago" : "Disponible cuando tu suscripción esté en Stripe"}
                >
                  Change billing information
                </button>
                <button
                  type="button"
                  className={`px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm ${sub?.provider === "stripe" ? "hover:bg-white/15" : "opacity-60 cursor-not-allowed"}`}
                  onClick={() => void openBillingPortal("general")}
                  disabled={sub?.provider !== "stripe"}
                  title={sub?.provider === "stripe" ? "Abrir portal de Stripe" : "Disponible cuando tu suscripción esté en Stripe"}
                >
                  Billing history
                </button>
              </div>
            </div>

            {me?.ownerAdmin ? (
              <div className="md:col-span-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="text-sm font-semibold text-emerald-100">Owner controls</div>
                <div className="text-xs text-emerald-100/70 mt-1">
                  Uso interno: asignar planes manuales/internos, cancelar planes y dar créditos sin cobros reales.
                </div>

                <div className="mt-4 grid md:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="text-xs text-white/60">Image queue</div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {ownerImageQueue?.pendingTotal ?? 0} pendientes / cap {ownerImageQueue?.capacity?.recommendedCap ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      Workers activos: {ownerImageWorkers.active || 0}/{ownerImageWorkers.total || 0}
                    </div>
                    <div className="text-xs text-white/60">
                      Job más viejo: {formatQueueAge(ownerImageQueue?.oldestAgeSeconds ?? null)}
                    </div>
                    <div className="text-xs text-white/55 mt-2 break-words">
                      Modelos cargados: {ownerImageQueue?.topModels?.length ? ownerImageQueue.topModels.map((row) => `${row.key} (${row.count})`).join(" · ") : "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="text-xs text-white/60">Video queue</div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {ownerVideoQueue?.pendingTotal ?? 0} pendientes / cap {ownerVideoQueue?.capacity?.recommendedCap ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      Workers activos: {ownerVideoWorkers.active || 0}/{ownerVideoWorkers.total || 0}
                    </div>
                    <div className="text-xs text-white/60">
                      Job más viejo: {formatQueueAge(ownerVideoQueue?.oldestAgeSeconds ?? null)}
                    </div>
                    <div className="text-xs text-white/55 mt-2 break-words">
                      Proveedores: {formatProviderSummary(ownerVideoQueue?.byProvider)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-xs ${ownerSystemBusy ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => void loadOwnerSystemStatus()}
                  >
                    {ownerSystemBusy ? "Refreshing…" : "Refresh system status"}
                  </button>
                  <div className="text-[11px] text-emerald-100/70">
                    DB latency: {ownerSystem?.checks?.db?.latencyMs != null ? `${ownerSystem.checks.db.latencyMs}ms` : "—"}
                  </div>
                </div>

                <div className="mt-4 grid md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <div className="text-xs text-white/60 mb-2">Email del usuario objetivo</div>
                    <input
                      value={ownerTargetEmail}
                      onChange={(e) => setOwnerTargetEmail(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 focus:outline-none focus:border-white/25"
                      placeholder="usuario@correo.com"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-white/60 mb-2">Créditos bonus</div>
                    <input
                      value={ownerCredits}
                      onChange={(e) => setOwnerCredits(e.target.value)}
                      inputMode="numeric"
                      className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 focus:outline-none focus:border-white/25"
                      placeholder="100"
                    />
                  </div>
                </div>

                <div className="mt-4 grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-white/60 mb-2">Plan manual a asignar</div>
                    <select
                      value={ownerPlanSlug}
                      onChange={(e) => setOwnerPlanSlug(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 focus:outline-none focus:border-white/25"
                    >
                      <option value="">Selecciona un plan</option>
                      {availablePlans.map((plan) => (
                        <option key={plan.id || plan.slug} value={plan.slug}>
                          {plan.name} · {plan.slug}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-xl bg-emerald-400 text-black font-bold ${ownerBusy ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => void ownerAssignPlan()}
                  >
                    Assign manual plan
                  </button>

                  <button
                    type="button"
                    className={`px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm ${ownerBusy ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => void ownerGrantCredits()}
                  >
                    Grant bonus credits
                  </button>

                  <button
                    type="button"
                    className={`px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-sm ${ownerBusy ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => void ownerCancelPlan(false)}
                  >
                    Cancel target plan
                  </button>

                  <button
                    type="button"
                    className={`px-4 py-2 rounded-xl bg-red-600/25 border border-red-500/40 text-sm ${ownerBusy ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => void ownerCancelPlan(true)}
                  >
                    Cancel + wipe target credits
                  </button>
                </div>

                <div className="text-[11px] text-emerald-100/70 mt-3">
                  Esto solo funciona si tu email está en OWNER_ADMIN_EMAILS o tu user ID está en OWNER_ADMIN_USER_IDS en Render.
                </div>

                {ownerMsg ? <div className="mt-3 text-sm text-emerald-100">{ownerMsg}</div> : null}
              </div>
            ) : null}

            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="text-sm font-semibold text-red-200">Danger zone</div>
              <div className="text-xs text-red-200/70 mt-1">
                {sub?.provider === "stripe"
                  ? "La cancelación real se confirma en el portal de Stripe. Al volver, la app sincroniza el plan y reinicia los créditos de generación si ya no queda ningún plan activo."
                  : "Pruebas de cancelación manual con o sin wipe de créditos de generación."}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {sub?.provider === "stripe" ? (
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-sm"
                    onClick={() => void cancelSubscription({ wipeGenerationCredits: false })}
                  >
                    Cancel in Stripe portal
                  </button>
                ) : (
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-sm"
                    onClick={() => void cancelSubscription({ wipeGenerationCredits: false })}
                  >
                    Cancel subscription (keep credits)
                  </button>
                )}

                {sub?.provider !== "stripe" ? (
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl bg-red-600/25 hover:bg-red-600/35 border border-red-500/40 text-sm"
                    onClick={() => void cancelSubscription({ wipeGenerationCredits: true })}
                  >
                    Cancel + wipe generation credits
                  </button>
                ) : null}

                {me?.ownerAdmin ? (
                  <>
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm ${(refreshing || portalSyncing) ? "opacity-60 pointer-events-none" : ""}`}
                      onClick={() => void forceLocalCancelForOwner({ wipeGenerationCredits: false })}
                    >
                      Deactivate locally
                    </button>

                    <button
                      type="button"
                      className={`px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm ${(refreshing || portalSyncing) ? "opacity-60 pointer-events-none" : ""}`}
                      onClick={() => void forceLocalCancelForOwner({ wipeGenerationCredits: true })}
                    >
                      Deactivate locally + wipe credits
                    </button>
                  </>
                ) : null}
              </div>

              <div className="text-[11px] text-red-100/70 mt-3">
                {sub?.provider === "stripe"
                  ? "Usa este acceso para cancelar en Stripe. Billing history sigue disponible para facturas y también quedará sincronizado si cancelas desde ahí."
                  : "El wipe borra solo créditos de generación: plan, topup y bonus. Los earnings no se borran aquí."}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
