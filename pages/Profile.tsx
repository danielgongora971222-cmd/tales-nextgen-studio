import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import { apiUrl } from "../services/apiBase";
import { supabase } from "../services/supabaseClient";
import { profileMe, type ProfileMeResponse } from "../services/profileApi";
import {
  billingMe,
  billingPlans,
  billingTopups,
  mockSubscribe,
  mockTopup,
  mockCancel,
} from "../services/billingApi";
import { acceptLegal } from "../services/legalApi";
import { emitProfileRefresh } from "../services/appEvents";
import ConfirmDollarPurchaseModal from "@/components/ConfirmDollarPurchaseModal";

const TERMS_VERSION = "2026-03-03";
const PRIVACY_VERSION = "2026-03-03";
const AUTOPAY_VERSION = "2026-03-03";

type TabKey = "profile" | "security" | "billing";

type ConfirmState =
  | null
  | {
      itemLabel: string;
      amountLabel: string;
      note?: string | null;
      action: () => Promise<void>;
    };

function periodLabel(period: string | null | undefined) {
  if (period === "week") return "weekly";
  if (period === "year") return "annual";
  return "monthly";
}

function formatK(n: number) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

export default function Profile({ onNavigate }: { onNavigate: (r: AppRoute) => void }) {
  const { user } = useAuth();
  const { wallet, refresh: refreshWallet } = useWallet();

  const [tab, setTab] = useState<TabKey>("profile");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [me, setMe] = useState<ProfileMeResponse | null>(null);

  const [sub, setSub] = useState<any | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [topups, setTopups] = useState<any[]>([]);

  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // Profile edits
  const [displayName, setDisplayName] = useState<string>(user?.username || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Security
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<string>("");

  // Billing UI toggles
  const [showPlans, setShowPlans] = useState(false);
  const [plansFilter, setPlansFilter] = useState<"all" | "annual">("all");
  const [showTopups, setShowTopups] = useState(false);

  const credits = Number(wallet?.generationCredits ?? 0);
  const activePlanName = sub?.planName || sub?.plan_name || "Ninguno";

  const planForLimit = useMemo(() => {
    const slug = sub?.planSlug || sub?.plan_slug;
    if (!slug) return null;
    return plans.find((p) => p.slug === slug) || null;
  }, [plans, sub?.planSlug, sub?.plan_slug]);

  const planLimit = Number(planForLimit?.plan_credits ?? 0) + Number(planForLimit?.bonus_credits ?? 0);
  const remainingPlanish = Number(wallet?.gen_plan_credits ?? 0) + Number(wallet?.gen_bonus_credits ?? 0);
  const spentPlanish = Math.max(0, planLimit - remainingPlanish);
  const pct = planLimit > 0 ? Math.min(100, Math.max(0, (spentPlanish / planLimit) * 100)) : 0;

  async function loadAll() {
    setLoading(true);
    setErr("");

    const [pR, sR, plsR, topsR] = await Promise.allSettled([
      profileMe(),
      billingMe(),
      billingPlans(),
      billingTopups(),
    ]);

    const errors: string[] = [];

    if (pR.status === "fulfilled") {
      setMe(pR.value);
      setDisplayName(pR.value.displayName || user?.username || "");
    } else {
      errors.push(pR.reason?.message || "No se pudo cargar perfil.");
    }

    if (sR.status === "fulfilled") setSub(sR.value);
    else errors.push(sR.reason?.message || "No se pudo cargar suscripción.");

    if (plsR.status === "fulfilled") setPlans(plsR.value || []);
    else errors.push(plsR.reason?.message || "No se pudieron cargar planes.");

    if (topsR.status === "fulfilled") setTopups(topsR.value || []);
    else errors.push(topsR.reason?.message || "No se pudieron cargar topups.");

    if (errors.length) {
      setErr(errors[0]);
    }

    setLoading(false);
  }

  useEffect(() => {
    const focus = window.localStorage.getItem("tales_profile_focus");
    if (focus === "billing") setTab("billing");
    else setTab("profile");
    window.localStorage.removeItem("tales_profile_focus");
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  async function saveDisplayName() {
    const next = displayName.trim();
    if (!next) {
      setErr("El nombre no puede estar vacío.");
      return;
    }

    setSavingProfile(true);
    setErr("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          username: next,
          display_name: next,
        },
      });
      if (error) throw error;

      emitProfileRefresh();
      const p = await profileMe();
      setMe(p);
    } catch (e: any) {
      setErr(e?.message || "No se pudo guardar el nombre.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function toggleAutorefill(next: boolean) {
    setSavingProfile(true);
    setErr("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          autorefill_enabled: next,
        },
      });
      if (error) throw error;

      emitProfileRefresh();
      const p = await profileMe();
      setMe(p);
    } catch (e: any) {
      setErr(e?.message || "No se pudo actualizar Auto-refill.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!file) return;

    const okType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!okType) {
      setErr("Formato inválido. Usa PNG, JPG o WEBP.");
      return;
    }

    const maxBytes = 1_500_000; // 1.5MB
    if (file.size > maxBytes) {
      setErr("La imagen es muy pesada. Máximo 1.5MB.");
      return;
    }

    setErr("");
    setAvatarUploading(true);

    const tmp = URL.createObjectURL(file);
    setAvatarPreview(tmp);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesión inválida.");

      // 1) Presign
      const presignResp = await fetch(apiUrl("/api/assets/presign-upload"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
      let presignData: any;
      try {
        presignData = JSON.parse(presignText);
      } catch {
        throw new Error(`Presign devolvió texto no JSON. Inicio: ${presignText.slice(0, 80)}`);
      }

      if (!presignResp.ok || presignData?.ok !== true || !presignData?.upload?.storagePath) {
        const msg = presignData?.error?.message || `Presign failed (${presignResp.status})`;
        throw new Error(msg);
      }

      const upload = presignData.upload;

      // 2) PUT directo a storage
      if (upload.provider === "r2") {
        const putResp = await fetch(upload.url, {
          method: upload.method || "PUT",
          headers: upload.headers || { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        if (!putResp.ok) {
          const errText = await putResp.text();
          throw new Error(`R2 upload failed: ${putResp.status} ${errText}`);
        }
      } else if (upload.provider === "supabase") {
        if (!upload.bucket || !upload.path || !upload.token) {
          throw new Error("Supabase signed upload incompleto (bucket/path/token).");
        }

        const anySb: any = supabase as any;
        const fn = anySb?.storage?.from?.(upload.bucket)?.uploadToSignedUrl;
        if (typeof fn !== "function") {
          throw new Error("supabase-js no soporta uploadToSignedUrl en el cliente.");
        }

        const { error: upErr } = await supabase.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: file.type || "application/octet-stream",
          });

        if (upErr) throw new Error(upErr.message);
      } else {
        throw new Error(`Proveedor de upload desconocido: ${String(upload.provider)}`);
      }

      // 3) Guarda storagePath en user_metadata
      const { error: upMetaErr } = await supabase.auth.updateUser({
        data: {
          avatar_storage_path: upload.storagePath,
        },
      });
      if (upMetaErr) throw upMetaErr;

      // 4) Pide URL firmada para render inmediato + refresca avatar global
      emitProfileRefresh();
      const p = await profileMe();
      setMe(p);

      await refreshWallet();
    } catch (e: any) {
      setErr(e?.message || "No se pudo subir el avatar.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function changePassword() {
    setSecurityMsg("");
    setErr("");

    const a = newPass.trim();
    const b = newPass2.trim();
    if (!a || a.length < 8) {
      setErr("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (a !== b) {
      setErr("Las contraseñas no coinciden.");
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: a });
      if (error) throw error;
      setNewPass("");
      setNewPass2("");
      setSecurityMsg("Contraseña actualizada.");
    } catch (e: any) {
      setErr(e?.message || "No se pudo actualizar la contraseña.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function doCancelSubscription() {
    const ok = window.confirm(
      "Esto cancelará tu plan y borrará tus créditos de generación (plan/topup/bonus). ¿Deseas continuar?"
    );
    if (!ok) return;

    setErr("");
    try {
      await mockCancel();
      await refreshWallet();
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || "No se pudo cancelar el plan.");
    }
  }

  if (loading) {
    return <div className="p-6 text-white">Cargando...</div>;
  }

  const email = me?.email || "";
  const handle = email ? email.split("@")[0] : "";

  const avatarSrc = me?.avatarUrl || avatarPreview || user?.avatarUrl || "";

  const filteredPlans = plansFilter === "annual" ? plans.filter((p) => p.billing_period === "year") : plans;

  return (
    <div className="p-6 text-white max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <div className="text-sm text-white/60 mt-1">Profile, security, plan & billing</div>
        </div>

        <button
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10"
          onClick={() => onNavigate(AppRoute.HOME)}
          type="button"
        >
          Back
        </button>
      </div>

      {err ? <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40">{err}</div> : null}

      <div className="grid md:grid-cols-[260px,1fr] gap-6">
        {/* Left navigation */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setTab("profile")}
            className={`w-full text-left px-4 py-3 rounded-2xl border transition-colors ${
              tab === "profile" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            <div className="text-sm font-bold">Profile</div>
            <div className="text-xs text-white/55 mt-1">Avatar, name, account</div>
          </button>

          <button
            type="button"
            onClick={() => setTab("security")}
            className={`w-full text-left px-4 py-3 rounded-2xl border transition-colors ${
              tab === "security" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            <div className="text-sm font-bold">Security</div>
            <div className="text-xs text-white/55 mt-1">Reset password</div>
          </button>

          <button
            type="button"
            onClick={() => setTab("billing")}
            className={`w-full text-left px-4 py-3 rounded-2xl border transition-colors ${
              tab === "billing" ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            <div className="text-sm font-bold">Plan & Billing</div>
            <div className="text-xs text-white/55 mt-1">Manage plans & extra credits</div>
          </button>

          <div className="pt-2">
            <button
              type="button"
              onClick={loadAll}
              className="w-full px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Right content */}
        <div className="space-y-6">
          {tab === "profile" ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-xl font-bold">Profile</div>
              <div className="text-sm text-white/60 mt-1">Your public profile details</div>

              <div className="mt-6 flex flex-col sm:flex-row gap-6">
                <div className="shrink-0">
                  <div className="text-sm font-semibold mb-2">Avatar</div>
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
                      if (f) uploadAvatar(f);
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
                      <input
                        value={handle}
                        readOnly
                        className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 opacity-80"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <div className="text-sm font-semibold mb-2">Email</div>
                      <input
                        value={email}
                        readOnly
                        className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 opacity-80"
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-xl bg-white text-black font-bold ${
                        savingProfile ? "opacity-50 pointer-events-none" : ""
                      }`}
                      onClick={saveDisplayName}
                    >
                      {savingProfile ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "security" ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-xl font-bold">Security</div>
              <div className="text-sm text-white/60 mt-1">Reset your password</div>

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

              {securityMsg ? <div className="mt-4 text-sm text-emerald-200">{securityMsg}</div> : null}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className={`px-4 py-2 rounded-xl bg-white text-black font-bold ${
                    savingPassword ? "opacity-50 pointer-events-none" : ""
                  }`}
                  onClick={changePassword}
                >
                  {savingPassword ? "Updating..." : "Update password"}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "billing" ? (
            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xl font-bold">Plan & billing</div>
                    <div className="text-sm text-white/60 mt-1">Manage your plan and extra credits</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                      onClick={() => {
                        setPlansFilter("all");
                        setShowPlans(true);
                      }}
                    >
                      Upgrade plan
                    </button>

                    <button
                      type="button"
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                      onClick={() => {
                        setPlansFilter("annual");
                        setShowPlans(true);
                      }}
                    >
                      Change to annual billing
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid md:grid-cols-2 gap-4">
                  {/* Current Plan */}
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-sm text-white/60">Plan</div>
                    <div className="text-lg font-extrabold mt-1">{activePlanName}</div>
                    <div className="text-sm text-white/60 mt-1">Billed {periodLabel(sub?.billingPeriod)}</div>
                    {sub?.currentPeriodEnd ? (
                      <div className="text-sm text-white/60 mt-1">
                        Next payment: {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                      </div>
                    ) : null}
                  </div>

                  {/* Credits */}
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white/60">Credits</div>
                        <div className="text-2xl font-extrabold mt-1">{formatK(credits)}</div>
                        <div className="text-[11px] text-white/55 mt-1">
                          Plan {formatK(Number(wallet?.gen_plan_credits ?? 0))} · Extra {formatK(Number(wallet?.gen_topup_credits ?? 0))} · Bonus{" "}
                          {formatK(Number(wallet?.gen_bonus_credits ?? 0))}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-xs text-white/55">Activate auto-refill</div>
                        <button
                          type="button"
                          className={`w-12 h-7 rounded-full border border-white/15 p-1 transition-colors ${
                            me?.autoRefillEnabled ? "bg-emerald-500/50" : "bg-white/10"
                          } ${savingProfile ? "opacity-60 pointer-events-none" : ""}`}
                          onClick={() => toggleAutorefill(!me?.autoRefillEnabled)}
                          title="Auto-refill (solo preferencia UI por ahora)"
                        >
                          <div
                            className={`w-5 h-5 rounded-full bg-white transition-transform ${
                              me?.autoRefillEnabled ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {planLimit > 0 ? (
                      <div className="mt-4">
                        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-white/60" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-white/55 mt-2">
                          <span>Spent {formatK(spentPlanish)}</span>
                          <span>Limit {formatK(planLimit)}</span>
                        </div>
                        <div className="text-[11px] text-white/45 mt-1">Credits reset every billing period</div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-white/45 mt-4">No active plan limit detected.</div>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Extra credits</div>
                        <div className="text-xs text-white/55 mt-1">
                          Extra credits expire 3 years after the last purchase (mock).
                        </div>
                      </div>

                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                        onClick={() => setShowTopups((v) => !v)}
                      >
                        Buy extra credits
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
                        className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm opacity-60 cursor-not-allowed"
                        title="Coming soon"
                      >
                        Change billing information
                      </button>
                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm opacity-60 cursor-not-allowed"
                        title="Coming soon"
                      >
                        Billing history
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                  <div className="text-sm font-semibold text-red-200">Danger zone</div>
                  <div className="text-xs text-red-200/70 mt-1">Cancel a subscription</div>

                  <button
                    type="button"
                    className="mt-3 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-sm"
                    onClick={doCancelSubscription}
                  >
                    Cancel subscription
                  </button>
                </div>

                {/* Plans list (toggle) */}
                {showPlans ? (
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{plansFilter === "annual" ? "Annual plans" : "Plans"}</div>
                      <button
                        type="button"
                        className="text-sm text-white/70 hover:text-white"
                        onClick={() => setShowPlans(false)}
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {filteredPlans.map((pl) => {
                        const price = `$${Number(pl.price_cents / 100).toFixed(2)} USD`;
                        const per = periodLabel(pl.billing_period);
                        return (
                          <div
                            key={pl.id}
                            className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{pl.name}</div>
                              <div className="text-xs text-white/60 mt-1">
                                {per} · {price}
                              </div>
                              <div className="text-xs text-white/60">
                                Credits: {formatK(pl.plan_credits)} + Bonus: {formatK(pl.bonus_credits)}
                              </div>
                            </div>

                            <button
                              type="button"
                              className="shrink-0 px-3 py-2 rounded-xl bg-white text-black font-bold"
                              onClick={() => {
                                setConfirm({
                                  itemLabel: `Plan ${pl.name} (${per})`,
                                  amountLabel: price,
                                  note: `Esta compra es una suscripción ${per} recurrente hasta que canceles.`,
                                  action: async () => {
                                    await acceptLegal({
                                      termsVersion: TERMS_VERSION,
                                      privacyVersion: PRIVACY_VERSION,
                                      autopayVersion: AUTOPAY_VERSION,
                                    });
                                    await mockSubscribe(pl.slug);
                                    await refreshWallet();
                                    await loadAll();
                                  },
                                });
                              }}
                            >
                              Choose
                            </button>
                          </div>
                        );
                      })}

                      {!filteredPlans.length ? (
                        <div className="text-sm text-white/60">No plans found for this filter.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {/* Topups list (toggle) */}
                {showTopups ? (
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">Extra credits</div>
                      <button
                        type="button"
                        className="text-sm text-white/70 hover:text-white"
                        onClick={() => setShowTopups(false)}
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {topups.map((t) => {
                        const price = `$${Number(t.price_cents / 100).toFixed(2)} USD`;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className="p-3 rounded-xl bg-black/40 border border-white/10 hover:bg-white/10 text-left"
                            onClick={() => {
                              setConfirm({
                                itemLabel: `Créditos extra (${t.credits_amount} créditos)`,
                                amountLabel: price,
                                note: "Compra puntual. Requiere plan activo.",
                                action: async () => {
                                  await acceptLegal({
                                    termsVersion: TERMS_VERSION,
                                    privacyVersion: PRIVACY_VERSION,
                                    autopayVersion: AUTOPAY_VERSION,
                                  });
                                  await mockTopup(t.id);
                                  await refreshWallet();
                                  await loadAll();
                                },
                              });
                            }}
                          >
                            <div className="font-semibold">{t.name}</div>
                            <div className="text-xs text-white/60 mt-1">
                              {price} · +{formatK(t.credits_amount)} credits
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-xs text-white/50 mt-3">Nota: comprar créditos extra requiere plan activo.</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDollarPurchaseModal
        open={!!confirm}
        itemLabel={confirm?.itemLabel || ""}
        amountLabel={confirm?.amountLabel || ""}
        note={confirm?.note || null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await confirm.action();
        }}
      />
    </div>
  );
}