import React, { useEffect, useRef, useState } from "react";
import { AppRoute } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";
import { apiUrl } from "../services/apiBase";
import { supabase } from "../services/supabaseClient";
import { profileMe, type ProfileMeResponse } from "../services/profileApi";
import { billingMe, mockCancel } from "../services/billingApi";
import { emitProfileRefresh, emitWalletRefresh } from "../services/appEvents";

type TabKey = "profile" | "security" | "billing";

export default function Profile({ onNavigate }: { onNavigate: (r: AppRoute) => void }) {
  const { user } = useAuth();
  const { refresh: refreshWallet } = useWallet();

  const [tab, setTab] = useState<TabKey>("profile");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [me, setMe] = useState<ProfileMeResponse | null>(null);
  const [sub, setSub] = useState<any | null>(null);

  const [displayName, setDisplayName] = useState<string>(user?.username || "");
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const [passMsg, setPassMsg] = useState<string>("");

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

  async function loadAll() {
    setLoading(true);
    setErr("");

    const [pR, sR] = await Promise.allSettled([profileMe(), billingMe()]);

    if (pR.status === "fulfilled") {
      setMe(pR.value);
      setDisplayName(pR.value.displayName || user?.username || "");
    } else {
      setErr(pR.reason?.message || "No se pudo cargar tu perfil.");
    }

    if (sR.status === "fulfilled") setSub(sR.value || null);

    setLoading(false);
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

  async function cancelSubscription() {
    const ok = window.confirm("Esto cancelará tu plan. ¿Deseas continuar?");
    if (!ok) return;

    setErr("");
    try {
      await mockCancel();
      emitWalletRefresh();
      await refreshWallet();
      setSub((await billingMe()) || null);
    } catch (e: any) {
      setErr(e?.message || "No se pudo cancelar el plan.");
    }
  }

  const avatarSrc = me?.avatarUrl || avatarPreview || user?.avatarUrl || "";
  const email = me?.email || "";
  const handle = email ? email.split("@")[0] : "";

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
          onClick={loadAll}
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
        >
          Refresh
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
              {sub?.currentPeriodEnd ? (
                <div className="text-sm text-white/60 mt-1">Next renewal: {new Date(sub.currentPeriodEnd).toLocaleDateString()}</div>
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
                <button type="button" className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm opacity-60 cursor-not-allowed" title="Coming soon">
                  Change billing information
                </button>
                <button type="button" className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm opacity-60 cursor-not-allowed" title="Coming soon">
                  Billing history
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="text-sm font-semibold text-red-200">Danger zone</div>
              <div className="text-xs text-red-200/70 mt-1">Cancel a subscription</div>

              <button
                type="button"
                className="mt-3 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-sm"
                onClick={() => void cancelSubscription()}
              >
                Cancel subscription
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}