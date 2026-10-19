import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Award, Bold, Circle, Copy, Eye,
  FilePlus2, ImagePlus, Italic, Layers, LockKeyhole, Minus, Palette, PenLine, Plus, Redo2,
  Save, Square, Trash2, Type, Undo2, UnlockKeyhole, Upload } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import Modal from "../../components/UI/modal";
import Button from "../../components/UI/button";
import { registerNavigationGuard } from "../../utils/navigationGuard";
import { assignCertificateTemplateToCycle, createSavedCertificateTemplate, deleteSavedCertificateTemplate,
  fetchAwardCycles, fetchCertificateTemplate, updateCertificateTemplate,
  uploadCertificateDesign, uploadCertificateSignature } from "../../services/api";
import { CertificateCanvas, useCertificateFitScale } from "./AwardCertificate";
import { CERTIFICATE_DYNAMIC_FIELDS, CERTIFICATE_FONT_OPTIONS, CERTIFICATE_HEIGHT, CERTIFICATE_WIDTH,
  certificateTemplateSnapshot, createBlankCertificateTemplate, createCanvasElement, normalizeCertificateTemplate } from "./certificateTemplate";

const SAMPLE_CERTIFICATE = {
  id: "sample", employeeName: "Juan Dela Cruz", designationTitle: "Senior Science Research Specialist",
  divisionName: "Geological Survey Division", awardTitle: "Outstanding Public Servant",
  opensOn: "2026-01-01", closesOn: "2026-06-30", awardedOn: "2026-08-23",
  signatoryName: "Maria Dela Cruz", signatoryTitle: "Regional Director", certificateNumber: "SAMPLE-0001",
};
const inputClass = "h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:opacity-50";
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const elementLabel = (element) => element.type === "text" ? element.text.trim().slice(0, 35) || "Empty text"
  : element.type === "image" ? "Image" : ({ rectangle: "Rectangle", ellipse: "Ellipse", line: "Line" }[element.shape] || "Shape");

function recordsFrom(result) {
  const candidates = Array.isArray(result?.templates) ? result.templates : result?.template ? [{
    id: result.activeTemplateId || "default", name: "Default Certificate", template: result.template,
  }] : [];
  return candidates.map((record) => ({ ...record, id: String(record.id), template: normalizeCertificateTemplate(record.template) }));
}

function Tool({ icon: Icon, children, onClick, disabled, label, active = false, className = "" }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
    className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} ${className}`}>
    {Icon ? <Icon size={15} aria-hidden="true" /> : null}{children}
  </button>;
}
function Field({ label, children }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-[11px] font-semibold text-slate-500">{label}</span>{children}</label>;
}
function NumberField({ label, value, onChange, min, max, step = 1 }) {
  return <Field label={label}><input type="number" aria-label={label} value={value} min={min} max={max} step={step}
    onChange={(event) => { if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }} className={inputClass} /></Field>;
}
function ColorField({ label, value, onChange }) {
  return <Field label={label}><span className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-2">
    <input type="color" aria-label={label} value={/^#[\da-f]{6}$/i.test(value) ? value : "#ffffff"}
      onChange={(event) => onChange(event.target.value)} className="h-6 w-7 shrink-0 cursor-pointer border-0 bg-transparent p-0" />
    <span className="text-[11px] uppercase text-slate-500">{value}</span>
  </span></Field>;
}
function CanvasPreview({ template }) {
  const [frameRef, scale] = useCertificateFitScale({ max: 0.9 });
  return <div ref={frameRef} className="w-full overflow-auto bg-slate-100 p-2">
    <div className="mx-auto" style={{ width: CERTIFICATE_WIDTH * scale, height: CERTIFICATE_HEIGHT * scale }}>
      <div style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <CertificateCanvas certificate={SAMPLE_CERTIFICATE} template={template} />
      </div>
    </div>
  </div>;
}

export default function CertificateTemplateEditor() {
  const [history, setHistory] = useState(() => ({ present: createBlankCertificateTemplate(), past: [], future: [] }));
  const template = history.present;
  const [records, setRecords] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [name, setName] = useState("Untitled certificate");
  const [savedName, setSavedName] = useState("Untitled certificate");
  const [savedSnapshot, setSavedSnapshot] = useState(() => certificateTemplateSnapshot(createBlankCertificateTemplate()));
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState("add");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [loadError, setLoadError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState("");
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [viewportRef, fitZoom] = useCertificateFitScale({ min: 0.2, max: 0.85 });
  const [manualZoom, setManualZoom] = useState(null);
  const zoom = manualZoom ?? fitZoom;
  const stateRef = useRef(history);
  stateRef.current = history;
  const gestureRef = useRef(null);
  const uploadRef = useRef(null);
  const uploadMode = useRef("image");
  const signatureRef = useRef(null);
  const textRef = useRef(null);
  const busy = loading || Boolean(working);
  const freeform = template.version === 2;
  const elements = freeform ? template.elements : [];
  const selected = elements.find((element) => element.id === selectedId);
  const dirty = certificateTemplateSnapshot(template) !== savedSnapshot || name.trim() !== savedName;

  const commit = useCallback((change) => {
    setHistory((current) => {
      const next = normalizeCertificateTemplate(typeof change === "function" ? change(current.present) : change);
      if (certificateTemplateSnapshot(next) === certificateTemplateSnapshot(current.present)) return current;
      return { present: next, past: [...current.past.slice(-49), current.present], future: [] };
    });
  }, []);
  const undo = () => setHistory((current) => current.past.length ? {
    present: current.past[current.past.length - 1], past: current.past.slice(0, -1), future: [current.present, ...current.future].slice(0, 50),
  } : current);
  const redo = () => setHistory((current) => current.future.length ? {
    present: current.future[0], past: [...current.past, current.present].slice(-50), future: current.future.slice(1),
  } : current);
  const loadLibrary = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRecords(recordsFrom(await fetchCertificateTemplate())); }
    catch (error) { setLoadError(error.response?.data?.message || "Unable to load saved designs. Please try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    const result = await Swal.fire({ title: "Leave this design?", text: "You have unsaved changes.", icon: "warning",
      showCancelButton: true, confirmButtonText: "Discard changes", cancelButtonText: "Keep editing", confirmButtonColor: "#0f766e" });
    return Boolean(result.isConfirmed);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    const unregister = registerNavigationGuard(confirmDiscard);
    return () => { window.removeEventListener("beforeunload", warn); unregister(); };
  }, [confirmDiscard, dirty]);

  const openRecord = (record) => {
    const next = normalizeCertificateTemplate(record.template);
    setHistory({ present: next, past: [], future: [] });
    setActiveId(String(record.id)); setName(record.name); setSavedName(record.name);
    setSavedSnapshot(certificateTemplateSnapshot(next)); setSelectedId("");
  };
  const newBlank = async () => {
    if (!(await confirmDiscard())) return;
    const blank = createBlankCertificateTemplate();
    let nextName = "Untitled certificate";
    const existingNames = new Set(records.map((record) => record.name));
    for (let suffix = 2; existingNames.has(nextName); suffix += 1) nextName = `Untitled certificate ${suffix}`;
    setHistory({ present: blank, past: [], future: [] }); setActiveId(""); setName(nextName); setSavedName(nextName);
    setSavedSnapshot(certificateTemplateSnapshot(blank)); setSelectedId(""); setTab("add");
  };
  const updateElement = (patch, id = selectedId) => commit((current) => ({ ...current,
    elements: current.elements.map((element) => element.id === id ? { ...element, ...patch } : element),
  }));
  const addElement = (type, overrides = {}) => {
    if (!freeform || busy) return;
    if (elements.length >= 100) { toast.error("A design can contain up to 100 elements."); return; }
    const element = createCanvasElement(type, overrides);
    commit((current) => ({ ...current, elements: [...current.elements, element] })); setSelectedId(element.id);
  };
  const removeElement = (id = selectedId) => {
    if (!freeform || busy || elements.find((element) => element.id === id)?.locked) return;
    commit((current) => ({ ...current, elements: current.elements.filter((element) => element.id !== id) })); setSelectedId("");
  };
  const duplicate = () => {
    if (selected) addElement(selected.type, { ...selected, id: undefined, x: selected.x + 20, y: selected.y + 20, locked: false });
  };
  const reorder = (direction) => {
    if (!selected || selected.locked) return;
    commit((current) => {
      const items = [...current.elements];
      const index = items.findIndex((element) => element.id === selectedId);
      const target = direction === "front" ? items.length - 1 : direction === "back" ? 0 : clamp(index + direction, 0, items.length - 1);
      items.splice(target, 0, items.splice(index, 1)[0]); return { ...current, elements: items };
    });
  };
  const beginGesture = (event, id, mode = "move") => {
    const current = stateRef.current.present;
    const element = current.version === 2 && current.elements.find((item) => item.id === id);
    if (busy || !element || element.locked || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation(); setSelectedId(id);
    gestureRef.current = { before: current, element, mode, clientX: event.clientX, clientY: event.clientY, zoom };
  };
  useEffect(() => {
    const move = (event) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const dx = (event.clientX - gesture.clientX) / gesture.zoom;
      const dy = (event.clientY - gesture.clientY) / gesture.zoom;
      const angle = (gesture.element.rotation || 0) * Math.PI / 180;
      const patch = gesture.mode === "resize" ? {
        width: Math.max(12, gesture.element.width + dx * Math.cos(angle) + dy * Math.sin(angle)),
        height: Math.max(4, gesture.element.height - dx * Math.sin(angle) + dy * Math.cos(angle)),
      } : { x: gesture.element.x + dx, y: gesture.element.y + dy };
      const next = normalizeCertificateTemplate({ ...gesture.before,
        elements: gesture.before.elements.map((element) => element.id === gesture.element.id ? { ...element, ...patch } : element),
      });
      setHistory((current) => ({ ...current, present: next }));
    };
    const finish = (event) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gestureRef.current = null;
      setHistory((current) => event.type === "pointercancel" ? { ...current, present: gesture.before }
        : certificateTemplateSnapshot(current.present) === certificateTemplateSnapshot(gesture.before) ? current
          : { ...current, past: [...current.past.slice(-49), gesture.before], future: [] });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, []);
  const elementKeyDown = (event, id) => {
    const element = elements.find((item) => item.id === id);
    if (!element || element.locked || busy) return;
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (offsets[event.key]) {
      event.preventDefault(); event.stopPropagation(); const distance = event.shiftKey ? 10 : 1;
      updateElement({ x: element.x + offsets[event.key][0] * distance, y: element.y + offsets[event.key][1] * distance }, id);
    } else if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); removeElement(id);
    }
  };

  const save = async () => {
    if (busy) return;
    if (!name.trim()) { toast.error("Enter a template name."); return; }
    setWorking("save");
    try {
      const result = activeId ? await updateCertificateTemplate(template, { templateId: activeId, name: name.trim() })
        : await createSavedCertificateTemplate({ name: name.trim(), template });
      const record = result.templateRecord || { id: result.activeTemplateId || activeId, name: name.trim(), template: result.template || template };
      const library = Array.isArray(result.templates) ? recordsFrom(result)
        : activeId ? records.map((item) => item.id === activeId ? record : item) : [...records, record];
      setRecords(library); openRecord(record); toast.success("Certificate design saved.");
    } catch (error) { toast.error(error.response?.data?.message || "Unable to save the design."); }
    finally { setWorking(""); }
  };
  const deleteDesign = async () => {
    if (!activeId || records.length <= 1) return;
    const result = await Swal.fire({ title: "Delete this saved design?", text: "Previously issued certificates keep their design.",
      icon: "warning", showCancelButton: true, confirmButtonText: "Delete design", confirmButtonColor: "#be123c" });
    if (!result.isConfirmed) return;
    setWorking("delete");
    try {
      const response = await deleteSavedCertificateTemplate(activeId);
      const library = recordsFrom(response); setRecords(library.length ? library : records.filter((record) => record.id !== activeId));
      const blank = createBlankCertificateTemplate(); setHistory({ present: blank, past: [], future: [] });
      setActiveId(""); setName("Untitled certificate"); setSavedName("Untitled certificate"); setSavedSnapshot(certificateTemplateSnapshot(blank)); setSelectedId("");
      toast.success("Certificate design deleted.");
    } catch (error) { toast.error(error.response?.data?.message || "Unable to delete the design."); }
    finally { setWorking(""); }
  };
  const chooseUpload = (mode) => { uploadMode.current = mode; uploadRef.current?.click(); };
  const storeImage = async (file, mode) => {
    const limit = mode === "signature" ? 2 : 5;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > limit * 1024 * 1024) {
      toast.error(`Choose a PNG, JPG, or WebP image of ${limit} MB or smaller.`); return false;
    }
    if (mode !== "background" && elements.length >= 100) { toast.error("A design can contain up to 100 elements."); return false; }
    setWorking("upload");
    try {
      const result = mode === "signature" ? await uploadCertificateSignature(file) : await uploadCertificateDesign(file);
      const src = mode === "signature" ? result.signatureImage : result.backgroundImage;
      if (!src) throw new Error("The uploaded image is missing.");
      if (mode === "background") commit((current) => ({ ...current, backgroundImage: src }));
      else {
        const element = createCanvasElement("image", { src, width: mode === "signature" ? 220 : 240, height: mode === "signature" ? 90 : 180 });
        commit((current) => ({ ...current, elements: [...current.elements, element] })); setSelectedId(element.id);
      }
      toast.success("Image added to your design."); return true;
    } catch (error) { toast.error(error.response?.data?.message || "Unable to upload this image."); return false; }
    finally { setWorking(""); }
  };
  const uploadImage = async (event) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (file) await storeImage(file, uploadMode.current);
  };
  const saveSignature = async () => {
    if (!signatureRef.current || signatureRef.current.isEmpty()) { toast.error("Draw your signature first."); return; }
    const blob = await new Promise((resolve) => signatureRef.current.getCanvas().toBlob(resolve, "image/png"));
    if (blob && await storeImage(new File([blob], "signature.png", { type: "image/png" }), "signature")) setSignatureOpen(false);
  };
  const openAssignment = async () => {
    setAssignOpen(true); setLoadingCycles(true);
    try {
      const result = await fetchAwardCycles();
      const available = (result.cycles || []).filter((cycle) => String(cycle.status).toLowerCase() !== "closed" && !cycle.isArchived);
      setCycles(available); setCycleId(String(available[0]?.id || ""));
    } catch (error) { setCycles([]); toast.error(error.response?.data?.message || "Unable to load open nominations."); }
    finally { setLoadingCycles(false); }
  };
  const assign = async () => {
    if (!cycleId) return;
    setWorking("assign");
    try { await assignCertificateTemplateToCycle({ cycleId, template }); setAssignOpen(false); toast.success("Design assigned to the nomination."); }
    catch (error) { toast.error(error.response?.data?.message || "Unable to assign this design."); }
    finally { setWorking(""); }
  };
  const keyboardShortcuts = (event) => {
    if (event.defaultPrevented || busy) return;
    const editingText = event.target.closest?.("input,textarea,select,[contenteditable=true]");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
    else if (!editingText && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    else if (!editingText && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); }
    else if (!editingText && selectedId) elementKeyDown(event, selectedId);
  };
  const insertField = (key) => {
    if (!key) return;
    const start = textRef.current?.selectionStart ?? selected.text.length;
    const end = textRef.current?.selectionEnd ?? start;
    updateElement({ text: `${selected.text.slice(0, start)}{{${key}}}${selected.text.slice(end)}` });
  };

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" onKeyDown={keyboardShortcuts}>
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><Palette size={21} /></span>
        <div><h2 className="m-0 text-base font-bold text-slate-900">Certificate designer</h2><p className="m-0 mt-0.5 text-xs text-slate-500">Start with a blank canvas. Make every detail your own.</p></div>
      </div><div className="flex flex-wrap gap-2">
        <Tool icon={FilePlus2} onClick={newBlank} disabled={busy}>New blank</Tool><Tool icon={Eye} onClick={() => setPreviewOpen(true)} disabled={busy}>Preview</Tool>
        <Tool icon={Award} onClick={openAssignment} disabled={busy}>Use for nomination</Tool>
        <Button icon={Save} onClick={save} loading={working === "save"} disabled={busy || (Boolean(activeId) && !dirty)}>Save design</Button>
      </div>
    </header>
    {loadError ? <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
      {loadError}<button type="button" onClick={loadLibrary} className="font-bold underline">Try again</button></div> : null}
    <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_260px]">
      <aside className="min-w-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
        <div className="grid grid-cols-3 gap-1 border-b border-slate-100 p-2" role="tablist" aria-label="Design tools">
          {[{ id: "add", label: "Add", icon: Plus }, { id: "designs", label: "Designs", icon: Palette }, { id: "layers", label: "Layers", icon: Layers }].map(({ id, label, icon: Icon }) =>
            <button key={id} id={`certificate-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="certificate-tools-panel" type="button" onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold ${tab === id ? "bg-teal-50 text-teal-700" : "text-slate-500 hover:bg-slate-50"}`}><Icon size={17} />{label}</button>)}
        </div>
        <div id="certificate-tools-panel" role="tabpanel" aria-labelledby={`certificate-tab-${tab}`} className="max-h-[720px] space-y-5 overflow-y-auto p-4">
          {tab === "add" ? <fieldset disabled={busy || !freeform} className="m-0 min-w-0 space-y-5 border-0 p-0">
            <div className="space-y-2"><p className="m-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Text</p>
              <Tool icon={Type} onClick={() => addElement("text", { text: "Your heading", fontSize: 38, fontWeight: 700, height: 90 })} className="w-full justify-start">Add heading</Tool>
              <Tool icon={Type} onClick={() => addElement("text", { text: "Your text here", fontSize: 18 })} className="w-full justify-start">Add text</Tool></div>
            <div className="space-y-2"><p className="m-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Images &amp; signatures</p>
              <Tool icon={ImagePlus} onClick={() => chooseUpload("image")} className="w-full justify-start">Upload image</Tool>
              <Tool icon={Upload} onClick={() => chooseUpload("signature")} className="w-full justify-start">Upload signature</Tool>
              <Tool icon={PenLine} onClick={() => setSignatureOpen(true)} className="w-full justify-start">Draw signature</Tool></div>
            <div className="space-y-2"><p className="m-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Shapes</p><div className="grid grid-cols-3 gap-1.5">
              <Tool icon={Square} label="Add rectangle" onClick={() => addElement("shape", { shape: "rectangle" })} className="px-2" />
              <Tool icon={Circle} label="Add ellipse" onClick={() => addElement("shape", { shape: "ellipse" })} className="px-2" />
              <Tool icon={Minus} label="Add line" onClick={() => addElement("shape", { shape: "line", height: 4, strokeWidth: 2, fill: "transparent", stroke: "#334155" })} className="px-2" />
            </div></div>
            <div className="space-y-2"><p className="m-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Award fields</p>
              <p className="m-0 text-[11px] leading-5 text-slate-500">These fill in automatically for each recipient.</p>
              {CERTIFICATE_DYNAMIC_FIELDS.map((field) => <button type="button" key={field.key} aria-label={`Add ${field.label} field`}
                onClick={() => addElement("text", { text: `{{${field.key}}}`, fontSize: field.key === "employeeName" ? 32 : 16, height: 80 })}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-left text-xs font-medium text-slate-600 hover:border-teal-300 hover:bg-teal-50 disabled:opacity-40">{field.label}<Plus size={13} /></button>)}
            </div>
          </fieldset> : null}
          {tab === "designs" ? <div className="space-y-3"><p className="m-0 text-xs leading-5 text-slate-500">Open a saved design, or start a new blank certificate.</p>
            {loading ? <p role="status" className="text-xs text-slate-500">Loading designs...</p> : records.map((record) => <button key={record.id} type="button" disabled={busy}
              aria-label={`Open design ${record.name}`} onClick={async () => { if (await confirmDiscard()) openRecord(record); }}
              className={`w-full overflow-hidden rounded-xl border p-2 text-left ${activeId === record.id ? "border-teal-400 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <div className="relative mx-auto overflow-hidden border border-slate-200 bg-white" style={{ width: 176, height: 125 }}>
                <div style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, transform: "scale(0.1833)", transformOrigin: "top left" }}><CertificateCanvas certificate={SAMPLE_CERTIFICATE} template={record.template} /></div>
              </div><span className="mt-2 block truncate text-xs font-semibold text-slate-700">{record.name}</span></button>)}
          </div> : null}
          {tab === "layers" ? <div className="space-y-2"><p className="m-0 text-[11px] leading-5 text-slate-500">Top layers appear in front. Select a layer to edit it.</p>
            {elements.length ? [...elements].reverse().map((element) => <button type="button" key={element.id} onClick={() => setSelectedId(element.id)} aria-label={`Select layer ${elementLabel(element)}`}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-3 text-left text-xs ${selectedId === element.id ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-600"}`}>
              {element.type === "text" ? <Type size={14} /> : element.type === "image" ? <ImagePlus size={14} /> : <Square size={14} />}
              <span className="min-w-0 flex-1 truncate">{elementLabel(element)}</span>{element.locked ? <LockKeyhole size={12} /> : null}</button>)
              : <p className="py-6 text-center text-xs text-slate-400">Your layers will appear here.</p>}
          </div> : null}
        </div>
      </aside>
      <main className="min-w-0 bg-slate-100">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1"><Tool icon={Undo2} label="Undo" onClick={undo} disabled={busy || !history.past.length} className="px-2" />
            <Tool icon={Redo2} label="Redo" onClick={redo} disabled={busy || !history.future.length} className="px-2" /><span className="mx-1 h-5 border-l border-slate-200" />
            <Tool icon={Copy} label="Duplicate element" onClick={duplicate} disabled={busy || !selected} className="px-2" />
            <Tool icon={Trash2} label="Delete element" onClick={() => removeElement()} disabled={busy || !selected || selected.locked} className="px-2" />
          </div><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">A4 · Landscape</span>
        </div>
        {!freeform ? <div className="border-b border-teal-200 bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-900">This saved certificate keeps its existing layout. Choose <strong>New blank</strong> to create a design with your own text, images, and shapes.</div> : null}
        <div ref={viewportRef} className="relative min-h-[450px] overflow-auto p-4 sm:p-7 xl:min-h-[650px]" style={{ backgroundImage: "radial-gradient(#cbd5e1 0.8px, transparent 0.8px)", backgroundSize: "16px 16px" }}>
          <div className="mx-auto" style={{ width: CERTIFICATE_WIDTH * zoom, height: CERTIFICATE_HEIGHT * zoom }}>
            <div style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
              <CertificateCanvas certificate={SAMPLE_CERTIFICATE} template={template} editable={freeform && !busy} selectedElementId={selectedId} onSelectElement={setSelectedId}
                onElementPointerDown={beginGesture} onElementResizePointerDown={(event, id) => beginGesture(event, id, "resize")} onElementKeyDown={elementKeyDown}
                onElementDoubleClick={() => { textRef.current?.focus(); textRef.current?.select(); }} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2.5">
          <span className="text-[11px] text-slate-500">{elements.length} elements · Drag to move · Shift + arrows for larger steps</span>
          <div className="flex items-center gap-2"><button type="button" aria-label="Zoom out" onClick={() => setManualZoom(Math.max(0.2, zoom - 0.1))} className="rounded p-1 text-slate-500 hover:bg-slate-100"><Minus size={15} /></button>
            <span className="w-10 text-center text-xs text-slate-500">{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setManualZoom(Math.min(1.5, zoom + 0.1))} className="rounded p-1 text-slate-500 hover:bg-slate-100"><Plus size={15} /></button>
            <button type="button" onClick={() => setManualZoom(null)} className="rounded px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50">Fit</button></div>
        </div>
      </main>
      <aside className="min-w-0 space-y-5 border-t border-slate-200 p-4 xl:max-h-[800px] xl:overflow-y-auto xl:border-l xl:border-t-0">
        <Field label="Template name"><input aria-label="Template name" maxLength={80} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <p className="m-0 text-[11px] text-slate-400" role="status">{working ? "Working..." : dirty ? "Unsaved changes" : activeId ? "All changes saved" : "New blank design"}</p>
        {selected ? <div className="space-y-4 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-xs font-bold uppercase tracking-wider text-slate-500">{selected.type} properties</h3>
            <Tool icon={selected.locked ? UnlockKeyhole : LockKeyhole} label={selected.locked ? "Unlock element" : "Lock element"} onClick={() => updateElement({ locked: !selected.locked })} disabled={busy} className="px-2" /></div>
          <fieldset disabled={busy || selected.locked} className="m-0 min-w-0 space-y-4 border-0 p-0">
            {selected.type === "text" ? <>
              <Field label="Text content"><textarea ref={textRef} aria-label="Text content" rows={4} maxLength={5000} value={selected.text} onChange={(event) => updateElement({ text: event.target.value })} className={`${inputClass} h-auto resize-y py-2 leading-5`} /></Field>
              <Field label="Insert award field"><select aria-label="Insert award field" value="" onChange={(event) => insertField(event.target.value)} className={inputClass}>
                <option value="">Choose a field...</option>{CERTIFICATE_DYNAMIC_FIELDS.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></Field>
              <Field label="Font"><select aria-label="Font" value={selected.fontFamily} onChange={(event) => updateElement({ fontFamily: event.target.value })} className={inputClass}>
                {CERTIFICATE_FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-2"><NumberField label="Font size" value={selected.fontSize} min={8} max={128} onChange={(fontSize) => updateElement({ fontSize })} />
                <NumberField label="Line height" value={selected.lineHeight} min={0.5} max={3} step={0.1} onChange={(lineHeight) => updateElement({ lineHeight })} /></div>
              <div className="flex flex-wrap gap-1"><Tool icon={Bold} label="Bold" active={selected.fontWeight >= 600} onClick={() => updateElement({ fontWeight: selected.fontWeight >= 600 ? 400 : 700 })} className="px-2" />
                <Tool icon={Italic} label="Italic" active={selected.fontStyle === "italic"} onClick={() => updateElement({ fontStyle: selected.fontStyle === "italic" ? "normal" : "italic" })} className="px-2" />
                {[{ align: "left", icon: AlignLeft }, { align: "center", icon: AlignCenter }, { align: "right", icon: AlignRight }].map(({ align, icon }) => <Tool key={align} icon={icon} label={`Align ${align}`} active={selected.textAlign === align} onClick={() => updateElement({ textAlign: align })} className="px-2" />)}</div>
              <ColorField label="Text color" value={selected.color} onChange={(color) => updateElement({ color })} />
              <NumberField label="Letter spacing" value={selected.letterSpacing} min={-5} max={30} step={0.5} onChange={(letterSpacing) => updateElement({ letterSpacing })} />
            </> : selected.type === "shape" ? <>
              <ColorField label="Fill color" value={selected.fill} onChange={(fill) => updateElement({ fill })} />
              <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" aria-label="Transparent fill" checked={selected.fill === "transparent"} onChange={(event) => updateElement({ fill: event.target.checked ? "transparent" : "#e2e8f0" })} />No fill</label>
              <ColorField label="Border color" value={selected.stroke} onChange={(stroke) => updateElement({ stroke })} />
              <NumberField label="Border width" value={selected.strokeWidth} min={0} max={20} onChange={(strokeWidth) => updateElement({ strokeWidth })} />
              {selected.shape === "rectangle" ? <NumberField label="Corner radius" value={selected.borderRadius} min={0} max={240} onChange={(borderRadius) => updateElement({ borderRadius })} /> : null}
            </> : <Field label="Image fit"><select aria-label="Image fit" value={selected.fit} onChange={(event) => updateElement({ fit: event.target.value })} className={inputClass}><option value="contain">Fit entire image</option><option value="cover">Fill and crop</option></select></Field>}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
              {[{ key: "x", label: "X position", max: CERTIFICATE_WIDTH }, { key: "y", label: "Y position", max: CERTIFICATE_HEIGHT }, { key: "width", label: "Width", max: CERTIFICATE_WIDTH }, { key: "height", label: "Height", max: CERTIFICATE_HEIGHT }].map(({ key, label, max }) =>
                <NumberField key={key} label={label} value={Math.round(selected[key] * 10) / 10} min={key === "width" || key === "height" ? 1 : 0} max={max} onChange={(value) => updateElement({ [key]: value })} />)}
              <NumberField label="Rotation" value={selected.rotation} min={-360} max={360} onChange={(rotation) => updateElement({ rotation })} />
              <NumberField label="Opacity (%)" value={Math.round(selected.opacity * 100)} min={0} max={100} onChange={(value) => updateElement({ opacity: value / 100 })} />
            </div>
            <div className="grid grid-cols-2 gap-2"><Tool icon={ArrowUp} onClick={() => reorder(1)}>Forward</Tool><Tool icon={ArrowDown} onClick={() => reorder(-1)}>Backward</Tool>
              <Tool onClick={() => reorder("front")}>To front</Tool><Tool onClick={() => reorder("back")}>To back</Tool>
              <Tool onClick={() => updateElement({ x: (CERTIFICATE_WIDTH - selected.width) / 2 })}>Center X</Tool><Tool onClick={() => updateElement({ y: (CERTIFICATE_HEIGHT - selected.height) / 2 })}>Center Y</Tool></div>
          </fieldset>
        </div> : <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center"><Layers size={22} className="mx-auto mb-2 text-slate-300" />
          <p className="m-0 text-xs leading-5 text-slate-500">Add an element, then select it to change its appearance and position.</p></div>}
        {freeform ? <fieldset disabled={busy} className="m-0 min-w-0 space-y-3 border-0 border-t border-slate-100 p-0 pt-4">
          <h3 className="m-0 text-xs font-bold uppercase tracking-wider text-slate-500">Canvas</h3>
          <ColorField label="Page color" value={template.paper.backgroundColor} onChange={(backgroundColor) => commit((current) => ({ ...current, paper: { backgroundColor } }))} />
          <Tool icon={Upload} onClick={() => chooseUpload("background")} className="w-full">Upload background</Tool>
          {template.backgroundImage ? <><Field label="Background fit"><select aria-label="Background fit" value={template.backgroundImageFit} onChange={(event) => commit((current) => ({ ...current, backgroundImageFit: event.target.value }))} className={inputClass}>
            <option value="contain">Fit entire image</option><option value="cover">Fill page</option></select></Field><Tool icon={Trash2} onClick={() => commit((current) => ({ ...current, backgroundImage: "" }))} className="w-full">Remove background</Tool></> : null}
          <Tool onClick={() => { commit(createBlankCertificateTemplate()); setSelectedId(""); }} className="w-full">Clear canvas</Tool>
        </fieldset> : null}
        {activeId ? <Tool icon={Trash2} onClick={deleteDesign} disabled={busy || records.length <= 1} className="w-full text-rose-600">Delete saved design</Tool> : null}
      </aside>
    </div>
    <input ref={uploadRef} type="file" aria-label="Upload certificate image" accept="image/png,image/jpeg,image/webp" onChange={uploadImage} className="hidden" />
    <Modal open={previewOpen} title="Certificate preview" description="Sample award details show how your design will look for a recipient." onClose={() => setPreviewOpen(false)} maxWidth="max-w-5xl" portal><CanvasPreview template={template} /></Modal>
    <Modal open={assignOpen} title="Use design for nomination" description="Winners receive this design when the nomination closes." onClose={working ? undefined : () => setAssignOpen(false)} portal
      footer={<Button icon={Award} onClick={assign} disabled={busy || loadingCycles || !cycleId}>Use this design</Button>}>
      {loadingCycles ? <p role="status">Loading open nominations...</p> : cycles.length ? <Field label="Open nomination"><select aria-label="Open nomination" value={cycleId} onChange={(event) => setCycleId(event.target.value)} className={inputClass}>
        {cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.category || cycle.title || `Nomination ${cycle.id}`}</option>)}</select></Field> : <p>No open nominations are available.</p>}
    </Modal>
    <Modal open={signatureOpen} title="Draw a signature" description="Use your mouse or touch screen. The signature becomes an image you can move and resize." onClose={working ? undefined : () => setSignatureOpen(false)} maxWidth="max-w-xl" portal
      footer={<><Button variant="secondary" onClick={() => signatureRef.current?.clear()} disabled={busy}>Clear signature</Button><Button onClick={saveSignature} disabled={busy}>Add signature</Button></>}>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><SignatureCanvas ref={signatureRef} penColor="#111827" canvasProps={{ width: 480, height: 200, style: { width: "100%", height: 200 }, "aria-label": "Draw certificate signature" }} /></div>
    </Modal>
  </section>;
}
