import React, { useMemo, useState } from "react";
import Breadcrumbs from "../breadcrumbs/breadcrumbs";
import Header from "../navigation/Header";
import Sidebar from "../navigation/Sidebar";
import Footer from "./Footer";
import { getProfilePathForRole } from "../../utils/roleRoutes";
import { requestProfileTab } from "../profile/profileUtils";

export default function WorkspaceShell({
  user,
  onLogout,
  currentPath,
  onNavigate,
  navigationItems,
  portalLabel,
  pageTitle,
  pageDescription,
  hidePageIntro = false,
  breadcrumbs = [],
  contentClassName = "mx-auto max-w-7xl p-3 sm:p-4",
  children,
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const settingsPath = useMemo(
    () => navigationItems.find((item) => item.key === "settings")?.path || null,
    [navigationItems]
  );
  const profilePath = useMemo(
    () => getProfilePathForRole(user?.roleKey || user?.role),
    [user?.role, user?.roleKey]
  );
  return (
    // Transparent so the page gradient on <html> shows through; dark mode paints over it there.
    <div className="min-h-screen bg-transparent">
      <Header
        user={user}
        onOpenProfile={profilePath && onNavigate ? (tabId) => {
          requestProfileTab(tabId);
          onNavigate(profilePath);
        } : undefined}
        onOpenSettings={settingsPath && onNavigate ? () => onNavigate(settingsPath) : undefined}
        onLogout={onLogout}
        onNavigate={onNavigate}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setMobileSidebarOpen(true)}
      />
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 border-0 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <Sidebar
        user={user}
        onLogout={onLogout}
        navigationItems={navigationItems}
        activePath={currentPath}
        onNavigate={onNavigate}
        portalLabel={portalLabel}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        variant="crimson"
      />

      <main className={`flex min-h-screen flex-col pt-14 transition-all duration-300 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <div className={`flex-1 ${contentClassName}`}>
          <Breadcrumbs items={breadcrumbs} onNavigate={onNavigate} className="mb-3 w-full" />

          {!hidePageIntro ? (
            <div className="mb-4 flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                {portalLabel ? (
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D61E1E]">
                    {portalLabel}
                  </p>
                ) : null}
                <h1 className={`${portalLabel ? "mt-1.5" : "mt-0"} text-lg font-semibold text-slate-900 sm:text-xl`}>{pageTitle}</h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{pageDescription}</p>
              </div>
            </div>
          ) : null}

          {children}
        </div>
        
        <Footer />
      </main>
    </div>
  );
}
