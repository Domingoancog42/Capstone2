import React from "react";
import { ArrowRight, Lock, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const publicUrl = process.env.PUBLIC_URL || "";
const mgbLogo = `${publicUrl}/mgb.png`;

function AuthenticationLoader() {
  return (
    <div
      className="flex min-h-[420px] items-center justify-center px-6 py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <div>
        <div className="mx-auto h-11 w-11 animate-spin rounded-full border-[3px] border-rose-100 border-t-[#D61E1E]" />
        <p className="m-0 mt-5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          Verifying your session...
        </p>
      </div>
    </div>
  );
}

/** Authentication-aware catch-all page used by the final React Router wildcard route. */
export default function NotFoundPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading } = useAuth();

  const buttonText = isAuthenticated
    ? "Back to Dashboard"
    : "Back to Login";

  const destination = isAuthenticated
    ? "/dashboard"
    : "/login";

  const message = isAuthenticated
    ? "You do not have permission to view this page. Please return to the dashboard."
    : "You do not have permission to view this page. Please return to the login page.";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff8fb_0%,#fff0f5_48%,#f6e2e9_100%)] font-['Aptos','Segoe_UI',sans-serif] text-slate-950 dark:bg-[linear-gradient(180deg,#020617_0%,#07101f_48%,#0b1220_100%)] dark:text-slate-50">
      <header className="border-b border-rose-100/90 bg-white/90 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex min-h-[76px] max-w-6xl items-center gap-3 px-5 py-3 sm:px-8">
          <img
            alt="Mines and Geosciences Bureau seal"
            className="h-12 w-12 shrink-0 object-contain"
            src={mgbLogo}
          />
          <div className="min-w-0 border-l border-slate-200 pl-3 dark:border-slate-700">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-[#D61E1E] sm:text-[11px]">
              Mines and Geosciences Bureau
            </p>
            <p className="m-0 mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300 sm:text-sm">
              Human Resources Information System
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-77px)] max-w-6xl items-center px-4 py-8 sm:px-8 sm:py-12">
        <div className="grid w-full overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_70px_rgba(110,19,41,0.16)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_24px_70px_rgba(0,0,0,0.42)] md:grid-cols-[0.88fr_1.12fr]">
          <div className="relative hidden min-h-[470px] overflow-hidden bg-[linear-gradient(145deg,#8f1010_0%,#d61e1e_58%,#f05252_100%)] p-10 text-white md:flex md:items-center md:justify-center">
            <div aria-hidden="true" className="absolute -left-20 -top-20 h-64 w-64 rounded-full border-[42px] border-white/10" />
            <div aria-hidden="true" className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full border-[52px] border-white/10" />
            <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-white/25 bg-white/10 shadow-2xl backdrop-blur-sm">
              <Shield className="h-40 w-40 text-white/95" strokeWidth={1.35} />
              <span className="absolute flex h-20 w-20 items-center justify-center rounded-2xl border border-white/30 bg-white text-[#B41818] shadow-xl">
                <Lock className="h-10 w-10" strokeWidth={2.2} />
              </span>
            </div>
          </div>

          {isAuthLoading ? (
            <AuthenticationLoader />
          ) : (
            <div className="flex min-h-[470px] flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
              <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-[#D61E1E] shadow-sm ring-1 ring-rose-100 dark:bg-rose-950/40 dark:ring-rose-900 md:hidden">
                <Shield className="h-9 w-9" aria-hidden="true" />
              </div>
              <h1 className="m-0 text-[clamp(4.5rem,13vw,8.25rem)] font-black leading-[0.78] tracking-[-0.07em] text-[#D61E1E]">
                404
              </h1>
              <p className="m-0 mt-8 text-xs font-extrabold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                Restricted destination
              </p>
              <h2 className="m-0 mt-3 text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                Unauthorized Access
              </h2>
              <p className="m-0 mt-5 max-w-[48ch] text-[15px] font-medium leading-7 text-slate-600 dark:text-slate-300">
                {message}
              </p>
              <button
                type="button"
                onClick={() => navigate(destination, { replace: true })}
                className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#D61E1E] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-rose-900/15 transition hover:bg-[#B41818] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#D61E1E]/25 sm:w-fit"
              >
                {buttonText}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
