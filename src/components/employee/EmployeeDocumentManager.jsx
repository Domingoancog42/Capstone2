import React, { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import { deleteEmployeeDocument } from "../../services/api";
import { EmployeeDocumentList, useEmployeeDocuments } from "./EmployeeDocumentsModal";

export default function EmployeeDocumentManager({ employee, disabled = false }) {
  const employeeRecordId = Number(employee?.id || 0);
  const { documents, loading, loadError, replaceDocuments, reload } = useEmployeeDocuments(employeeRecordId);
  const [removingId, setRemovingId] = useState("");
  const operationScope = useRef(null);

  useEffect(() => {
    const scope = { active: true, disabled: false, busy: false };
    operationScope.current = scope;
    setRemovingId("");
    return () => { scope.active = false; };
  }, [employeeRecordId]);

  useEffect(() => {
    if (operationScope.current) {
      operationScope.current.disabled = disabled;
    }
  }, [disabled, employeeRecordId]);

  const handleRemove = async (documentItem) => {
    const scope = operationScope.current;
    if (!scope?.active || disabled || scope.disabled || scope.busy || employeeRecordId <= 0) {
      return;
    }
    scope.busy = true;
    setRemovingId(documentItem.id);
    try {
      const confirmation = await Swal.fire({
        title: "Remove uploaded document?",
        text: `Remove "${documentItem.fileName}" from this employee? This takes effect immediately and cannot be undone by Cancel.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, remove",
        cancelButtonText: "Keep document",
        confirmButtonColor: "#dc2626",
        cancelButtonColor: "#64748b",
        reverseButtons: true,
        focusCancel: true,
      });
      if (!confirmation.isConfirmed || !scope.active || scope.disabled) {
        return;
      }
      const result = await deleteEmployeeDocument(employeeRecordId, documentItem.id);
      if (scope.active) {
        replaceDocuments(result.documents || []);
        toast.success(result.message || "Document removed.");
      }
    } catch (error) {
      if (scope.active) {
        toast.error(error?.response?.data?.message || error?.message || "Unable to remove the document.");
      }
    } finally {
      scope.busy = false;
      if (scope.active) { setRemovingId(""); }
    }
  };

  return (
    <section aria-label="Uploaded employee documents" className="space-y-3">
      <div>
        <h3 className="m-0 text-sm font-semibold text-slate-900">Uploaded Documents</h3>
        <p className="m-0 mt-1 text-xs text-slate-500">
          View or remove files already uploaded by this employee. Confirmed removals take effect immediately; Save is not required and Cancel will not restore removed files.
        </p>
      </div>
      <EmployeeDocumentList employee={employee} documents={documents} loading={loading} loadError={loadError}
        onRetry={reload} onRemove={handleRemove} removingId={removingId} disabled={disabled} />
    </section>
  );
}
