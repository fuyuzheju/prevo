import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "../lib/api.ts";
import type { AuthUser } from "../lib/types.ts";
import { clearToken, getToken, setToken } from "../lib/storage.ts";

interface AuthContextValue {
  user: AuthUser | null;
  initializing: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const token = await api.login(username, password);
    setToken(token);
    setUser(await api.me());
  }, []);

  useEffect(() => {
    api.setUnauthorizedHandler(logout);
    if (!getToken()) {
      setInitializing(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setInitializing(false));
  }, [logout]);

  const value = useMemo(() => ({ user, initializing, login, logout }), [user, initializing, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
