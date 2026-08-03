import React, { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Eraser, ImagePlus, PenLine, PenSquare } from "lucide-react";
import Button from "../../UI/button";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";

export default function SignatureSection({
  values,
  readOnly,
  saving,
  error,
  onSave,
}) {
  const signatureRef = useRef(null);
  const fileInputRef = useRef(null);
  const [draftImage, setDraftImage] = useState("");

  const handleUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDraftImage(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    signatureRef.current?.clear();
    setDraftImage("");
  };

  const handleClearAll = () => {
    signatureRef.current?.clear();
    setDraftImage("");
    // Call onSave with empty data to clear the saved signature
    // The parent component needs to handle empty signatures without validation
    if (!readOnly) {
      onSave("", "");
    }
  };

  const handleSave = () => {
    if (readOnly) {
      return;
    }

    const drawnSignature = signatureRef.current && !signatureRef.current.isEmpty()
      ? signatureRef.current.toDataURL("image/png")
      : "";

    const signatureToSave = draftImage || drawnSignature || values.signatureDataUrl || "";
    
    // Only validate if trying to save a non-empty signature
    if (!signatureToSave) {
      return;
    }

    onSave(signatureToSave, draftImage ? "Uploaded signature" : "Drawn signature");
  };

  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("signature")}
      icon={PenLine}
      title="E-Signature"
      description="Upload or draw a reusable electronic signature for forms that require your authorized approval mark."
      readOnly={readOnly}
      saving={saving}
      onSave={handleSave}
      saveLabel="Save Signature"
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
            {draftImage || values.signatureDataUrl ? (
              <img
                src={draftImage || values.signatureDataUrl}
                alt="Signature preview"
                className="max-h-48 max-w-full object-contain"
              />
            ) : (
              <p className="m-0 text-center text-sm text-slate-500">
                Draw your signature on the pad or upload an image to preview it here.
              </p>
            )}
          </div>
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
