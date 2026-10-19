import { useAutoRefreshData } from "../components/auto/autorefreshdatalist";
import { getFilingSignatories } from "../services/api";

// Keep the signing spaces empty until the saved policy is known, including on a failed load.
const INITIAL_SETTINGS = { showTimestamps: false, showESignatures: false };
const SETTINGS_TOPICS = ["settings", "filing_signatories"];

function selectSettings(result) {
  const settings = result?.filingSignatories;
  if (typeof settings?.showTimestamps !== "boolean" || typeof settings?.showESignatures !== "boolean") {
    throw new Error("Unable to load filing form signatory settings.");
  }
  return settings;
}

export default function useFilingSignatories() {
  const { data, loading, error, refresh } = useAutoRefreshData({
    fetchData: getFilingSignatories,
    initialData: INITIAL_SETTINGS,
    selectData: selectSettings,
    topics: SETTINGS_TOPICS,
  });

  return { ...data, loading, error, refresh };
}
