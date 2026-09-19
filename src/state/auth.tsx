/**
 * DENSEN — Client auth state (Day 2).
 * ====================================
 * Session strategy: the RAW session token lives ONLY in React state (memory).
 * It is never written to localStorage/sessionStorage/cookies — storage XSS
 * cannot steal a session. A refresh signs the user out (documented prototype
 * tradeoff; hardened transport wiring is a later step in AUTH-PLAN.md §9).
 * All server state comes from `auth.getSessionByToken` (server-validated,
 * non-PII viewer). Role and band feed the existing age-aware safety gates.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export interface Viewer {
  userId: string;
  role: string;
  userStatus: string;
  isMinor: boolean;
  ageBand: string;
  emailVerified: boolean;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface AuthContextShape {
  sessionToken: string | null;
  viewer: Viewer | null;
  /** true while the initial session check is in flight. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextShape | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const result = useQuery(api.auth.getSessionByToken, sessionToken ? { sessionToken } : "skip");

  const doSignOut = useMutation(api.auth.signOut);

  useEffect(() => {
    if (result !== undefined) setLoading(false);
  }, [result]);

  const viewer: Viewer | null =
    result && typeof result === "object" && "valid" in result && result.valid && "viewer" in result
      ? (result.viewer as Viewer)
      : null;

  // A server-side invalidated/expired session clears the local token immediately.
  useEffect(() => {
    if (result && typeof result === "object" && "valid" in result && !result.valid && sessionToken) {
      setSessionToken(null);
    }
  }, [result, sessionToken]);

  const doSignIn = useMutation(api.auth.signIn);
  const signIn = useCallback(
    async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await doSignIn({ email, password });
        if (res?.ok) {
          setSessionToken(res.sessionToken);
          return { ok: true };
        }
        // One generic error for unknown-email/bad-password/locked (anti-enumeration).
        return { ok: false, error: "invalid_credentials" };
      } catch {
        return { ok: false, error: "network" };
      }
    },
    [doSignIn]
  );

  const signOut = useCallback(async () => {
    try {
      if (sessionToken) await doSignOut({ sessionToken });
    } finally {
      setSessionToken(null);
    }
  }, [doSignOut, sessionToken]);

  const value = useMemo(
    () => ({ sessionToken, viewer, loading, signIn, signOut }),
    [sessionToken, viewer, loading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Protected-route wrapper: redirects to /login preserving the intended path. */
export function RequireAuth({ children, returnTo }: { children: ReactNode; returnTo?: string }) {
  const { viewer, loading } = useContext(AuthContext)!;
  const nav = useNavigateNext();
  if (loading) return null;
  if (!viewer) {
    const target = returnTo ?? window.location.hash.replace(/^#/, "");
    nav(`/login?returnTo=${encodeURIComponent(target)}`);
    return null;
  }
  return <>{children}</>;
}

// Local import shim so the file stays self-contained.
import { useNavigate as useNavigateNext } from "react-router-dom";

export function useAuth(): AuthContextShape {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
