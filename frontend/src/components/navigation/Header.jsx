import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, Menu, Settings, User, Clock, AlertCircle } from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { logout, checkPasswordExpiry } from "../../services/api";
import { getRoleLabel } from "../../utils/roleRoutes";
import { scalePollInterval } from "../auto/autorefreshconfig";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import NotificationBell from "../notification/NotificationBell";
import ChatBubbleButton from "../bubble_chat/ChatBubbleButton";
import { ThemeToggleButton, isDarkThemeEnabled } from "../darkmode/darkmodetoggle";

function AccountMenuAction({
  icon: Icon,
  label,
  helper,
  onClick,
  tone = "default",
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`app-account-menu-action flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
        tone === "danger"
          ? "app-account-menu-action--logout text-rose-600 hover:bg-rose-50"
          : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <span
        className={`app-account-menu-action-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
          tone === "danger" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-600"
        }`}
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {helper ? (
          <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
            {helper}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// Helper function to get password expiry styling tone
function getPasswordExpiryTone(daysUntilExpiry, hasExpired) {
  if (hasExpired || daysUntilExpiry <= 3) {
    return {
      bg: "bg-rose-50",
      border: "border-rose-200",
      icon: "bg-rose-100 text-rose-600",
      text: "text-rose-700",
      badge: "bg-rose-100 text-rose-700",
    };
  }
  if (daysUntilExpiry <= 7) {
    return {
      bg: "bg-orange-50",
      border: "border-orange-200",
      icon: "bg-orange-100 text-orange-600",
      text: "text-orange-700",
      badge: "bg-orange-100 text-orange-700",
    };
  }
  if (daysUntilExpiry <= 14) {
    return {
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: "bg-amber-100 text-amber-600",
      text: "text-amber-700",
      badge: "bg-amber-100 text-amber-700",
    };
  }
  return {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    icon: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
  };
}

// Helper function to format expiry date
function formatExpiryDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function Header({
  user,
  onOpenProfile,
  onOpenSettings,
  onLogout,
  onNavigate,
  sidebarCollapsed = false,
  onToggleSidebar,
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  // Held in state rather than a ref so the messenger re-renders once the slot exists to portal into.
  const [chatHeaderSlot, setChatHeaderSlot] = useState(null);
  const [passwordExpiry, setPasswordExpiry] = useState(null);
  const headerActionsRef = useRef(null);
  const userName = user?.full_name || user?.username || "Admin";
  const userRole = getRoleLabel(user?.role || "Administrator");
  const position = user?.position || "Not assigned";
  const designation = String(user?.designation || "").trim();
  const profileImageUrl = resolveBackendAssetUrl(user?.profile_image || user?.profileImage);
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name.charAt(0).toUpperCase())
    .join("") || "A";

  const fetchPasswordExpiry = useCallback(async () => {
    try {
      const response = await checkPasswordExpiry();
      if (response.success && response.passwordExpiry) {
        setPasswordExpiry(response.passwordExpiry);
      } else {
        setPasswordExpiry(null);
      }
    } catch (error) {
      console.error("Failed to fetch password expiry:", error);
      setPasswordExpiry(null);
    }
  }, []);

  useEffect(() => {
    fetchPasswordExpiry();

    // Optional: Auto-refresh password expiry every 60 seconds
    const intervalId = setInterval(fetchPasswordExpiry, scalePollInterval(60000));
    
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchPasswordExpiry]);

  const openProfileSecurity = () => {
    setProfileOpen(false);
    onOpenProfile?.("security");
  };

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (headerActionsRef.current && !headerActionsRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!profileOpen) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileOpen]);

  const handleLogout = async () => {
    const darkMode = isDarkThemeEnabled();
    const confirmation = await Swal.fire({
      title: "Are you sure you want to log out?",
      icon: "warning",
      iconColor: darkMode ? "#fb923c" : undefined,
      showCancelButton: true,
      confirmButtonText: "Log Out",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#e11d48",
      cancelButtonColor: darkMode ? "#475569" : "#64748b",
      background: darkMode ? "#0f172a" : undefined,
      color: darkMode ? "#e2e8f0" : undefined,
      reverseButtons: true,
      allowOutsideClick: false,
      allowEscapeKey: true,
      customClass: {
        popup: darkMode ? "rounded-[1.4rem] border border-slate-700 bg-slate-900 shadow-2xl" : "rounded-[1.4rem]",
        title: darkMode ? "text-slate-100" : "text-slate-900",
        htmlContainer: darkMode ? "text-slate-300" : "text-slate-600",
      },
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    Swal.fire({
      title: "Signing out...",
      text: "Please wait.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      background: darkMode ? "#0f172a" : undefined,
      color: darkMode ? "#e2e8f0" : undefined,
      customClass: {
        popup: darkMode ? "rounded-[1.4rem] border border-slate-700 bg-slate-900 shadow-2xl" : "rounded-[1.4rem]",
        title: darkMode ? "text-slate-100" : "text-slate-900",
        htmlContainer: darkMode ? "text-slate-300" : "text-slate-600",
      },
      didOpen: () => {
        Swal.showLoading();
      },
    });

    try {
      await logout();
    } finally {
      Swal.close();
      onLogout?.();
    }
  };

  return (
    <>
      {/* `app-topbar` opts this out of the mobile wrap rule — the bar is a fixed 3.5rem, so a
          wrapped second line would be clipped rather than shown. */}
      <header className="app-topbar app-topbar-themed fixed inset-x-0 top-0 z-40 h-14 border-b border-slate-200 bg-white transition-colors duration-300">
        <div ref={headerActionsRef} className="flex h-full items-center justify-between gap-2 px-3 sm:gap-3 sm:px-5">
          <div className={`flex min-w-0 flex-1 items-center transition-all duration-300 ${sidebarCollapsed ? "lg:ml-[6rem]" : "lg:ml-[19.5rem]"}`}>
            {onToggleSidebar ? (
              <button
                type="button"
                aria-label="Open navigation menu"
                onClick={onToggleSidebar}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-slate-300 hover:bg-white lg:hidden"
              >
                <Menu size={16} />
              </button>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <ThemeToggleButton />
            {/* The messenger portals its trigger in here from `lg` up; see ChatBubbleButton. */}
            <span ref={setChatHeaderSlot} className="contents" />
            <NotificationBell
              user={user}
              onNavigate={onNavigate}
              onOpen={() => {
                setProfileOpen(false);
              }}
            />

            <div className="relative">
              <button
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                type="button"
                onClick={() => {
                  setProfileOpen((open) => !open);
                }}
                className="app-account-trigger inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 pr-2.5 text-left text-slate-700 transition hover:border-slate-300 hover:bg-white"
              >
                <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-[#D61E1E] text-[11px] font-bold text-white">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt={userName} className="h-full w-full object-cover" />
                  ) : (
                    initials
                  )}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <strong className="block max-w-28 truncate text-xs font-semibold text-slate-900">
                    {user?.username || "Admin"}
                  </strong>
                  <span className="block max-w-28 truncate text-[10.5px] text-slate-500">{userRole}</span>
                </span>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {profileOpen ? (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="app-account-menu absolute right-0 top-[calc(100%+10px)] z-50 w-[270px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.18)]"
                  >
                    <div className="app-account-menu-banner h-11 bg-[linear-gradient(135deg,#D61E1E_0%,#B41818_52%,#6f1313_100%)]" />
                    <div className="relative px-4 pb-3">
                      <div className="-mt-7 flex flex-col items-center text-center">
                        <span className="app-account-menu-avatar grid h-16 w-16 place-items-center overflow-hidden rounded-full border-4 border-white bg-white text-base font-bold text-[#D61E1E] shadow-lg">
                          {profileImageUrl ? (
                            <img src={profileImageUrl} alt={userName} className="h-full w-full object-cover" />
                          ) : (
                            initials
                          )}
                        </span>
                        <p className="mt-3 max-w-[220px] text-sm font-semibold leading-6 text-slate-900">
                          Welcome {userName}
                        </p>
                        <p className="mt-1.5 text-xs text-slate-500">Position: {position}</p>
                        {designation ? <p className="mt-0.5 text-xs text-slate-500">Designation: {designation}</p> : null}
                        {user?.must_change_password ? (
                          <span className="mt-3 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                            Password update required
                          </span>
                        ) : null}
                      </div>

                      {/* Password Expiration Section */}
                      {passwordExpiry && passwordExpiry.daysUntilExpiry != null ? (
                        <div className="mt-4 border-t border-slate-200 pt-3">
                          {(() => {
                            const daysUntilExpiry = Math.max(0, passwordExpiry.daysUntilExpiry);
                            const hasExpired = Boolean(passwordExpiry.hasExpired) || passwordExpiry.daysUntilExpiry <= 0;
                            const tone = getPasswordExpiryTone(daysUntilExpiry, hasExpired);

                            return (
                              <div className={`rounded-xl border p-3 ${tone.bg} ${tone.border}`}>
                                <button
                                  type="button"
                                  onClick={openProfileSecurity}
                                  className="flex w-full items-start gap-2.5 rounded-lg text-left transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D61E1E]/30"
                                  aria-label="Open profile Security tab to change password"
                                >
                                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone.icon}`}>
                                    {hasExpired || daysUntilExpiry <= 3 ? <AlertCircle size={16} /> : <Clock size={16} />}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="m-0 text-xs font-bold text-slate-900">Password Expiration</p>
                                    <p className={`m-0 mt-0.5 text-sm font-semibold ${tone.text}`}>
                                      {hasExpired
                                        ? "Expired"
                                        : `${daysUntilExpiry} ${daysUntilExpiry === 1 ? "day" : "days"} left`}
                                    </p>
                                    <p className="m-0 mt-1 text-[11px] text-slate-500">
                                      {passwordExpiry.expiryDate
                                        ? `Expires: ${formatExpiryDate(passwordExpiry.expiryDate)}`
                                        : "Valid for 60 days after your last password change."}
                                    </p>
                                  </div>
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}

                      <div className="mt-5 border-t border-slate-200 pt-3">
                        {onOpenProfile ? (
                          <AccountMenuAction
                            icon={User}
                            label="Profile"
                            onClick={() => {
                              setProfileOpen(false);
                              onOpenProfile();
                            }}
                          />
                        ) : null}

                        {onOpenSettings ? (
                          <AccountMenuAction
                            icon={Settings}
                            label="Settings"
                            onClick={() => {
                              setProfileOpen(false);
                              onOpenSettings();
                            }}
                          />
                        ) : null}

                      </div>

                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <AccountMenuAction
                          icon={LogOut}
                          label="Log Out"
                          tone="danger"
                          onClick={() => {
                            setProfileOpen(false);
                            void handleLogout();
                          }}
                        />
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>
      {/*
        * Rendered beside the header rather than inside it: the dark theme's `backdrop-filter` on
        * the bar would otherwise pin the mobile bubble inside the 56px strip.
        */}
      <ChatBubbleButton
        key={user?.id}
        user={user}
        onOpen={() => setProfileOpen(false)}
        headerSlot={chatHeaderSlot}
      />
    </>
  );
}
