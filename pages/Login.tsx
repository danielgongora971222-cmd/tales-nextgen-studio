import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../services/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

type ToastType = "success" | "error" | "info";

export default function Login() {
  const { isLoading } = useAuth();

  const [view, setView] = useState<"login" | "register" | "verify">("login");

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [otpCode, setOtpCode] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<{ type: ToastType; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(type: ToastType, text: string) {
    setToast({ type, text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    // Si ya hay sesión, manda al home
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/");
    });
  }, []);

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
        const msg = (error.message || "").toLowerCase();

        if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
          showToast("info", "Tu correo no está confirmado. Te envío un código.");
          await requestOtp(false);
          setView("verify");
          return;
        }

        if (msg.includes("invalid") || msg.includes("login")) {
          showToast("error", "Correo o contraseña incorrectos.");
          return;
        }

        showToast("error", error.message);
        return;
      }

      showToast("success", "Login correcto ✅");
      window.location.replace("/");
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

    setSubmitting(true);
    try {
      await requestOtp(true);
      showToast("success", "Cuenta creada. Revisa tu correo: te llegó un código ✅");
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

      // Ya verificado → ponemos contraseña + nombre visible
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { display_name: displayName?.trim() || null },
      });

      if (updateError) {
        showToast("error", updateError.message);
        return;
      }

      showToast("success", "Correo confirmado ✅ Ahora inicia sesión.");
      await supabase.auth.signOut();

      setOtpCode("");
      setPassword("");
      setPassword2("");
      setView("login");
    } catch (err: any) {
      showToast("error", err?.message || "No se pudo confirmar el código.");
    } finally {
      setSubmitting(false);
    }
  }

  const toastBg =
    toast?.type === "success"
      ? "bg-green-600"
      : toast?.type === "error"
      ? "bg-red-600"
      : "bg-blue-600";

  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold">
          {view === "login" && "Iniciar sesión"}
          {view === "register" && "Crear cuenta"}
          {view === "verify" && "Confirmar correo (código)"}
        </h1>

        {toast && (
          <div className={`mb-4 rounded-md px-3 py-2 text-white ${toastBg}`}>{toast.text}</div>
        )}

        {view === "login" && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Correo</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Contraseña</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-black px-3 py-2 text-white disabled:opacity-60"
              disabled={isLoading || submitting}
            >
              {submitting ? "Entrando..." : "Entrar"}
            </button>

            <div className="text-center text-sm">
              ¿No tienes cuenta?{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  resetForm();
                  setView("register");
                }}
              >
                Crear cuenta
              </button>
            </div>
          </form>
        )}

        {view === "register" && (
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Nombre visible</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Tu nombre"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Correo</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Contraseña</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Repetir contraseña</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-black px-3 py-2 text-white disabled:opacity-60"
              disabled={isLoading || submitting}
            >
              {submitting ? "Creando..." : "Crear cuenta"}
            </button>

            <div className="text-center text-sm">
              ¿Ya tienes cuenta?{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  resetForm();
                  setView("login");
                }}
              >
                Iniciar sesión
              </button>
            </div>
          </form>
        )}

        {view === "verify" && (
          <form onSubmit={handleVerifySubmit} className="space-y-4">
            <div className="text-sm text-zinc-600">
              Te envié un código a: <b>{email.trim()}</b>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Código</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Ej: 123456"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-black px-3 py-2 text-white disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? "Confirmando..." : "Confirmar"}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                className="w-1/2 rounded-md border px-3 py-2"
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
              >
                Reenviar código
              </button>

              <button
                type="button"
                className="w-1/2 rounded-md border px-3 py-2"
                disabled={submitting}
                onClick={() => {
                  setOtpCode("");
                  setView("login");
                  showToast("info", "Vuelve a iniciar sesión cuando quieras.");
                }}
              >
                Volver
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
