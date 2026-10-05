import React, { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import toast, { Toaster } from "react-hot-toast";
import Login from "./components/UI_Login/login";
import AdminDashboard from "./page/Admin/AdminDashboard";
import CashierDashboard from "./page/Cashier/cashierdashboard";
import ChiefDashboard from "./page/Chief/chiefdashboard";
import ChiefAdminDashboard from "./page/chiefadmin/chiefadmindashboard";
import EmployeeDashboard from "./page/Employee/employeedashboard";
import HrheadDashboard from "./page/HRHead/Hrheaddashboard";
import HrstaffDashboard from "./page/HRStaff/Hrstaffdashboard";
import PlanningOfficerDashboard from "./page/PlanningOfficer/planningofficerdashboard";
import RegionalDashboard from "./page/Regionaldirector/RegionalDashboard";
import NotFoundPage from "./page/NotFoundPage";
import PassSlipScannerPage from "./features/passSlipScanner/PassSlipScannerPage";
import { AuthProvider, useAuth } from "./context/AuthContext";
import {
  APP_ROUTE_PATHS,
  getDefaultPathForRole,
  isKnownAppPath,
  isPathAllowedForRole,
  normalizePath,
  PASS_SLIP_SCANNER_PATH,
  MANAGED_USER_ROLE_KEYS,
  resolveRoutingRole,
} from "./utils/roleRoutes";
import {
  AUTH_ACCOUNT_INACTIVE_REASON,
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_SESSION_TIMEOUT_REASON,
  getPublicSettings,
  logout,
  refreshSession,
} from "./services/api";
import { startLiveUpdates, stopLiveUpdates } from "./services/liveUpdatesService";
import { useAutoRefreshOnChange } from "./components/auto/autorefreshdatalist";
import { initializeTheme, isDarkThemeEnabled } from "./components/darkmode/darkmodetoggle";
import {
  applyUiThemeColor,
  getActiveUiThemeColor,
  getStoredUiThemeColor,
  isUiThemeColor,
} from "./components/theme/systemTheme";
import useUnsafeTextValidation from "./hooks/useUnsafeTextValidation";
import { confirmNavigation, hasNavigationGuard } from "./utils/navigationGuard";

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
 * Keep notifications close to the top edge while leaving room for header controls.
 */
const APP_TOASTER_PROPS = {
  position: "top-right",
  containerStyle: { top: 56, right: 24, zIndex: 99999 },
  toastOptions: { duration: 3000, className: "app-toast" },
};

const publicUrl = process.env.PUBLIC_URL || "";
const mgbLogo = `${publicUrl}/mgb.png`;

const supportedRoles = ["admin", ...MANAGED_USER_ROLE_KEYS];
const SESSION_TIMEOUT_WARNING_SECONDS = 30;
const SESSION_TIMEOUT_TOAST_ID = "session-timeout-inactivity";

function showSessionTimeoutToast(message = "") {
  toast.error(
    message || "Your session expired due to inactivity. Please sign in again.",
    {
      id: SESSION_TIMEOUT_TOAST_ID,
      duration: 3000,
    }
  );
}

function sessionTimeoutWarningHtml(seconds) {
  return `
    <div class="app-swal-copy" style="display:grid; gap:14px; font-size:17px; line-height:1.5;">
      <p style="margin:0;">You have been inactive for a while.</p>
      <p style="margin:0;">Your session will end in <strong id="session-timeout-countdown">${seconds}</strong> seconds.</p>
    </div>
  `;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

function AppContent() {
  useUnsafeTextValidation();

  const {
    user,
    isAuthLoading,
    setAuthenticatedUser,
    clearAuthentication,
  } = useAuth();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const currentPath = normalizePath(location.pathname);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30);
  // Raised while the "account set to inactive" notice is on screen, so nothing else signs the user
  // out from under it. See the session-expired listener below.
  const inactiveNoticeRef = useRef(false);
  const userId = user?.id ?? null;

  /*
   * A page with unsaved work (see utils/navigationGuard.js) is asked first. Only a move the person
   * chose is held: a `replace` is the app redirecting itself -- signing out, bouncing an unknown
   * path -- and must never wait on a dialog.
   */
  const navigate = useCallback((path, { replace = false } = {}) => {
    const target = normalizePath(path);

    if (replace || !hasNavigationGuard() || target === normalizePath(window.location.pathname)) {
      routerNavigate(target, { replace });
      return;
    }

    void confirmNavigation(target).then((allowed) => {
      if (allowed) {
        routerNavigate(target, { replace });
      }
    });
  }, [routerNavigate]);

  const handleLogin = (nextUser) => {
    const normalizedUser = setAuthenticatedUser(nextUser);
    initializeTheme();
    navigate(
      getDefaultPathForRole(normalizedUser?.roleKey, normalizedUser?.baseRoleKey),
      { replace: true }
    );
  };

  const handleLogout = useCallback(() => {
    clearAuthentication();

    // If a session ends while the catch-all page is open, leave its URL in place so the page can
    // immediately switch from the dashboard action to the login action. Normal app pages sign out
    // to the explicit public route.
    if (
      normalizePath(window.location.pathname) !== PASS_SLIP_SCANNER_PATH
      && isKnownAppPath(window.location.pathname)
    ) {
      navigate("/login", { replace: true });
    }
  }, [clearAuthentication, navigate]);

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

      if (event?.detail?.reason === AUTH_SESSION_TIMEOUT_REASON) {
        handleLogout();
        showSessionTimeoutToast(event?.detail?.message);
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

  // A local Settings save publishes `settings`; the server change feed publishes
  // `security_policy` for saves made on another machine. Both paths update the timer without making
  // the user sign out, reload, or wait for their stored user object to change.
  const refreshSessionTimeout = useCallback(async () => {
    if (!userId) {
      return;
    }

    try {
      const result = await getPublicSettings();
      const timeout = Number(result.security?.sessionTimeoutMinutes || result.sessionTimeoutMinutes);

      if (Number.isFinite(timeout) && timeout > 0) {
        setSessionTimeoutMinutes(timeout);
      }
    } catch {
      // Keep the last known policy; the next feed event, focus refresh, or reload retries it.
    }
  }, [userId]);

  useAutoRefreshOnChange(refreshSessionTimeout, {
    topics: ["security_policy", "settings"],
    enabled: Boolean(userId),
    refreshOnMount: false,
    intervalMs: 0,
  });

  useEffect(() => {
    if (!user || currentPath === PASS_SLIP_SCANNER_PATH) {
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

    const expireSession = ({ notify = true } = {}) => {
      if (expired) {
        return;
      }

      expired = true;
      clearWarningTimer();
      clearCountdownTimer();
      logout().catch(() => {});
      if (!cleanedUp) {
        handleLogout();

        if (notify) {
          showSessionTimeoutToast();
        }
      }
    };

    const refreshBackendSessionAfterActivity = () => {
      const now = Date.now();
      const refreshIntervalMs = Math.min(60_000, Math.max(10_000, Math.floor(timeoutMs / 4)));

      if (now - lastSessionRefreshAt < refreshIntervalMs) {
        return;
      }

      lastSessionRefreshAt = now;
      refreshSession({ extend: true }).catch(() => {});
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
              await refreshSession({ extend: true });
              scheduleWarning();
            } catch {
              expireSession();
            }
            return;
          }

          expireSession({ notify: result.dismiss === Swal.DismissReason.timer });
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
  }, [currentPath, handleLogout, sessionTimeoutMinutes, user]);

  const handleUserChange = useCallback((nextUser) => {
    setAuthenticatedUser(nextUser);
    initializeTheme();
  }, [setAuthenticatedUser]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (!user) {
      if (currentPath === PASS_SLIP_SCANNER_PATH) {
        return;
      }

      // Unknown addresses must remain visible so the anonymous 404 action can be shown. Only known
      // protected routes are sent to the explicit login route.
      if (currentPath === "/" || (currentPath !== "/login" && isKnownAppPath(currentPath))) {
        navigate("/login", { replace: true });
      }
      return;
    }

    // A custom role is admitted through the built-in role it was based on, since that
    // is the dashboard and route prefix it actually uses.
    const routingRole = resolveRoutingRole(user.roleKey || user.role, user.baseRoleKey);

    if (!supportedRoles.includes(routingRole)) {
      handleLogout();
      return;
    }

    if (currentPath === "/" || currentPath === "/login") {
      navigate(getDefaultPathForRole(user.roleKey, user.baseRoleKey), { replace: true });
      return;
    }

    if (!isKnownAppPath(currentPath)) {
      // The wildcard route owns unknown paths. Keeping the location intact also makes refreshes
      // deterministic and avoids a redirect loop through the dashboard or login page.
      return;
    }

    if (!isPathAllowedForRole(currentPath, user.roleKey, user.baseRoleKey)) {
      navigate(getDefaultPathForRole(user.roleKey, user.baseRoleKey), { replace: true });
    }
  }, [currentPath, handleLogout, isAuthLoading, navigate, user]);

  /*
   * The change feed only makes sense for a signed-in browser: it needs a session to authorise the
   * request, and there is nothing on the login screen for it to keep current. Keying the effect on
   * `userId` also means signing out tears the parked request down rather than leaving it to 401.
   */
  useEffect(() => {
    if (!userId || currentPath === PASS_SLIP_SCANNER_PATH) {
      return undefined;
    }

    startLiveUpdates();

    return () => stopLiveUpdates();
  }, [currentPath, userId]);

  /*
   * Permissions are read from the session, so a revoked module only takes effect once the session is
   * re-read. Without this an admin unchecking a module changed nothing on the affected person's
   * screen until they signed out and back in.
   *
   * Compare with this tab's React state as well as storage. Another tab may already
   * have updated shared localStorage while this tab still displays the old grants.
   */
  const refreshPermissions = useCallback(async () => {
    if (!userId) {
      return;
    }

    try {
      const result = await refreshSession();
      setAuthenticatedUser(result.user);
    } catch {
      // A failed poll changes nothing; a genuinely dead session is handled by the 401 interceptor.
    }
  }, [setAuthenticatedUser, userId]);

  /*
   * `settings` is here because the admin screen saves the permission matrix through settings.php,
   * so that is the topic a save in this browser publishes. `permissions` covers the
   * permissions.php endpoint.
   */
  useAutoRefreshOnChange(refreshPermissions, {
    enabled: Boolean(userId) && currentPath !== PASS_SLIP_SCANNER_PATH,
    topics: ["permissions", "settings", "user", "roles"],
    refreshOnMount: false,
  });

  let content = null;
  const dashboardPath = user
    ? getDefaultPathForRole(user.roleKey, user.baseRoleKey)
    : "/login";
  const renderedPath = currentPath === "/dashboard" ? dashboardPath : currentPath;

  if (currentPath === PASS_SLIP_SCANNER_PATH) {
    content = <PassSlipScannerPage />;
  } else if (isAuthLoading) {
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
  } else if (!user && (currentPath === "/login" || currentPath === "/")) {
    content = <Login onLogin={handleLogin} />;
  } else if (!user) {
    content = (
      <div className="grid min-h-screen place-items-center bg-white px-4 text-center text-slate-900">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-[#D61E1E]" role="status" aria-label="Opening login page" />
      </div>
    );
  } else if (isPathAllowedForRole(currentPath, user.roleKey, user.baseRoleKey)) {
    // Custom roles render their base role's dashboard; the module checklist decides
    // what that dashboard actually shows them.
    switch (resolveRoutingRole(user.roleKey || user.role, user.baseRoleKey)) {
      case "admin":
        content = (
          <AdminDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={renderedPath}
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
            currentPath={renderedPath}
            onNavigate={navigate}
            onUserChange={handleUserChange}
          />
        );
        break;
      case "chiefadmin":
        content = (
          <ChiefAdminDashboard
            user={user}
            onLogout={handleLogout}
            currentPath={renderedPath}
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
            currentPath={renderedPath}
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
            currentPath={renderedPath}
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
            currentPath={renderedPath}
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
            currentPath={renderedPath}
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
            currentPath={renderedPath}
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
            currentPath={renderedPath}
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
      <Routes>
        {APP_ROUTE_PATHS.map((path) => (
          <Route key={path} path={path} caseSensitive element={content} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}



