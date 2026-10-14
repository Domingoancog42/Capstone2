/*
 * The address directory behind every Region / Province / City / Address picker.
 *
 * The PSGC lists are compiled in from src/data rather than fetched, so they are in memory the moment
 * this module loads. The trade is size -- barangay.json alone is 4.8 MB, carried in the main bundle.
 * They are fixed at build time, though, so the addresses an administrator adds in Settings > Add
 * Address (addresses.php) are laid over them here: a new region, province, city or barangay joins its
 * list, and a saved row for a built-in barangay replaces that barangay -- which is how a barangay gets
 * a ZIP code of its own instead of the one guessed from the place names.
 *
 * Codes stay what the pickers filter on. A level from the built-in list keeps its PSGC code; a level
 * that was added carries the server's code ('X' and ten hex digits), and its children point at it the
 * same way PSGC children point at theirs.
 */
import barangayData from "../data/philippines-addresses/barangay.json";
import cityData from "../data/philippines-addresses/city.json";
import provinceData from "../data/philippines-addresses/province.json";
import regionData from "../data/philippines-addresses/region.json";
import zipCodeData from "../data/philippines-addresses/zipcodes.json";

const builtInRegions = Array.isArray(regionData) ? regionData : [];
const builtInProvinces = Array.isArray(provinceData) ? provinceData : [];
const builtInCities = Array.isArray(cityData) ? cityData : [];
const builtInBarangays = Array.isArray(barangayData) ? barangayData : [];
const builtInZipEntries = zipCodeData && typeof zipCodeData === "object" ? Object.entries(zipCodeData) : [];

export const builtInAddressDirectory = Object.freeze({
  regions: builtInRegions,
  provinces: builtInProvinces,
  cities: builtInCities,
  barangays: builtInBarangays,
  zipEntries: builtInZipEntries,
  addresses: [],
});

let builtInCodeSets = null;

/** Built on first use: the barangay set alone is 42,000 codes. */
function getBuiltInCodeSets() {
  if (!builtInCodeSets) {
    builtInCodeSets = {
      regions: new Set(builtInRegions.map((item) => item.region_code)),
      provinces: new Set(builtInProvinces.map((item) => item.province_code)),
      cities: new Set(builtInCities.map((item) => item.city_code)),
      barangays: new Set(builtInBarangays.map((item) => item.brgy_code)),
    };
  }

  return builtInCodeSets;
}

export function isBuiltInBarangayCode(code) {
  return getBuiltInCodeSets().barangays.has(String(code || ""));
}

const compareNames = (key) => (left, right) => String(left[key] || "").localeCompare(
  String(right[key] || ""),
  undefined,
  { sensitivity: "base", numeric: true }
);

/**
 * The built-in lists with the saved addresses (as addresses.php returns them) laid over them.
 *
 * Added regions, provinces and cities are appended after the built-in ones, so every picker keeps
 * the order it had. With nothing saved this hands back the built-in directory itself, which keeps
 * the object identity stable for the screens that memoize on it.
 */
export function buildAddressDirectory(addresses = []) {
  const rows = Array.isArray(addresses) ? addresses.filter((row) => row && row.barangayCode) : [];

  if (rows.length === 0) {
    return builtInAddressDirectory;
  }

  const codeSets = getBuiltInCodeSets();
  const addedRegions = new Map();
  const addedProvinces = new Map();
  const addedCities = new Map();
  const overrides = new Map();
  const addedBarangays = [];

  rows.forEach((row) => {
    if (!codeSets.regions.has(row.regionCode) && !addedRegions.has(row.regionCode)) {
      addedRegions.set(row.regionCode, {
        region_code: row.regionCode,
        region_name: row.regionName,
        custom: true,
      });
    }

    if (!codeSets.provinces.has(row.provinceCode) && !addedProvinces.has(row.provinceCode)) {
      addedProvinces.set(row.provinceCode, {
        province_code: row.provinceCode,
        province_name: row.provinceName,
        region_code: row.regionCode,
        custom: true,
      });
    }

    if (!codeSets.cities.has(row.cityCode) && !addedCities.has(row.cityCode)) {
      addedCities.set(row.cityCode, {
        city_code: row.cityCode,
        city_name: row.cityName,
        province_code: row.provinceCode,
        region_desc: row.regionCode,
        custom: true,
      });
    }

    const barangay = {
      brgy_code: row.barangayCode,
      brgy_name: row.barangayName,
      city_code: row.cityCode,
      province_code: row.provinceCode,
      region_code: row.regionCode,
      zip_code: row.zipCode,
      custom: true,
      addressId: row.id,
    };

    if (codeSets.barangays.has(row.barangayCode)) {
      overrides.set(row.barangayCode, { ...barangay, overridesBuiltIn: true });
    } else {
      addedBarangays.push(barangay);
    }
  });

  const barangays = overrides.size > 0
    ? builtInBarangays.map((item) => overrides.get(item.brgy_code) || item)
    : builtInBarangays.slice();

  return {
    regions: [...builtInRegions, ...[...addedRegions.values()].sort(compareNames("region_name"))],
    provinces: [...builtInProvinces, ...[...addedProvinces.values()].sort(compareNames("province_name"))],
    cities: [...builtInCities, ...[...addedCities.values()].sort(compareNames("city_name"))],
    barangays: barangays.concat(addedBarangays.sort(compareNames("brgy_name"))),
    zipEntries: builtInZipEntries,
    addresses: rows,
  };
}

/** Trimmed, with runs of whitespace collapsed -- the form the server stores a name in. */
export function normalizeAddressName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The option named `text`, ignoring case and spacing. This is how a typed name is matched to an
 * existing entry, and addresses.php derives a new entry's code the same way, so the two agree on
 * what counts as the same place.
 */
export function findAddressOption(options, nameKey, text) {
  const key = normalizeAddressName(text).toLowerCase();

  if (!key) {
    return null;
  }

  return options.find((option) => normalizeAddressName(option?.[nameKey]).toLowerCase() === key) || null;
}

export function normalizePlaceText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function placeNameVariants(value) {
  const original = String(value || "").trim();

  if (!original) {
    return [];
  }

  const withoutParentheses = original.replace(/\([^)]*\)/g, " ");
  const normalized = normalizePlaceText(original);
  const normalizedWithoutParentheses = normalizePlaceText(withoutParentheses);
  const withoutCityOfPrefix = normalizedWithoutParentheses.replace(/^city of\s+/, "");
  const withoutCitySuffix = normalizedWithoutParentheses.replace(/\s+city$/, "");
  const cityOfPrefixWithoutSuffix = withoutCityOfPrefix.replace(/\s+city$/, "");

  return uniqueValues([
    normalized,
    normalizedWithoutParentheses,
    withoutCityOfPrefix,
    withoutCitySuffix,
    cityOfPrefixWithoutSuffix,
  ]);
}

export function findPlaceByName(options, nameKey, value) {
  const storedVariants = placeNameVariants(value);

  if (storedVariants.length === 0) {
    return null;
  }

  return options.find((option) => {
    const optionVariants = placeNameVariants(option?.[nameKey]);
    return storedVariants.some((variant) => optionVariants.includes(variant));
  }) || null;
}

/*
 * Employee records store the readable province, city and barangay names, but the cascading edit
 * controls use PSGC codes. Rebuild those codes before opening an existing record so every saved
 * address level is selected instead of resetting the controls to their placeholders.
 */
export function resolveStoredAddress(values = {}, directory = builtInAddressDirectory) {
  const provinces = Array.isArray(directory?.provinces) ? directory.provinces : [];
  const cities = Array.isArray(directory?.cities) ? directory.cities : [];
  const barangays = Array.isArray(directory?.barangays) ? directory.barangays : [];
  const regions = Array.isArray(directory?.regions) ? directory.regions : [];

  let province = values.provinceCode
    ? provinces.find((item) => item.province_code === values.provinceCode) || null
    : null;
  province ||= findPlaceByName(provinces, "province_name", values.province);

  const provinceCities = province
    ? cities.filter((item) => item.province_code === province.province_code)
    : cities;
  let city = values.cityCode
    ? cities.find((item) => item.city_code === values.cityCode) || null
    : null;
  city ||= findPlaceByName(provinceCities, "city_name", values.city);

  if (!province && city) {
    province = provinces.find((item) => item.province_code === city.province_code) || null;
  }

  const regionCode = province?.region_code || city?.region_desc || values.regionCode || "";
  const region = regions.find((item) => item.region_code === regionCode)
    || findPlaceByName(regions, "region_name", values.region);
  const cityBarangays = city
    ? barangays.filter((item) => item.city_code === city.city_code)
    : barangays;
  const barangay = findPlaceByName(cityBarangays, "brgy_name", values.address);

  return {
    region: region?.region_name || values.region || "",
    regionCode: region?.region_code || regionCode,
    province: province?.province_name || values.province || "",
    provinceCode: province?.province_code || values.provinceCode || "",
    city: city?.city_name || values.city || "",
    cityCode: city?.city_code || values.cityCode || "",
    address: barangay?.brgy_name || values.address || "",
  };
}

function zipValueToText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.join(" ");
  }

  if (value && typeof value === "object") {
    return Object.values(value).join(" ");
  }

  return "";
}

const normalizedZipEntriesCache = new WeakMap();

/** Each ZIP list's place names, normalized once rather than on every lookup. */
function getNormalizedZipEntries(zipEntries) {
  let normalized = normalizedZipEntriesCache.get(zipEntries);

  if (!normalized) {
    normalized = zipEntries.map(([zipCode, place]) => [zipCode, normalizePlaceText(zipValueToText(place))]);
    normalizedZipEntriesCache.set(zipEntries, normalized);
  }

  return normalized;
}

/**
 * The ZIP code the place names point to in the ZIP list: an exact city or barangay name first, then
 * a city, then a barangay that contains (or is contained in) a listed place, then the province or
 * region. It is a guess from names -- the list carries no PSGC codes -- which is why a saved address
 * with a ZIP code of its own takes precedence wherever one exists.
 */
export function resolveZipCode(zipEntries, cityName, barangayName, provinceName, regionName) {
  if (!Array.isArray(zipEntries) || zipEntries.length === 0) {
    return "";
  }

  const cityNeedles = placeNameVariants(cityName);
  const barangayNeedles = placeNameVariants(barangayName);
  const provinceNeedles = placeNameVariants(provinceName);
  const regionNeedles = placeNameVariants(regionName);
  const preferredNeedles = [...cityNeedles, ...barangayNeedles];
  const fallbackNeedles = [...provinceNeedles, ...regionNeedles];

  if (preferredNeedles.length === 0 && fallbackNeedles.length === 0) {
    return "";
  }

  const entries = getNormalizedZipEntries(zipEntries);

  const exactEntry = entries.find(([, haystack]) => preferredNeedles.some((needle) => needle === haystack));

  if (exactEntry) {
    return exactEntry[0];
  }

  const cityEntry = entries.find(([, haystack]) => (
    cityNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack))
  ));

  if (cityEntry) {
    return cityEntry[0];
  }

  const barangayEntry = entries.find(([, haystack]) => (
    barangayNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack))
  ));

  if (barangayEntry) {
    return barangayEntry[0];
  }

  const fallbackEntry = entries.find(([, haystack]) => fallbackNeedles.some((needle) => haystack.includes(needle)));

  return fallbackEntry?.[0] || "";
}

/** The ZIP code a barangay gets: its own saved one if it has it, otherwise the guess from the names. */
export function zipCodeForAddress(zipEntries, { barangay = null, regionName, provinceName, cityName, barangayName } = {}) {
  if (barangay?.zip_code) {
    return String(barangay.zip_code);
  }

  if (!normalizeAddressName(cityName) && !normalizeAddressName(barangayName)) {
    return "";
  }

  return resolveZipCode(zipEntries, cityName, barangayName, provinceName, regionName);
}
