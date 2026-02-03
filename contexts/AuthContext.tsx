import React, { createContext, useContext, useEffect, useState } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { User as AppUser } from "../types";
import { supabase } from "../services/supabaseClient";

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

  const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
    username
  )}`;

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
