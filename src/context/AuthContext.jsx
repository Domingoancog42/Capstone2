import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { refreshSession } from "../services/api";
import { normalizeUser, SESSION_USER_KEY } from "../utils/roleRoutes";

const AuthContext = createContext(null);

/**
 * Keeps the browser's authentication state tied to the PHP session.
 *
 * localStorage is only a cache written for non-security UI helpers. It never supplies the provider's
 * initial user: session.php must confirm that the cookie-backed session is valid first.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const setAuthenticatedUser = useCallback((nextUser) => {
    const normalizedUser = normalizeUser(nextUser);

    if (!normalizedUser) {
      window.localStorage.removeItem(SESSION_USER_KEY);
      setUser(null);
      return null;
    }

    const serializedUser = JSON.stringify(normalizedUser);
    window.localStorage.setItem(SESSION_USER_KEY, serializedUser);
    setUser((currentUser) => (
      JSON.stringify(currentUser) === serializedUser ? currentUser : normalizedUser
    ));
    return normalizedUser;
  }, []);

  const clearAuthentication = useCallback(() => {
    window.localStorage.removeItem(SESSION_USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;

    // This request is the authority on authentication. A cached username or user object never is.
    Promise.resolve(refreshSession({ extend: true, allowAnonymous: true }))
      .then((result) => {
        if (!active) {
          return;
        }

        const sessionIsAuthenticated = result?.authenticated ?? Boolean(result?.user);

        if (sessionIsAuthenticated && result?.user) {
          setAuthenticatedUser(result.user);
        } else {
          clearAuthentication();
        }
      })
      .catch(() => {
        if (active) {
          clearAuthentication();
        }
      })
      .finally(() => {
        if (active) {
          setIsAuthLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [clearAuthentication, setAuthenticatedUser]);

  const value = useMemo(() => ({
    user,
    isAuthenticated: !isAuthLoading && Boolean(user),
    isAuthLoading,
    setAuthenticatedUser,
    clearAuthentication,
  }), [clearAuthentication, isAuthLoading, setAuthenticatedUser, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
