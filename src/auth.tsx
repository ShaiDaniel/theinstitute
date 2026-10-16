// Who is looking: the signed-in Google account (if any) and their member profile (if they made one).
import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth } from './firebase';
import { loadMember, type Member } from './members';

interface Session {
  /** False until Firebase has said whether someone is signed in. */
  ready: boolean;
  user: User | null;
  member: Member | null;
  reloadMember: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        try {
          setMember(u ? await loadMember(u.uid) : null);
        } catch {
          setMember(null);
        }
        setReady(true);
      }),
    [],
  );

  const reloadMember = useCallback(async () => {
    const u = auth.currentUser;
    setMember(u ? await loadMember(u.uid) : null);
  }, []);

  return <SessionContext.Provider value={{ ready, user, member, reloadMember }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
