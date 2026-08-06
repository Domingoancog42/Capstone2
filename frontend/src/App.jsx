import React, { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { Toaster } from "react-hot-toast";
import Login from "./components/UI_Login/login";
import AdminDashboard from "./page/Admin/AdminDashboard";
import ChiefDashboard from "./page/Chief/chiefdashboard";
import EmployeeDashboard from "./page/Employee/employeedashboard";
import HrheadDashboard from "./page/HRHead/Hrheaddashboard";
import HrstaffDashboard from "./page/HRStaff/Hrstaffdashboard";
import RegionalDashboard from "./page/Regionaldirector/RegionalDashboard";
import {
  getDefaultPathForRole,
  isPathAllowedForRole,
  normalizePath,
  normalizeUser,
  MANAGED_USER_ROLE_KEYS,
  readStoredUser,
  resolveBaseRole,
  SESSION_USER_KEY,
} from "./utils/roleRoutes";
import { AUTH_SESSION_EXPIRED_EVENT, getPublicSettings, logout, refreshSession } from "./services/api";
import { startLiveUpdates, stopLiveUpdates } from "./services/liveUpdatesService";
import { useAutoRefreshOnChange } from "./components/auto/autorefreshdatalist";
import { applyTheme, initializeTheme } from "./components/darkmode/darkmodetoggle";

/**
 * The one and only toast outlet for the app.
 *
 * react-hot-toast keeps its toasts, timers, and — critically — its `pausedAt` flag in a single
 * module-level store that every mounted `<Toaster>` shares. A second outlet therefore renders a
 * duplicate of every toast and drives that shared pause state from its own hover handlers: when a
 * duplicate is removed or reflows under the cursor its `mouseleave` never fires, `pausedAt` stays
 * set, and the dismissal effect bails out (`if (pausedAt) return`) for every toast from then on.
 * That is the "toasts never disappear" bug. Mount this here and nowhere else.
 *
 * `top: 72` clears the fixed 64px header the dashboards render.
 */
const APP_TOASTER_PROPS = {
  position: "top-right",
  containerStyle: { top: 72, right: 24, zIndex: 99999 },
  toastOptions: { duration: 4500 },
};

const supportedRoles = ["admin", ...MANAGED_USER_ROLE_KEYS];
const SESSION_TIMEOUT_WARNING_SECONDS = 30;

function sessionTimeoutWarningHtml(seconds) {
  return `
    <div style="display:grid; gap:14px; color:#4b5563; font-size:17px; line-height:1.5;">
      <p style="margin:0;">You have been inactive for a while.</p>
      <p style="margin:0;">Your session will end in <strong id="session-timeout-countdown">${seconds}</strong> seconds.</p>
    </div>
  `;
}

export default function App() {
  const [user, setUser] = useState(readStoredUser);
  const [sessionHydrated, setSessionHydrated] = useState(() => !readStoredUser());
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname));
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30);
  const userId = user?.id ?? null;

  useEffect(() => {
    const handlePopState = () => setCurrentPath(normalizePath(window.location.pathname));

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((path, { replace = false } = {}) => {
    const nextPath = normalizePath(path);

    if (window.location.pathname !== nextPath) {
      if (replace) {
        window.history.replaceState({}, "", nextPath);
      } else {
        window.history.pushState({}, "", nextPath);
      }
    }

    setCurrentPath(nextPath);
  }, []);

  const handleLogin = (nextUser) => {
    const normalizedUser = normalizeUser(nextUser);
    window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(normalizedUser));
    initializeTheme();
    setUser(normalizedUser);
    navigate(
      getDefaultPathForRole(normalizedUser?.roleKey, normalizedUser?.baseRoleKey),
      { replace: true }
    );
  };

  const handleLogout = useCallback(() => {
    window.localStorage.removeItem(SESSION_USER_KEY);
    applyTheme("light");
    setUser(null);
    navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const storedUser = readStoredUser();

    if (!storedUser) {
      setSessionHydrated(true);
      return undefined;
    }

    let active = true;

    refreshSession()
      .then((result) => {
        if (!active) {
          return;
        }

        const normalizedUser = normalizeUser(result.user);
        window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(normalizedUser));
        initializeTheme();
        setUser(normalizedUser);
      })
      .catch(() => {
        if (active) {
          handleLogout();
        }
      })
      .finally(() => {
        if (active) {
          setSessionHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, [handleLogout]);

  useEffect(() => {
    const handleSessionExpired = () => {
      handleLogout();
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [handleLogout]);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    let mounted = true;

    getPublicSettings()
      .then((result) => {
        if (!mounted) {
          return;
        }

        const timeout = Number(result.security?.sessionTimeoutMinutes || result.sessionTimeoutMinutes);
        setSessionTimeoutMinutes(Number.isFinite(timeout) && timeout > 0 ? timeout : 30);
      })
      .catch(() => {
        if (mounted) {
          setSessionTimeoutMinutes(30);
        }
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const timeoutMs = Math.max(1, Number(sessionTimeoutMinutes) || 30) * 60 * 1000;
    const warningMs = Math.min(SESSION_TIMEOUT_WARNING_SECONDS * 1000, Math.max(1000, timeoutMs));
    const warningDelayMs = Math.max(0, timeoutMs - warningMs);
    const activityEvents = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    let warningTimerId = null;
    let countdownIntervalId = null;
    let warningVisible = false;
    let expired = false;
    let cleanedUp = false;
    let lastSessionRefreshAt = Date.now();

    const clearWarningTimer = () => {
      if (warningTimerId !== null) {
        window.clearTimeout(warningTimerId);
        warningTimerId = null;
      }
    };

    const clearCountdownTimer = () => {
      if (countdownIntervalId !== null) {
        window.clearInterval(countdownIntervalId);
        countdownIntervalId = null;
      }
    };

    const expireSession = () => {
      if (expired) {
        return;
      }

      expired = true;
      clearWarningTimer();
      clearCountdownTimer();
      logout().catch(() => {});
      if (!cleanedUp) {
        handleLogout();
      }
    };

    const refreshBackendSessionAfterActivity = () => {
      const now = Date.now();
      const refreshIntervalMs = Math.min(60_000, Math.max(10_000, Math.floor(timeoutMs / 4)));

      if (now - lastSessionRefreshAt < refreshIntervalMs) {
        return;
      }

      lastSessionRefreshAt = now;
      refreshSession().catch(() => {});
    };

    const scheduleWarning = () => {
      clearWarningTimer();
      warningTimerId = window.setTimeout(() => {
        if (expired || cleanedUp || warningVisible) {
          return;
        }

        warningVisible = true;

        Swal.fire({
          title: "Session timeout warning",
          html: sessionTimeoutWarningHtml(Math.ceil(warningMs / 1000)),
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Stay Logged In",
          cancelButtonText: "Log Out",
          confirmButtonColor: "#2563eb",
          cancelButtonColor: "#6b7280",
          allowOutsideClick: false,
          allowEscapeKey: false,
          timer: warningMs,
          timerProgressBar: true,
          didOpen: () => {
            const updateCountdown = () => {
              const secondsLeft = Math.max(0, Math.ceil((Swal.getTimerLeft() || 0) / 1000));
              const countdownElement = document.getElementById("session-timeout-countdown");

              if (countdownElement) {
                countdownElement.textContent = String(secondsLeft);
              }
            };

            updateCountdown();
            countdownIntervalId = window.setInterval(updateCountdown, 250);
          },
          willClose: () => {
            clearCountdownTimer();
          },
          customClass: {
            popup: "rounded-[0.35rem]",
            title: "text-slate-700",
          },
        }).then(async (result) => {
          warningVisible = false;

          if (cleanedUp || expired) {
            return;
          }

          if (result.isConfirmed) {
            try {
              await refreshSession();
              scheduleWarning();
            } catch {
              expireSession();
            }
            return;
          }

          expireSession();
        });
      }, warningDelayMs);
    };

    const resetTimer = () => {
      if (expired || warningVisible) {
        return;
      }

      refreshBackendSessionAfterActivity();
      scheduleWarning();
    };

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true });
    });
    scheduleWarning();

    return () => {
      cleanedUp = true;
      clearWarningTimer();
      clearCountdownTimer();

      if (warningVisible) {
        Swal.close();
      }

      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer);
      });
    };
  }, [handleLogout, sessionTimeoutMinutes, user]);

  const handleUserChange = useCallback((nextUser) => {
    const normalizedUser = normalizeUser(nextUser);
    window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(normalizedUser));
    initializeTheme();
    setUser(normalizedUser);
  }, []);

  useEffect(() => {
    if (!user) {
      if (currentPath !== "/") {
        navigate("/", { replace: true });
      }
      return;
    }

    // A custom role is admitted through the built-in role it was based on, since that
    // is the dashboard and route prefix it actually uses.
    const routingRole = resolveBaseRole(user.roleKey || user.role, user.baseRoleKey);

    if (!supportedRoles.includes(routingRole)) {
      handleLogout();
      return;
    }

    if (!isPathAllowedForRole(currentPath, user.roleKey, user.baseRoleKey)) {
      navigate(getDefaultPathForRole(user.roleKey, user.baseRoleKey), { replace: true });
    }
  }, [currentPath, handleLogout, navigate, user]);

  /*
   * The change feed only makes sense for a signed-in browser: it needs a session to authorise the
   * request, and there is nothing on the login screen for it to keep current. Keying the effect on
   * `userId` also means signing out tears the parked request down rather than leaving it to 401.
   */
  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    startLiveUpdates();

    return () => stopLiveUpdates();
  }, [userId]);

  /*
   * Permissions are read from the session, so a revoked module only takes effect once the session is
   * re-read. Without this an admin unchecking a module changed nothing on the affected person's
   * screen until they signed out and back in.
   *
   * The stored copy is compared before calling setUser: this runs on an auto-refresh event, and
   * handing React a new user object when nothing actually changed would remount the workspace under
   * whoever is using it.
   */
  const refreshPermissions = useCallback(async () => {
    if (!userId) {
      return;
    }

    try {
      const result = await refreshSession();
      const normalizedUser = normalizeUser(result.user);
      const serialized = JSON.stringify(normalizedUser);

      if (serialized === window.localStorage.getItem(SESSION_USER_KEY)) {
        return;
      }

      window.localStorage.setItem(SESSION_USER_KEY, serialized);
      setUser(normalizedUser);
    } catch {
      // A failed poll changes nothing; a genuinely dead session is handled by the 401 interceptor.
    }
  }, [userId]);

  /*
   * `settings` is here because the admin screen saves the permission matrix through settings.php,
   * so that is the topic a save in this browser publishes. `permissions` covers the
   * permissions.php endpoint.
   */
  useAutoRefreshOnChange(refreshPermissions, {
    topics: ["permissions", "settings"],
    refreshOnMount: false,
  });

  let content = null;

  if (!sessionHydrated) {
    content = (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-4 text-center text-white">
        <div>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <p className="m-0 mt-4 text-sm font-semibold">Checking secure session...</p>
        </div>
      </div>
    );
  } else if (!user) {
    content = <Login onLogin={handleLogin} />;
  } else if (isPathAllowedForRole(currentPath, user.roleKey, user.baseRoleKey)) {
    // Custom roles render their base role's dashboard; the module checklist decides
    // what that dashboard actually shows them.
    switch (resolveBaseRole(user.roleKey || user.role, user.baseRoleKey)) {
      case "admin":
        content = (
          <AdminDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "chief":
        content = (
          <ChiefDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "employee":
        content = (
          <EmployeeDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "regionaldirector":
        content = (
          <RegionalDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "hrhead":
        content = (
          <HrheadDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "hrstaff":
        content = (
          <HrstaffDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      default:
        content = null;
    }
  }

  return (
    <>
      <Toaster {...APP_TOASTER_PROPS} />
      {content}
    </>
  );
}



