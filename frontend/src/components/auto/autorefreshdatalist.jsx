import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_REFRESH_ALL_TOPIC,
  AUTO_REFRESH_DEBOUNCE_MS,
  AUTO_REFRESH_FALLBACK_INTERVAL_MS,
  autoRefreshTopicMatches,
  normalizeAutoRefreshTopics,
  subscribeAutoRefresh,
} from "./autorefreshconfig";

function defaultSelectData(result) {
  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result?.records)) {
    return result.records;
  }

  if (Array.isArray(result?.data)) {
    return result.data;
  }

  if (Array.isArray(result?.items)) {
    return result.items;
  }

  return result ?? [];
}

function useLatestRef(value) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

function clearTimer(timerRef) {
  if (timerRef.current !== null && typeof window !== "undefined") {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function clearIntervalTimer(timerRef) {
  if (timerRef.current !== null && typeof window !== "undefined") {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

function pageIsVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function useAutoRefreshData({
  enabled = true,
  fetchData,
  initialData = [],
  onData,
  onError,
  refreshKey = "",
  refreshOnMount = true,
  selectData = defaultSelectData,
  topic = AUTO_REFRESH_ALL_TOPIC,
  topics,
  debounceMs = AUTO_REFRESH_DEBOUNCE_MS,
} = {}) {
  const topicList = useMemo(
    () => normalizeAutoRefreshTopics(topics || topic || AUTO_REFRESH_ALL_TOPIC),
    [topic, topics]
  );
  const topicKey = topicList.join("|");
  const fetchDataRef = useLatestRef(fetchData);
  const onDataRef = useLatestRef(onData);
  const onErrorRef = useLatestRef(onError);
  const selectDataRef = useLatestRef(selectData);
  const debounceTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && refreshOnMount));
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const refresh = useCallback(async (reason = "manual", eventPayload = null) => {
    if (!enabled || typeof fetchDataRef.current !== "function") {
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isInitialLoad = reason === "mount";

    setError(null);
    setLoading(isInitialLoad);
    setRefreshing(!isInitialLoad);

    try {
      const result = await fetchDataRef.current({
        event: eventPayload,
        reason,
      });
      const nextData = selectDataRef.current(result);

      if (requestIdRef.current !== requestId) {
        return result;
      }

      setData(nextData);
      setLastSyncedAt(new Date().toISOString());

      if (typeof onDataRef.current === "function") {
        onDataRef.current(nextData, result, {
          event: eventPayload,
          reason,
        });
      }

      return result;
    } catch (nextError) {
      if (requestIdRef.current === requestId) {
        setError(nextError);

        if (typeof onErrorRef.current === "function") {
          onErrorRef.current(nextError, {
            event: eventPayload,
            reason,
          });
        }
      }

      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled, fetchDataRef, onDataRef, onErrorRef, selectDataRef]);

  const scheduleRefresh = useCallback((reason, eventPayload) => {
    if (typeof window === "undefined") {
      void refresh(reason, eventPayload);
      return;
    }

    clearTimer(debounceTimerRef);
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void refresh(reason, eventPayload);
    }, Math.max(0, Number(debounceMs) || 0));
  }, [debounceMs, refresh]);

  useEffect(() => {
    if (!enabled || !refreshOnMount) {
      return undefined;
    }

    void refresh("mount");
    return undefined;
  }, [enabled, refresh, refreshKey, refreshOnMount]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return subscribeAutoRefresh((payload) => {
      if (autoRefreshTopicMatches(payload.topics || payload.topic, topicList)) {
        scheduleRefresh("event", payload);
      }
    }, {
      topics: topicList,
    });
  }, [enabled, scheduleRefresh, topicKey, topicList]);

  useEffect(() => () => {
    clearTimer(debounceTimerRef);
  }, []);

  return {
    data,
    error,
    lastSyncedAt,
    loading,
    refresh,
    refreshing,
    setData,
  };
}

/**
 * The callback-only counterpart to `useAutoRefreshData`, for the many screens that already own their
 * fetch-and-store logic and only need to be told *when* to re-run it.
 *
 * Replaces the `useEffect(() => { void loadRecords(); }, [loadRecords])` that every workspace has,
 * and additionally re-runs it whenever the topic changes — from a mutation in this tab, another tab
 * of this browser, or another user's browser via the server change feed.
 *
 * The callback receives `{ background }`. It is `true` for every refresh that was not the first
 * load, and screens should use it to skip their loading skeleton: swapping a populated table for
 * spinner rows every time somebody else clicks Approve is the reload this is meant to replace.
 */
export function useAutoRefreshOnChange(onRefresh, {
  enabled = true,
  topic = AUTO_REFRESH_ALL_TOPIC,
  topics,
  debounceMs = AUTO_REFRESH_DEBOUNCE_MS,
  intervalMs = AUTO_REFRESH_FALLBACK_INTERVAL_MS,
  refreshOnFocus = true,
  refreshOnMount = true,
} = {}) {
  const topicList = useMemo(
    () => normalizeAutoRefreshTopics(topics || topic || AUTO_REFRESH_ALL_TOPIC),
    [topic, topics]
  );
  const topicKey = topicList.join("|");
  const onRefreshRef = useLatestRef(onRefresh);
  const debounceTimerRef = useRef(null);
  const intervalTimerRef = useRef(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let active = true;

    const run = (background, reason = "manual") => {
      if (!active || typeof onRefreshRef.current !== "function") {
        return;
      }

      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;

      Promise.resolve(onRefreshRef.current({ background, reason }))
        .catch(() => {})
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    if (refreshOnMount) {
      run(false, "mount");
    }

    const unsubscribe = subscribeAutoRefresh(() => {
      clearTimer(debounceTimerRef);
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        run(true, "event");
      }, Math.max(0, Number(debounceMs) || 0));
    }, { topics: topicList });

    const safeIntervalMs = Math.max(0, Number(intervalMs) || 0);
    if (safeIntervalMs > 0) {
      intervalTimerRef.current = window.setInterval(() => {
        if (pageIsVisible()) {
          run(true, "interval");
        }
      }, safeIntervalMs);
    }

    const handleFocusRefresh = () => {
      if (pageIsVisible()) {
        run(true, "focus");
      }
    };

    if (refreshOnFocus) {
      window.addEventListener("focus", handleFocusRefresh);
      document.addEventListener("visibilitychange", handleFocusRefresh);
    }

    return () => {
      active = false;
      clearTimer(debounceTimerRef);
      clearIntervalTimer(intervalTimerRef);
      if (refreshOnFocus) {
        window.removeEventListener("focus", handleFocusRefresh);
        document.removeEventListener("visibilitychange", handleFocusRefresh);
      }
      unsubscribe();
    };
    // topicList is rebuilt per render; topicKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounceMs, enabled, intervalMs, onRefreshRef, refreshOnFocus, refreshOnMount, topicKey]);
}

export default function AutoRefreshDataList({
  children,
  enabled = true,
  fetchData,
  initialData = [],
  onData,
  onError,
  refreshKey = "",
  refreshOnMount = true,
  selectData = defaultSelectData,
  topic = AUTO_REFRESH_ALL_TOPIC,
  topics,
  debounceMs = AUTO_REFRESH_DEBOUNCE_MS,
}) {
  const state = useAutoRefreshData({
    debounceMs,
    enabled,
    fetchData,
    initialData,
    onData,
    onError,
    refreshKey,
    refreshOnMount,
    selectData,
    topic,
    topics,
  });

  if (typeof children === "function") {
    return children(state);
  }

  return null;
}
