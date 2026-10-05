import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Small, table-agnostic selection state used by request workspaces.
 *
 * The selected keys survive pagination, but are pruned as soon as a reload or filter removes the
 * underlying row. This keeps a bulk action from operating on a stale request the user can no longer
 * see.
 */
export default function useRowSelection(rows = [], getRowKey = (row) => row?.id) {
  const [selectedKeys, setSelectedKeys] = useState([]);

  const rowKey = useCallback(
    (row) => String(getRowKey(row) ?? ""),
    [getRowKey]
  );

  const availableKeySignature = useMemo(
    () => rows.map(rowKey).filter(Boolean).join("\u001f"),
    [rowKey, rows]
  );

  useEffect(() => {
    const availableKeys = new Set(availableKeySignature ? availableKeySignature.split("\u001f") : []);

    setSelectedKeys((current) => {
      const next = current.filter((key) => availableKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [availableKeySignature]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeySet.has(rowKey(row))),
    [rowKey, rows, selectedKeySet]
  );

  const toggleRow = useCallback((row) => {
    const key = rowKey(row);
    if (!key) return;

    setSelectedKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  }, [rowKey]);

  const toggleRows = useCallback((visibleRows = []) => {
    const keys = visibleRows.map(rowKey).filter(Boolean);
    if (keys.length === 0) return;

    setSelectedKeys((current) => {
      const currentSet = new Set(current);
      const allSelected = keys.every((key) => currentSet.has(key));

      keys.forEach((key) => {
        if (allSelected) currentSet.delete(key);
        else currentSet.add(key);
      });

      return Array.from(currentSet);
    });
  }, [rowKey]);

  const clearSelection = useCallback(() => setSelectedKeys([]), []);
  const isSelected = useCallback((row) => selectedKeySet.has(rowKey(row)), [rowKey, selectedKeySet]);
  const areAllSelected = useCallback((visibleRows = []) => (
    visibleRows.length > 0 && visibleRows.every((row) => selectedKeySet.has(rowKey(row)))
  ), [rowKey, selectedKeySet]);
  const areSomeSelected = useCallback((visibleRows = []) => (
    visibleRows.some((row) => selectedKeySet.has(rowKey(row)))
  ), [rowKey, selectedKeySet]);

  return {
    selectedRows,
    selectedCount: selectedRows.length,
    isSelected,
    toggleRow,
    toggleRows,
    areAllSelected,
    areSomeSelected,
    clearSelection,
  };
}
