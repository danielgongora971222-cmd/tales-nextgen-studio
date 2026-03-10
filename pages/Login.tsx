// pages/Login.tsx
import React, { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Background3D from "../components/Background3D";
import { supabase } from "../services/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

type ToastType = "success" | "error" | "info";

type LoginProps = {
  mode?: "page" | "modal";
  onClose?: () => void;
};

export default function Login({ mode = "page", onClose }: LoginProps) {
  const { isLoading } = useAuth();

  const [view, setView] = useState<"login" | "register" | "verify">("login");
  const [verifyMode, setVerifyMode] = useState<"login" | "register">("login");

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [otpCode, setOtpCode] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<{ type: ToastType; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);

  function finishAuthFlow() {
    if (mode === "modal") {
      onClose?.();
      return;
    }
    window.location.replace("/");
  }

  function showToast(type: ToastType, text: string) {
    setToast({ type, text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      if (mode === "modal") {
        onClose?.();
        return;
      }
      window.location.replace("/");
    });
  }, [mode, onClose]);

  function resetForm() {
    setDisplayName("");
    setEmail("");
    setPassword("");
    setPassword2("");
    setOtpCode("");
  }

  async function requestOtp(shouldCreateUser: boolean) {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser,
        data: { display_name: displayName?.trim() || null },
      },
    });
    if (error) throw error;
  }

  function friendlyAuthError(msgRaw: string) {
    const msg = (msgRaw || "").toLowerCase();

    if (msg.includes("invalid login") || msg.includes("invalid") || msg.includes("login")) {
      return "Correo o contraseña incorrectos.";
    }
    if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
      return "Tu correo no está confirmado. Te envío un código.";
    }
    if (msg.includes("rate limit")) {
      return "Demasiados intentos. Espera un momento y vuelve a intentar.";
    }
    return msgRaw || "Error de autenticación.";
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email.trim()) return showToast("error", "Escribe tu correo.");
    if (!password) return showToast("error", "Escribe tu contraseña.");

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const friendly = friendlyAuthError(error.message);

        if (friendly.includes("Te envío un código")) {
          showToast("info", friendly);
          await requestOtp(false);
          setVerifyMode("login");
          setView("verify");
          return;
        }

        showToast("error", friendly);
        return;
      }

      showToast("success", "Login correcto ✅");
      finishAuthFlow();
    } catch (err: any) {
      showToast("error", err?.message || "Error iniciando sesión.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterSubmit(e: FormEvent) {
    e.preventDefault();

    if (!displayName.trim()) return showToast("error", "Escribe tu nombre visible.");
    if (!email.trim()) return showToast("error", "Escribe tu correo.");
    if (!password) return showToast("error", "Escribe tu contraseña.");
    if (!password2) return showToast("error", "Repite tu contraseña.");
    if (password !== password2) return showToast("error", "Las contraseñas no coinciden.");
    if (password.length < 8) return showToast("error", "Usa una contraseña de al menos 8 caracteres.");

    setSubmitting(true);
    try {
      await requestOtp(true);
      showToast("success", "Cuenta creada ✅ Te llegó un código al correo.");
      setVerifyMode("register");
      setView("verify");
    } catch (err: any) {
      showToast("error", err?.message || "No se pudo crear la cuenta.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySubmit(e: FormEvent) {
    e.preventDefault();

    if (!email.trim()) return showToast("error", "Falta el correo.");
    if (!otpCode.trim()) return showToast("error", "Escribe el código que te llegó por correo.");

    if (verifyMode === "register") {
      if (!password) return showToast("error", "Falta la contraseña.");
      if (!password2) return showToast("error", "Repite la contraseña.");
      if (password !== password2) return showToast("error", "Las contraseñas no coinciden.");
    }

    setSubmitting(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "email",
      });

      if (verifyError) {
        showToast("error", verifyError.message);
        return;
      }

      if (verifyMode === "register") {
        const { error: updateError } = await supabase.auth.updateUser({
          password,
          data: { display_name: displayName?.trim() || null },
        });

        if (updateError) {
          showToast("error", updateError.message);
          return;
        }

        showToast("success", "Correo confirmado ✅ ¡Bienvenido!");
        finishAuthFlow();
        return;
      }

      showToast("success", "Correo confirmado ✅");
      finishAuthFlow();
    } catch (err: any) {
      showToast("error", err?.message || "No se pudo confirmar el código.");
    } finally {
      setSubmitting(false);
    }
  }

  const toastClass =
    toast?.type === "success"
      ? "bg-emerald-900/30 border-emerald-500/30 text-emerald-200"
      : toast?.type === "error"
      ? "bg-red-900/30 border-red-500/30 text-red-200"
      : "bg-blue-900/30 border-blue-500/30 text-blue-200";

  const canSubmitLogin = Boolean(email.trim() && password);
  const canSubmitRegister = Boolean(displayName.trim() && email.trim() && password && password2);
  const isModal = mode === "modal";

  return (
    <div
      className={
        isModal
          ? "fixed inset-0 z-[140] overflow-y-auto bg-black/78 px-4 py-[max(env(safe-area-inset-top),16px)] pb-[calc(env(safe-area-inset-bottom)+16px)] backdrop-blur-md"
          : "relative flex min-h-screen w-full items-start justify-center overflow-y-auto bg-black px-4 py-10 text-white font-sans md:items-center"
      }
      onClick={isModal ? onClose : undefined}
    >
      {!isModal && (
        <>
          <div className="absolute inset-0 z-0 opacity-60 pointer-events-none">
            <Background3D />
          </div>
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none" />
        </>
      )}

      <div
        className="relative z-10 mx-auto w-full max-w-[min(100%,34rem)] overflow-y-auto rounded-[32px] border border-white/10 bg-[rgba(0,0,0,0.82)] p-6 text-white shadow-[0_0_50px_rgba(0,0,0,0.5)] backdrop-blur-xl md:p-8"
        style={
          isModal
            ? { maxHeight: "calc(100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.5rem)" }
            : undefined
        }
        onClick={isModal ? (e) => e.stopPropagation() : undefined}
      >
        {isModal && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Cerrar login"
            title="Cerrar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}

        <div className="text-center mb-6 relative">
          <div className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-[26px] border border-white/10 bg-white/5 shadow-[0_16px_40px_rgba(0,0,0,0.42)]">
            <img
              src="/branding/tales-logo.png"
              alt="Tales.AI"
              className="h-full w-full object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const fallback = e.currentTarget.nextElementSibling as HTMLSpanElement | null;
                if (fallback) fallback.style.display = "inline-flex";
              }}
            />
            <span className="hidden h-full w-full items-center justify-center text-2xl font-black tracking-tight">TALES</span>
          </div>

          <p className="mt-5 text-sm font-mono uppercase tracking-[0.35em] text-white/42">Welcome to</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Tales.AI</h1>
          <p className="mt-3 text-sm leading-6 text-white/62">
            Crea imágenes y video con un flujo más estable, más claro y preparado para crecer contigo.
          </p>
        </div>

        <div className="mb-6 rounded-[24px] border border-[rgba(241,225,148,0.14)] bg-[linear-gradient(145deg,rgba(91,14,20,0.24),rgba(0,0,0,0.54))] px-4 py-4 shadow-[0_20px_44px_rgba(0,0,0,0.34)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/46">Studio access</div>
          <div className="mt-2 text-lg font-bold text-white">Activa tu cuenta y tus créditos</div>
          <div className="mt-2 text-sm leading-6 text-white/62">
            Desde aquí podrás entrar a Design Studio, Creator Hub, My Assets, My Trades y las siguientes capas premium del producto.
          </div>
        </div>

        {toast && (
          <div className={`mb-6 p-3 border rounded-lg text-xs text-center animate-in slide-in-from-top-2 ${toastClass}`}>
            {toast.type === "success" ? "✅ " : toast.type === "error" ? "⚠️ " : "ℹ️ "}
            {toast.text}
          </div>
        )}

        {view === "login" && (
          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Email</label>
              <div className="relative group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tuemail@gmail.com"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                  autoFocus
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Password</label>
              <div className="relative group">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || submitting || !canSubmitLogin}
              className={`w-full py-4 rounded-xl font-bold text-black text-sm tracking-wide uppercase transition-all shadow-lg ${
                isLoading || submitting || !canSubmitLogin
                  ? "bg-gray-800 cursor-not-allowed text-gray-500"
                  : "bg-white hover:bg-gray-100 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
              }`}
            >
              {submitting ? "ENTERING STUDIO..." : "LOGIN"}
            </button>

            <div className="mt-4 pt-6 border-t border-white/5 text-center space-y-4">
              <p className="text-xs text-gray-400">Don't have an account?</p>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setView("register");
                }}
                className="text-xs font-bold text-white border border-white/20 px-6 py-2 rounded-full hover:bg-white hover:text-black transition-all"
              >
                CREATE ACCOUNT
              </button>
            </div>
          </form>
        )}

        {view === "register" && (
          <form onSubmit={handleRegisterSubmit} className="space-y-6">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Display name
              </label>
              <div className="relative group">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ej: Rafael"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                  autoFocus
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Email</label>
              <div className="relative group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tuemail@gmail.com"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Password</label>
              <div className="relative group">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Repeat password
              </label>
              <div className="relative group">
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || submitting || !canSubmitRegister}
              className={`w-full py-4 rounded-xl font-bold text-black text-sm tracking-wide uppercase transition-all shadow-lg ${
                isLoading || submitting || !canSubmitRegister
                  ? "bg-gray-800 cursor-not-allowed text-gray-500"
                  : "bg-white hover:bg-gray-100 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
              }`}
            >
              {submitting ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
            </button>

            <div className="mt-4 pt-6 border-t border-white/5 text-center space-y-4">
              <p className="text-xs text-gray-400">Already have an account?</p>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setView("login");
                }}
                className="text-xs font-bold text-white border border-white/20 px-6 py-2 rounded-full hover:bg-white hover:text-black transition-all"
              >
                LOGIN INSTEAD
              </button>
            </div>
          </form>
        )}

        {view === "verify" && (
          <form onSubmit={handleVerifySubmit} className="space-y-6">
            <div className="text-xs text-gray-400 text-center">
              Te envié un código a: <span className="text-white font-bold">{email.trim()}</span>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Código</label>
              <div className="relative group">
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="Ej: 123456"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                  autoFocus
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors" />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={`w-full py-4 rounded-xl font-bold text-black text-sm tracking-wide uppercase transition-all shadow-lg ${
                submitting
                  ? "bg-gray-800 cursor-not-allowed text-gray-500"
                  : "bg-white hover:bg-gray-100 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
              }`}
            >
              {submitting ? "CONFIRMING..." : "CONFIRM CODE"}
            </button>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  try {
                    setSubmitting(true);
                    await requestOtp(false);
                    showToast("success", "Código reenviado ✅");
                  } catch (err: any) {
                    showToast("error", err?.message || "No se pudo reenviar el código.");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="w-1/2 py-3 rounded-xl font-bold text-xs tracking-wide uppercase border border-white/20 text-white hover:bg-white hover:text-black transition-all disabled:opacity-60"
              >
                RESEND
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setOtpCode("");
                  setView(verifyMode === "register" ? "register" : "login");
                  showToast("info", "Puedes intentar de nuevo cuando quieras.");
                }}
                className="w-1/2 py-3 rounded-xl font-bold text-xs tracking-wide uppercase border border-white/20 text-white hover:bg-white hover:text-black transition-all disabled:opacity-60"
              >
                BACK
              </button>
            </div>

            <div className="mt-2 text-[10px] text-gray-600 text-center font-mono">
              SECURE CONNECTION ESTABLISHED
            </div>
          </form>
        )}

        {view !== "verify" && (
          <div className="mt-6 text-[10px] text-gray-600 text-center font-mono">
            SECURE CONNECTION ESTABLISHED
          </div>
        )}
      </div>
    </div>
  );
}
