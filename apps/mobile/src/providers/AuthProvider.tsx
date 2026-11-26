import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { toAppError, type MembershipWithContext, type PermissionKey, type Profile } from '@klasora/shared';
import { supabase } from '@/lib/supabase';

export interface MobileSchool {
  id: string;
  name: string;
  slug: string;
  roles: MembershipWithContext['role'][];
}

interface AuthState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  schools: MobileSchool[];
  currentSchool: MobileSchool | null;
  permissions: Set<PermissionKey>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  selectSchool: (schoolId: string) => Promise<void>;
  /** Returns to the school list (for people in several schools). */
  clearSchool: () => void;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const MEMBERSHIP_SELECT = `
  id, school_id, role_id, status,
  school:schools ( id, name, slug ),
  role:roles!school_memberships_role_fk ( id, name, role_key, is_system_role )
`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schools, setSchools] = useState<MobileSchool[]>([]);
  const [currentSchoolId, setCurrentSchoolId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<PermissionKey>>(new Set());

  const loadPermissions = useCallback(async (schoolId: string) => {
    const { data, error } = await supabase.rpc('get_my_permissions', { p_school_id: schoolId });
    if (error) throw toAppError(error, { fallback: "We couldn't load your access for this school." });
    setPermissions(new Set((data ?? []) as PermissionKey[]));
  }, []);

  const loadWorkspace = useCallback(
    async (userId: string) => {
      const [profileRes, membershipRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('school_memberships').select(MEMBERSHIP_SELECT).eq('user_id', userId).eq('status', 'active'),
      ]);
      if (membershipRes.error) throw toAppError(membershipRes.error, { fallback: "We couldn't load your schools." });
      setProfile((profileRes.data as Profile | null) ?? null);

      const bySchool = new Map<string, MobileSchool>();
      for (const m of (membershipRes.data ?? []) as unknown as MembershipWithContext[]) {
        if (!m.school || !m.role) continue;
        const existing = bySchool.get(m.school.id);
        if (existing) existing.roles.push(m.role);
        else bySchool.set(m.school.id, { id: m.school.id, name: m.school.name, slug: m.school.slug, roles: [m.role] });
      }
      const list = [...bySchool.values()].sort((a, b) => a.name.localeCompare(b.name));
      setSchools(list);

      const only = list.length === 1 ? list[0] : undefined;
      if (only) {
        setCurrentSchoolId(only.id);
        await loadPermissions(only.id);
      }
    },
    [loadPermissions],
  );

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await loadWorkspace(data.session.user.id).catch(() => undefined);
      setReady(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setSchools([]);
        setCurrentSchoolId(null);
        setPermissions(new Set());
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadWorkspace]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      profile,
      schools,
      currentSchool: schools.find((s) => s.id === currentSchoolId) ?? null,
      permissions,
      async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw toAppError(error, { fallback: "We couldn't sign you in. Please try again." });
        setSession(data.session);
        await loadWorkspace(data.user.id);
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw toAppError(error, { fallback: "We couldn't send the reset email. Please try again shortly." });
      },
      async selectSchool(schoolId) {
        await loadPermissions(schoolId);
        setCurrentSchoolId(schoolId);
      },
      clearSchool() {
        setCurrentSchoolId(null);
        setPermissions(new Set());
      },
      async reload() {
        if (session) await loadWorkspace(session.user.id);
      },
    }),
    [ready, session, profile, schools, currentSchoolId, permissions, loadWorkspace, loadPermissions],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
