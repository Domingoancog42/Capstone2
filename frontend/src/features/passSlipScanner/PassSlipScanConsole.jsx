import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  LogOut,
  QrCode,
  ScanLine,
  ShieldAlert,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "react-hot-toast";
import QrCameraScanner, { cameraScanningSupported } from "../../components/passslip/QrCameraScanner";
import { fetchPassSlipScanHistory, fetchPassSlips, scanPassSlip } from "../../services/passSlipService";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { formatDateDisplay } from "../../utils/leaveHelpers";
import { formatRecordDivision } from "../../utils/divisionDisplay";
import {
  PASS_SLIP_STATUS,
  formatPassSlipDuration,
  normalizePassSlipStatus,
  passSlipElapsedMinutes,
  passSlipStatusBadgeClasses,
  passSlipStatusLabel,
} from "../../utils/passSlipStatus";

/*
 * The standalone scan console: the only place in the system where a pass slip's Time Out and Time
 * Returned are written.
 *
 * Two ways in, in the order a real gate desk will actually use them:
 *
 *   1. A USB or Bluetooth QR reader. These emulate a keyboard -- they type the payload and press
 *      Enter -- so nothing needs to be focused and nothing needs to be installed. This is the path
 *      that works on a plain-HTTP office LAN, which is where this system runs.
 *   2. The machine's camera, when the browser will open one (see QrCameraScanner).
 *
 * Both end in the same call, and that call decides nothing: the server reads the slip's own
 * status to work out whether this scan is the departure or the return.
 */

/** A keystroke gap wider than this ends the current hardware-reader burst. People type slower. */
const WEDGE_KEY_GAP_MS = 60;

/* How long the same payload is ignored after a successful read. The camera decodes several times a
 * second while a code is held up, and every one of those repeats would otherwise be a fresh request. */
const REPEAT_SCAN_COOLDOWN_MS = 4000;

/** The credential inside whatever a reader produced. Mirrors pass_slip_extract_token() in PHP. */
export function extractPassSlipToken(raw) {
  const match = /[0-9a-fA-F]{32}/.exec(String(raw || ""));
  return match ? match[0].toLowerCase() : "";
}

/*
 * The scan history comes from the server, which logs every scan in `pass_slip_scans`, so every phone
 * or desk machine that opens the station shows the same list -- including the people who have come
 * back and so dropped off "Currently out". It is re-read on this interval while the page is visible,
 * which is how a scan made on one device shows up on the others.
 */
const SCAN_HISTORY_REFRESH_MS = 5000;

/* Where this page used to keep its own copy of the history, before the server held it. */
const LEGACY_SCAN_HISTORY_PREFIX = "hris_pass_slip_scan_history:";

/*
 * Only what the history draws. The signed-in scan response carries the slip's QR token, which is a
 * credential and has no business being held onto after the scan.
 */
function scanHistoryRecord(record, publicAccess) {
  if (!record) return null;

  return {
    employeeName: record.employeeName || "",
    employeeId: publicAccess ? "" : record.employeeId || "",
    division: publicAccess ? "" : formatRecordDivision(record, ""),
    reference: record.reference || "",
    timeOutDisplay: record.timeOutDisplay || null,
    timeInDisplay: record.timeInDisplay || null,
    durationMinutes: record.durationMinutes ?? null,
  };
}

/*
 * One card per pass slip. The return scan updates the card its departure scan made -- the badge, the
 * Time Returned, the duration -- and brings it back to the top, instead of adding a second card for
 * the same slip. Refused scans stay cards of their own: they are separate events the desk needs to
 * see, and one must never overwrite the times a real scan recorded.
 *
 * The server builds its list the same way; this copy applies a scan made here straight away, without
 * waiting for the next refresh.
 */
function slipHistoryKey(entry) {
  return entry?.ok && entry.record?.reference ? entry.record.reference : "";
}

/** The newer scan's values win; anything it left blank keeps what the earlier scan recorded. */
function mergeHistoryRecord(previous, next) {
  const merged = { ...previous };
  Object.entries(next || {}).forEach(([field, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      merged[field] = value;
    }
  });
  return merged;
}

function addScanToHistory(entry, entries) {
  const key = slipHistoryKey(entry);
  if (!key) {
    return [entry, ...entries];
  }

  const previous = entries.find((item) => slipHistoryKey(item) === key);
  const merged = previous
    ? { ...entry, id: previous.id, record: mergeHistoryRecord(previous.record, entry.record) }
    : entry;

  return [merged, ...entries.filter((item) => slipHistoryKey(item) !== key)];
}

/** Drops the per-device copy an older build of this page kept. It held names; nothing reads it now. */
function forgetLegacyScanHistory() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(LEGACY_SCAN_HISTORY_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* Storage blocked: there is nothing there to forget either. */
  }
}

function localDateKey(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function scanHistoryDayLabel(timestamp, now) {
  const key = localDateKey(timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (key === localDateKey(now)) return "Today";
  if (key === localDateKey(yesterday)) return "Yesterday";
  return formatDateDisplay(new Date(timestamp));
}

/*
 * One pass slip as a card: whose slip it is and where it stands, when it was last scanned, then its
 * Departure and Time Returned side by side. A scan the server turned away keeps its reason.
 */
function ScanHistoryRow({ entry, now }) {
  const { ok, action, message, record, at } = entry;
  const isTimeOut = action === "TIME_OUT";

  const badge = ok
    ? isTimeOut
      ? ["Departed", "bg-amber-100 text-amber-800"]
      : ["Returned", "bg-emerald-100 text-emerald-800"]
    : ["Not accepted", "bg-rose-100 text-rose-800"];

  const scannedAt = `${scanHistoryDayLabel(at, now)} · ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const details = [scannedAt, record?.reference, record?.employeeId, record?.division].filter(Boolean).join(" · ");
  const hasDuration = ok && record?.durationMinutes !== null && record?.durationMinutes !== undefined;

  return (
    <li className="border-b border-slate-200 px-4 py-5 last:border-b-0 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-base font-bold text-slate-900">
            {record?.employeeName || "Unrecognized code"}
          </p>
          <p className="m-0 mt-1 break-words text-sm text-slate-500">{details}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${badge[1]}`}>
          {badge[0]}
        </span>
      </div>

      {record ? (
        <dl className="m-0 mt-4 grid grid-cols-2 gap-3">
          {[
            ["Departure", record.timeOutDisplay],
            ["Time Returned", record.timeInDisplay],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-100 px-3.5 py-3">
              <dt className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="m-0 mt-1.5 text-base font-bold text-slate-900">{value || "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hasDuration ? (
        <p className="m-0 mt-2.5 text-xs font-semibold text-slate-600">
          Total time outside the office: {formatPassSlipDuration(record.durationMinutes)}
        </p>
      ) : null}
      {!ok ? <p className="m-0 mt-2.5 break-words text-sm text-rose-700">{message}</p> : null}
    </li>
  );
}

function ScanResultCard({ result, publicAccess = false }) {
  if (!result) return null;

  const { ok, action, message, record } = result;
  const isTimeOut = action === "TIME_OUT";

  const tone = ok
    ? isTimeOut
      ? "border-amber-300 bg-amber-50"
      : "border-emerald-300 bg-emerald-50"
    : "border-rose-300 bg-rose-50";

  const Icon = ok ? (isTimeOut ? LogOut : CheckCircle2) : XCircle;
  const iconTone = ok ? (isTimeOut ? "text-amber-700" : "text-emerald-700") : "text-rose-700";

  return (
    <div className={`rounded-2xl border-2 p-4 sm:p-5 ${tone}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Icon size={28} className={`mt-0.5 shrink-0 ${iconTone}`} />
        <div className="min-w-0 flex-1">
          <p className={`m-0 text-base font-bold ${iconTone}`}>
            {ok ? (isTimeOut ? "Time Out recorded" : "Time Returned recorded") : "Scan not accepted"}
          </p>
          <p className="m-0 mt-1 break-words text-sm text-slate-700">{message}</p>
        </div>
      </div>

      {record ? (
        <div className="mt-4 rounded-xl border border-white/70 bg-white/80 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="m-0 text-base font-bold text-slate-900">{record.employeeName}</p>
              {!publicAccess ? (
                <p className="m-0 mt-0.5 text-xs text-slate-600">
                  {[record.employeeId, record.position, formatRecordDivision(record)].filter(Boolean).join(" • ")}
                </p>
              ) : null}
            </div>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${passSlipStatusBadgeClasses(record.status)}`}
            >
              {passSlipStatusLabel(record.status)}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {[
              ["Reference", record.reference],
              ...(!publicAccess ? [["Destination", record.destination]] : []),
              ["Time Out", record.timeOutDisplay || "—"],
              ["Time Returned", record.timeInDisplay || "—"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="m-0 mt-0.5 break-words font-medium text-slate-800">{value || "—"}</dd>
              </div>
            ))}
          </dl>

          {record.durationMinutes !== null && record.durationMinutes !== undefined ? (
            <p className="m-0 mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
              Total time outside the office: {formatPassSlipDuration(record.durationMinutes)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function PassSlipScanConsole({ user, publicAccess = false }) {
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [scanHistory, setScanHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [openSlips, setOpenSlips] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  const busyRef = useRef(false);
  const recentRef = useRef(new Map());
  const wedgeRef = useRef({ buffer: "", lastKeyAt: 0 });
  const historyRequestRef = useRef(0);

  const cameraAvailable = useMemo(() => cameraScanningSupported(), []);

  useEffect(() => {
    forgetLegacyScanHistory();
  }, []);

  /*
   * Only the newest request may write the list. A refresh that set off just before a scan landed
   * would otherwise put that scan's card back the way it was until the refresh after.
   */
  const loadScanHistory = useCallback(async () => {
    const requestId = ++historyRequestRef.current;

    try {
      const response = await fetchPassSlipScanHistory({ publicAccess });
      if (requestId !== historyRequestRef.current) return;

      setScanHistory(
        (response.entries || []).map((entry) => ({ ...entry, record: scanHistoryRecord(entry.record, publicAccess) }))
      );
      setHistoryLoaded(true);
      setHistoryFailed(false);
    } catch {
      if (requestId !== historyRequestRef.current) return;
      setHistoryFailed(true);
    }
  }, [publicAccess]);

  /* Re-read while the page is on screen, and at once when it comes back to it. */
  useEffect(() => {
    void loadScanHistory();

    const refreshIfVisible = () => {
      if (document.visibilityState !== "hidden") {
        void loadScanHistory();
      }
    };

    const timer = window.setInterval(refreshIfVisible, SCAN_HISTORY_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadScanHistory]);

  const loadOpenSlips = useCallback(async ({ background = false } = {}) => {
    if (publicAccess) {
      setOpenSlips([]);
      return;
    }

    try {
      const response = await fetchPassSlips();
      setOpenSlips(
        (response.records || []).filter(
          (record) => normalizePassSlipStatus(record.status) === PASS_SLIP_STATUS.OUT
        )
      );
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load the pass slips currently out.");
      }
    }
  }, [publicAccess]);

  useEffect(() => {
    if (!publicAccess) {
      void loadOpenSlips();
    }
  }, [loadOpenSlips, publicAccess]);

  useAutoRefreshOnChange(loadOpenSlips, {
    enabled: !publicAccess,
    topic: "pass_slip",
    refreshOnMount: false,
  });

  /* Drives the "out for ..." readings on the open slips without re-fetching anything. */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const submitScan = useCallback(async (raw) => {
    const token = extractPassSlipToken(raw);
    const trimmed = String(raw || "").trim();

    if (!token && trimmed === "") {
      return;
    }

    if (busyRef.current) {
      return;
    }

    /*
     * The same payload twice in quick succession is one code held in front of a reader, not two
     * presentations of it. Swallowed here so the desk is not flooded with "Time Out was just
     * recorded" refusals for a scan that already worked.
     */
    const dedupeKey = token || trimmed.toLowerCase();
    const lastSeenAt = recentRef.current.get(dedupeKey) || 0;
    if (Date.now() - lastSeenAt < REPEAT_SCAN_COOLDOWN_MS) {
      return;
    }
    recentRef.current.set(dedupeKey, Date.now());

    busyRef.current = true;
    setBusy(true);

    /* Sent verbatim: the server is the one that pulls the token out and decides what it means. */
    const payload = token || trimmed;
    let scanResult;

    try {
      const response = publicAccess
        ? await scanPassSlip(payload, { publicAccess: true })
        : await scanPassSlip(payload);
      scanResult = {
        ok: true,
        action: response.action,
        message: response.message,
        record: response.record || null,
        at: Date.now(),
      };
      if (!publicAccess) {
        void loadOpenSlips({ background: true });
      }
    } catch (error) {
      const data = error?.response?.data;
      scanResult = {
        ok: false,
        action: data?.action || "DENIED",
        message: data?.message || error?.message || "The scan could not be processed.",
        record: data?.record || null,
        at: Date.now(),
      };
    }

    const historyEntry = {
      id: `${scanResult.at}-${Math.random().toString(36).slice(2, 8)}`,
      ok: scanResult.ok,
      action: scanResult.action,
      message: scanResult.message,
      record: scanHistoryRecord(scanResult.record, publicAccess),
      at: scanResult.at,
    };

    setResult(scanResult);

    /*
     * Shown here at once, then confirmed by the server. Only a scan that reached a slip is logged
     * there -- a code that matches nothing never makes the shared history, so it is not added here
     * only to vanish again on the next refresh; the result card above still reports it.
     */
    if (historyEntry.record) {
      historyRequestRef.current += 1;
      setScanHistory((current) => addScanToHistory(historyEntry, current));
    }
    void loadScanHistory();

    busyRef.current = false;
    setBusy(false);
  }, [loadOpenSlips, loadScanHistory, publicAccess]);

  /*
   * Hardware readers, caught at the document.
   *
   * A wedge reader types its payload in a few milliseconds and finishes with Enter, so a burst of
   * fast keystrokes ending in Enter is a scan and anything slower is a person. Listening on the
   * document rather than on an input is what makes the desk work hands-free -- nobody has to
   * remember to click the box first -- and keystrokes aimed at a real field are left alone.
   */
  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const typingInAField = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (typingInAField || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const state = wedgeRef.current;
      const now = Date.now();
      const gap = now - state.lastKeyAt;
      state.lastKeyAt = now;

      if (event.key === "Enter") {
        const scanned = state.buffer;
        state.buffer = "";

        if (scanned.length >= 8) {
          event.preventDefault();
          void submitScan(scanned);
        }
        return;
      }

      if (gap > WEDGE_KEY_GAP_MS) {
        state.buffer = "";
      }

      if (event.key.length === 1) {
        state.buffer += event.key;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [submitScan]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h3 className="m-0 flex items-center gap-2 text-base font-semibold text-slate-950">
              <ScanLine size={18} className="text-teal-700" />
              Pass Slip Scan Station
            </h3>
            <p className="m-0 mt-1 max-w-2xl text-sm text-slate-500">
              Scan a pass slip QR code once on the way out and again on return. The station works out
              which of the two it is — no times are typed here.
            </p>
          </div>

          {cameraAvailable ? (
            <button
              type="button"
              aria-pressed={cameraOn}
              onClick={() => setCameraOn((current) => !current)}
              className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                cameraOn
                  ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Camera size={16} />
              {cameraOn ? "Stop camera" : "Use camera"}
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
          <div className="space-y-3">
            {cameraOn ? (
              <QrCameraScanner active={cameraOn} paused={busy} onDecode={submitScan} />
            ) : (
              <div className="grid place-items-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <QrCode size={40} className="text-slate-400" />
                <p className="m-0 mt-3 text-sm font-semibold text-slate-700">Waiting for a scan</p>
                <p className="m-0 mt-1 max-w-xs text-sm text-slate-500">
                  Point a USB or Bluetooth reader at the QR code — it works without clicking anything
                  on this page first.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {result ? (
              <ScanResultCard result={result} publicAccess={publicAccess} />
            ) : (
              <div className="grid h-full min-h-[180px] place-items-center rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                <div>
                  <ShieldAlert size={22} className="mx-auto text-slate-400" />
                  <p className="m-0 mt-2 text-sm font-semibold text-slate-700">No scan yet</p>
                  <p className="m-0 mt-1 max-w-sm text-sm text-slate-500">
                    The result of the next scan appears here, along with whose slip it is and the time
                    that was recorded.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-4 py-5 sm:px-6">
          <h3 className="m-0 flex items-center gap-2 text-lg font-bold text-slate-950">
            Scan history
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
              {scanHistory.length}
            </span>
          </h3>
          <p className="m-0 mt-1 text-sm text-slate-500">
            One card per pass slip: the return scan updates the same card with its Time Returned.
            Every device that opens this station shows the same list, covering the last 30 days.
          </p>
          {historyFailed && historyLoaded ? (
            <p className="m-0 mt-2 text-xs font-semibold text-amber-700">
              Could not reach the server just now — the list may be a little behind.
            </p>
          ) : null}
        </header>

        {scanHistory.length === 0 ? (
          <p className="m-0 px-4 py-8 text-center text-sm text-slate-500 sm:px-6">
            {historyLoaded
              ? "No scans recorded at this station yet."
              : historyFailed
                ? "The scan history could not be loaded. It will try again shortly."
                : "Loading scan history..."}
          </p>
        ) : (
          <ul className="m-0 max-h-[40rem] list-none overflow-y-auto p-0">
            {scanHistory.map((entry) => (
              <ScanHistoryRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        )}
      </section>

      {!publicAccess ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="m-0 flex items-center gap-2 text-base font-semibold text-slate-950">
          <Users size={18} className="text-amber-700" />
          Currently out on pass slip
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
            {openSlips.length}
          </span>
        </h3>
        <p className="m-0 mt-1 text-sm text-slate-500">
          Everyone whose Time Out has been scanned and whose return is still outstanding.
          {user?.full_name ? ` Scans are recorded against ${user.full_name}.` : ""}
        </p>

        {openSlips.length === 0 ? (
          <p className="m-0 mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Nobody is out on a pass slip right now.
          </p>
        ) : (
          <ul className="m-0 mt-4 grid list-none gap-2.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {openSlips.map((record) => {
              const elapsed = passSlipElapsedMinutes(record, now);
              const overdue = elapsed !== null && elapsed > (Number(record.expectedMinutes) || 0);

              return (
                <li
                  key={record.id}
                  className={`rounded-xl border p-3.5 ${overdue ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}
                >
                  <p className="m-0 truncate text-sm font-bold text-slate-900">{record.employeeName}</p>
                  <p className="m-0 mt-0.5 truncate text-xs text-slate-500">
                    {[record.employeeId, formatRecordDivision(record)].filter(Boolean).join(" • ")}
                  </p>
                  <p className="m-0 mt-2 truncate text-sm text-slate-700">{record.destination}</p>
                  <p className="m-0 mt-1.5 text-xs text-slate-500">
                    Out since {record.timeOutDisplay || "—"} · {formatDateDisplay(record.timeOutDate || record.passDate)}
                  </p>
                  {elapsed !== null ? (
                    <p className={`m-0 mt-1.5 text-xs font-semibold ${overdue ? "text-rose-700" : "text-slate-600"}`}>
                      Out for {formatPassSlipDuration(elapsed)}
                      {overdue ? ` — past the ${formatPassSlipDuration(record.expectedMinutes)} expected` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        </section>
      ) : null}
    </div>
  );
}
