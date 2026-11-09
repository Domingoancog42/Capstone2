import { useEffect } from "react";
import { parseMoment } from "./awardCycleUtils";

/**
 * Refetches at the moment a cycle's period runs out, which closes its nominations and voting together.
 *
 * `rewards.php` works the phase out from the clock and closes an expired cycle on the next request
 * that lists them, so without this the reader watching the clock run out would sit on a form or a
 * ballot the server has already stopped accepting until something else happened to refetch. A timer
 * aimed at the next boundary rather than a poll: one wake-up, at the only moment it matters, and the
 * refetch is what runs the close server-side.
 *
 * Shared by the Nomination screen and the employees' Award Voting page, which both watch the clock.
 */
export default function useDeadlineRefresh(cycles, onDeadlinePassed) {
  useEffect(() => {
    const now = Date.now();

    const nextDeadline = cycles
      .filter((cycle) => cycle.status !== "closed" && !cycle.isArchived)
      .map((cycle) => parseMoment(cycle.closesOn)?.getTime() ?? 0)
      .filter((moment) => moment > now)
      .sort((left, right) => left - right)[0];

    if (!nextDeadline) {
      return undefined;
    }

    // A couple of seconds past it, so the server's clock has certainly crossed the line too.
    const delay = nextDeadline - now + 2000;

    // setTimeout overflows past ~24.8 days and fires immediately; a deadline that distant will be
    // re-armed by a later render long before it arrives.
    if (delay > 2_147_483_647) {
      return undefined;
    }

    const timer = window.setTimeout(onDeadlinePassed, delay);

    return () => window.clearTimeout(timer);
  }, [cycles, onDeadlinePassed]);
}
