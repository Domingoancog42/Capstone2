import React, { useCallback, useEffect, useMemo } from "react";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../UI/card";
import ProfilePage from "../profile/ProfilePage";
import NotificationCenter from "../notification/NotificationCenter";
import Table from "../UI/table";
import { getProfilePathForRole } from "../../utils/roleRoutes";
import { AccessDeniedInline } from "../auth/AccessDenied";
import {
  canAccessNavigationItem,
  filterNavigationItemsByPermissions,
  permissionResourceForModule,
  userCanAccessModule,
} from "../../utils/permissions";
import { createAccessRequest } from "../../services/accessRequestService";
import WorkspaceShell from "./WorkspaceShell";

function MetricCard({ metric }) {
  const Icon = metric.icon;

  return (
    <Card className="shadow-md">
      <CardContent className="grid gap-3">
        <div className={`grid h-11 w-11 place-items-center rounded-2xl text-white ${metric.tone}`}>
          <Icon size={20} />
        </div>
        <div>
          <p className="m-0 text-sm font-semibold text-slate-500">{metric.label}</p>
          <strong className="mt-2 block text-lg font-semibold text-slate-900">{metric.value}</strong>
          <p className="mt-2 text-sm leading-6 text-slate-500">{metric.helper}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailCard({ card }) {
  const Icon = card.icon;

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">{card.title}</CardTitle>
          <CardDescription>{card.description}</CardDescription>
        </div>
        {Icon ? (
          <div className={`grid h-11 w-11 place-items-center rounded-2xl text-white ${card.tone || "bg-slate-800"}`}>
            <Icon size={18} />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {card.items?.map((item) => (
          <div
            key={item.label}
            className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <div>
              <p className="m-0 text-sm font-semibold text-slate-900">{item.label}</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">{item.helper}</p>
            </div>
            {item.value ? (
              <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                {item.value}
              </span>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function RoleWorkspacePage({
  user,
  onLogout,
  currentPath,
  onNavigate,
  onUserChange,
  portalLabel,
  navigationItems,
  modules,
  contentClassName,
}) {
  // With the base role left out, a custom role resolved to "/" and never matched its own
  // profile route -- the page fell through to the placeholder card instead of the real profile.
  const profilePath = getProfilePathForRole(user?.roleKey || user?.role, user?.baseRoleKey);
  const isProfileView = currentPath === profilePath;
  /*
   * Used to pick somewhere safe to land — the fallback route and the Access Denied "Go Back"
   * target. The sidebar receives the full list and applies the same filter itself, so a module
   * unchecked in RBAC Management drops out of the navigation for this role.
   */
  const permittedNavigationItems = useMemo(
    () => filterNavigationItemsByPermissions(navigationItems, user),
    [navigationItems, user]
  );
  const allActionableNavigationItems = useMemo(
    () => navigationItems.flatMap((item) => {
      const items = item?.key && item?.path ? [item] : [];
      const childItems = Array.isArray(item?.children)
        ? item.children
            .filter((child) => child?.key && child?.path)
            .map((child) => ({ ...child, parent: item }))
        : [];

      return [...childItems, ...items];
    }),
    [navigationItems]
  );
  const actionableNavigationItems = useMemo(
    () => permittedNavigationItems.flatMap((item) => {
      const items = item?.key && item?.path ? [item] : [];
      const childItems = Array.isArray(item?.children)
        ? item.children
            .filter((child) => child?.key && child?.path)
            .map((child) => ({ ...child, parent: item }))
        : [];

      return [...childItems, ...items];
    }),
    [permittedNavigationItems]
  );
  const dashboardPath = actionableNavigationItems.find((item) => item.key === "dashboard")?.path || actionableNavigationItems[0]?.path;
  const matchedNavigationItem = allActionableNavigationItems.find((item) => item.path === currentPath);
  const permissionDenied = Boolean(
    (isProfileView && !userCanAccessModule(user, "profile"))
    || (
      !isProfileView
      && matchedNavigationItem
      && !canAccessNavigationItem(matchedNavigationItem, user)
    )
  );
  const activeItem = permissionDenied
    ? matchedNavigationItem
    : (matchedNavigationItem || actionableNavigationItems[0]);
  const isNotificationsView = !isProfileView && !permissionDenied && activeItem?.key === "notifications";
  const isMessagesView = !isProfileView && !permissionDenied && activeItem?.key === "messages";

  useEffect(() => {
    if (!isProfileView && currentPath && !matchedNavigationItem && dashboardPath) {
      onNavigate?.(dashboardPath, { replace: true });
    }
  }, [currentPath, dashboardPath, isProfileView, matchedNavigationItem, onNavigate]);

  const content = permissionDenied
    ? {
        title: "Access Denied",
        description: "Your role does not currently have access to this workspace.",
        hidePageIntro: true,
      }
    : isProfileView
      ? {
        title: "Profile",
        description: "Review and update the information linked to your HRIS account.",
      }
    : isNotificationsView
      ? {
          title: "Notifications",
          description: "Review alerts, track unread items, and manage your notification history.",
          hidePageIntro: true,
          render: ({ user: currentUser, onNavigate: navigate }) => (
            <NotificationCenter user={currentUser} onNavigate={navigate} />
          ),
        }
      : (modules[activeItem?.key] || modules[actionableNavigationItems[0]?.key] || {});
  const parentBreadcrumb =
    activeItem?.parent
    && (
      activeItem.parent.path !== activeItem.path
      || activeItem.parent.label !== (content.breadcrumbLabel || content.title || activeItem?.label)
    )
      ? [{ label: activeItem.parent.label, path: activeItem.parent.path || activeItem.path }]
      : [];
  const breadcrumbs = isProfileView
    ? [
        { label: "Dashboard", path: dashboardPath },
        { label: "My Profile" },
      ]
    : activeItem?.key === "dashboard"
      ? [{ label: "Dashboard", path: dashboardPath }]
      : [
          { label: "Dashboard", path: dashboardPath },
          ...parentBreadcrumb,
          {
            label: content.breadcrumbLabel || content.title || activeItem?.label || portalLabel,
            path: activeItem?.path,
          },
          ...(content.breadcrumbCurrent ? [{ label: content.breadcrumbCurrent }] : []),
        ];
  const deniedPageName = isProfileView ? "Profile" : (activeItem?.label || "this workspace");
  /*
   * The permission *resource*, not the nav key — several entries share one resource (Travel Order,
   * Pass Slips and CTO are all `leave`), and the resource is what an admin can actually grant.
   */
  const deniedModuleKey = isProfileView
    ? "profile"
    : permissionResourceForModule(activeItem?.permissionModule || activeItem?.key);
  const requestAccess = useCallback(
    () => createAccessRequest({
      moduleKey: deniedModuleKey,
      moduleLabel: deniedPageName,
    }),
    [deniedModuleKey, deniedPageName]
  );

  return (
    <WorkspaceShell
      user={user}
      onLogout={onLogout}
      currentPath={currentPath}
      onNavigate={onNavigate}
      navigationItems={navigationItems}
      portalLabel={portalLabel}
      pageTitle={content.title || portalLabel}
      pageDescription={content.description || "Role-specific workspace"}
      hidePageIntro={isProfileView || Boolean(content.hidePageIntro)}
      breadcrumbs={breadcrumbs}
      contentClassName={contentClassName}
      // Messages must always use the viewport-managed shell so every role gets Admin's layout:
      // the contacts and thread scroll independently while the composer remains visible.
      fitViewport={isMessagesView || (!isProfileView && !permissionDenied && Boolean(content.fitViewport))}
    >
      {isProfileView && !permissionDenied ? (
        <ProfilePage user={user} onUserChange={onUserChange} />
      ) : permissionDenied ? (
        <AccessDeniedInline
          message={`You don't have permission to view ${deniedPageName}.`}
          onNavigateBack={dashboardPath ? () => onNavigate?.(dashboardPath, { replace: true }) : undefined}
          onRequestAccess={deniedModuleKey ? requestAccess : undefined}
        />
      ) : (
        <>
          {typeof content.render === "function" ? content.render({ user, currentPath, onNavigate }) : null}

          {content.metrics?.length ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {content.metrics.map((metric) => (
                <MetricCard key={metric.label} metric={metric} />
              ))}
            </section>
          ) : null}

          {content.cards?.length ? (
            <section className="mt-6 grid gap-4 xl:grid-cols-2">
              {content.cards.map((card) => (
                <DetailCard key={card.title} card={card} />
              ))}
            </section>
          ) : null}

          {content.table ? (
            <section className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>{content.table.title}</CardTitle>
                  <CardDescription>{content.table.description}</CardDescription>
                </CardHeader>
                {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
                <CardContent className="p-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
                  <Table
                    columns={content.table.columns}
                    data={content.table.rows}
                    rowKey={content.table.rowKey || "id"}
                    emptyMessage={content.table.emptyMessage || "No records found."}
                    cardsClassName="lg:hidden"
                    tableWrapperClassName="hidden lg:block"
                  />
                </CardContent>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </WorkspaceShell>
  );
}
