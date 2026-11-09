import { useCallback, useEffect, useState } from "react";
import { getEmployeeOptions } from "../services/api";
import { fetchLeaveTypes } from "../services/leaveService";
import { useAutoRefreshOnChange } from "../components/auto/autorefreshdatalist";

/*
 * The choices every list filter offers -- divisions, designations, employment statuses, leave types --
 * read from the database's own tables.
 *
 * Filters used to collect their options off the rows a screen had loaded, or from a list typed into
 * the code. Both drift: a division with nothing filed yet never appeared, a Chief's filter depended on
 * which requests happened to be on the page, and a leave type added in Settings could not be picked.
 *
 * One cached request serves every filter on screen, so a page mounting several of them asks once.
 */

const CACHE_TTL_MS = 30000;
/* A refresh still shares a response this fresh, so filters refreshing together send one request. */
const REFRESH_SHARE_MS = 1000;

function createCachedLoader(load) {
  let cached = null;

  const read = (maxAgeMs = CACHE_TTL_MS) => {
    const now = Date.now();

    if (cached && now - cached.at < maxAgeMs) {
      return cached.promise;
    }

    const promise = Promise.resolve()
      .then(load)
      .catch((error) => {
        if (cached?.promise === promise) {
          cached = null;
        }
        throw error;
      });

    cached = { at: now, promise };
    return promise;
  };

  read.reset = () => {
    cached = null;
  };

  return read;
}

const loadOrganizationOptions = createCachedLoader(() => getEmployeeOptions());
const loadLeaveTypeOptions = createCachedLoader(() => fetchLeaveTypes());

/** Test hook: drop the cached responses so each test reads its own mocks. */
export function resetFilterOptionsCache() {
  loadOrganizationOptions.reset();
  loadLeaveTypeOptions.reset();
}

function uniqueSorted(values) {
  return Array.from(new Set(
    values.map((value) => String(value || "").trim()).filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

const EMPTY_ORGANIZATION_OPTIONS = Object.freeze({
  divisions: [],
  designations: [],
  designationRecords: [],
  employmentStatuses: [],
  loaded: false,
});

function shapeOrganizationOptions(result) {
  const divisionRecords = Array.isArray(result?.divisions) ? result.divisions : [];
  const designationRecords = Array.isArray(result?.designations) ? result.designations : [];
  const divisionNameById = new Map(
    divisionRecords.map((division) => [String(division.id), String(division.name || "").trim()])
  );

  return {
    divisions: uniqueSorted(divisionRecords.map((division) => division.name || division.code)),
    designations: uniqueSorted(designationRecords.map((designation) => designation.name)),
    /* Kept with their division so a division-scoped desk can offer only its own designations. */
    designationRecords: designationRecords.map((designation) => ({
      name: String(designation.name || "").trim(),
      divisionName: divisionNameById.get(String(designation.division_id)) || "",
    })).filter((designation) => designation.name),
    employmentStatuses: uniqueSorted(Array.isArray(result?.employmentStatuses) ? result.employmentStatuses : []),
    loaded: true,
  };
}

/*
 * Loads once on mount, then again when an employee record changes or the window regains focus --
 * the moments a new division, designation or employment status could have appeared.
 */
function useCachedOptions(loader, shape, emptyValue, { enabled = true, topic } = {}) {
  const [options, setOptions] = useState(emptyValue);

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      setOptions(shape(await loader(refresh ? REFRESH_SHARE_MS : CACHE_TTL_MS)));
    } catch {
      /* A failed read leaves the last good options in place; filters still work on what they had. */
    }
  }, [loader, shape]);

  useEffect(() => {
    if (enabled) {
      void load();
    }
  }, [enabled, load]);

  useAutoRefreshOnChange(() => load({ refresh: true }), {
    enabled,
    topic,
    refreshOnMount: false,
  });

  return options;
}

/** Divisions, designations and employment statuses, straight from the database. */
export function useOrganizationFilterOptions({ enabled = true } = {}) {
  return useCachedOptions(
    loadOrganizationOptions,
    shapeOrganizationOptions,
    EMPTY_ORGANIZATION_OPTIONS,
    { enabled, topic: "employee" }
  );
}

const EMPTY_LEAVE_TYPES = Object.freeze([]);

function shapeLeaveTypes(result) {
  const leaveTypes = Array.isArray(result?.leaveTypes) ? result.leaveTypes : [];
  /* The table's own order (leave_type_id), which is the order Settings lists them in. */
  return Array.from(new Set(leaveTypes.map((leaveType) => String(leaveType?.name || "").trim()).filter(Boolean)));
}

/** The active leave types configured in the leave_types table. */
export function useLeaveTypeFilterOptions({ enabled = true } = {}) {
  return useCachedOptions(loadLeaveTypeOptions, shapeLeaveTypes, EMPTY_LEAVE_TYPES, {
    enabled,
    topic: "leave_request",
  });
}

/** The designations belonging to one division, for a desk that only ever sees that division. */
export function designationsForDivision(designationRecords = [], divisionName = "") {
  const target = String(divisionName || "").trim().toLowerCase();

  return uniqueSorted(
    designationRecords
      .filter((designation) => !target || designation.divisionName.toLowerCase() === target)
      .map((designation) => designation.name)
  );
}
