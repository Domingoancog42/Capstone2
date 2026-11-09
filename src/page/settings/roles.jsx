import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import SettingsNotice from "../../components/settings/SettingsNotice";
import {
  createRole,
  deleteRole,
  getRoles,
  updateRole,
} from "../../services/api";
import {
  createDefaultPermissionTemplates,
  normalizeSinglePermissionTemplate,
  permissionItems,
  permissionSections,
} from "./permission";

const emptyRoleForm = {
  id: null,
  label: "",
  baseRole: "",
  description: "",
};

function moduleTemplateForBaseRole(baseRole, templates) {
  const template = templates?.[baseRole] || createDefaultPermissionTemplates()[baseRole];

  return normalizeSinglePermissionTemplate(template || { enabled: true, modules: {} });
}

function countEnabledModules(template) {
  return Object.values(template?.modules || {}).filter((modulePermission) => modulePermission.enabled).length;
}

/**
 * Modules that only the Admin workspace has a page for. A custom role cannot be based on
 * Admin -- doing so would hand out the admin dashboard, which this checklist cannot take
 * back -- so ticking one of these grants a permission with nowhere to exercise it. Saying
 * so on the box is kinder than letting it look as though the tick did not save.
 */
const ADMIN_ONLY_MODULE_KEYS = new Set(["users", "permissions", "settings", "auditLogs"]);

function roleKeyFromLabel(label) {
  return String(label || "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Administrators can create a role that reuses one of the existing workforce
 * dashboards and then choose the modules it can enter.  The backend owns the
 * validation and the stored template; this screen only keeps a friendly draft.
 */
export default function RoleSettings({ onRolesChanged }) {
  const [roles, setRoles] = useState([]);
  const [baseRoles, setBaseRoles] = useState([]);
  const [templates, setTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(emptyRoleForm);
  const [moduleAccess, setModuleAccess] = useState(() => normalizeSinglePermissionTemplate({}));
  const [moduleAccessTouched, setModuleAccessTouched] = useState(false);

  const applyResult = useCallback((result) => {
    setRoles(Array.isArray(result?.roles) ? result.roles : []);
    setBaseRoles(Array.isArray(result?.baseRoles) ? result.baseRoles : []);
    setTemplates(result?.templates || {});
  }, []);

  const loadRoles = useCallback(async () => {
    setLoading(true);

    try {
      const result = await getRoles();
      applyResult(result);
      onRolesChanged?.(result);
      setMessage("");
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load roles.");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, [applyResult, onRolesChanged]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const customRoles = useMemo(() => roles.filter((role) => role.isCustom), [roles]);
  const builtinRoles = useMemo(() => roles.filter((role) => !role.isCustom), [roles]);

  // Until the administrator starts adjusting the checklist, switching base roles
  // refreshes its proposed access from that role's current template.
  useEffect(() => {
    if (!editorOpen || moduleAccessTouched || !form.baseRole) {
      return;
    }

    setModuleAccess(moduleTemplateForBaseRole(form.baseRole, templates));
  }, [editorOpen, form.baseRole, moduleAccessTouched, templates]);

  const openCreate = () => {
    const firstBaseRole = baseRoles[0]?.key || "";

    setForm({ ...emptyRoleForm, baseRole: firstBaseRole });
    setModuleAccess(moduleTemplateForBaseRole(firstBaseRole, templates));
    setModuleAccessTouched(false);
    setMessage("");
    setEditorOpen(true);
  };

  const openEdit = (role) => {
    setForm({
      id: role.id,
      label: role.label || "",
      baseRole: role.baseRole || "",
      description: role.description || "",
    });
    setModuleAccess(normalizeSinglePermissionTemplate(templates?.[role.key] || {}));
    setModuleAccessTouched(true);
    setMessage("");
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) {
      return;
    }

    setEditorOpen(false);
    setForm(emptyRoleForm);
    setModuleAccessTouched(false);
  };

  const toggleModule = (moduleKey, defaultActions) => {
    setModuleAccessTouched(true);
    setModuleAccess((current) => {
      const modulePermission = current.modules?.[moduleKey] || { enabled: false, actions: [] };
      const enabled = !modulePermission.enabled;

      return {
        ...current,
        modules: {
          ...current.modules,
          [moduleKey]: {
            enabled,
            actions: enabled
              ? (modulePermission.actions?.length ? modulePermission.actions : defaultActions)
              : [],
          },
        },
      };
    });
  };

  const setAllModules = (enabled) => {
    setModuleAccessTouched(true);
    setModuleAccess((current) => ({
      ...current,
      modules: permissionItems.reduce((modules, item) => {
        modules[item.key] = {
          enabled,
          actions: enabled
            ? (current.modules?.[item.key]?.actions?.length
              ? current.modules[item.key].actions
              : item.defaultActions)
            : [],
        };

        return modules;
      }, {}),
    }));
  };

  const applySavedResult = (result, createdRoleKey = "") => {
    applyResult(result);
    onRolesChanged?.(result, { createdRoleKey });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.label.trim()) {
      setMessage("Role name is required.");
      setMessageTone("error");
      return;
    }

    if (!form.baseRole) {
      setMessage("Choose which existing role this one is based on.");
      setMessageTone("error");
      return;
    }

    setSaving(true);

    const payload = {
      label: form.label.trim(),
      baseRole: form.baseRole,
      description: form.description.trim(),
      permissions: moduleAccess,
    };
    const creating = !form.id;

    try {
      const result = creating
        ? await createRole(payload)
        : await updateRole(form.id, payload);
      const createdRoleKey = creating ? roleKeyFromLabel(payload.label) : "";

      applySavedResult(result, createdRoleKey);
      const successMessage = result.message || (creating ? "Role created successfully." : "Role updated successfully.");
      setMessage(successMessage);
      setMessageTone("success");
      toast.success(successMessage);
      setEditorOpen(false);
      setForm(emptyRoleForm);
      setModuleAccessTouched(false);
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Unable to save the role.";
      setMessage(errorMessage);
      setMessageTone("error");
      toast.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    setDeletingKey(role.key);

    try {
      const result = await deleteRole(role.id);
      applySavedResult(result);
      const successMessage = result.message || "Role deleted successfully.";
      setMessage(successMessage);
      setMessageTone("success");
      toast.success(successMessage);
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Unable to delete the role.";
      setMessage(errorMessage);
      setMessageTone("error");
      toast.error(errorMessage);
    } finally {
      setDeletingKey("");
    }
  };

  const enabledModuleCount = countEnabledModules(moduleAccess);
  const baseRoleLabel = baseRoles.find((role) => role.key === form.baseRole)?.label || "selected role";

  return (
    <div className="grid gap-5 rounded-[24px] border border-slate-200 bg-slate-50/80 p-3 shadow-[0_18px_50px_-35px_rgba(15,23,42,0.55)] sm:p-4">
      <header className="relative overflow-hidden rounded-[19px] bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-600 px-5 py-5 text-white shadow-sm sm:px-6">
        <div className="pointer-events-none absolute -right-14 -top-20 h-52 w-52 rounded-full bg-indigo-500/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-44 w-44 rounded-full bg-sky-400/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-indigo-100 shadow-inner shadow-white/10">
              <Layers size={22} />
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-200">Access profiles</p>
              <h2 className="m-0 mt-1 text-xl font-bold tracking-tight text-white">Role Management</h2>
              <p className="m-0 mt-1 max-w-2xl text-sm leading-5 text-slate-300">
                Create tailored access profiles while keeping each role connected to a trusted workspace.
              </p>
              <SettingsNotice tone={messageTone} className="mt-3 max-w-2xl">
                {message}
              </SettingsNotice>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreate}
            disabled={loading || baseRoles.length === 0}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={17} />
            Create role
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-slate-300 bg-white px-4 py-16">
          <Loader2 size={26} className="animate-spin text-slate-400" />
          <p className="mt-3 text-sm font-semibold text-slate-600">Loading roles...</p>
        </div>
      ) : (
        <div className="grid gap-5">
          <section>
            <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Custom Roles</p>
            {customRoles.length === 0 ? (
              <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-medium text-slate-500">
                No custom roles yet. Select Create Role to add one.
              </p>
            ) : (
              <div className="grid gap-2">
                {customRoles.map((role) => (
                  <div
                    key={role.key}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="m-0 truncate text-sm font-semibold text-slate-950">{role.label}</p>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Custom</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          Based on {role.baseRoleLabel || role.baseRole}
                        </span>
                      </div>
                      {role.description ? <p className="m-0 mt-1.5 text-xs leading-5 text-slate-500">{role.description}</p> : null}
                      <p className="m-0 mt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-400">
                        <span className="inline-flex items-center gap-1"><Users size={12} />{role.userCount} {role.userCount === 1 ? "user" : "users"}</span>
                        <span className="inline-flex items-center gap-1"><ShieldCheck size={12} />{role.moduleCount} of {permissionItems.length} modules</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(role)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(role)}
                        disabled={deletingKey === role.key}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingKey === role.key ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Built-in Roles</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {builtinRoles.map((role) => (
                <div key={role.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center gap-2">
                    <Lock size={13} className="shrink-0 text-slate-400" />
                    <p className="m-0 truncate text-sm font-semibold text-slate-950">{role.label}</p>
                  </div>
                  <p className="m-0 mt-1.5 text-xs leading-5 text-slate-500">{role.description}</p>
                  <p className="m-0 mt-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-400">
                    <span className="inline-flex items-center gap-1"><Users size={12} />{role.userCount} {role.userCount === 1 ? "user" : "users"}</span>
                    <span className="inline-flex items-center gap-1"><ShieldCheck size={12} />{role.moduleCount} of {permissionItems.length} modules</span>
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {editorOpen ? (
        <>
          <button
            type="button"
            aria-label="Close role editor"
            onClick={closeEditor}
            className="fixed inset-0 z-40 cursor-default bg-slate-900/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? "Edit role" : "Create new role"}
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(94vw,780px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-slate-200 bg-white shadow-2xl ring-1 ring-slate-900/5"
          >
            <div className="relative overflow-hidden border-b border-indigo-700 bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-600 px-5 py-5 text-white sm:px-6">
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-indigo-500/25 blur-3xl" aria-hidden="true" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-indigo-100">
                    {form.id ? <Pencil size={17} /> : <Plus size={18} />}
                  </div>
                  <div className="min-w-0">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-200">{form.id ? "Access profile" : "New access profile"}</p>
                    <h3 className="m-0 mt-1 text-xl font-bold tracking-tight text-white">{form.id ? "Edit role" : "Create a role"}</h3>
                    <p className="m-0 mt-1 max-w-xl text-xs leading-5 text-slate-300">
                      Start with a trusted workspace, then tailor the modules this role can enter.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Close"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            <form className="grid gap-5 p-5 sm:p-6" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Role name <span className="text-rose-500">*</span></span>
                <input
                  type="text"
                  value={form.label}
                  maxLength={100}
                  required
                  onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                  placeholder="e.g. Auditor"
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Base workspace <span className="text-rose-500">*</span></span>
                <select
                  value={form.baseRole}
                  required
                  onChange={(event) => {
                    setForm((current) => ({ ...current, baseRole: event.target.value }));
                    setModuleAccessTouched(false);
                  }}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                >
                  {baseRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                </select>
              </label>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-3 text-xs leading-5 text-indigo-900">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-indigo-600" />
                <span>Members assigned this role will use the <strong>{baseRoleLabel}</strong> workspace. You can fine-tune permissions below.</span>
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Description <span className="font-normal text-slate-400">(optional)</span></span>
                <input
                  type="text"
                  value={form.description}
                  maxLength={255}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="What this role is for"
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                />
              </label>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:px-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                      <ShieldCheck size={17} />
                    </div>
                    <div>
                      <p className="m-0 text-sm font-bold text-slate-950">Module access <span className="font-normal text-slate-400">(optional)</span></p>
                      <p className="m-0 mt-1 text-xs leading-5 text-slate-500">{enabledModuleCount} of {permissionItems.length} modules selected</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => setAllModules(true)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Select all</button>
                    <button type="button" onClick={() => setAllModules(false)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Clear</button>
                  </div>
                </div>

                <div className="grid gap-3 p-3 sm:p-4">
                  {permissionSections.map((section) => (
                    <div key={section.title} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                      <p className="m-0 mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{section.title}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {section.items.map((item) => {
                          const checked = Boolean(moduleAccess.modules?.[item.key]?.enabled);
                          const adminOnly = ADMIN_ONLY_MODULE_KEYS.has(item.key);

                          return (
                            <label
                              key={item.key}
                              title={item.description}
                              className={[
                                "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition",
                                checked ? "border-indigo-200 bg-white shadow-sm" : "border-transparent bg-white/60 hover:border-slate-200 hover:bg-white",
                              ].join(" ")}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleModule(item.key, item.defaultActions)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-indigo-600 focus:ring-indigo-500"
                              />
                              <span className="min-w-0">
                                <span className="block text-xs font-semibold leading-5 text-slate-800">{item.label}</span>
                                {adminOnly ? (
                                  <span className="mt-0.5 block text-[10px] font-semibold leading-4 text-amber-700">
                                    Admin workspace only — no page in {baseRoleLabel}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-xs text-slate-400">You can refine role permissions at any time.</p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-70">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {saving ? "Saving..." : form.id ? "Save Changes" : "Create Role"}
                </button>
                </div>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
