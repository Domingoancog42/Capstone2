import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAddresses } from "../services/addressService";
import { useAutoRefreshOnChange } from "../components/auto/autorefreshdatalist";
import { buildAddressDirectory } from "../utils/addressDirectory";

/*
 * The address pickers' lists: the built-in PSGC directory with the addresses added in Settings laid
 * over it (see utils/addressDirectory.js).
 *
 * One cached request serves every picker on screen, and the last answer seeds the next screen that
 * mounts, so reopening the employee form shows the added entries at once instead of after a request.
 * The list only changes when somebody saves in Settings, so this refreshes on the `addresses` topic
 * that save publishes and does not poll.
 */

const CACHE_TTL_MS = 30000;
/* A refresh still shares a response this fresh, so pickers refreshing together send one request. */
const REFRESH_SHARE_MS = 1000;
const EMPTY_ADDRESSES = Object.freeze([]);

let cached = null;
let lastResult = null;

function shapeResult(result) {
  return {
    addresses: Array.isArray(result?.addresses) ? result.addresses : EMPTY_ADDRESSES,
    canManage: Boolean(result?.canManage),
  };
}

function readAddresses(maxAgeMs = CACHE_TTL_MS) {
  const now = Date.now();

  if (cached && now - cached.at < maxAgeMs) {
    return cached.promise;
  }

  const promise = Promise.resolve()
    .then(fetchAddresses)
    .then((result) => {
      lastResult = shapeResult(result);
      return lastResult;
    })
    .catch((error) => {
      if (cached?.promise === promise) {
        cached = null;
      }
      throw error;
    });

  cached = { at: now, promise };
  return promise;
}

/** Puts a list the server has just answered with in the cache, so the refreshes that follow a save share it. */
export function primeAddressDirectory(result) {
  lastResult = shapeResult(result);
  cached = { at: Date.now(), promise: Promise.resolve(lastResult) };
  return lastResult;
}

/** Test hook: forget the cached list so each test reads its own mocks. */
export function resetAddressDirectoryCache() {
  cached = null;
  lastResult = null;
}

function sameAddresses(left, right) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export default function useAddressDirectory({ enabled = true } = {}) {
  const [state, setState] = useState(() => ({
    addresses: lastResult?.addresses || EMPTY_ADDRESSES,
    canManage: Boolean(lastResult?.canManage),
    status: lastResult ? "ready" : "loading",
    error: "",
  }));

  const applyResult = useCallback((result) => {
    setState((current) => ({
      // Keeping the same array when nothing changed keeps the directory, and every picker built on
      // it, from being rebuilt.
      addresses: sameAddresses(current.addresses, result.addresses) ? current.addresses : result.addresses,
      canManage: result.canManage,
      status: "ready",
      error: "",
    }));
  }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      applyResult(await readAddresses(refresh ? REFRESH_SHARE_MS : CACHE_TTL_MS));
    } catch (error) {
      // The built-in lists still work without the added entries, so a failed read only reports itself.
      setState((current) => ({
        ...current,
        status: "error",
        error: error?.response?.data?.message || "Unable to load the added addresses.",
      }));
    }
  }, [applyResult]);

  useEffect(() => {
    if (enabled) {
      void load();
    }
  }, [enabled, load]);

  useAutoRefreshOnChange(() => load({ refresh: true }), {
    enabled,
    topic: "addresses",
    refreshOnMount: false,
    refreshOnFocus: false,
    intervalMs: 0,
  });

  /** Shows a list a save just returned, here and in every picker that mounts after it. */
  const replaceAddresses = useCallback((result) => {
    applyResult(primeAddressDirectory(result));
  }, [applyResult]);

  const directory = useMemo(() => buildAddressDirectory(state.addresses), [state.addresses]);

  return useMemo(() => ({
    ...directory,
    canManage: state.canManage,
    status: state.status,
    error: state.error,
    reload: load,
    replaceAddresses,
  }), [directory, load, replaceAddresses, state.canManage, state.error, state.status]);
}
