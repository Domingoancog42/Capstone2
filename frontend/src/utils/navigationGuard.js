/*
 * A page with work in progress -- the profile while Edit Profile is open -- registers a guard here,
 * and App's navigate() asks every guard before leaving for another page. A guard resolves true to
 * let the navigation go ahead (the work was saved or discarded) and false to stay.
 *
 * React Router's own blocker needs a data router; this app mounts <BrowserRouter>, so the check
 * lives in the one navigate() every sidebar, header and breadcrumb link already goes through.
 */
const guards = new Set();

export function registerNavigationGuard(guard) {
  guards.add(guard);

  return () => {
    guards.delete(guard);
  };
}

export function hasNavigationGuard() {
  return guards.size > 0;
}

export async function confirmNavigation(targetPath) {
  for (const guard of Array.from(guards)) {
    // A guard that throws keeps the page where it is rather than losing the work behind it.
    try {
      if (!(await guard(targetPath))) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}
