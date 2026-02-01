import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { backend } from '../services/backendService';

interface AuthContextType {
  user: User | null;
  login: (username: string) => Promise<void>;
  register: (username: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const currentUser = backend.auth.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string) => {
    setIsLoading(true);
    try {
      const u = await backend.auth.login(username);
      setUser(u);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (username: string) => {
    setIsLoading(true);
    try {
      const u = await backend.auth.register(username);
      setUser(u);
    } finally {
      setIsLoading(false);
    }
  }

  const logout = () => {
    backend.auth.logout();
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
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};