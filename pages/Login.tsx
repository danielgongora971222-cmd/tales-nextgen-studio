import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import Background3D from "../components/Background3D";

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Solo para registro (opcional)
  const [displayName, setDisplayName] = useState("");

  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const { login, register, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);
    setInfo(null);

    if (!email.trim() || !password.trim()) return;

    try {
      if (isRegistering) {
        const res = await register(email.trim(), password, displayName);
        if (res.needsEmailConfirmation) {
          setInfo(
            "Cuenta creada ✅ Ahora revisa tu correo para confirmar (si Supabase tiene Confirm Email activado)."
          );
        }
      } else {
        await login(email.trim(), password);
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    }
  };

  const canSubmit = Boolean(email.trim() && password.trim());

  return (
    <div className="relative w-full h-screen overflow-hidden flex items-center justify-center bg-black text-white font-sans">
      {/* Galaxy/Cosmos Grid Background */}
      <div className="absolute inset-0 z-0 opacity-60 pointer-events-none">
        <Background3D />
      </div>

      {/* Ambient Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none"></div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md p-8 glass-panel rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in duration-700 backdrop-blur-xl">
        <div className="text-center mb-10 relative">
          <div className="inline-block relative">
            <h1 className="text-5xl font-bold tracking-tighter mb-2 bg-gradient-to-br from-white via-gray-300 to-gray-500 bg-clip-text text-transparent">
              TALES
            </h1>
            <div className="absolute -top-2 -right-4 w-2 h-2 bg-white rounded-full animate-pulse shadow-[0_0_10px_white]"></div>
          </div>
          <p className="text-gray-400 text-sm font-mono tracking-widest uppercase opacity-70">
            NextGen Creative Studio
          </p>
        </div>

        {info && (
          <div className="mb-6 p-3 bg-emerald-900/30 border border-emerald-500/30 rounded-lg text-emerald-200 text-xs text-center animate-in slide-in-from-top-2">
            ✅ {info}
          </div>
        )}

        {error && (
          <div className="mb-6 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-red-200 text-xs text-center animate-in slide-in-from-top-2">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {isRegistering && (
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Display name (opcional)
              </label>
              <div className="relative group">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ej: Rafael"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                />
                <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors"></div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Email
            </label>
            <div className="relative group">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tuemail@gmail.com"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
                autoFocus
              />
              <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors"></div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Password
            </label>
            <div className="relative group">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-lg text-white focus:outline-none focus:border-white/50 focus:bg-black/60 transition-all placeholder-gray-600"
              />
              <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 pointer-events-none transition-colors"></div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !canSubmit}
            className={`w-full py-4 rounded-xl font-bold text-black text-sm tracking-wide uppercase transition-all shadow-lg ${
              isLoading || !canSubmit
                ? "bg-gray-800 cursor-not-allowed text-gray-500"
                : "bg-white hover:bg-gray-100 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            }`}
          >
            {isLoading
              ? isRegistering
                ? "CREATING ACCOUNT..."
                : "AUTHENTICATING..."
              : isRegistering
              ? "CREATE ACCOUNT"
              : "LOGIN"}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/5 text-center space-y-4">
          <p className="text-xs text-gray-400">
            {isRegistering ? "Already have an account?" : "New here?"}
          </p>

          <button
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError(null);
              setInfo(null);
              setEmail("");
              setPassword("");
              setDisplayName("");
            }}
            className="text-xs font-bold text-white border border-white/20 px-6 py-2 rounded-full hover:bg-white hover:text-black transition-all"
          >
            {isRegistering ? "LOGIN INSTEAD" : "CREATE ACCOUNT"}
          </button>
        </div>

        <div className="mt-6 text-[10px] text-gray-600 text-center font-mono">
          SECURE CONNECTION ESTABLISHED
        </div>
      </div>
    </div>
  );
};

export default Login;
