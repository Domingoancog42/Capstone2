import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import Modal from "../UI/modal";
import Button from "../UI/button";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

export default function ProfileImageModal({
  open,
  currentImage = "",
  onClose,
  onSave,
}) {
  const [imageDataUrl, setImageDataUrl] = useState(resolveBackendAssetUrl(currentImage) || "");
  const [hasLocalUpload, setHasLocalUpload] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setImageDataUrl(resolveBackendAssetUrl(currentImage) || "");
    setHasLocalUpload(false);
    setSaving(false);
    setReading(false);
    setError("");
    setPosition({ x: 50, y: 50 });
  }, [currentImage, open]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = "";
    setError("");
    if (file.type && !file.type.startsWith("image/")) {
      setError("Choose an image file for your passport photo.");
      return;
    }

    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(String(reader.result || ""));
      setHasLocalUpload(true);
      setPosition({ x: 50, y: 50 });
      setSaving(false);
      setReading(false);
    };
    reader.onerror = () => {
      setError("Unable to read this image. Please choose another photo.");
      setReading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!imageDataUrl) {
      onSave("");
      onClose();
      return;
    }

    if (!hasLocalUpload) {
      onClose();
      return;
    }

    setSaving(true);
    setError("");

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      // Preserve the PDS passport-photo ratio: 3.5 cm wide by 4.5 cm high.
      canvas.width = 420;
      canvas.height = 540;
      const context = canvas.getContext("2d");

      if (!context) {
        setError("Unable to prepare the photo. Please try again.");
        setSaving(false);
        return;
      }

      // Match the portrait preview's object-fit/object-position without stretching the photo.
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      const x = (canvas.width - drawWidth) * position.x / 100;
      const y = (canvas.height - drawHeight) * position.y / 100;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, x, y, drawWidth, drawHeight);

      onSave(canvas.toDataURL("image/png"));
      setSaving(false);
      onClose();
    };
    image.onerror = () => {
      setError("Unable to open this image. Please choose another photo.");
      setSaving(false);
    };
    image.src = imageDataUrl;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Profile Picture"
      maxWidth="max-w-xl"
      footer={
        <>
          <Button
            variant="secondary"
            icon={Trash2}
            disabled={saving || reading}
            onClick={() => {
              setImageDataUrl("");
              setHasLocalUpload(false);
              setError("");
            }}
          >
            Remove
          </Button>
          <Button variant="primary" loading={saving} disabled={reading} onClick={handleSave}>Save Picture</Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        <div className="grid w-full place-items-center rounded-2xl border border-slate-200 bg-slate-100 p-3 sm:rounded-[28px] sm:p-4">
          <div className="grid aspect-[7/9] w-48 max-w-full place-items-center overflow-hidden border border-slate-400 bg-white shadow-sm sm:w-56">
            {imageDataUrl ? (
              <img
                src={imageDataUrl}
                alt="Passport portrait, 3.5 cm wide by 4.5 cm high"
                className="h-full w-full object-cover"
                style={{ objectPosition: `${position.x}% ${position.y}%` }}
              />
            ) : (
              <div className="p-4 text-center text-slate-500">
                <ImagePlus className="mx-auto mb-3" size={36} />
                <p className="m-0 text-sm font-semibold">Upload a passport photo</p>
              </div>
            )}
          </div>
          <p className="m-0 mt-3 text-xs font-semibold text-slate-600">4.5 cm high × 3.5 cm wide</p>
        </div>

        {hasLocalUpload && imageDataUrl ? (
          <div className="space-y-3">
            <p className="m-0 text-sm text-slate-600">Adjust the framing so your full face is visible.</p>
            {[
              ["x", "Horizontal position"],
              ["y", "Vertical position"],
            ].map(([axis, label]) => (
              <label key={axis} className="block text-sm text-slate-600">
                {label}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={position[axis]}
                  disabled={saving || reading}
                  onChange={(event) => setPosition((current) => ({ ...current, [axis]: Number(event.target.value) }))}
                  className="mt-1 block w-full"
                />
              </label>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:rounded-[24px] sm:p-5">
          <p className="m-0 text-sm text-slate-600">
            Upload an unfiltered passport-sized photo taken within the last 6 months. The photo is cropped to 4.5 cm high × 3.5 cm wide for your PDS. Review the preview before saving.
          </p>
        </div>

        {error ? <p role="alert" className="m-0 text-sm text-red-600">{error}</p> : null}

        <Button
          variant="secondary"
          icon={Upload}
          fullWidth
          disabled={saving || reading}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Image
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Upload passport photo"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </Modal>
  );
}
