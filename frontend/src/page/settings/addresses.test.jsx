import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Swal from "sweetalert2";
import barangayData from "../../data/philippines-addresses/barangay.json";
import cityData from "../../data/philippines-addresses/city.json";
import provinceData from "../../data/philippines-addresses/province.json";
import regionData from "../../data/philippines-addresses/region.json";
import zipCodeData from "../../data/philippines-addresses/zipcodes.json";
import { createAddress, deleteAddress, fetchAddresses, updateAddress } from "../../services/addressService";
import {
  buildAddressDirectory,
  builtInAddressDirectory,
  resolveStoredAddress,
  resolveZipCode,
} from "../../utils/addressDirectory";
import { resetAddressDirectoryCache } from "../../hooks/useAddressDirectory";
import AddressSettings from "./addresses";
import CreateEmployee from "../Admin/create_employee";

jest.mock("../../services/addressService", () => ({
  fetchAddresses: jest.fn(),
  createAddress: jest.fn(),
  updateAddress: jest.fn(),
  deleteAddress: jest.fn(),
}));

jest.mock("sweetalert2", () => ({
  __esModule: true,
  default: { fire: jest.fn() },
}));

/* ---------- the original create_employee.jsx ZIP lookup, verbatim, to compare against ---------- */
function oldNormalizePlaceText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function oldUniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function oldPlaceNameVariants(value) {
  const original = String(value || "").trim();
  if (!original) return [];
  const withoutParentheses = original.replace(/\([^)]*\)/g, " ");
  const normalized = oldNormalizePlaceText(original);
  const normalizedWithoutParentheses = oldNormalizePlaceText(withoutParentheses);
  const withoutCityOfPrefix = normalizedWithoutParentheses.replace(/^city of\s+/, "");
  const withoutCitySuffix = normalizedWithoutParentheses.replace(/\s+city$/, "");
  const cityOfPrefixWithoutSuffix = withoutCityOfPrefix.replace(/\s+city$/, "");
  return oldUniqueValues([normalized, normalizedWithoutParentheses, withoutCityOfPrefix, withoutCitySuffix, cityOfPrefixWithoutSuffix]);
}
function oldZipValueToText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(" ");
  if (value && typeof value === "object") return Object.values(value).join(" ");
  return "";
}
function oldResolveZipCode(zipEntries, cityName, barangayName, provinceName, regionName) {
  const cityNeedles = oldPlaceNameVariants(cityName);
  const barangayNeedles = oldPlaceNameVariants(barangayName);
  const provinceNeedles = oldPlaceNameVariants(provinceName);
  const regionNeedles = oldPlaceNameVariants(regionName);
  const preferredNeedles = [...cityNeedles, ...barangayNeedles];
  const fallbackNeedles = [...provinceNeedles, ...regionNeedles];
  if (preferredNeedles.length === 0 && fallbackNeedles.length === 0) return "";
  const exactEntry = zipEntries.find(([, place]) => {
    const haystack = oldNormalizePlaceText(oldZipValueToText(place));
    return preferredNeedles.some((needle) => needle === haystack);
  });
  if (exactEntry) return exactEntry[0];
  const cityEntry = zipEntries.find(([, place]) => {
    const haystack = oldNormalizePlaceText(oldZipValueToText(place));
    return cityNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack));
  });
  if (cityEntry) return cityEntry[0];
  const barangayEntry = zipEntries.find(([, place]) => {
    const haystack = oldNormalizePlaceText(oldZipValueToText(place));
    return barangayNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack));
  });
  if (barangayEntry) return barangayEntry[0];
  const fallbackEntry = zipEntries.find(([, place]) => {
    const haystack = oldNormalizePlaceText(oldZipValueToText(place));
    return fallbackNeedles.some((needle) => haystack.includes(needle));
  });
  return fallbackEntry?.[0] || "";
}

/* ---------- fixtures: the shapes addresses.php returns ---------- */
const BARMM = "X99D6D63554";
const savedAddresses = [
  {
    id: 3, regionCode: BARMM, regionName: "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)",
    provinceCode: "X12F844621D", provinceName: "Maguindanao del Norte",
    cityCode: "X1303841C2A", cityName: "Datu Odin Sinsuat",
    barangayCode: "X0C6E5F4AB6", barangayName: "Awang", zipCode: "9601",
    updatedAt: "2026-10-13 15:14:43",
  },
  {
    id: 4, regionCode: "10", regionName: "Region X (Northern Mindanao)",
    provinceCode: "1043", provinceName: "Misamis Oriental",
    cityCode: "104305", cityName: "Cagayan De Oro City (Capital)",
    barangayCode: "104305001", barangayName: "Agusan", zipCode: "9099",
    updatedAt: "2026-10-13 15:14:26",
  },
  {
    id: 1, regionCode: "10", regionName: "Region X (Northern Mindanao)",
    provinceCode: "1043", provinceName: "Misamis Oriental",
    cityCode: "104321", cityName: "Opol",
    barangayCode: "X19658A8A31", barangayName: "Purok Seven", zipCode: "9016",
    updatedAt: "2026-10-13 15:14:00",
  },
];

const zipEntries = Object.entries(zipCodeData);
const regionNameByCode = Object.fromEntries(regionData.map((item) => [item.region_code, item.region_name]));
const provinceNameByCode = {};
provinceData.forEach((item) => {
  if (!(item.province_code in provinceNameByCode)) provinceNameByCode[item.province_code] = item.province_name;
});
const cityByCode = Object.fromEntries(cityData.map((item) => [item.city_code, item]));

function setInputValue(input, value) {
  const prototype = input instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event(input instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mountedViews = [];

function mount(element) {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  const view = {
    container,
    unmount: () => {
      if (view.mounted) {
        view.mounted = false;
        act(() => root.unmount());
        container.remove();
      }
    },
    mounted: true,
  };
  mountedViews.push(view);
  return view;
}

async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();

  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for the condition.");
    }

    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

function tableRows(container) {
  return Array.from(container.querySelectorAll("table tbody tr"));
}

beforeEach(() => {
  resetAddressDirectoryCache();
  fetchAddresses.mockResolvedValue({ success: true, canManage: true, addresses: savedAddresses });
});

afterEach(() => {
  mountedViews.splice(0).forEach((view) => view.unmount());
  document.body.innerHTML = "";
});

test("the shared ZIP lookup answers exactly as the form's own copy did", () => {
  let compared = 0;

  for (let index = 0; index < barangayData.length; index += 5) {
    const barangay = barangayData[index];
    const args = [
      cityByCode[barangay.city_code]?.city_name,
      barangay.brgy_name,
      provinceNameByCode[barangay.province_code],
      regionNameByCode[barangay.region_code],
    ];
    expect(resolveZipCode(zipEntries, ...args)).toBe(oldResolveZipCode(zipEntries, ...args));
    compared += 1;
  }

  cityData.forEach((city) => {
    const args = [city.city_name, "", provinceNameByCode[city.province_code], regionNameByCode[city.region_desc]];
    expect(resolveZipCode(zipEntries, ...args)).toBe(oldResolveZipCode(zipEntries, ...args));
    compared += 1;
  });

  [["", "", "", ""], ["Opol", "Purok Seven", "", ""], ["", "", "Misamis Oriental", ""], ["Nowhere Town", "Unknown", "", "Region Z"]]
    .forEach((args) => expect(resolveZipCode(zipEntries, ...args)).toBe(oldResolveZipCode(zipEntries, ...args)));

  expect(compared).toBeGreaterThan(9000);
}, 180000);

test("saved addresses are laid over the built-in lists", () => {
  expect(buildAddressDirectory([])).toBe(builtInAddressDirectory);

  const directory = buildAddressDirectory(savedAddresses);

  expect(directory.regions).toHaveLength(regionData.length + 1);
  expect(directory.regions[directory.regions.length - 1]).toMatchObject({ region_code: BARMM, custom: true });
  expect(directory.provinces).toHaveLength(provinceData.length + 1);
  expect(directory.cities).toHaveLength(cityData.length + 1);
  // Two new barangays; the override replaces Agusan where it stood.
  expect(directory.barangays).toHaveLength(barangayData.length + 2);
  const agusanIndex = barangayData.findIndex((item) => item.brgy_code === "104305001");
  expect(directory.barangays[agusanIndex]).toMatchObject({ brgy_name: "Agusan", zip_code: "9099", overridesBuiltIn: true });
  expect(directory.barangays.filter((item) => item.city_code === "104321").map((item) => item.brgy_name)).toContain("Purok Seven");

  // An employee record saved with names only finds its way back to the codes.
  expect(resolveStoredAddress({ province: "Maguindanao del Norte", city: "Datu Odin Sinsuat", address: "Awang" }, directory))
    .toEqual({
      region: "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)",
      regionCode: BARMM,
      province: "Maguindanao del Norte",
      provinceCode: "X12F844621D",
      city: "Datu Odin Sinsuat",
      cityCode: "X1303841C2A",
      address: "Awang",
    });
});

test("Settings lists every address, newest saved first, and filters them", async () => {
  const view = mount(<AddressSettings user={{ permissions: { settings: ["view", "create", "edit", "archive"] } }} />);
  await flush();

  expect(view.container.textContent).toContain(`${(barangayData.length + 2).toLocaleString("en-US")} addresses · 2 added · 1 edited`);
  let rows = tableRows(view.container);
  expect(rows).toHaveLength(10);
  expect(rows[0].textContent).toContain("Awang");
  expect(rows[0].textContent).toContain("Added");
  expect(rows[1].textContent).toContain("Agusan");
  expect(rows[1].textContent).toContain("9099");
  expect(rows[1].textContent).toContain("Edited");
  expect(rows[3].textContent).not.toMatch(/Added|Edited/);
  // A built-in row shows the ZIP code the names point to.
  expect(rows[3].textContent).toMatch(/\d{4}/);

  const search = view.container.querySelector('input[name="addressSearch"]');
  act(() => setInputValue(search, "datu odin awang"));
  await flush();
  rows = tableRows(view.container);
  // The saved one, and the built-in Awang of Datu Odin Sinsuat (Dinaig) under ARMM.
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Added");
  expect(rows[1].textContent).toContain("Datu Odin Sinsuat (Dinaig)");

  // A ZIP code search covers the built-in guesses once they are worked out.
  act(() => setInputValue(search, "9016"));
  for (let attempt = 0; attempt < 400 && view.container.textContent.includes("Looking up the ZIP codes"); attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
  rows = tableRows(view.container);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.every((row) => row.textContent.includes("9016"))).toBe(true);

  act(() => setInputValue(search, ""));
  const sourceSelect = view.container.querySelector('select[aria-label="Filter by source"]');
  act(() => setInputValue(sourceSelect, "edited"));
  await flush();
  rows = tableRows(view.container);
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain("Agusan");

  act(() => setInputValue(sourceSelect, ""));
  const regionSelect = view.container.querySelector('select[aria-label="Filter by region"]');
  act(() => setInputValue(regionSelect, BARMM));
  await flush();
  rows = tableRows(view.container);
  expect(rows).toHaveLength(1);
  const provinceSelect = view.container.querySelector('select[aria-label="Filter by province"]');
  expect(provinceSelect.disabled).toBe(false);
  expect(Array.from(provinceSelect.options).map((option) => option.textContent)).toContain("Maguindanao del Norte");

  view.unmount();
}, 60000);

test("Add Address sends new levels without codes and existing ones with theirs", async () => {
  createAddress.mockResolvedValue({
    success: true,
    canManage: true,
    message: "Address added successfully.",
    address: { ...savedAddresses[2], id: 9, barangayCode: "XAAAAAAAAAA", barangayName: "Purok 9" },
    addresses: [{ ...savedAddresses[2], id: 9, barangayCode: "XAAAAAAAAAA", barangayName: "Purok 9" }, ...savedAddresses],
  });

  const view = mount(<AddressSettings user={{}} />);
  await flush();

  const addButton = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Add Address");
  act(() => addButton.click());
  await flush();

  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain("Add Address");

  const field = (name) => dialog.querySelector(`input[name="${name}"]`);
  act(() => setInputValue(field("addressRegion"), "region x (northern mindanao)"));
  act(() => setInputValue(field("addressProvince"), "Misamis Oriental"));
  act(() => setInputValue(field("addressCity"), "Opol"));
  act(() => setInputValue(field("addressBarangay"), "Purok 9"));
  await flush();

  expect(dialog.textContent).toContain("Existing region");
  expect(dialog.textContent).toContain("Existing province");
  expect(dialog.textContent).toContain("New address under Opol");
  // Opol's own entry in the ZIP list.
  expect(field("addressZipCode").value).toBe("9016");

  // An address saved already is refused before it reaches the server.
  act(() => setInputValue(field("addressBarangay"), "purok seven"));
  await flush();
  expect(dialog.textContent).toContain("This address is already in the list.");
  const submit = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Save Address");
  await act(async () => { submit.click(); });
  expect(createAddress).not.toHaveBeenCalled();

  act(() => setInputValue(field("addressBarangay"), "Purok 9"));
  await act(async () => { submit.click(); });
  await flush();

  expect(createAddress).toHaveBeenCalledWith({
    regionCode: "10",
    regionName: "Region X (Northern Mindanao)",
    provinceCode: "1043",
    provinceName: "Misamis Oriental",
    cityCode: "104321",
    cityName: "Opol",
    barangayCode: "",
    barangayName: "Purok 9",
    zipCode: "9016",
  });
  // The dialog leaves with its exit animation.
  await waitFor(() => document.querySelector('[role="dialog"]') === null);
  const rows = tableRows(view.container);
  expect(rows[0].textContent).toContain("Purok 9");
  expect(rows[0].className).toContain("bg-amber-50");

  view.unmount();
});

test("a new region carries its new levels, and picking another region clears what no longer fits", async () => {
  createAddress.mockResolvedValue({ success: true, canManage: true, addresses: savedAddresses, address: savedAddresses[0] });

  const view = mount(<AddressSettings user={{}} />);
  await flush();
  act(() => Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Add Address").click());
  await flush();
  const dialog = document.querySelector('[role="dialog"]');
  const field = (name) => dialog.querySelector(`input[name="${name}"]`);

  // Picked from Region X's lists ...
  act(() => setInputValue(field("addressRegion"), "Region X (Northern Mindanao)"));
  act(() => setInputValue(field("addressProvince"), "Misamis Oriental"));
  act(() => setInputValue(field("addressCity"), "Opol"));
  // ... then the region changes to another existing one: the province no longer fits and goes,
  // and the city with it.
  act(() => setInputValue(field("addressRegion"), "Region XI (Davao Region)"));
  await flush();
  expect(field("addressProvince").value).toBe("");
  expect(field("addressCity").value).toBe("");

  // A new region: everything under it is new and is kept as typed.
  act(() => setInputValue(field("addressRegion"), "Negros Island Region (NIR)"));
  act(() => setInputValue(field("addressProvince"), "Negros Occidental"));
  act(() => setInputValue(field("addressCity"), "Bacolod City"));
  act(() => setInputValue(field("addressBarangay"), "Alijis"));
  act(() => setInputValue(field("addressZipCode"), "61a00x"));
  await flush();
  expect(field("addressZipCode").value).toBe("6100");
  expect(dialog.textContent).toContain("New region");
  expect(dialog.textContent).toContain("New province under Negros Island Region (NIR)");

  const submit = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Save Address");
  await act(async () => { submit.click(); });
  await flush();
  expect(createAddress).toHaveBeenCalledWith(expect.objectContaining({
    regionCode: "",
    regionName: "Negros Island Region (NIR)",
    provinceCode: "",
    cityCode: "",
    barangayCode: "",
    barangayName: "Alijis",
    zipCode: "6100",
  }));

  view.unmount();
});

test("editing keeps the barangay's code; deleting asks first", async () => {
  updateAddress.mockResolvedValue({ success: true, canManage: true, message: "Address updated successfully.", addresses: savedAddresses, address: savedAddresses[0] });
  deleteAddress.mockResolvedValue({ success: true, canManage: true, message: "Address removed.", addresses: savedAddresses.slice(1) });
  createAddress.mockResolvedValue({ success: true, canManage: true, addresses: savedAddresses, address: savedAddresses[1] });
  Swal.fire.mockResolvedValue({ isConfirmed: true });

  const view = mount(<AddressSettings user={{}} />);
  await flush();

  act(() => document.querySelector('button[aria-label="Edit Awang"]').click());
  await flush();
  let dialog = document.querySelector('[role="dialog"]');
  const field = (name) => dialog.querySelector(`input[name="${name}"]`);
  expect(field("addressBarangay").value).toBe("Awang");
  expect(field("addressZipCode").value).toBe("9601");
  act(() => setInputValue(field("addressBarangay"), "Awang Proper"));
  act(() => setInputValue(field("addressZipCode"), "9602"));
  await act(async () => {
    Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Save Address").click();
  });
  await flush();
  expect(updateAddress).toHaveBeenCalledWith(expect.objectContaining({
    id: 3,
    regionCode: BARMM,
    regionName: "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)",
    barangayCode: "X0C6E5F4AB6",
    barangayName: "Awang Proper",
    zipCode: "9602",
  }));

  // Editing a built-in row saves it for the first time, with its PSGC code.
  const builtInEdit = document.querySelector('button[aria-label="Edit Baikingon"]')
    || Array.from(document.querySelectorAll('button[aria-label^="Edit "]')).find((button) => !/Awang|Agusan|Purok/.test(button.getAttribute("aria-label")));
  const builtInName = builtInEdit.getAttribute("aria-label").replace(/^Edit /, "");
  act(() => builtInEdit.click());
  await flush();
  dialog = document.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain("Edit Built-in Address");
  act(() => setInputValue(dialog.querySelector('input[name="addressZipCode"]'), "1234"));
  await act(async () => {
    Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Save Address").click();
  });
  await flush();
  const builtIn = barangayData.find((item) => item.brgy_name === builtInName);
  expect(createAddress).toHaveBeenCalledWith(expect.objectContaining({
    barangayCode: builtIn.brgy_code,
    barangayName: builtInName,
    zipCode: "1234",
  }));

  await act(async () => { document.querySelector('button[aria-label="Delete Awang"]').click(); });
  await flush();
  expect(Swal.fire).toHaveBeenCalled();
  expect(deleteAddress).toHaveBeenCalledWith(3);
  expect(tableRows(view.container)[0].textContent).not.toContain("Awang");

  // An edited built-in offers Restore instead of Delete.
  expect(document.querySelector('button[aria-label="Restore the built-in Agusan"]')).toBeTruthy();

  view.unmount();
});

test("nobody without Settings rights is offered Add, Edit or Delete", async () => {
  fetchAddresses.mockResolvedValue({ success: true, canManage: false, addresses: savedAddresses });
  const view = mount(<AddressSettings user={{}} />);
  await flush();
  expect(Array.from(view.container.querySelectorAll("button")).some((button) => button.textContent === "Add Address")).toBe(false);
  expect(document.querySelector('button[aria-label="Edit Awang"]')).toBeNull();
  expect(view.container.querySelector("table thead").textContent).not.toContain("Actions");
  view.unmount();
});

test("the employee form offers the added addresses and their ZIP codes", async () => {
  const view = mount(
    <CreateEmployee
      initialValues={{ id: 77, firstName: "Ana", lastName: "Cruz", province: "Maguindanao del Norte", city: "Datu Odin Sinsuat", address: "Awang", zipCode: "" }}
      options={{ divisions: [], designations: [], roles: [] }}
    />
  );
  await flush();
  await flush();

  const select = (name) => view.container.querySelector(`select[name="${name}"]`);
  expect(select("region").value).toBe(BARMM);
  expect(select("province").value).toBe("X12F844621D");
  expect(select("city").value).toBe("X1303841C2A");
  expect(select("address").value).toBe("Awang");
  expect(view.container.querySelector('input[name="zipCode"]').value).toBe("9601");

  // Picking an added barangay under a built-in city fills its own ZIP code.
  act(() => setInputValue(select("region"), "10"));
  act(() => setInputValue(select("province"), "1043"));
  act(() => setInputValue(select("city"), "104305"));
  await flush();
  expect(Array.from(select("address").options).map((option) => option.value)).toContain("Agusan");
  act(() => setInputValue(select("address"), "Agusan"));
  await flush();
  expect(view.container.querySelector('input[name="zipCode"]').value).toBe("9099");

  view.unmount();
});
