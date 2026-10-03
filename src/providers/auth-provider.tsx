import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/db";
import type { HrProfile } from "@/lib/types";

const REMEMBER_KEY = "hr-signal-remember";
interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: HrProfile | null;
  loading: boolean;
  signIn: (email: string, password: string, remember: boolean) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<HrProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("hr_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load HR profile", error.message);
      setProfile(null);
      return;
    }
    setProfile((data as HrProfile | null) ?? null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await loadProfile(user.id);
  }, [loadProfile, user?.id]);

  useEffect(() => {
    // Register the listener BEFORE restoring the session so the initial
    // session restore can never be missed.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        // Deferred: calling the client directly inside this callback deadlocks it.
        setTimeout(() => {
          void loadProfile(nextSession.user.id);
        }, 0);
      } else {
        setProfile(null);
      }
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const restored = data.session ?? null;

      // "Remember me" off means the session must not survive a browser restart or
      // be reused from another tab. The flag is device-scoped (local storage) so a
      // remembered session keeps working across tabs.
      if (restored && localStorage.getItem(REMEMBER_KEY) !== "1") {
        await supabase.auth.signOut({ scope: "local" });
        setSession(null);
        setUser(null);
        setProfile(null);
      } else {
        setSession(restored);
        setUser(restored?.user ?? null);
        if (restored?.user) await loadProfile(restored.user.id);
      }
      setLoading(false);
    })();

    return () => subscription.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      if (remember) localStorage.setItem(REMEMBER_KEY, "1");
      else localStorage.removeItem(REMEMBER_KEY);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        return { error: "Incorrect email or password. Please try again." };
      }

      if (data.user) {
        await loadProfile(data.user.id);
        // Authentication events are recorded for audit.
        void supabase.from("hr_audit_log").insert({
          actor_id: data.user.id,
          actor_email: data.user.email,
          entity_type: "auth",
          entity_id: data.user.id,
          action: "login",
          after_json: { email: data.user.email },
          session_meta: { remembered: remember, user_agent: navigator.userAgent },
        });
        void supabase
          .from("hr_profiles")
          .update({ last_login_at: new Date().toISOString() })
          .eq("user_id", data.user.id);
      }

      return { error: null };
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    if (user?.id) {
      void supabase.from("hr_audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        entity_type: "auth",
        entity_id: user.id,
        action: "logout",
        session_meta: { user_agent: navigator.userAgent },
      });
    }
    localStorage.removeItem(REMEMBER_KEY);
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setUser(null);
  }, [user?.id, user?.email]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, session, profile, loading, signIn, signOut, refreshProfile }),
    [user, session, profile, loading, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

/** Default landing route for each role. */
export const ROLE_HOME: Record<string, string> = {
  founder: "/executive",
  hr: "/dashboard",
};
