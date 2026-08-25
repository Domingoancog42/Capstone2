import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  Bold,
  Check,
  Eraser,
  Grip,
  Italic,
  LoaderCircle,
  Minus,
  Palette,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import {
  assignCertificateTemplateToCycle,
  fetchAwardCycles,
  fetchCertificateTemplate,
  updateCertificateTemplate,
  uploadCertificateDesign,
  uploadCertificateSignature,
} from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { CertificateCanvas } from "./AwardCertificate";
import {
  CERTIFICATE_ELEMENT_DEFINITIONS,
  CERTIFICATE_FONT_OPTIONS,
  CERTIFICATE_HEIGHT,
  CERTIFICATE_PRESETS,
  CERTIFICATE_WIDTH,
  certificateTemplateDraftForPreset,
  certificateTemplateSnapshot,
  createCertificateTemplate,
  normalizeCertificateTemplate,
  rememberCertificateTemplateDraft,
} from "./certificateTemplate";

const SAMPLE_CERTIFICATE = {
  id: "sample",
  employeeName: "Juan Dela Cruz",
  designationTitle: "Senior Science Research Specialist",
  divisionName: "Geological Survey Division",
  awardTitle: "Outstanding Public Servant",
  opensOn: "2026-01-01",
  closesOn: "2026-06-30",
  awardedOn: "2026-08-23",
  signatoryName: "Maria Dela Cruz",
  certificateNumber: "MGB-X-2026-0001",
};

const inputClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100";

function signatureCanvasToFile(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== "function") {
      reject(new Error("This browser cannot export the signature canvas."));
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The signature canvas did not create an image."));
        return;
      }

      resolve(new File([blob], `e-signature-${Date.now()}.png`, { type: "image/png" }));
    }, "image/png");
  });
}

function certificateElementHeight(id, item) {
  if (id === "signatureImage") {
    return item.width * 0.34;
  }

  return CERTIFICATE_ELEMENT_DEFINITIONS[id]?.type === "image" ? item.width : 18;
}

function TemplateThumbnail({ preset, number, active, onClick }) {
  const previewTemplate = useMemo(() => createCertificateTemplate(preset.id), [preset.id]);
  const scale = 0.174;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Template ${number}: ${preset.name}`}
      className={`w-full rounded-2xl border p-2 text-left transition ${
        active
          ? "border-teal-500 bg-teal-50 shadow-sm ring-2 ring-teal-100"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100" style={{ width: 168, height: 118 }}>
        <span className={`pointer-events-none absolute left-2 top-2 z-10 grid h-7 min-w-7 place-items-center rounded-full px-1.5 text-xs font-extrabold shadow-md ${
          active ? "bg-teal-700 text-white" : "bg-slate-900/90 text-white"
        }`}>
          {number}
        </span>
        <div style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <CertificateCanvas certificate={SAMPLE_CERTIFICATE} template={previewTemplate} />
        </div>
      </div>
      <span className="mt-2 flex items-center justify-between gap-2 px-1">
        <span>
          <strong className="block text-sm font-semibold text-slate-900">{preset.name}</strong>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{preset.description}</span>
        </span>
        {active ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-600 text-white">
            <Check size={13} />
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ColorControl({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      <span className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
        />
        <span className="text-xs font-medium uppercase tracking-wide text-slate-600">{value}</span>
      </span>
    </label>
  );
}

function ToggleControl({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
    </label>
  );
}

function IconToggle({ label, active, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-9 min-w-9 place-items-center rounded-lg border px-2 transition ${
        active
          ? "border-teal-600 bg-teal-50 text-teal-700"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

export default function CertificateTemplateEditor() {
  const [template, setTemplate] = useState(() => createCertificateTemplate());
  const [templateDrafts, setTemplateDrafts] = useState(() => {
    const initial = createCertificateTemplate();
    return { [initial.preset]: initial };
  });
  const [savedSnapshot, setSavedSnapshot] = useState(() => certificateTemplateSnapshot(createCertificateTemplate()));
  const [selectedElementId, setSelectedElementId] = useState("");
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [zoom, setZoom] = useState(0.72);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [nominationDialogOpen, setNominationDialogOpen] = useState(false);
  const [nominationCycles, setNominationCycles] = useState([]);
  const [selectedNominationId, setSelectedNominationId] = useState("");
  const [loadingNominations, setLoadingNominations] = useState(false);
  const [assigningNomination, setAssigningNomination] = useState(false);
  const [loadError, setLoadError] = useState("");
  const designInputRef = useRef(null);
  const signatureInputRef = useRef(null);
  const signaturePadRef = useRef(null);

  const dirty = certificateTemplateSnapshot(template) !== savedSnapshot;
  const selectedDefinition = CERTIFICATE_ELEMENT_DEFINITIONS[selectedElementId];
  const selectedElement = template.elements[selectedElementId];
  const selectedLogoVisible = selectedElementId === "leftLogo"
    ? template.showLeftLogo
    : template.showRightLogo;

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const result = await fetchCertificateTemplate();
        const next = normalizeCertificateTemplate(result?.template);

        if (!active) {
          return;
        }

        setTemplate(next);
        setTemplateDrafts({ [next.preset]: next });
        setSavedSnapshot(certificateTemplateSnapshot(next));
        setLoadError("");
      } catch (requestError) {
        if (active) {
          setLoadError(requestError.response?.data?.message || "Unable to load the saved certificate template.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setTemplateDrafts((drafts) => rememberCertificateTemplateDraft(drafts, template));
  }, [template]);

  useEffect(() => {
    const warnBeforeLeaving = (event) => {
      if (!dirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  const commit = useCallback((change) => {
    const next = normalizeCertificateTemplate(typeof change === "function" ? change(template) : change);
    setPast((history) => [...history.slice(-39), template]);
    setFuture([]);
    setTemplate(next);
  }, [template]);

  const undo = () => {
    if (past.length === 0) {
      return;
    }

    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([template, ...future].slice(0, 40));
    setTemplate(previous);
  };

  const redo = () => {
    if (future.length === 0) {
      return;
    }

    const next = future[0];
    setPast([...past.slice(-39), template]);
    setFuture(future.slice(1));
    setTemplate(next);
  };

  const updateSelectedElement = (patch) => {
    if (!selectedElementId) {
      return;
    }

    commit((current) => ({
      ...current,
      elements: {
        ...current.elements,
        [selectedElementId]: { ...current.elements[selectedElementId], ...patch },
      },
    }));
  };

  const resizeSelectedGraphic = (width) => {
    if (!selectedElementId) {
      return;
    }

    commit((current) => {
      const currentElement = current.elements[selectedElementId];
      const signature = selectedElementId === "signatureImage";
      const nextWidth = Math.max(signature ? 80 : 36, Math.min(signature ? 260 : 140, width));
      const centerX = currentElement.x + currentElement.width / 2;
      const nextHeight = signature ? nextWidth * 0.34 : nextWidth;

      return {
        ...current,
        elements: {
          ...current.elements,
          [selectedElementId]: {
            ...currentElement,
            width: nextWidth,
            x: Math.round(Math.max(0, Math.min(CERTIFICATE_WIDTH - nextWidth, centerX - nextWidth / 2))),
            y: Math.max(0, Math.min(CERTIFICATE_HEIGHT - nextHeight, currentElement.y)),
          },
        },
      };
    });
  };

  const nudgeElement = useCallback((id, deltaX, deltaY) => {
    commit((current) => {
      const currentElement = current.elements[id];
      if (!currentElement) {
        return current;
      }

      return {
        ...current,
        elements: {
          ...current.elements,
          [id]: {
            ...currentElement,
            x: Math.max(0, Math.min(CERTIFICATE_WIDTH - currentElement.width, currentElement.x + deltaX)),
            y: Math.max(0, Math.min(CERTIFICATE_HEIGHT - certificateElementHeight(id, currentElement), currentElement.y + deltaY)),
          },
        },
      };
    });
  }, [commit]);

  const startDragging = (event, id) => {
    if (event.button !== 0) {
      return;
    }

    const startTemplate = template;
    const startElement = startTemplate.elements[id];
    if (!startElement) {
      return;
    }

    const drag = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: startElement.x,
      startY: startElement.y,
      moved: false,
    };

    document.body.style.cursor = "grabbing";

    const move = (moveEvent) => {
      const deltaX = (moveEvent.clientX - drag.startClientX) / zoom;
      const deltaY = (moveEvent.clientY - drag.startClientY) / zoom;
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        drag.moved = true;
      }

      setTemplate((current) => {
        const currentElement = current.elements[id];
        return {
          ...current,
          elements: {
            ...current.elements,
            [id]: {
              ...currentElement,
              x: Math.round(Math.max(0, Math.min(CERTIFICATE_WIDTH - currentElement.width, drag.startX + deltaX))),
              y: Math.round(Math.max(0, Math.min(CERTIFICATE_HEIGHT - certificateElementHeight(id, currentElement), drag.startY + deltaY))),
            },
          },
        };
      });
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";

      if (drag.moved) {
        setPast((history) => [...history.slice(-39), startTemplate]);
        setFuture([]);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  const handleElementKeyDown = (event, id) => {
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];

    if (!direction) {
      return;
    }

    event.preventDefault();
    const distance = event.shiftKey ? 10 : 1;
    nudgeElement(id, direction[0] * distance, direction[1] * distance);
  };

  const changePreset = (presetId) => {
    setSelectedElementId("");

    if (presetId === template.preset) {
      return;
    }

    setTemplateDrafts((drafts) => rememberCertificateTemplateDraft(drafts, template));
    commit(certificateTemplateDraftForPreset(templateDrafts, presetId, template));
  };

  const resetTemplate = async () => {
    const result = await Swal.fire({
      icon: "question",
      title: "Reset this design?",
      text: "Text, colors, typography, and element positions will return to this design's defaults.",
      showCancelButton: true,
      confirmButtonText: "Reset design",
      confirmButtonColor: "#0f766e",
    });

    if (result.isConfirmed) {
      commit(createCertificateTemplate(template.preset));
      setSelectedElementId("");
    }
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      const result = await updateCertificateTemplate(template);
      const saved = normalizeCertificateTemplate(result?.template || template);
      setTemplate(saved);
      setSavedSnapshot(certificateTemplateSnapshot(saved));
      setPast([]);
      setFuture([]);
      toast.success(result?.message || "Certificate template saved.");
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to save the certificate template.");
    } finally {
      setSaving(false);
    }
  };

  const openNominationDialog = async () => {
    setNominationDialogOpen(true);
    setLoadingNominations(true);

    try {
      const result = await fetchAwardCycles();
      const available = (Array.isArray(result?.cycles) ? result.cycles : []).filter(
        (cycle) => cycle?.status !== "closed" && !cycle?.isArchived,
      );

      setNominationCycles(available);
      setSelectedNominationId(String(available[0]?.id || ""));
    } catch (requestError) {
      setNominationCycles([]);
      setSelectedNominationId("");
      toast.error(requestError.response?.data?.message || "Unable to load open nominations.");
    } finally {
      setLoadingNominations(false);
    }
  };

  const assignTemplateToNomination = async () => {
    if (!selectedNominationId) {
      toast.error("Choose an open nomination first.");
      return;
    }

    setAssigningNomination(true);
    try {
      const result = await assignCertificateTemplateToCycle({
        cycleId: selectedNominationId,
        template,
      });

      toast.success(result?.message || "Certificate assigned to the nomination.");
      setNominationDialogOpen(false);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to assign the certificate.");
    } finally {
      setAssigningNomination(false);
    }
  };

  const updateSignatureImage = (signatureImage) => {
    commit((current) => ({ ...current, signatureImage }));
  };

  const handleDesignUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Use a PNG, JPG, or WebP certificate design.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("The certificate design must be 5 MB or smaller.");
      return;
    }

    setUploadingDesign(true);
    try {
      const result = await uploadCertificateDesign(file);
      const backgroundImage = String(result?.backgroundImage || "");

      if (!backgroundImage) {
        throw new Error("The uploaded certificate design path is missing.");
      }

      commit((current) => ({ ...current, backgroundImage }));
      setSelectedElementId("");
      toast.success("Design image uploaded. Save or assign the template when ready.");
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to upload the certificate design.");
    } finally {
      setUploadingDesign(false);
    }
  };

  const removeDesignImage = () => {
    commit((current) => ({ ...current, backgroundImage: "" }));
    setSelectedElementId("");
  };

  const storeSignatureFile = async (file, successMessage) => {
    setUploadingSignature(true);
    try {
      const result = await uploadCertificateSignature(file);
      const signatureImage = String(result?.signatureImage || "");

      if (!signatureImage) {
        throw new Error("The uploaded signature path is missing.");
      }

      updateSignatureImage(signatureImage);
      setSelectedElementId("");
      toast.success(successMessage);
      return true;
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to save the signature.");
      return false;
    } finally {
      setUploadingSignature(false);
    }
  };

  const handleSignatureUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Use a PNG, JPG, or WebP signature image.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("The signature image must be 2 MB or smaller.");
      return;
    }

    await storeSignatureFile(file, "Signature uploaded. Save the template to apply it to certificates.");
  };

  const handleDrawnSignature = async () => {
    if (!signaturePadRef.current || signaturePadRef.current.isEmpty()) {
      toast.error("Draw your signature before using it.");
      return;
    }

    try {
      const file = await signatureCanvasToFile(signaturePadRef.current.getCanvas());
      const saved = await storeSignatureFile(file, "E-signature added. Save the template to apply it to certificates.");

      if (saved) {
        setSignaturePadOpen(false);
      }
    } catch {
      toast.error("Unable to prepare the e-signature. Please draw it again.");
    }
  };

  const removeSignatureImage = () => {
    updateSignatureImage("");
    setSelectedElementId("");
  };

  if (loading) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-500">
          <LoaderCircle size={18} className="animate-spin" />
          Loading certificate editor…
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-lg font-semibold text-slate-950">Certificate Template</h2>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${dirty ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Choose a design, click any text block, and drag it into place. Sample details are replaced by each winner's information.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            aria-label="Undo"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.length === 0}
            aria-label="Redo"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Redo2 size={17} />
          </button>
          <button
            type="button"
            onClick={resetTemplate}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCcw size={16} />
            Reset
          </button>
          <button
            type="button"
            onClick={openNominationDialog}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3.5 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
          >
            <Award size={16} />
            Use this certificate for nomination
          </button>
          <button
            type="button"
            onClick={saveTemplate}
            disabled={saving || !dirty}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </header>

      {loadError ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {loadError} You can still design now and save when the connection is available.
        </div>
      ) : null}

      <div className="grid xl:grid-cols-[210px_minmax(0,1fr)_285px]">
        <aside className="border-b border-slate-200 bg-slate-50/70 p-4 xl:max-h-[760px] xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Palette size={16} className="text-teal-700" />
              <h3 className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Designs</h3>
            </span>
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500 shadow-sm">
              {CERTIFICATE_PRESETS.length} templates
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 xl:flex-col xl:overflow-visible">
            {CERTIFICATE_PRESETS.map((preset, index) => (
              <div key={preset.id} className="w-[186px] shrink-0">
                <TemplateThumbnail
                  preset={preset}
                  number={index + 1}
                  active={template.preset === preset.id}
                  onClick={() => changePreset(preset.id)}
                />
              </div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 bg-slate-100">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Grip size={16} />
              <span>Drag to move · Arrow keys for fine adjustment</span>
            </div>
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.05).toFixed(2))))}
                aria-label="Zoom out"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <Minus size={15} />
              </button>
              <span className="w-14 text-center text-xs font-semibold text-slate-600">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((value) => Math.min(1, Number((value + 0.05).toFixed(2))))}
                aria-label="Zoom in"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>

          <div className="min-h-[640px] overflow-auto p-6">
            <div
              className="mx-auto"
              style={{ width: CERTIFICATE_WIDTH * zoom, height: CERTIFICATE_HEIGHT * zoom }}
            >
              <div style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                <CertificateCanvas
                  certificate={SAMPLE_CERTIFICATE}
                  template={template}
                  editable
                  selectedElementId={selectedElementId}
                  onSelectElement={setSelectedElementId}
                  onElementPointerDown={startDragging}
                  onElementKeyDown={handleElementKeyDown}
                />
              </div>
            </div>
          </div>
        </main>

        <aside className="border-t border-slate-200 bg-white p-4 xl:border-l xl:border-t-0">
          {selectedElement && selectedDefinition ? (
            <div>
              <div className="mb-4">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Selected block</p>
                <h3 className="m-0 mt-1 text-base font-semibold text-slate-900">{selectedDefinition.label}</h3>
                {selectedDefinition.dynamic ? (
                  <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                    This sample is automatically replaced with the winner's award details.
                  </p>
                ) : selectedDefinition.type === "image" ? (
                  <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                    Drag the {selectedElementId === "signatureImage" ? "signature" : "logo"} on the certificate or use the controls below for precise placement.
                  </p>
                ) : null}
              </div>

              {selectedDefinition.textKey ? (
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">
                    {selectedDefinition.label}
                  </span>
                  {selectedDefinition.multiline ? (
                    <textarea
                      rows={selectedElementId === "organization" ? 6 : 3}
                      value={template.text[selectedDefinition.textKey] || ""}
                      onChange={(event) => commit((current) => ({
                        ...current,
                        text: { ...current.text, [selectedDefinition.textKey]: event.target.value },
                      }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-5 text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    />
                  ) : (
                    <input
                      value={template.text[selectedDefinition.textKey] || ""}
                      onChange={(event) => commit((current) => ({
                        ...current,
                        text: { ...current.text, [selectedDefinition.textKey]: event.target.value },
                      }))}
                      className={inputClass}
                    />
                  )}
                </label>
              ) : null}

              {selectedDefinition.type === "image" ? (
                <div className="grid gap-4">
                  <label>
                    <span className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>{selectedElementId === "signatureImage" ? "Signature size" : "Logo size"}</span>
                      <span>{Math.round(selectedElement.width)} px</span>
                    </span>
                    <input
                      type="range"
                      min={selectedElementId === "signatureImage" ? 80 : 36}
                      max={selectedElementId === "signatureImage" ? 260 : 140}
                      step="2"
                      value={selectedElement.width}
                      onChange={(event) => resizeSelectedGraphic(Number(event.target.value))}
                      className="w-full accent-teal-700"
                    />
                  </label>

                  <div>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Position</span>
                    <div className="grid grid-cols-4 gap-2">
                      <IconToggle label="Move left" onClick={() => nudgeElement(selectedElementId, -5, 0)}><ArrowLeft size={15} /></IconToggle>
                      <IconToggle label="Move up" onClick={() => nudgeElement(selectedElementId, 0, -5)}><ArrowUp size={15} /></IconToggle>
                      <IconToggle label="Move down" onClick={() => nudgeElement(selectedElementId, 0, 5)}><ArrowDown size={15} /></IconToggle>
                      <IconToggle label="Move right" onClick={() => nudgeElement(selectedElementId, 5, 0)}><ArrowRight size={15} /></IconToggle>
                    </div>
                  </div>

                  {selectedElementId === "signatureImage" ? (
                    <button
                      type="button"
                      onClick={removeSignatureImage}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                    >
                      <Trash2 size={15} />
                      Remove signature
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => commit((current) => ({
                        ...current,
                        [selectedElementId === "leftLogo" ? "showLeftLogo" : "showRightLogo"]: !selectedLogoVisible,
                      }))}
                      className="h-10 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      {selectedLogoVisible ? "Hide this logo" : "Show this logo"}
                    </button>
                  )}
                </div>
              ) : (
              <div className="grid gap-3">
                <label>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">Font</span>
                  <select
                    value={selectedElement.fontFamily}
                    onChange={(event) => updateSelectedElement({ fontFamily: event.target.value })}
                    className={inputClass}
                    style={{ fontFamily: selectedElement.fontFamily }}
                  >
                    {CERTIFICATE_FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Size</span>
                    <input
                      type="number"
                      min="8"
                      max="64"
                      value={selectedElement.fontSize}
                      onChange={(event) => updateSelectedElement({ fontSize: Number(event.target.value) || 8 })}
                      className={inputClass}
                    />
                  </label>
                  <ColorControl label="Text color" value={selectedElement.color} onChange={(color) => updateSelectedElement({ color })} />
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">Text style</span>
                  <div className="flex flex-wrap gap-2">
                    <IconToggle
                      label="Bold"
                      active={Number(selectedElement.fontWeight) >= 700}
                      onClick={() => updateSelectedElement({ fontWeight: Number(selectedElement.fontWeight) >= 700 ? 400 : 700 })}
                    >
                      <Bold size={15} />
                    </IconToggle>
                    <IconToggle
                      label="Italic"
                      active={selectedElement.fontStyle === "italic"}
                      onClick={() => updateSelectedElement({ fontStyle: selectedElement.fontStyle === "italic" ? "normal" : "italic" })}
                    >
                      <Italic size={15} />
                    </IconToggle>
                    <IconToggle label="Align left" active={selectedElement.textAlign === "left"} onClick={() => updateSelectedElement({ textAlign: "left" })}>
                      <AlignLeft size={15} />
                    </IconToggle>
                    <IconToggle label="Align center" active={selectedElement.textAlign === "center"} onClick={() => updateSelectedElement({ textAlign: "center" })}>
                      <AlignCenter size={15} />
                    </IconToggle>
                    <IconToggle label="Align right" active={selectedElement.textAlign === "right"} onClick={() => updateSelectedElement({ textAlign: "right" })}>
                      <AlignRight size={15} />
                    </IconToggle>
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">Position</span>
                  <div className="grid grid-cols-4 gap-2">
                    <IconToggle label="Move left" onClick={() => nudgeElement(selectedElementId, -5, 0)}><ArrowLeft size={15} /></IconToggle>
                    <IconToggle label="Move up" onClick={() => nudgeElement(selectedElementId, 0, -5)}><ArrowUp size={15} /></IconToggle>
                    <IconToggle label="Move down" onClick={() => nudgeElement(selectedElementId, 0, 5)}><ArrowDown size={15} /></IconToggle>
                    <IconToggle label="Move right" onClick={() => nudgeElement(selectedElementId, 5, 0)}><ArrowRight size={15} /></IconToggle>
                  </div>
                </div>
              </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
              <p className="m-0 text-sm font-semibold text-slate-700">Select an element</p>
              <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Click a logo, signature, or text block to edit its look or position.</p>
            </div>
          )}

          <div className="mt-5 border-t border-slate-200 pt-5">
            <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Page style</p>
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                ref={designInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleDesignUpload}
                className="hidden"
                aria-label="Upload certificate design image"
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-800">Custom design image <span className="font-normal text-slate-500">(optional)</span></p>
                  <p className="m-0 mt-1 text-[11px] leading-4 text-slate-500">Upload a landscape PNG, JPG, or WebP up to 5 MB. It replaces the built-in background artwork.</p>
                </div>
                {template.backgroundImage ? (
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <img
                      src={resolveBackendAssetUrl(template.backgroundImage)}
                      alt="Uploaded certificate design preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : null}
              </div>
              {template.backgroundImage ? (
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">Image fit</span>
                  <select
                    value={template.backgroundImageFit}
                    onChange={(event) => commit((current) => ({ ...current, backgroundImageFit: event.target.value }))}
                    aria-label="Certificate design image fit"
                    className={inputClass}
                  >
                    <option value="cover">Fill the certificate</option>
                    <option value="contain">Show the whole image</option>
                  </select>
                </label>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={uploadingDesign}
                  onClick={() => designInputRef.current?.click()}
                  className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {uploadingDesign ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploadingDesign ? "Uploading…" : template.backgroundImage ? "Replace design image" : "Upload design image"}
                </button>
                {template.backgroundImage ? (
                  <button
                    type="button"
                    onClick={removeDesignImage}
                    className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                  >
                    <Trash2 size={14} />
                    Remove design image
                  </button>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorControl
                label="Background"
                value={template.paper.backgroundColor}
                onChange={(backgroundColor) => commit((current) => ({ ...current, paper: { ...current.paper, backgroundColor } }))}
              />
              <ColorControl
                label="Primary"
                value={template.paper.primaryColor}
                onChange={(primaryColor) => commit((current) => ({ ...current, paper: { ...current.paper, primaryColor } }))}
              />
              <ColorControl
                label="Accent"
                value={template.paper.accentColor}
                onChange={(accentColor) => commit((current) => ({ ...current, paper: { ...current.paper, accentColor } }))}
              />
            </div>
            <div className="mt-3 grid gap-2">
              <ToggleControl label="Show MGB logo" checked={template.showLeftLogo} onChange={(showLeftLogo) => commit((current) => ({ ...current, showLeftLogo }))} />
              <ToggleControl label="Show Bagong Pilipinas" checked={template.showRightLogo} onChange={(showRightLogo) => commit((current) => ({ ...current, showRightLogo }))} />
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                ref={signatureInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleSignatureUpload}
                className="hidden"
                aria-label="Upload certificate signature"
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-800">Certificate signature <span className="font-normal text-slate-500">(optional)</span></p>
                  <p className="m-0 mt-1 text-[11px] leading-4 text-slate-500">Upload a PNG, JPG, or WebP up to 2 MB, or draw an e-signature.</p>
                </div>
                {template.signatureImage ? (
                  <div className="grid h-12 w-24 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white p-1.5">
                    <img
                      src={resolveBackendAssetUrl(template.signatureImage)}
                      alt="Certificate signature preview"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={uploadingSignature}
                  onClick={() => signatureInputRef.current?.click()}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {uploadingSignature ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploadingSignature ? "Saving…" : template.signatureImage ? "Replace file" : "Upload file"}
                </button>
                <button
                  type="button"
                  disabled={uploadingSignature}
                  onClick={() => setSignaturePadOpen(true)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <PenLine size={14} />
                  {template.signatureImage ? "Draw again" : "Draw e-signature"}
                </button>
                {template.signatureImage ? (
                  <button
                    type="button"
                    onClick={removeSignatureImage}
                    aria-label="Remove certificate signature"
                    className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                  >
                    <Trash2 size={14} />
                    Remove signature
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {nominationDialogOpen ? (
        <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nomination-certificate-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 id="nomination-certificate-title" className="m-0 text-base font-semibold text-slate-950">Use certificate for nomination</h3>
                <p className="m-0 mt-1 text-xs leading-5 text-slate-500">The winner will receive this exact design automatically when the nomination closes.</p>
              </div>
              <button
                type="button"
                disabled={assigningNomination}
                onClick={() => setNominationDialogOpen(false)}
                aria-label="Close nomination selection"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {loadingNominations ? (
                <div className="flex min-h-32 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
                  <LoaderCircle size={17} className="animate-spin" />
                  Loading open nominations…
                </div>
              ) : nominationCycles.length > 0 ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Open nomination</span>
                  <select
                    value={selectedNominationId}
                    onChange={(event) => setSelectedNominationId(event.target.value)}
                    aria-label="Open nomination"
                    className={inputClass}
                  >
                    {nominationCycles.map((cycle) => {
                      const preset = CERTIFICATE_PRESETS.find((item) => item.id === cycle.certificateTemplatePreset);
                      const assignedLabel = cycle.hasCertificateTemplate
                        ? ` — currently ${preset?.name || "assigned"}`
                        : "";

                      return <option key={cycle.id} value={cycle.id}>{cycle.category}{assignedLabel}</option>;
                    })}
                  </select>
                  <p className="m-0 mt-2 text-xs leading-5 text-slate-500">You can assign a different design any time before the nomination closes.</p>
                </label>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center">
                  <p className="m-0 text-sm font-semibold text-slate-700">No open nominations</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Create or reopen a nomination before assigning this certificate.</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                type="button"
                disabled={assigningNomination}
                onClick={() => setNominationDialogOpen(false)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingNominations || assigningNomination || !selectedNominationId}
                onClick={assignTemplateToNomination}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {assigningNomination ? <LoaderCircle size={16} className="animate-spin" /> : <Award size={16} />}
                {assigningNomination ? "Assigning…" : "Use for nomination"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {signaturePadOpen ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !uploadingSignature) {
              setSignaturePadOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="e-signature-title"
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 id="e-signature-title" className="m-0 text-base font-semibold text-slate-950">Draw e-signature</h3>
                <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Draw inside the box using your mouse, trackpad, stylus, or finger.</p>
              </div>
              <button
                type="button"
                disabled={uploadingSignature}
                onClick={() => setSignaturePadOpen(false)}
                aria-label="Close e-signature pad"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white">
                <SignatureCanvas
                  ref={signaturePadRef}
                  penColor="#0f172a"
                  minWidth={1.2}
                  maxWidth={3}
                  canvasProps={{
                    className: "block h-52 w-full touch-none cursor-crosshair",
                    "aria-label": "E-signature drawing pad",
                  }}
                />
                <div className="pointer-events-none absolute bottom-10 left-8 right-8 border-b border-slate-300" />
                <span className="pointer-events-none absolute bottom-3 left-8 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Sign above the line</span>
              </div>
              <p className="m-0 mt-3 text-xs leading-5 text-slate-500">Using a signature is optional. Only use a signature you are authorized to place on certificates.</p>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                disabled={uploadingSignature}
                onClick={() => signaturePadRef.current?.clear()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                <Eraser size={16} />
                Clear
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={uploadingSignature}
                  onClick={() => setSignaturePadOpen(false)}
                  className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 sm:flex-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={uploadingSignature}
                  onClick={handleDrawnSignature}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none"
                >
                  {uploadingSignature ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                  {uploadingSignature ? "Saving…" : "Use signature"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
