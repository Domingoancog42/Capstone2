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
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setImageDataUrl(resolveBackendAssetUrl(currentImage) || "");
    setHasLocalUpload(false);
    setSaving(false);
  }, [currentImage, open]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(String(reader.result || ""));
      setHasLocalUpload(true);
      setSaving(false);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
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

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 420;
      canvas.height = 420;
      const context = canvas.getContext("2d");

      if (!context) {
        setSaving(false);
        return;
      }

      // Center-crop the upload so it fills the circular profile avatar without white bars.
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      const x = (canvas.width - drawWidth) / 2;
      const y = (canvas.height - drawHeight) / 2;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, x, y, drawWidth, drawHeight);

      onSave(canvas.toDataURL("image/png"));
      setSaving(false);
      onClose();
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
            onClick={() => {
              setImageDataUrl("");
              setHasLocalUpload(false);
            }}
          >
            Remove
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>Save Picture</Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        <div className="grid aspect-square max-h-80 w-full place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-3 sm:h-80 sm:aspect-auto sm:rounded-[28px] sm:p-4">
          {imageDataUrl ? (
            <div className="grid aspect-square w-full max-w-64 place-items-center overflow-hidden rounded-full border-4 border-white bg-white shadow-inner ring-1 ring-slate-200">
              <img
                src={imageDataUrl}
                alt="Profile preview"
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="text-center text-slate-500">
              <ImagePlus className="mx-auto mb-3" size={36} />
              <p className="m-0 text-sm font-semibold">Upload a photo to preview it as a circle</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:rounded-[24px] sm:p-5">
          <p className="m-0 text-sm text-slate-600">
            Uploaded images are automatically centered and cropped to fill the circular profile picture.
          </p>
        </div>

        <Button
          variant="secondary"
          icon={Upload}
          fullWidth
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Image
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </Modal>
  );
}
