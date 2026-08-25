import React, { useEffect, useMemo, useState } from "react";
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
  fitViewport = false,
  children,
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const settingsPath = useMemo(
    () => navigationItems.find((item) => item.key === "settings")?.path || null,
    [navigationItems]
  );
  // A custom role has no route prefix of its own, so its profile lives under the base role's.
  // Leaving the base role out resolved to "/" and the profile link went nowhere.
  const profilePath = useMemo(
    () => getProfilePathForRole(user?.roleKey || user?.role, user?.baseRoleKey),
    [user?.baseRoleKey, user?.role, user?.roleKey]
  );

  /*
   * The drawer is an overlay, so the page behind it must not scroll — without this a touch drag
   * that starts on the scrim scrolls the workspace underneath and the drawer appears to drift.
   * Restores the previous value rather than clearing it, since the profile floating card locks the
   * body the same way and can still be open behind the drawer.
   */
  useEffect(() => {
    if (!mobileSidebarOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen]);

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

      {/*
       * `fitViewport` is for workspaces that manage their own scrolling — Messages, where the
       * conversation list and the thread each scroll and the composer stays pinned to the bottom.
       * Those panes only scroll if something above them has a *definite* height, so on desktop the
       * container is pinned to `calc(100vh - 4rem)` and clipped, exactly as Admin's messages view
       * does inline. `min-h-screen`/`flex-1` is not enough: with no resolved height the panes fall
       * back to their content height, the container stretches past the fold, and the contact list
       * grows instead of scrolling. `main` stays a block here for the same reason — as a flex column
       * it would hand the child a flex-basis and override that height. Below `lg` the panes stack, so
       * the clipping is dropped and the page scrolls normally.
       */}
      <main
        className={`pt-14 transition-all duration-300 ${
          fitViewport ? "lg:overflow-hidden" : "flex min-h-screen flex-col"
        } ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}
      >
        <div
          className={
            fitViewport
              ? "flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden"
              : `flex-1 ${contentClassName}`
          }
        >
          <Breadcrumbs
            items={breadcrumbs}
            onNavigate={onNavigate}
            className={fitViewport ? "w-full shrink-0" : "mb-3 w-full"}
          />

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

          {fitViewport ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          ) : (
            children
          )}
        </div>
        
        {/*
         * A viewport-locked workspace already fills the fold, so on desktop the footer would only
         * push the page into a scroll to reach a strip of copyright text — Admin's messages view has
         * none either. It still renders below `lg`, where the page scrolls anyway.
         */}
        {fitViewport ? (
          <div className="lg:hidden">
            <Footer />
          </div>
        ) : (
          <Footer />
        )}
      </main>
    </div>
  );
}
