import React, { act } from "react";
import { createRoot } from "react-dom/client";
import useFilingSignatories from "./useFilingSignatories";
import { getFilingSignatories } from "../services/api";
import { subscribeAutoRefresh } from "../components/auto/autorefreshconfig";

jest.mock("../services/api", () => ({ getFilingSignatories: jest.fn() }));
jest.mock("../components/auto/autorefreshconfig", () => ({
  AUTO_REFRESH_ALL_TOPIC: "*",
  AUTO_REFRESH_DEBOUNCE_MS: 0,
  normalizeAutoRefreshTopics: (topics) => Array.isArray(topics) ? topics : [topics],
  autoRefreshTopicMatches: () => true,
  subscribeAutoRefresh: jest.fn(() => jest.fn()),
}));

/* eslint-disable testing-library/no-unnecessary-act */
let container;
let root;
let result;

function Probe() {
  result = useFilingSignatories();
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  jest.useRealTimers();
});

async function renderProbe() {
  await act(async () => root.render(<Probe />));
}

test("keeps signature spaces empty until the saved display policy has loaded", async () => {
  let resolveRequest;
  getFilingSignatories.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
  await renderProbe();
  expect(result.loading).toBe(true);
  expect(result.showTimestamps).toBe(false);
  expect(result.showESignatures).toBe(false);
  await act(async () => resolveRequest({ filingSignatories: { showTimestamps: false, showESignatures: true } }));
  expect(result.loading).toBe(false);
  expect(result.showTimestamps).toBe(false);
  expect(result.showESignatures).toBe(true);
});

test.each(["settings", "filing_signatories"])("refreshes an open form for the %s settings event", async (topic) => {
  getFilingSignatories.mockResolvedValue({ filingSignatories: { showTimestamps: true, showESignatures: true } });
  await renderProbe();
  expect(result.loading).toBe(false);
  expect(subscribeAutoRefresh.mock.calls[0][1].topics).toEqual(["settings", "filing_signatories"]);
  getFilingSignatories.mockResolvedValue({ filingSignatories: { showTimestamps: false, showESignatures: false } });
  const listener = subscribeAutoRefresh.mock.calls[0][0];
  act(() => listener({ topics: [topic] }));
  await act(async () => jest.runOnlyPendingTimers());
  expect(result.showESignatures).toBe(false);
  expect(result.showTimestamps).toBe(false);
});

test("leaves signatures hidden when settings are unavailable or malformed", async () => {
  getFilingSignatories.mockResolvedValue({ filingSignatories: {} });
  await renderProbe();
  expect(result.loading).toBe(false);
  expect(result.error).toBeInstanceOf(Error);
  expect(result.showTimestamps).toBe(false);
  expect(result.showESignatures).toBe(false);
});
