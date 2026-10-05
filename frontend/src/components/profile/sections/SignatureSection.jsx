import React, { useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Eraser, ImagePlus, PenLine, PenSquare } from "lucide-react";
import Button from "../../UI/button";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";

/*
 * The signature has no Save button of its own: Edit Profile's Save Changes saves it with the rest of
 * the profile. What the person draws or uploads is handed up as `pendingSignature` straight away --
 * only the open tab is mounted, so a drawing kept here would be lost on switching tabs.
 *
 * `pendingSignature` is null when nothing has changed, `{ dataUrl, uploadName }` for a new signature,
 * and `{ dataUrl: "" }` when the saved one is to be removed.
 */
export default function SignatureSection({
  values,
  readOnly,
  error,
  pendingSignature = null,
  onPendingSignatureChange,
}) {
  const signatureRef = useRef(null);
  const fileInputRef = useRef(null);

  const previewSignature = pendingSignature ? pendingSignature.dataUrl : values.signatureDataUrl;

  const handleUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      signatureRef.current?.clear();
      onPendingSignatureChange?.({ dataUrl: String(reader.result || ""), uploadName: "Uploaded signature" });
    };
    reader.readAsDataURL(file);
  };

  const handleDrawEnd = () => {
    if (readOnly || !signatureRef.current || signatureRef.current.isEmpty()) {
      return;
    }

    onPendingSignatureChange?.({ dataUrl: signatureRef.current.toDataURL("image/png"), uploadName: "Drawn signature" });
  };

  /* Clears the pad and any unsaved drawing or upload; the saved signature is left as it is. */
  const handleClear = () => {
    signatureRef.current?.clear();
    onPendingSignatureChange?.(null);
  };

  /* Marks the saved signature for removal when the profile is saved. */
  const handleClearAll = () => {
    signatureRef.current?.clear();
    onPendingSignatureChange?.({ dataUrl: "", uploadName: "" });
  };

  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("signature")}
      icon={PenLine}
      title="E-Signature"
      description="Upload or draw a reusable electronic signature for forms that require your authorized approval mark."
      readOnly={readOnly}
    >
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <PenSquare size={16} />
            Draw Signature
          </div>
          <div className={`overflow-hidden rounded-[20px] border border-slate-200 bg-white ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
            <SignatureCanvas
              ref={signatureRef}
              canvasProps={{
                className: "h-56 w-full",
              }}
              penColor="#000000"
              onEnd={handleDrawEnd}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" icon={Eraser} disabled={readOnly} onClick={handleClear}>
              Clear Signature
            </Button>
            <Button variant="secondary" icon={ImagePlus} disabled={readOnly} onClick={() => fileInputRef.current?.click()}>
              Upload Signature Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
          {error ? <p className="m-0 mt-3 text-xs font-semibold text-[#B41818]">{error}</p> : null}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-700">Preview Signature</div>
          <div className="grid min-h-[224px] place-items-center rounded-[20px] border border-dashed border-slate-200 bg-slate-50 p-4">
            {previewSignature ? (
              <img
                src={previewSignature}
                alt="Signature preview"
                className="max-h-48 max-w-full object-contain"
              />
            ) : (
              <p className="m-0 text-center text-sm text-slate-500">
                Draw your signature on the pad or upload an image to preview it here.
              </p>
            )}
          </div>
          {pendingSignature ? (
            <p className="m-0 mt-2 text-xs font-medium text-amber-700">
              {pendingSignature.dataUrl
                ? "New signature — saved when you press Save Changes."
                : "Signature will be removed when you press Save Changes."}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" icon={Eraser} disabled={readOnly} onClick={handleClearAll}>
              Clear Signature
            </Button>
          </div>
        </div>
      </div>
    </ProfileSectionCard>
  );
}
