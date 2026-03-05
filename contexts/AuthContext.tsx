import React, { createContext, useContext, useEffect, useState } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { User as AppUser } from "../types";
import { supabase } from "../services/supabaseClient";
import { profileMe } from "../services/profileApi";
import { EVENT_PROFILE_REFRESH } from "../services/appEvents";

// ✅ Prefetch para “calentar” caches (assets + elements)
import { listMyAssets } from "../services/assetsApi";
import { listKlingElements } from "../services/klingElementsService";

interface AuthContextType {
  user: AppUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toAppUser(u: SupabaseUser): AppUser {
  const meta = (u.user_metadata || {}) as any;
  const usernameRaw =
    (meta.username || meta.display_name || "").toString().trim();

  const username =
    usernameRaw || (u.email ? u.email.split("@")[0] : "user");

  const avatarFromMeta = meta.avatar_url ? String(meta.avatar_url) : "";

  const avatarUrl =
    avatarFromMeta ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;

  return { id: u.id, username, avatarUrl };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      const su = data.session?.user ?? null;
      setUser(su ? toAppUser(su) : null);
      setIsLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const su = session?.user ?? null;
      setUser(su ? toAppUser(su) : null);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ✅ Hidrata avatar firmado (y displayName) desde backend cuando exista session
  // - Evita depender de URLs firmadas guardadas en user_metadata
  // - Se refresca también cuando emitimos EVENT_PROFILE_REFRESH
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const run = async () => {
      try {
        const p = await profileMe();
        if (cancelled) return;

        setUser((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            username: p.displayName || prev.username,
            avatarUrl: p.avatarUrl || prev.avatarUrl,
          };
        });
      } catch {
        // Silencio: si backend no está listo, mantenemos fallback (dicebear)
      }
    };

    run();

    const handler = () => run();
    window.addEventListener(EVENT_PROFILE_REFRESH, handler as any);

    return () => {
      cancelled = true;
      window.removeEventListener(EVENT_PROFILE_REFRESH, handler as any);
    };
  }, [user?.id]);

    // ✅ Prefetch en background tras login: calienta caches para tools/pickers
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    // Pequeño delay para no competir con el primer render post-login
    const t = setTimeout(() => {
      if (cancelled) return;

      Promise.allSettled([
        // Prefetch alineado con tools/pickers para evitar recargas al navegar
        listMyAssets({ type: "image", limit: 500 }),
        listMyAssets({ type: "video", limit: 300 }),
        listKlingElements(),
      ]).catch(() => {
        // silencio: prefetch no debe romper el login
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user?.id]);


  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      const su = data.user;
      setUser(su ? toAppUser(su) : null);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, password: string, displayName?: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: displayName?.trim() ? displayName.trim() : undefined,
          },
        },
      });
      if (error) throw error;

      // Si Supabase tiene "Confirm email" activado, NO te loguea al instante.
      const needsEmailConfirmation = !data.session;

      const su = data.session?.user ?? null;
      setUser(su ? toAppUser(su) : null);

      return { needsEmailConfirmation };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
