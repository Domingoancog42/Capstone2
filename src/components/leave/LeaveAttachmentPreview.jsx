import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { fetchBackendFileBlob } from "../../utils/downloadBackendFile";

export function getLeaveAttachmentPreviewInfo(attachmentPath, attachmentName) {
  const storedPath = String(attachmentPath || "").trim();
  const storedName = String(attachmentName || "").trim();
  const source = storedPath || (/[/\\]/.test(storedName) ? storedName : "");
  const path = source ? resolveBackendAssetUrl(source) : "";
  let pathname = "";
  try { pathname = new URL(path, window.location.origin).pathname; } catch { /* No usable path. */ }
  let derivedName = pathname.split("/").pop() || "";
  try { derivedName = decodeURIComponent(derivedName); } catch { /* Keep the stored name. */ }
  const name = storedName || (/^(data:|blob:)/i.test(source) ? "Medical certificate" : derivedName);
  const image = /^data:image\//i.test(path) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(pathname || name)
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
  const pdf = /^data:application\/pdf[;,]/i.test(path) || /\.pdf$/i.test(pathname || name) || /\.pdf$/i.test(name);
  return { path, name, image, pdf, canPreview: Boolean(path && (image || pdf)) };
}

/** A viewport-level attachment viewer, shared by reviewers and leave applicants. */
export default function LeaveAttachmentPreview({ open, attachmentName, attachmentPath, onClose, onRemove, removing = false }) {
  const info = getLeaveAttachmentPreviewInfo(attachmentPath, attachmentName);
  const sourceKey = `${info.path}\n${info.name}`;
  const [preview, setPreview] = useState({ sourceKey: "", url: "", error: "", loading: true });
  const [retryVersion, setRetryVersion] = useState(0);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const headingId = useId();

  useEffect(() => {
    if (!open || !info.path || !info.canPreview) return undefined;
    let active = true;
    let objectUrl = "";
    setPreview({ sourceKey, url: "", error: "", loading: true });
    fetchBackendFileBlob(info.path, info.name)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ sourceKey, url: objectUrl, error: "", loading: false });
      })
      .catch((error) => {
        if (active) {
          setPreview({ sourceKey, url: "", error: error?.message || "Unable to open this attachment.", loading: false });
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, info.path, info.name, info.canPreview, sourceKey, retryVersion]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose?.();
      } else if (event.key === "Tab") {
        const controls = [...(dialogRef.current?.querySelectorAll("button:not(:disabled), a[href], iframe") || [])];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    // Capture Escape before the enclosing review/form/menu can handle it.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, onClose]);

  if (!open) return null;
  const currentPreview = preview.sourceKey === sourceKey ? preview : { url: "", error: "", loading: true };
  const loading = info.canPreview && currentPreview.loading;
  const error = !info.path ? "This request has no attachment link available."
    : !info.canPreview ? "Preview is not available for this file type." : currentPreview.error;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <button type="button" aria-label="Close attachment preview" tabIndex={-1}
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} className="relative z-10 flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="m-0 text-lg font-semibold text-slate-950">Attachment Preview</h3>
            <p title={info.name} className="m-0 mt-1 truncate text-sm text-slate-500">{info.name || "Medical certificate"}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onRemove ? (
              <button type="button" aria-label="Cancel medical certificate upload" aria-busy={removing}
                disabled={removing} onClick={onRemove}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                <X size={14} aria-hidden="true" />{removing ? "Cancelling..." : "Cancel Upload"}
              </button>
            ) : null}
            <button ref={closeRef} type="button" aria-label="Close attachment preview" onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto bg-slate-100 p-3 sm:p-4">
          {loading ? (
            <div role="status" className="grid min-h-48 place-content-center justify-items-center gap-3 text-sm font-semibold text-slate-600">
              <LoaderCircle className="animate-spin" size={26} aria-hidden="true" />Loading attachment...
            </div>
          ) : error ? (
            <div role="alert" className="grid min-h-48 place-content-center justify-items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-600">
              <AlertTriangle size={26} aria-hidden="true" />
              <p className="m-0">{error}</p>
              {info.canPreview ? (
                <button type="button" onClick={() => setRetryVersion((version) => version + 1)}
                  className="min-h-9 rounded-xl border border-slate-300 bg-white px-4 font-semibold hover:bg-slate-50">Retry</button>
              ) : null}
            </div>
          ) : info.image ? (
            <div className="grid place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
              <img src={currentPreview.url} alt={info.name || "Medical certificate"}
                onError={() => setPreview((current) => ({ ...current, error: "This attachment could not be displayed. Please try again." }))}
                className="block max-h-[calc(92dvh-10rem)] w-auto max-w-full object-contain" />
            </div>
          ) : (
            <iframe src={currentPreview.url} title={info.name || "Medical certificate"}
              className="h-[70dvh] w-full rounded-xl border border-slate-200 bg-white" />
          )}
        </div>
      </div>
    </div>, document.body,
  );
}
