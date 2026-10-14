import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Check, MapPin, Plus, Search } from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import { faPen, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import ComboboxField from "../../components/UI/ComboboxField";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { SettingsNotice, SettingsPanel } from "../../components/settings";
import useAddressDirectory from "../../hooks/useAddressDirectory";
import { createAddress, deleteAddress, updateAddress } from "../../services/addressService";
import {
  findAddressOption,
  normalizeAddressName,
  normalizePlaceText,
  zipCodeForAddress,
} from "../../utils/addressDirectory";
import { userHasPermission } from "../../utils/permissions";

const ADDRESS_ROWS_PER_PAGE = 10;
// Same cap as ADDRESS_NAME_MAX_LENGTH in addresses.php (the name columns are VARCHAR(150)).
const ADDRESS_NAME_MAX_LENGTH = 150;
const ZIP_CODE_PATTERN = /^\d{4}$/;

const LEVEL_LABELS = {
  region: "Region",
  province: "Province",
  city: "City / Municipality",
  barangay: "Address",
};

const PARENT_LEVEL = {
  province: "region",
  city: "province",
  barangay: "city",
};

const SOURCE_FILTER_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "added", label: "Added" },
  { value: "edited", label: "Edited built-in" },
  { value: "builtin", label: "Built-in" },
];

const SOURCE_BADGES = {
  added: { label: "Added", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  edited: { label: "Edited", className: "border-amber-200 bg-amber-50 text-amber-700" },
  builtin: { label: "Built-in", className: "border-slate-200 bg-slate-50 text-slate-600" },
};

const FILTER_SELECT_CLASS =
  "min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

const emptyAddressForm = {
  regionName: "",
  provinceName: "",
  cityName: "",
  barangayName: "",
  zipCode: "",
};

const numberFormat = new Intl.NumberFormat("en-US");

function firstByCode(items, codeKey) {
  const byCode = new Map();

  items.forEach((item) => {
    const code = item?.[codeKey];

    if (code && !byCode.has(code)) {
      byCode.set(code, item);
    }
  });

  return byCode;
}

/**
 * One row per barangay the pickers offer: the added and edited ones first, most recently saved
 * first (the order addresses.php returns them in), then the built-in list in its own order.
 */
function buildAddressRows(directory) {
  const regionsByCode = firstByCode(directory.regions, "region_code");
  const provincesByCode = firstByCode(directory.provinces, "province_code");
  const citiesByCode = firstByCode(directory.cities, "city_code");
  const savedOrder = new Map(directory.addresses.map((address, index) => [address.barangayCode, index]));
  const saved = [];
  const builtIn = [];

  directory.barangays.forEach((barangay) => {
    const source = barangay.custom ? (barangay.overridesBuiltIn ? "edited" : "added") : "builtin";
    const row = {
      key: barangay.brgy_code,
      source,
      addressId: barangay.addressId || null,
      regionCode: barangay.region_code,
      regionName: regionsByCode.get(barangay.region_code)?.region_name || "",
      provinceCode: barangay.province_code,
      provinceName: provincesByCode.get(barangay.province_code)?.province_name || "",
      cityCode: barangay.city_code,
      cityName: citiesByCode.get(barangay.city_code)?.city_name || "",
      barangayCode: barangay.brgy_code,
      barangayName: barangay.brgy_name,
      // A built-in barangay's ZIP code is a guess worked out from the names, so it is only worked
      // out when the row is shown or searched for; see builtInZipCode().
      zipCode: barangay.custom ? String(barangay.zip_code || "") : null,
      searchText: null,
    };

    (barangay.custom ? saved : builtIn).push(row);
  });

  saved.sort((left, right) => (savedOrder.get(left.barangayCode) ?? 0) - (savedOrder.get(right.barangayCode) ?? 0));

  return saved.concat(builtIn);
}

/*
 * The ZIP codes worked out for built-in barangays, kept for the life of the page. Working one out
 * takes a scan of the ZIP list, which is nothing for the ten rows on screen but over a second for all
 * 42,000 -- so the full set is only built when somebody actually searches by ZIP code.
 */
const builtInZipCodes = new Map();
let builtInZipCodesComplete = false;

function builtInZipCode(row, zipEntries) {
  if (!builtInZipCodes.has(row.barangayCode)) {
    builtInZipCodes.set(row.barangayCode, zipCodeForAddress(zipEntries, {
      regionName: row.regionName,
      provinceName: row.provinceName,
      cityName: row.cityName,
      barangayName: row.barangayName,
    }));
  }

  return builtInZipCodes.get(row.barangayCode);
}

function rowZipCode(row, zipEntries) {
  return row.zipCode ?? builtInZipCode(row, zipEntries);
}

function rowSearchText(row) {
  if (row.searchText === null) {
    row.searchText = normalizePlaceText(`${row.regionName} ${row.provinceName} ${row.cityName} ${row.barangayName}`);
  }

  return row.searchText;
}

function searchTerms(query) {
  return normalizePlaceText(query).split(" ").filter(Boolean);
}

/**
 * How the form's four names land in the directory: which of them are existing entries, and what the
 * level below each one can be picked from. A level under a new (unmatched) parent has nothing to
 * pick from, so it is new as well.
 */
function resolveAddressForm(form, directory) {
  const region = findAddressOption(directory.regions, "region_name", form.regionName);
  const provinceChoices = region
    ? directory.provinces.filter((item) => item.region_code === region.region_code)
    : [];
  const province = findAddressOption(provinceChoices, "province_name", form.provinceName);
  const cityChoices = province
    ? directory.cities.filter((item) => item.province_code === province.province_code)
    : [];
  const city = findAddressOption(cityChoices, "city_name", form.cityName);
  const barangayChoices = city
    ? directory.barangays.filter((item) => item.city_code === city.city_code)
    : [];
  const barangay = findAddressOption(barangayChoices, "brgy_name", form.barangayName);

  return { region, province, city, barangay, provinceChoices, cityChoices, barangayChoices };
}

/**
 * Picking a different existing region (or province, or city) leaves the levels below it pointing at
 * the old one's list, so an entry that was picked from that list and no longer fits is cleared.
 * Anything typed is kept: under a new parent it simply becomes new as well.
 */
function dropOrphanedLevels(previous, next, directory) {
  const before = resolveAddressForm(previous, directory);
  let after = resolveAddressForm(next, directory);
  let result = next;
  let parentCleared = false;

  ["province", "city", "barangay"].forEach((level) => {
    const key = `${level}Name`;
    const orphaned = before[level] && result[key] === previous[key] && !after[level];

    if (orphaned && (after[PARENT_LEVEL[level]] || parentCleared)) {
      result = { ...result, [key]: "" };
      parentCleared = true;
      after = resolveAddressForm(result, directory);
    }
  });

  return result;
}

function validateAddressForm(form) {
  const errors = {};

  ["region", "province", "city", "barangay"].forEach((level) => {
    const key = `${level}Name`;
    const name = normalizeAddressName(form[key]);

    if (!name) {
      errors[key] = `${LEVEL_LABELS[level]} is required.`;
    } else if (name.length > ADDRESS_NAME_MAX_LENGTH) {
      errors[key] = `${LEVEL_LABELS[level]} must not exceed ${ADDRESS_NAME_MAX_LENGTH} characters.`;
    } else if (!/[\p{L}\p{N}]/u.test(name)) {
      errors[key] = `${LEVEL_LABELS[level]} must contain a letter or a number.`;
    }
  });

  if (!form.zipCode) {
    errors.zipCode = "ZIP code is required.";
  } else if (!ZIP_CODE_PATTERN.test(form.zipCode)) {
    errors.zipCode = "ZIP code must be exactly 4 digits.";
  }

  return errors;
}

/** The ZIP code to offer: a saved barangay's own, otherwise the ZIP list's guess from the names. */
function suggestZipCode(form, resolved, zipEntries) {
  return zipCodeForAddress(zipEntries, {
    barangay: resolved.barangay,
    regionName: form.regionName,
    provinceName: form.provinceName,
    cityName: form.cityName,
    barangayName: form.barangayName,
  });
}

/** The name to send: the list's own spelling for a built-in entry, the typed one for anything else. */
function levelName(entry, nameKey, typed) {
  return entry && !entry.custom ? entry[nameKey] : normalizeAddressName(typed);
}

function SourceBadge({ source }) {
  const badge = SOURCE_BADGES[source] || SOURCE_BADGES.builtin;

  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function FieldHint({ tone = "muted", icon: Icon, children }) {
  if (!children) {
    return null;
  }

  const toneClass = {
    muted: "text-slate-500",
    new: "text-indigo-600",
    error: "font-semibold text-rose-700",
  }[tone] || "text-slate-500";

  return (
    <p className={`m-0 mt-1.5 flex items-start gap-1.5 text-xs leading-5 ${toneClass}`}>
      {Icon ? <Icon size={13} className="mt-1 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** "Existing province" or "New province under Region X" -- what saving will do with a level. */
function levelHint(level, typed, entry, parentName) {
  if (!normalizeAddressName(typed)) {
    return null;
  }

  const noun = level === "city" ? "city / municipality" : level;

  if (entry) {
    return { tone: "muted", icon: Check, text: entry.custom ? `Added ${noun}` : `Existing ${noun}` };
  }

  return {
    tone: "new",
    icon: Plus,
    text: parentName ? `New ${noun} under ${parentName}` : `New ${noun}`,
  };
}

function AddressEditorModal({ open, editingRow, directory, onClose, onSaved }) {
  const [form, setForm] = useState(emptyAddressForm);
  const [zipTouched, setZipTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(editingRow);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(editingRow ? {
      regionName: editingRow.regionName,
      provinceName: editingRow.provinceName,
      cityName: editingRow.cityName,
      barangayName: editingRow.barangayName,
      zipCode: rowZipCode(editingRow, directory.zipEntries) || "",
    } : emptyAddressForm);
    // An address being edited keeps its ZIP code unless it is changed by hand.
    setZipTouched(Boolean(editingRow));
    setErrors({});
    setFormError("");
    setSaving(false);
    // Only a fresh open fills the form; a directory refresh mid-edit must not wipe what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRow]);

  const resolved = useMemo(() => resolveAddressForm(form, directory), [directory, form]);
  const suggestedZipCode = useMemo(
    () => suggestZipCode(form, resolved, directory.zipEntries),
    [directory.zipEntries, form, resolved]
  );

  /*
   * The barangay typed into Address may already be one the list has. When adding, a built-in one is
   * fine -- saving gives it this ZIP code -- but one already saved has to be edited instead. When
   * editing, the name must not land on a different barangay in the same city.
   */
  const barangayConflict = useMemo(() => {
    const match = resolved.barangay;

    if (!match) {
      return "";
    }

    if (isEditing) {
      return match.brgy_code !== editingRow.barangayCode
        ? `${match.brgy_name} is already in ${resolved.city?.city_name || "this city"}.`
        : "";
    }

    return match.custom ? "This address is already in the list. Edit it there instead." : "";
  }, [editingRow, isEditing, resolved.barangay, resolved.city]);

  const hints = {
    region: levelHint("region", form.regionName, resolved.region, ""),
    province: levelHint("province", form.provinceName, resolved.province, normalizeAddressName(form.regionName)),
    city: levelHint("city", form.cityName, resolved.city, normalizeAddressName(form.provinceName)),
  };

  let barangayHint = null;

  if (barangayConflict) {
    barangayHint = { tone: "error", text: barangayConflict };
  } else if (!isEditing && normalizeAddressName(form.barangayName)) {
    // An edited address stays the same entry whatever it is renamed to, so only adding needs a hint.
    if (!resolved.barangay) {
      const cityName = normalizeAddressName(form.cityName);
      barangayHint = { tone: "new", icon: Plus, text: cityName ? `New address under ${cityName}` : "New address" };
    } else if (!resolved.barangay.custom) {
      barangayHint = { tone: "muted", icon: Check, text: "Existing barangay. Saving gives it the ZIP code below." };
    }
  }

  const updateLevel = (level) => (value) => {
    const key = `${level}Name`;

    setForm((current) => {
      const next = dropOrphanedLevels(current, { ...current, [key]: value }, directory);

      // Until a ZIP code is typed by hand, it follows the address.
      return zipTouched
        ? next
        : { ...next, zipCode: suggestZipCode(next, resolveAddressForm(next, directory), directory.zipEntries) };
    });
    setErrors((current) => ({ ...current, [key]: "", zipCode: zipTouched ? current.zipCode : "" }));
    setFormError("");
  };

  const handleZipChange = (event) => {
    const zipCode = String(event.target.value || "").replace(/\D/g, "").slice(0, 4);

    setZipTouched(true);
    setForm((current) => ({ ...current, zipCode }));
    setErrors((current) => ({ ...current, zipCode: "" }));
    setFormError("");
  };

  const applySuggestedZipCode = () => {
    setZipTouched(false);
    setForm((current) => ({ ...current, zipCode: suggestedZipCode }));
    setErrors((current) => ({ ...current, zipCode: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (saving) {
      return;
    }

    const nextErrors = validateAddressForm(form);

    if (barangayConflict) {
      nextErrors.barangayName = barangayConflict;
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const { region, province, city, barangay } = resolved;
    const payload = {
      regionCode: region?.region_code || "",
      regionName: levelName(region, "region_name", form.regionName),
      provinceCode: province?.province_code || "",
      provinceName: levelName(province, "province_name", form.provinceName),
      cityCode: city?.city_code || "",
      cityName: levelName(city, "city_name", form.cityName),
      // An edited row keeps its barangay code. A new one only sends a code to override a built-in
      // barangay; the server gives a new barangay a code of its own.
      barangayCode: isEditing
        ? editingRow.barangayCode
        : (barangay && !barangay.custom ? barangay.brgy_code : ""),
      barangayName: !isEditing && barangay && !barangay.custom
        ? barangay.brgy_name
        : normalizeAddressName(form.barangayName),
      zipCode: form.zipCode,
    };

    setSaving(true);
    setFormError("");

    try {
      // Editing a built-in barangay saves it for the first time, so it is a create on the server.
      const result = editingRow?.addressId
        ? await updateAddress({ ...payload, id: editingRow.addressId })
        : await createAddress(payload);

      onSaved?.(result);
    } catch (requestError) {
      const data = requestError?.response?.data || {};
      const fieldErrors = data.errors && typeof data.errors === "object" ? data.errors : {};

      setErrors((current) => ({ ...current, ...fieldErrors }));
      setFormError(data.message || "Unable to save the address. Please try again.");
      setSaving(false);
    }
  };

  const regionOptions = useMemo(() => directory.regions.map((item) => item.region_name), [directory.regions]);
  const provinceOptions = useMemo(() => resolved.provinceChoices.map((item) => item.province_name), [resolved.provinceChoices]);
  const cityOptions = useMemo(() => resolved.cityChoices.map((item) => item.city_name), [resolved.cityChoices]);
  const barangayOptions = useMemo(() => resolved.barangayChoices.map((item) => item.brgy_name), [resolved.barangayChoices]);
  const showSuggestion = zipTouched && suggestedZipCode && suggestedZipCode !== form.zipCode;

  let title = "Add Address";

  if (isEditing) {
    title = editingRow.source === "builtin" ? "Edit Built-in Address" : "Edit Address";
  }

  return (
    <Modal
      open={open}
      title={title}
      description="Pick from each list or type a new name. A new entry is saved under the one above it."
      onClose={saving ? undefined : onClose}
      maxWidth="max-w-[680px]"
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {formError ? <SettingsNotice tone="error">{formError}</SettingsNotice> : null}
        {isEditing && editingRow.source === "builtin" ? (
          <SettingsNotice tone="info">
            This barangay comes from the built-in list. Saving keeps your changes on top of it, and
            deleting them later puts the built-in entry back.
          </SettingsNotice>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <ComboboxField
              label="Region *"
              name="addressRegion"
              value={form.regionName}
              onChange={updateLevel("region")}
              options={regionOptions}
              placeholder="Select or type a region"
              emptyOptionLabel="Clear region"
              maxLength={ADDRESS_NAME_MAX_LENGTH}
              error={errors.regionName}
            />
            {!errors.regionName && hints.region ? (
              <FieldHint tone={hints.region.tone} icon={hints.region.icon}>{hints.region.text}</FieldHint>
            ) : null}
          </div>
          <div>
            <ComboboxField
              label="Province *"
              name="addressProvince"
              value={form.provinceName}
              onChange={updateLevel("province")}
              options={provinceOptions}
              placeholder={resolved.region ? "Select or type a province" : "Type a province"}
              emptyOptionLabel="Clear province"
              maxLength={ADDRESS_NAME_MAX_LENGTH}
              error={errors.provinceName}
            />
            {!errors.provinceName && hints.province ? (
              <FieldHint tone={hints.province.tone} icon={hints.province.icon}>{hints.province.text}</FieldHint>
            ) : null}
          </div>
          <div>
            <ComboboxField
              label="City / Municipality *"
              name="addressCity"
              value={form.cityName}
              onChange={updateLevel("city")}
              options={cityOptions}
              placeholder={resolved.province ? "Select or type a city / municipality" : "Type a city / municipality"}
              emptyOptionLabel="Clear city / municipality"
              maxLength={ADDRESS_NAME_MAX_LENGTH}
              error={errors.cityName}
            />
            {!errors.cityName && hints.city ? (
              <FieldHint tone={hints.city.tone} icon={hints.city.icon}>{hints.city.text}</FieldHint>
            ) : null}
          </div>
          <div>
            <ComboboxField
              label="Address *"
              name="addressBarangay"
              value={form.barangayName}
              onChange={updateLevel("barangay")}
              options={barangayOptions}
              placeholder={resolved.city ? "Select or type a barangay" : "Type a barangay"}
              emptyOptionLabel="Clear address"
              maxLength={ADDRESS_NAME_MAX_LENGTH}
              error={errors.barangayName}
            />
            {!errors.barangayName && barangayHint ? (
              <FieldHint tone={barangayHint.tone} icon={barangayHint.icon}>{barangayHint.text}</FieldHint>
            ) : null}
          </div>
          <div>
            <InputField
              label="Zip Code *"
              name="addressZipCode"
              value={form.zipCode}
              onChange={handleZipChange}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="4-digit ZIP code"
              error={errors.zipCode}
            />
            {!errors.zipCode && !zipTouched && form.zipCode ? (
              <FieldHint>Suggested from the ZIP code list. Change it if it is wrong.</FieldHint>
            ) : null}
            {!errors.zipCode && showSuggestion ? (
              <p className="m-0 mt-1.5 text-xs leading-5 text-slate-500">
                The ZIP code list suggests {suggestedZipCode}.{" "}
                <button
                  type="button"
                  onClick={applySuggestedZipCode}
                  className="font-semibold text-indigo-600 underline-offset-2 hover:underline"
                >
                  Use it
                </button>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2.5 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save Address
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FilterSelect({ label, value, onChange, disabled = false, title, children }) {
  return (
    <label className="block w-full" title={title}>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={FILTER_SELECT_CLASS}
      >
        {children}
      </select>
    </label>
  );
}

/**
 * Settings > Add Address: every address the Region / Province / City / Address pickers offer, and
 * the place to add the ones the built-in list is missing or to correct a barangay's ZIP code.
 *
 * Saved entries live in addresses.php; useAddressDirectory lays them over the built-in PSGC lists,
 * and the employee form and the profile page read the same directory, so a saved address can be
 * picked there straight away.
 */
export default function AddressSettings({ user }) {
  const directory = useAddressDirectory();
  const { replaceAddresses } = directory;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [regionFilter, setRegionFilter] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [highlightKey, setHighlightKey] = useState("");
  const [zipCodesReady, setZipCodesReady] = useState(builtInZipCodesComplete);

  // The server's answer once it is in; until then, what this account's permissions say.
  const canManage = directory.status === "ready"
    ? directory.canManage
    : userHasPermission(user, "settings", "create") || userHasPermission(user, "settings", "edit");

  const rows = useMemo(() => buildAddressRows(directory), [directory]);
  const savedCount = directory.addresses.length;
  const editedCount = useMemo(() => rows.filter((row) => row.source === "edited").length, [rows]);

  const regionFilterOptions = useMemo(() => [...firstByCode(directory.regions, "region_code").values()], [directory.regions]);
  const provinceFilterOptions = useMemo(
    () => (regionFilter
      ? [...firstByCode(directory.provinces.filter((item) => item.region_code === regionFilter), "province_code").values()]
      : []),
    [directory.provinces, regionFilter]
  );
  const cityFilterOptions = useMemo(
    () => (provinceFilter ? directory.cities.filter((item) => item.province_code === provinceFilter) : []),
    [directory.cities, provinceFilter]
  );

  const terms = useMemo(() => searchTerms(deferredQuery), [deferredQuery]);
  const searchesZipCodes = terms.some((term) => /\d/.test(term));

  // Searching by ZIP code needs every built-in barangay's guess, so build them in slices the first
  // time somebody types a digit, leaving the page responsive while it runs.
  useEffect(() => {
    if (!searchesZipCodes || zipCodesReady) {
      return undefined;
    }

    const pending = rows.filter((row) => row.zipCode === null && !builtInZipCodes.has(row.barangayCode));
    let index = 0;
    let timer = null;
    let cancelled = false;

    const step = () => {
      const deadline = performance.now() + 12;

      while (index < pending.length && performance.now() < deadline) {
        builtInZipCode(pending[index], directory.zipEntries);
        index += 1;
      }

      if (cancelled) {
        return;
      }

      if (index < pending.length) {
        timer = window.setTimeout(step, 0);
        return;
      }

      builtInZipCodesComplete = true;
      setZipCodesReady(true);
    };

    timer = window.setTimeout(step, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [directory.zipEntries, rows, searchesZipCodes, zipCodesReady]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (regionFilter && row.regionCode !== regionFilter) {
      return false;
    }

    if (provinceFilter && row.provinceCode !== provinceFilter) {
      return false;
    }

    if (cityFilter && row.cityCode !== cityFilter) {
      return false;
    }

    if (sourceFilter && row.source !== sourceFilter) {
      return false;
    }

    if (terms.length === 0) {
      return true;
    }

    const text = rowSearchText(row);
    // Until the built-in guesses are ready, only the saved ZIP codes can be searched. After that the
    // lookup is a cache hit, bar a barangay whose saved entry was deleted since.
    const zipCode = row.zipCode ?? (zipCodesReady ? builtInZipCode(row, directory.zipEntries) : "");

    return terms.every((term) => text.includes(term) || (zipCode && zipCode.startsWith(term)));
  }), [cityFilter, directory.zipEntries, provinceFilter, regionFilter, rows, sourceFilter, terms, zipCodesReady]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ADDRESS_ROWS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * ADDRESS_ROWS_PER_PAGE;
  const pageRows = filteredRows.slice(pageStart, pageStart + ADDRESS_ROWS_PER_PAGE);
  const filtersActive = Boolean(query.trim() || regionFilter || provinceFilter || cityFilter || sourceFilter);

  useEffect(() => {
    if (!highlightKey) {
      return undefined;
    }

    const timer = window.setTimeout(() => setHighlightKey(""), 5000);
    return () => window.clearTimeout(timer);
  }, [highlightKey]);

  const resetFilters = () => {
    setQuery("");
    setRegionFilter("");
    setProvinceFilter("");
    setCityFilter("");
    setSourceFilter("");
    setPage(1);
  };

  const openCreate = () => {
    setEditingRow(null);
    setEditorOpen(true);
  };

  const openEdit = (row) => {
    setEditingRow(row);
    setEditorOpen(true);
  };

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const handleSaved = (result) => {
    replaceAddresses(result);
    setEditorOpen(false);
    // The saved address is listed first, so clear the filters and go to it.
    resetFilters();
    setHighlightKey(result?.address?.barangayCode || "");
    toast.success(result?.message || "Address saved.");
  };

  const handleDelete = async (row) => {
    if (!row.addressId || deletingId) {
      return;
    }

    const reverting = row.source === "edited";
    const confirmation = await Swal.fire({
      title: reverting ? "Restore the built-in entry?" : "Delete this address?",
      text: reverting
        ? `${row.barangayName} goes back to its built-in name and ZIP code.`
        : `${row.barangayName}, ${row.cityName} will no longer be offered in the address lists. Employee records that already use it keep their saved address.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: reverting ? "Restore" : "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setDeletingId(row.addressId);

    try {
      const result = await deleteAddress(row.addressId);
      replaceAddresses(result);
      toast.success(reverting ? "Built-in entry restored." : (result?.message || "Address removed."));
    } catch (requestError) {
      toast.error(requestError?.response?.data?.message || "Unable to delete the address.");
    } finally {
      setDeletingId(null);
    }
  };

  const columns = [
    {
      key: "regionName",
      header: "Region",
      cardRole: "eyebrow",
      cellClassName: "max-w-[210px] text-sm text-slate-700",
      render: (row) => row.regionName || "—",
    },
    {
      key: "provinceName",
      header: "Province",
      cellClassName: "text-sm text-slate-700",
      render: (row) => row.provinceName || "—",
    },
    {
      key: "cityName",
      header: "City / Municipality",
      cellClassName: "text-sm text-slate-700",
      render: (row) => row.cityName || "—",
    },
    {
      key: "barangayName",
      header: "Address",
      cardRole: "title",
      // Built-in rows carry no badge, so the added and edited ones stand out without a column of their own.
      render: (row) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-900">{row.barangayName}</span>
          {row.source !== "builtin" ? <SourceBadge source={row.source} /> : null}
        </span>
      ),
    },
    {
      key: "zipCode",
      header: "Zip Code",
      cellClassName: "whitespace-nowrap",
      render: (row) => {
        const zipCode = rowZipCode(row, directory.zipEntries);

        return zipCode
          ? <span className="font-mono text-sm font-semibold text-slate-800">{zipCode}</span>
          : <span className="text-xs text-slate-400">Not found</span>;
      },
    },
    ...(canManage ? [{
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <ActionIconButton
            label={`Edit ${row.barangayName}`}
            tone="edit"
            icon={faPen}
            onClick={() => openEdit(row)}
          />
          {row.addressId ? (
            <ActionIconButton
              label={row.source === "edited" ? `Restore the built-in ${row.barangayName}` : `Delete ${row.barangayName}`}
              tone="delete"
              icon={faTrashCan}
              text={row.source === "edited" ? "Restore" : "Delete"}
              disabled={deletingId === row.addressId}
              onClick={() => handleDelete(row)}
            />
          ) : null}
        </div>
      ),
    }] : []),
  ];

  const summary = [
    `${numberFormat.format(rows.length)} addresses`,
    savedCount - editedCount > 0 ? `${numberFormat.format(savedCount - editedCount)} added` : "",
    editedCount > 0 ? `${numberFormat.format(editedCount)} edited` : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      <SettingsPanel
        icon={MapPin}
        title="Addresses"
        description="Every region, province, city or municipality, address, and ZIP code the employee address fields offer. Add the ones that are missing, or correct a ZIP code."
        notice={directory.status === "error" ? `${directory.error} The built-in list is shown without them.` : ""}
        noticeTone="warning"
        actions={
          <>
            <span className="text-xs font-semibold text-slate-500">
              {directory.status === "loading" ? "Loading added addresses…" : summary}
            </span>
            {directory.status === "error" ? (
              <Button variant="secondary" size="sm" onClick={() => directory.reload({ refresh: true })}>
                Retry
              </Button>
            ) : null}
            {canManage ? (
              <Button icon={Plus} onClick={openCreate}>
                Add Address
              </Button>
            ) : null}
          </>
        }
      >
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <InputField
            name="addressSearch"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search name or ZIP code"
            icon={Search}
            aria-label="Search addresses"
            className="md:col-span-2 xl:col-span-1"
          />
          <FilterSelect
            label="Filter by region"
            value={regionFilter}
            onChange={(value) => {
              setRegionFilter(value);
              setProvinceFilter("");
              setCityFilter("");
              setPage(1);
            }}
          >
            <option value="">All regions</option>
            {regionFilterOptions.map((item) => (
              <option key={item.region_code} value={item.region_code}>{item.region_name}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Filter by province"
            value={provinceFilter}
            disabled={!regionFilter}
            title={regionFilter ? undefined : "Choose a region first"}
            onChange={(value) => {
              setProvinceFilter(value);
              setCityFilter("");
              setPage(1);
            }}
          >
            <option value="">All provinces</option>
            {provinceFilterOptions.map((item) => (
              <option key={item.province_code} value={item.province_code}>{item.province_name}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Filter by city or municipality"
            value={cityFilter}
            disabled={!provinceFilter}
            title={provinceFilter ? undefined : "Choose a province first"}
            onChange={(value) => {
              setCityFilter(value);
              setPage(1);
            }}
          >
            <option value="">All cities</option>
            {cityFilterOptions.map((item) => (
              <option key={item.city_code} value={item.city_code}>{item.city_name}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Filter by source"
            value={sourceFilter}
            onChange={(value) => {
              setSourceFilter(value);
              setPage(1);
            }}
          >
            {SOURCE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </FilterSelect>
        </div>

        {searchesZipCodes && !zipCodesReady ? (
          <p className="m-0 mt-2 text-xs text-slate-500" role="status">
            Looking up the ZIP codes of the built-in addresses…
          </p>
        ) : null}

        <Table
          columns={columns}
          data={pageRows}
          rowKey="key"
          emptyMessage={filtersActive ? "No addresses match the search or filters." : "No addresses found."}
          rowClassName={(row) => (row.key === highlightKey ? "bg-amber-50" : "")}
          minWidthClassName="min-w-[680px]"
          className="mt-4 rounded-lg border border-slate-200"
          stickyHeader
          cardsClassName="mt-4 lg:hidden"
          tableWrapperClassName="hidden lg:block"
        />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-xs font-semibold text-slate-500">
            {filteredRows.length > 0
              ? `Showing ${numberFormat.format(pageStart + 1)}–${numberFormat.format(pageStart + pageRows.length)} of ${numberFormat.format(filteredRows.length)}`
              : "Showing 0 addresses"}
            {filtersActive ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={resetFilters}
                  className="font-semibold text-indigo-600 underline-offset-2 hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : null}
          </p>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      </SettingsPanel>

      <AddressEditorModal
        open={editorOpen}
        editingRow={editingRow}
        directory={directory}
        onClose={closeEditor}
        onSaved={handleSaved}
      />
    </>
  );
}
