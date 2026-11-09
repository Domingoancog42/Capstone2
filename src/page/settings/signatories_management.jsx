import React, { useCallback, useEffect, useState } from "react";
import { Clock3, FileSignature, Save } from "lucide-react";
import Button from "../../components/UI/button";
import SettingsPanel from "../../components/settings/SettingsPanel";
import { SettingsToggleRow } from "../../components/settings/SettingsControls";
import { getFilingSignatories, saveFilingSignatories } from "../../services/api";
import { userHasPermission } from "../../utils/permissions";
import { normalizeRole } from "../../utils/roleRoutes";

export default function SignatoriesManagement({ user }) {
  const [settings, setSettings] = useState(null);
  const [savedSettings, setSavedSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState("info");
  const canEdit = normalizeRole(user?.roleKey || user?.role) === "admin"
    && userHasPermission(user, "settings", "edit");
  const dirty = settings && (settings.showTimestamps !== savedSettings?.showTimestamps
    || settings.showESignatures !== savedSettings?.showESignatures);

  const loadSettings = useCallback(async (isActive = () => true) => {
    setLoading(true);
    setNotice("");
    try {
      const result = await getFilingSignatories();
      if (isActive()) {
        setSettings(result.filingSignatories);
        setSavedSettings(result.filingSignatories);
      }
    } catch (error) {
      if (isActive()) {
        setNotice(error.response?.data?.message || "Unable to load signatory settings. Please try again.");
        setNoticeTone("error");
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadSettings(() => active);
    return () => { active = false; };
  }, [loadSettings]);

  const toggle = (key) => {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
    setNotice("");
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    if (!canEdit || !settings || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const result = await saveFilingSignatories(settings);
      setSettings(result.filingSignatories);
      setSavedSettings(result.filingSignatories);
      setNotice("Signatory settings saved successfully.");
      setNoticeTone("success");
    } catch (error) {
      setNotice(error.response?.data?.message || "Unable to save signatory settings. Please try again.");
      setNoticeTone("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPanel
      className="app-optional-field"
      icon={FileSignature}
      title="Signatories Management"
      description="Control timestamps and e-signatures on filing forms for all users, including printed and downloaded copies."
      notice={notice}
      noticeTone={noticeTone}
      onSubmit={saveSettings}
      footer={settings ? (
        <Button type="submit" icon={Save} loading={saving} disabled={!canEdit || loading || !dirty}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      ) : null}
    >
      {loading ? <p role="status" className="m-0 text-sm text-slate-500">Loading signatory settings...</p> : settings ? (
        <div className="space-y-4">
          <SettingsToggleRow
            id="filing-show-timestamps"
            icon={Clock3}
            label="Show timestamps"
            description="Display filed, reviewed, and approved date and time labels in signing areas."
            checked={settings.showTimestamps}
            onToggle={() => toggle("showTimestamps")}
            disabled={!canEdit || saving}
          />
          <SettingsToggleRow
            id="filing-show-e-signatures"
            icon={FileSignature}
            label="Show e-signatures"
            description="Display saved signature images in applicant and approver signing areas."
            checked={settings.showESignatures}
            onToggle={() => toggle("showESignatures")}
            disabled={!canEdit || saving}
          />
          <p className="m-0 text-sm leading-6 text-slate-500">
            These settings apply to leave, travel order, CTO, pass slip, loan, leave monetization,
            and overtime accomplishment forms. Names and signing lines stay visible.
            Saved signatures and approval records are retained when either option is off.
          </p>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => loadSettings()}>Try Again</Button>
      )}
    </SettingsPanel>
  );
}
