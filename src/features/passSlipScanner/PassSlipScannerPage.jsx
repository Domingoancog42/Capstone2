import React from "react";
import { ArrowLeft, ScanLine, ShieldCheck } from "lucide-react";
import PassSlipScanConsole from "./PassSlipScanConsole";
import { getDefaultPathForRole, resolveBaseRole } from "../../utils/roleRoutes";

const publicUrl = process.env.PUBLIC_URL || "";
const mgbLogo = `${publicUrl}/mgb.png`;

function passSlipWorkspacePath(user) {
  const roleKey = resolveBaseRole(user?.roleKey || user?.role, user?.baseRoleKey);

  return roleKey === "employee"
    ? "/employee/pass-slips"
    : `/${roleKey}/leave/pass-slips`;
}

function ScannerLink({ href, onNavigate, children, className = "" }) {
  const handleClick = (event) => {
    if (
      !onNavigate
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onNavigate(href);
  };

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}

/** A distraction-free route for the gate or front-desk scanning device. */
export default function PassSlipScannerPage({ user, onNavigate }) {
  const publicAccess = !user;
  const workspacePath = publicAccess ? "" : passSlipWorkspacePath(user);
  const dashboardPath = publicAccess
    ? ""
    : getDefaultPathForRole(user?.roleKey || user?.role, user?.baseRoleKey);

  return (
    <main className="pass-slip-workspace min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex min-h-[76px] max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <img
              alt="Mines and Geosciences Bureau seal"
              className="h-12 w-12 shrink-0 object-contain"
              src={mgbLogo}
            />
            <div className="min-w-0 border-l border-slate-200 pl-3 dark:border-slate-700">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-[#D61E1E] sm:text-[11px]">
                Mines and Geosciences Bureau
              </p>
              <p className="m-0 mt-0.5 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                Pass Slip Scanner
              </p>
            </div>
          </div>

          {!publicAccess ? (
            <ScannerLink
              href={workspacePath}
              onNavigate={onNavigate}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <ArrowLeft size={16} />
              Back to Pass Slips
            </ScannerLink>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="mb-5 overflow-hidden rounded-2xl bg-gradient-to-r from-teal-800 to-teal-600 p-5 text-white shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <ScanLine size={22} aria-hidden="true" />
              </span>
              <div>
                <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-teal-100">
                  Dedicated station
                </p>
                <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                  Pass Slip Scan Station
                </h1>
                <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-teal-50">
                  Keep this page open at the scanning desk. Each QR scan records either Time Out or
                  Time Returned automatically.
                </p>
              </div>
            </div>

            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-teal-50">
              <ShieldCheck size={15} aria-hidden="true" />
              {publicAccess
                ? "Public scanner — no login required"
                : `Signed in as ${user?.full_name || user?.username || "authorized user"}`}
            </div>
          </div>
        </section>

        <PassSlipScanConsole user={user} publicAccess={publicAccess} />

        {!publicAccess ? (
          <p className="m-0 mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            Need another module?{" "}
            <ScannerLink
              href={dashboardPath}
              onNavigate={onNavigate}
              className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
            >
              Return to your dashboard
            </ScannerLink>
            .
          </p>
        ) : null}
      </div>
    </main>
  );
}

export { passSlipWorkspacePath };
