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

export default function RoleSettings() {
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
    setRoles(result.roles || []);
    setBaseRoles(result.baseRoles || []);
    setTemplates(result.templates || {});
  }, []);

  const loadRoles = useCallback(async () => {
    setLoading(true);

    try {
      applyResult(await getRoles());
      setMessage("");
    } catch (error) {
      const text = error.response?.data?.message || "Unable to load roles.";
      setMessage(text);
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, [applyResult]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const customRoles = useMemo(() => roles.filter((role) => role.isCustom), [roles]);
  const builtinRoles = useMemo(() => roles.filter((role) => !role.isCustom), [roles]);

  // Until the admin ticks something, the checklist tracks whichever base role is
  // selected so the starting point is always a working set of modules.
  useEffect(() => {
    if (!editorOpen || moduleAccessTouched || !form.baseRole) {
      return;
    }

    setModuleAccess(moduleTemplateForBaseRole(form.baseRole, templates));
  }, [editorOpen, form.baseRole, moduleAccessTouched, templates]);

  const openCreate = () => {
    const firstBase = baseRoles[0]?.key || "";

    setForm({ ...emptyRoleForm, baseRole: firstBase });
    setModuleAccess(moduleTemplateForBaseRole(firstBase, templates));
    setModuleAccessTouched(false);
    setEditorOpen(true);
  };

  const openEdit = (role) => {
    setForm({
      id: role.id,
      label: role.label || "",
      baseRole: role.baseRole || "",
      description: role.description || "",
    });
    // An existing role already has a stored template; show that, not the base default.
    setModuleAccess(normalizeSinglePermissionTemplate(templates?.[role.key] || {}));
    setModuleAccessTouched(true);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setForm(emptyRoleForm);
    setModuleAccessTouched(false);
  };

  const toggleModule = (moduleKey, defaultActions) => {
    setModuleAccessTouched(true);
    setModuleAccess((current) => {
      const modulePermission = current.modules?.[moduleKey] || { enabled: false, actions: [] };
      const nextEnabled = !modulePermission.enabled;

      return {
        ...current,
        modules: {
          ...current.modules,
          [moduleKey]: {
            enabled: nextEnabled,
            actions: nextEnabled
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
            ? (current.modules?.[item.key]?.actions?.length ? current.modules[item.key].actions : item.defaultActions)
            : [],
        };

        return modules;
      }, {}),
    }));
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

    try {
      const result = form.id
        ? await updateRole(form.id, payload)
        : await createRole(payload);

      applyResult(result);
      setMessage(result.message || "Role saved.");
      setMessageTone("success");
      toast.success(result.message || "Role saved.");
      closeEditor();
    } catch (error) {
      const text = error.response?.data?.message || "Unable to save the role.";
      setMessage(text);
      setMessageTone("error");
      toast.error(text);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    setDeletingKey(role.key);

    try {
      const result = await deleteRole(role.id);
      applyResult(result);
      setMessage(result.message || "Role deleted.");
      setMessageTone("success");
      toast.success(result.message || "Role deleted.");
    } catch (error) {
      const text = error.response?.data?.message || "Unable to delete the role.";
      setMessage(text);
      setMessageTone("error");
      toast.error(text);
    } finally {
      setDeletingKey("");
    }
  };

  const enabledModuleCount = countEnabledModules(moduleAccess);
  const baseRoleLabel = baseRoles.find((role) => role.key === form.baseRole)?.label || "base role";

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-sm">
            <Layers size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-bold leading-tight text-slate-950">Roles</h2>
            <p className="m-0 mt-1 text-sm leading-5 text-slate-500">
              Built-in roles ship with the system. Add your own role, base it on one of them, and
              tick the modules it may open.
            </p>
            <SettingsNotice tone={messageTone} className="mt-2">
              {message}
            </SettingsNotice>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreate}
          disabled={loading || baseRoles.length === 0}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={16} />
          Add Role
        </button>
      </div>

      {loading ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16">
          <Loader2 size={26} className="animate-spin text-slate-400" />
          <p className="mt-3 text-sm font-semibold text-slate-600">Loading roles...</p>
        </div>
      ) : (
        <div className="grid gap-5">
          <section>
            <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              Custom Roles
            </p>
            {customRoles.length === 0 ? (
              <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-medium text-slate-500">
                No custom roles yet. Use Add Role to create one.
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
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                          Custom
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          Based on {role.baseRoleLabel || role.baseRole}
                        </span>
                      </div>
                      {role.description ? (
                        <p className="m-0 mt-1.5 text-xs leading-5 text-slate-500">{role.description}</p>
                      ) : null}
                      <p className="m-0 mt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Users size={12} />
                          {role.userCount} {role.userCount === 1 ? "user" : "users"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck size={12} />
                          {role.moduleCount} of {permissionItems.length} modules
                        </span>
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
            <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              Built-in Roles
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {builtinRoles.map((role) => (
                <div
                  key={role.key}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex items-center gap-2">
                    <Lock size={13} className="shrink-0 text-slate-400" />
                    <p className="m-0 truncate text-sm font-semibold text-slate-950">{role.label}</p>
                  </div>
                  <p className="m-0 mt-1.5 text-xs leading-5 text-slate-500">{role.description}</p>
                  <p className="m-0 mt-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} />
                      {role.userCount} {role.userCount === 1 ? "user" : "users"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck size={12} />
                      {role.moduleCount} of {permissionItems.length} modules
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <p className="m-0 mt-2 text-[11px] leading-5 text-slate-400">
              Built-in roles own a dashboard and route prefix, so they cannot be renamed or removed.
              Adjust their module access in Settings &gt; Permissions.
            </p>
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
            aria-label={form.id ? "Edit role" : "Add role"}
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="m-0 text-lg font-semibold text-slate-950">
                  {form.id ? "Edit Role" : "Add Role"}
                </h3>
                <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                  The base role decides which dashboard and pages this role uses. The checklist
                  decides what it can open there.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            <form className="grid gap-4" onSubmit={handleSubmit}>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-800">Role name *</span>
                <input
                  type="text"
                  value={form.label}
                  maxLength={100}
                  onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                  placeholder="e.g. Auditor"
                  className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-800">Based on *</span>
                <select
                  value={form.baseRole}
                  onChange={(event) => setForm((current) => ({ ...current, baseRole: event.target.value }))}
                  className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                >
                  {baseRoles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] leading-5 text-slate-500">
                  Users with this role sign in to the {baseRoleLabel} dashboard.
                </span>
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-800">Description</span>
                <input
                  type="text"
                  value={form.description}
                  maxLength={255}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="What this role is for"
                  className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <ShieldCheck size={16} className="text-slate-500" />
                      Module Access
                    </p>
                    <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                      {enabledModuleCount} of {permissionItems.length} modules selected
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAllModules(true)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllModules(false)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4">
                  {permissionSections.map((section) => (
                    <div key={section.title}>
                      <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {section.title}
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {section.items.map((item) => {
                          const checked = Boolean(moduleAccess.modules?.[item.key]?.enabled);

                          return (
                            <label
                              key={item.key}
                              title={item.description}
                              className={[
                                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition",
                                checked
                                  ? "border-slate-300 bg-white shadow-sm"
                                  : "border-transparent bg-white/50 hover:border-slate-200",
                              ].join(" ")}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleModule(item.key, item.defaultActions)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-900 focus:ring-slate-900"
                              />
                              <span className="min-w-0 text-xs font-semibold leading-5 text-slate-800">
                                {item.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {saving ? "Saving..." : form.id ? "Save Changes" : "Create Role"}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
