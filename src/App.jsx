import React, { useCallback, useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { Toaster, toast } from "react-hot-toast";
import Login from "./components/UI_Login/login";
import AdminDashboard from "./page/Admin/AdminDashboard";
import CashierDashboard from "./page/Cashier/cashierdashboard";
import ChiefDashboard from "./page/Chief/chiefdashboard";
import EmployeeDashboard from "./page/Employee/employeedashboard";
import HrheadDashboard from "./page/HRHead/Hrheaddashboard";
import HrstaffDashboard from "./page/HRStaff/Hrstaffdashboard";
import PlanningOfficerDashboard from "./page/PlanningOfficer/planningofficerdashboard";
import RegionalDashboard from "./page/Regionaldirector/RegionalDashboard";
import AccountUseReturnCard from "./components/auth/AccountUseReturnCard";
import {
  getDefaultPathForRole,
  isKnownAppPath,
  isPathAllowedForRole,
  normalizePath,
  normalizeUser,
  MANAGED_USER_ROLE_KEYS,
  readStoredUser,
  resolveBaseRole,
  SESSION_USER_KEY,
} from "./utils/roleRoutes";
import {
  AUTH_ACCOUNT_INACTIVE_REASON,
  AUTH_SESSION_EXPIRED_EVENT,
  getPublicSettings,
  logout,
  refreshSession,
  returnFromTemporaryAccountUse,
  startTemporaryAccountUse,
} from "./services/api";
import { startLiveUpdates, stopLiveUpdates } from "./services/liveUpdatesService";
import { useAutoRefreshOnChange } from "./components/auto/autorefreshdatalist";
import { applyTheme, initializeTheme, isDarkThemeEnabled } from "./components/darkmode/darkmodetoggle";
import {
  applyUiThemeColor,
  getActiveUiThemeColor,
  getStoredUiThemeColor,
  isUiThemeColor,
} from "./components/theme/systemTheme";

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

const publicUrl = process.env.PUBLIC_URL || "";
const mgbLogo = `${publicUrl}/mgb.png`;

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
  const [returningFromAccountUse, setReturningFromAccountUse] = useState(false);
  // Raised while the "account set to inactive" notice is on screen, so nothing else signs the user
  // out from under it. See the session-expired listener below.
  const inactiveNoticeRef = useRef(false);
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
        // The inactive notice signs the user out itself once acknowledged; logging out here as well
        // would drop them at the login screen before they had read it.
        if (active && !inactiveNoticeRef.current) {
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
    const handleSessionExpired = (event) => {
      /*
       * A deactivated account is told why, and stays put until it has been told.
       *
       * Only the first 401 carries the reason -- the server destroys the session as it answers, so
       * every request already in flight behind it comes back as an ordinary "sign in first". Those
       * would each call handleLogout() and yank the page out from under the notice, which is what
       * this latch prevents: once the notice is up it owns the sign-out, and nothing else acts on
       * the event until the user has acknowledged it.
       */
      if (inactiveNoticeRef.current) {
        return;
      }

      if (event?.detail?.reason !== AUTH_ACCOUNT_INACTIVE_REASON) {
        handleLogout();
        return;
      }

      inactiveNoticeRef.current = true;

      const darkMode = isDarkThemeEnabled();

      Swal.fire({
        title: "Account set to inactive",
        text:
          event?.detail?.message
          || "Your account has been set to inactive. Please contact your administrator.",
        icon: "warning",
        iconColor: darkMode ? "#fb923c" : undefined,
        confirmButtonText: "OK",
        confirmButtonColor: "#D61E1E",
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: darkMode ? "#0f172a" : undefined,
        color: darkMode ? "#e2e8f0" : undefined,
        customClass: {
          popup: darkMode ? "rounded-[1.4rem] border border-slate-700 bg-slate-900 shadow-2xl" : "rounded-[1.4rem]",
          title: darkMode ? "text-slate-100" : "text-slate-900",
          htmlContainer: darkMode ? "text-slate-300" : "text-slate-600",
        },
      }).then(() => {
        inactiveNoticeRef.current = false;
        handleLogout();
      });
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [handleLogout]);

  useEffect(() => {
    let mounted = true;

    getPublicSettings()
      .then((result) => {
        if (!mounted) {
          return;
        }

        // A payload without a usable color leaves the current one alone: passing it through would
        // normalize to the crimson default and persist it, silently undoing the saved color. An
        // unsaved pick from Settings > Preferences is left alone for the same reason -- on the
        // first load there is never one, so the shared color still lands as it always did.
        const hasUnsavedUiThemeColor = getActiveUiThemeColor() !== getStoredUiThemeColor();

        if (isUiThemeColor(result.uiThemeColor) && !hasUnsavedUiThemeColor) {
          applyUiThemeColor(result.uiThemeColor, { persist: true });
        }

        const timeout = Number(result.security?.sessionTimeoutMinutes || result.sessionTimeoutMinutes);
        if (user) {
          setSessionTimeoutMinutes(Number.isFinite(timeout) && timeout > 0 ? timeout : 30);
        }
      })
      .catch(() => {
        if (mounted && user) {
          setSessionTimeoutMinutes(30);
        }
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  // `changes.php` long-polls this topic while a user is signed in. A save by an administrator on
  // another machine therefore applies the shared color to this open dashboard without a refresh.
  const refreshUiPreference = useCallback(async () => {
    try {
      const result = await getPublicSettings();

      if (!isUiThemeColor(result.uiThemeColor)) {
        return;
      }

      // A color picked in Settings > Preferences is painted without being persisted until it is
      // saved. Overwriting it here would take it off the screen mid-decision, so this tab keeps its
      // own pick and picks another administrator's color up on the next reload or once it is saved.
      if (getActiveUiThemeColor() !== getStoredUiThemeColor()) {
        return;
      }

      applyUiThemeColor(result.uiThemeColor, { persist: true });
    } catch {
      // Keep the last known color; the next long-poll response or normal settings load retries it.
    }
  }, []);

  useAutoRefreshOnChange(refreshUiPreference, {
    topic: "ui_preference",
    enabled: Boolean(userId),
    refreshOnMount: false,
  });

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

  const handleStartAccountUse = useCallback(async (targetUser) => {
    const result = await startTemporaryAccountUse(targetUser?.id);
    const normalizedUser = normalizeUser(result.user);

    window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(normalizedUser));
    setUser(normalizedUser);
    navigate(
      getDefaultPathForRole(normalizedUser?.roleKey, normalizedUser?.baseRoleKey),
      { replace: true }
    );

    return result;
  }, [navigate]);

  const handleReturnFromAccountUse = useCallback(async () => {
    if (returningFromAccountUse) {
      return;
    }

    setReturningFromAccountUse(true);

    try {
      const result = await returnFromTemporaryAccountUse();
      const normalizedUser = normalizeUser(result.user);

      window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(normalizedUser));
      setUser(normalizedUser);
      navigate(
        getDefaultPathForRole(normalizedUser?.roleKey, normalizedUser?.baseRoleKey),
        { replace: true }
      );
      toast.success(result.message || "Returned to your administrator account.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to return to your administrator account.");

      if (error.response?.status === 401) {
        handleLogout();
      }
    } finally {
      setReturningFromAccountUse(false);
    }
  }, [handleLogout, navigate, returningFromAccountUse]);

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

    if (!isKnownAppPath(currentPath)) {
      navigate(getDefaultPathForRole(user.roleKey, user.baseRoleKey), { replace: true });
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
      <div className="grid min-h-screen place-items-center bg-white px-4 text-center text-slate-900">
        <div>
          <img
            alt="Mines and Geosciences Bureau seal"
            className="mx-auto h-[72px] w-[72px] object-contain"
            src={mgbLogo}
          />
          <div className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-[#D61E1E]" />
          <p className="m-0 mt-4 text-sm font-semibold">Restoring your session...</p>
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
            onUseAccount={handleStartAccountUse}
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
      case "planningofficer":
        content = (
          <PlanningOfficerDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={currentPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "cashier":
        content = (
          <CashierDashboard
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
  } else {
    // The route is real but is not part of this user's role. The redirect effect above sends the
    // user to their dashboard.
    content = null;
  }

  return (
    <>
      <Toaster {...APP_TOASTER_PROPS} />
      {content}
      <AccountUseReturnCard
        user={user}
        returning={returningFromAccountUse}
        onReturn={handleReturnFromAccountUse}
      />
    </>
  );
}



