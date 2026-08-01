import { useCallback, useMemo } from "react";

/**
 * Permission Hook
 * 
 * Provides utilities for checking user permissions and access rights.
 * 
 * @param {Object} user - The current user object
 * @param {Object} permissions - Permission configuration (optional)
 * @returns {Object} Permission utilities
 * 
 * @example
 * const { hasPermission, canAccess, isDisabled } = usePermission(user);
 * 
 * if (!canAccess('employees', 'view')) {
 *   return <AccessDenied />;
 * }
 */
export function usePermission(user, permissions = null) {
  const effectivePermissions = useMemo(
    () => permissions || user?.permissions || null,
    [permissions, user?.permissions]
  );

  /**
   * Check if user has a specific permission
   * @param {string} resource - The resource/module name (e.g., 'employees', 'attendance')
   * @param {string} action - The action (e.g., 'view', 'create', 'edit', 'delete')
   * @returns {boolean}
   */
  const hasPermission = useCallback(
    (resource, action) => {
      if (!user) {
        return false;
      }

      // Admin has all permissions
      if (user.roleKey === "admin" || user.role === "admin") {
        return true;
      }

      // If no permissions object provided, default to false for non-admins
      if (!effectivePermissions) {
        return false;
      }

      // Check if the resource exists in permissions
      if (!effectivePermissions[resource]) {
        return false;
      }

      // Check if the action is allowed
      const resourcePermissions = effectivePermissions[resource];
      
      if (Array.isArray(resourcePermissions)) {
        return resourcePermissions.includes(action);
      }

      if (Array.isArray(resourcePermissions.actions)) {
        return resourcePermissions.enabled !== false && resourcePermissions.actions.includes(action);
      }

      if (typeof resourcePermissions === "object") {
        return resourcePermissions[action] === true;
      }

      return false;
    },
    [user, effectivePermissions]
  );

  /**
   * Check if user can access a specific page/module
   * @param {string} module - The module name
   * @returns {boolean}
   */
  const canAccess = useCallback(
    (module) => {
      if (!user) {
        return false;
      }

      // Admin can access everything
      if (user.roleKey === "admin" || user.role === "admin") {
        return true;
      }

      // If no permissions object, check basic role-based access
      if (!effectivePermissions) {
        return false;
      }

      // Check if module exists and has any permissions
      if (!effectivePermissions[module]) {
        return false;
      }

      const modulePermissions = effectivePermissions[module];

      // If it's an array, check if there are any permissions
      if (Array.isArray(modulePermissions)) {
        return modulePermissions.length > 0;
      }

      if (Array.isArray(modulePermissions.actions)) {
        return modulePermissions.enabled !== false && modulePermissions.actions.length > 0;
      }

      // If it's an object, check if there are any true values
      if (typeof modulePermissions === "object") {
        return Object.values(modulePermissions).some((val) => val === true);
      }

      return false;
    },
    [user, effectivePermissions]
  );

  /**
   * Check if a feature/module is disabled for the user
   * @param {string} module - The module name
   * @returns {boolean}
   */
  const isDisabled = useCallback(
    (module) => {
      return !canAccess(module);
    },
    [canAccess]
  );

  /**
   * Get list of allowed actions for a resource
   * @param {string} resource - The resource name
   * @returns {string[]}
   */
  const getAllowedActions = useCallback(
    (resource) => {
      if (!user) {
        return [];
      }

      // Admin has all actions
      if (user.roleKey === "admin" || user.role === "admin") {
        return ["view", "create", "edit", "delete", "approve", "export"];
      }

      if (!effectivePermissions || !effectivePermissions[resource]) {
        return [];
      }

      const resourcePermissions = effectivePermissions[resource];

      if (Array.isArray(resourcePermissions)) {
        return resourcePermissions;
      }

      if (Array.isArray(resourcePermissions.actions)) {
        return resourcePermissions.enabled !== false ? resourcePermissions.actions : [];
      }

      if (typeof resourcePermissions === "object") {
        return Object.entries(resourcePermissions)
          .filter(([_, allowed]) => allowed === true)
          .map(([action]) => action);
      }

      return [];
    },
    [user, effectivePermissions]
  );

  /**
   * Check if user has any of the specified roles
   * @param {string|string[]} roles - Role or array of roles
   * @returns {boolean}
   */
  const hasRole = useCallback(
    (roles) => {
      if (!user) {
        return false;
      }

      const userRole = user.roleKey || user.role;
      
      if (Array.isArray(roles)) {
        return roles.some(
          (role) => 
            role.toLowerCase() === userRole.toLowerCase()
        );
      }

      return userRole.toLowerCase() === roles.toLowerCase();
    },
    [user]
  );

  return useMemo(
    () => ({
      hasPermission,
      canAccess,
      isDisabled,
      getAllowedActions,
      hasRole,
      user,
    }),
    [hasPermission, canAccess, isDisabled, getAllowedActions, hasRole, user]
  );
}

/**
 * Higher-Order Component to protect routes/components with permission checks
 * 
 * @param {React.Component} Component - The component to protect
 * @param {Object} config - Configuration object
 * @param {string} config.module - The module name to check access
 * @param {string} config.resource - The resource name (optional, for specific permission)
 * @param {string} config.action - The action to check (optional, requires resource)
 * @param {React.Component} config.fallback - Custom fallback component
 * 
 * @example
 * export default withPermission(EmployeesPage, { 
 *   module: 'employees',
 *   resource: 'employees',
 *   action: 'view'
 * });
 */
export function withPermission(Component, config = {}) {
  return function PermissionWrappedComponent(props) {
    const { user } = props;
    const { module, resource, action, fallback: FallbackComponent } = config;
    const { hasPermission, canAccess } = usePermission(user, props.permissions);

    // Check specific permission if resource and action provided
    if (resource && action) {
      if (!hasPermission(resource, action)) {
        if (FallbackComponent) {
          return <FallbackComponent {...props} />;
        }
        return null;
      }
    }

    // Check module access
    if (module && !canAccess(module)) {
      if (FallbackComponent) {
        return <FallbackComponent {...props} />;
      }
      return null;
    }

    return <Component {...props} />;
  };
}

export default usePermission;
