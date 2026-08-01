import React from "react";
import { toast } from "react-hot-toast";
import { certificateContent } from "./certificateContent";
import { escapeHtml } from "./rewardsUtils";

/** The on-screen preview. Wording and accent come from `certificateContent`, same as the printout. */
export default function RewardCertificate({ record }) {
  if (!record) {
    return null;
  }

  const content = certificateContent(record);

  if (content.isLoyalty) {
    return (
      <div className="mx-auto max-w-[980px] rounded-lg bg-slate-200 p-3 shadow-sm">
        <div className="grid overflow-hidden border-[8px] border-[#0f766e] bg-[#f7fffb] text-slate-950 lg:grid-cols-[220px_1fr]">
          <aside className="flex flex-col bg-[#0f766e] px-5 py-7 text-white">
            <div className="flex flex-col items-start gap-3">
              <img src="/mgb.png" alt="MGB logo" className="h-20 w-20 rounded-full bg-white p-1.5 object-contain" />
              <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.14em]">
                Mines and<br />Geosciences Bureau
              </p>
            </div>
            <div className="mt-14 rounded-2xl bg-white/15 px-4 py-5">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.2em] text-emerald-50">Loyalty</p>
              <p className="m-0 mt-2 text-3xl font-bold leading-tight">{content.categoryMark}</p>
            </div>
            {content.certificateNumber ? (
              <p className="m-0 mt-auto pt-8 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-50">
                No. {content.certificateNumber}
              </p>
            ) : null}
          </aside>

          <div className="px-6 py-8 text-left sm:px-10 sm:py-10">
            <h2 className="m-0 font-serif text-3xl font-bold uppercase leading-tight tracking-[0.08em] text-[#0f766e] sm:text-5xl">
              {content.heading}
            </h2>
            <p className="m-0 mt-7 text-sm font-extrabold uppercase tracking-[0.22em] text-slate-500">
              {content.presentedTo}
            </p>
            <p className="mt-4 inline-block rounded-3xl bg-white px-7 py-4 font-serif text-3xl font-bold text-slate-950 shadow-[0_16px_36px_rgba(15,118,110,0.12)] sm:text-5xl">
              {content.recipient}
            </p>

            <p className="m-0 mt-6 text-sm font-extrabold uppercase tracking-[0.16em] text-[#0f766e] sm:text-base">
              {content.nomineeLabel}
            </p>
            <p className="m-0 mt-2 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-700 sm:text-sm">
              {content.categoryLine}
            </p>

            <p className="mt-8 max-w-3xl text-base leading-8 text-slate-700 sm:text-lg">{content.body}</p>
            <p className="mt-7 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">{content.given}</p>

            <div className="mt-16 flex justify-end">
              <div className="w-full max-w-[340px] text-center text-sm font-bold text-slate-900">
                {content.signatory}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[940px] rounded-lg bg-slate-200 p-3 shadow-sm">
      <div className="relative overflow-hidden border-[8px] border-[#8f1717] bg-[#fffdf8] px-6 py-7 text-center text-slate-950 sm:px-10 sm:py-9">
        <div className="relative z-10 flex items-start justify-between gap-4 text-left">
          <div className="flex items-center gap-3">
            <img src="/mgb.png" alt="MGB logo" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#7f1d1d]">
              Mines and<br />Geosciences Bureau
            </p>
          </div>
          <p className="m-0 text-right text-xs font-bold text-slate-500">
            Certificate No.
            <span className="block text-slate-700">{content.certificateNumber || "N/A"}</span>
          </p>
        </div>

        <h2 className="relative z-10 m-0 mt-8 font-serif text-3xl font-bold uppercase tracking-[0.08em] text-[#8f1717] sm:text-5xl">
          {content.heading}
        </h2>

        <p className="relative z-10 m-0 mt-7 text-sm font-extrabold uppercase tracking-[0.22em] text-slate-500">
          {content.presentedTo}
        </p>
        <p className="relative z-10 mx-auto mt-3 inline-block min-w-[65%] border-b-2 border-slate-900 px-8 pb-2 font-serif text-3xl font-bold text-slate-950 sm:text-5xl">
          {content.recipient}
        </p>

        <p className="relative z-10 m-0 mt-5 text-sm font-extrabold uppercase tracking-[0.16em] text-[#8f1717] sm:text-base">
          {content.nomineeLabel}
        </p>
        <p className="relative z-10 m-0 mt-2 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-700 sm:text-sm">
          {content.categoryLine}
        </p>

        <p className="relative z-10 mx-auto mt-7 max-w-3xl text-base leading-8 text-slate-700 sm:text-lg">
          {content.body}
        </p>
        <p className="relative z-10 mx-auto mt-7 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
          {content.given}
        </p>

        <div className="relative z-10 mt-16 flex justify-end">
          <div className="w-full max-w-[340px] border-t border-slate-900 pt-3 text-center text-sm font-bold text-slate-900">
            {content.signatory}
          </div>
        </div>
      </div>
    </div>
  );
}

export function printCertificate(record) {
  if (typeof window === "undefined" || !record) {
    return;
  }

  const content = certificateContent(record);
  const printWindow = window.open("", "_blank", "width=960,height=720");

  if (!printWindow) {
    toast.error("Allow pop-ups to print the certificate.");
    return;
  }

  const topbarRight = content.isLoyalty
    ? `<div class="category-mark">${escapeHtml(content.categoryMark)}</div>`
    : `<div class="cert-no">Certificate No. ${escapeHtml(content.certificateNumber)}</div>`;

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(content.recipient)} - Certificate</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 28px; color: #111827; font-family: Georgia, "Times New Roman", serif; background: #f8fafc; }
          .certificate { position: relative; min-height: 690px; overflow: hidden; background: var(--paper); color: #111827; }
          .certificate.best { --accent: #8f1717; --accent-soft: #fff1e8; --paper: #fffdf8; border: 8px solid var(--accent); padding: 34px 46px 42px; text-align: center; }
          .certificate.best::before { content: ""; position: absolute; inset: 16px; border: 2px solid #d9a441; pointer-events: none; }
          .certificate.best::after { content: ""; position: absolute; inset: 28px; border: 1px solid rgba(143, 23, 23, 0.28); pointer-events: none; }
          .certificate.loyalty { --accent: #0f766e; --accent-soft: #ecfdf5; --paper: #f7fffb; display: grid; grid-template-columns: 220px 1fr; border: 8px solid var(--accent); text-align: left; }
          .topbar { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; min-height: 76px; }
          .loyalty .topbar { flex-direction: column; align-items: flex-start; justify-content: flex-start; min-height: 100%; padding: 26px 20px; background: var(--accent); color: white; }
          .logo { display: flex; align-items: center; gap: 12px; text-align: left; font: 700 12px Arial, sans-serif; color: var(--accent); letter-spacing: 0.12em; text-transform: uppercase; }
          .loyalty .logo { color: white; flex-direction: column; align-items: flex-start; gap: 14px; }
          .logo img { height: 72px; width: 72px; object-fit: contain; }
          .loyalty .logo img { border-radius: 999px; background: white; padding: 6px; }
          .cert-no { font: 700 12px Arial, sans-serif; color: #475569; }
          .category-mark { border-radius: 999px; background: var(--accent-soft); color: var(--accent); padding: 10px 16px; font: 800 12px Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
          .loyalty .category-mark { margin-top: 58px; border-radius: 18px; background: rgba(255,255,255,0.15); color: white; font-size: 22px; letter-spacing: 0.04em; line-height: 1.25; }
          .content { position: relative; z-index: 1; }
          .loyalty .content { padding: 48px 48px 42px; }
          h1 { position: relative; z-index: 1; margin: 34px 0 0; color: var(--accent); font-size: 42px; letter-spacing: 0.08em; text-transform: uppercase; }
          .loyalty h1 { margin-top: 0; font-size: 38px; line-height: 1.2; }
          .presented { margin: 28px 0 0; font: 700 15px Arial, sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #475569; }
          .recipient { margin: 14px auto 0; display: inline-block; min-width: 520px; border-radius: 24px; background: rgba(255,255,255,0.72); padding: 12px 34px; font-size: 42px; font-weight: 700; color: #111827; }
          .best .recipient { min-width: 560px; border-bottom: 2px solid #111827; border-radius: 0; background: transparent; padding: 0 36px 10px; }
          .loyalty .recipient { min-width: 0; margin-left: 0; background: white; box-shadow: 0 16px 36px rgba(15, 118, 110, 0.12); }
          .nominee { margin: 18px 0 0; font: 800 17px Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
          .category { margin: 8px 0 0; font: 800 14px Arial, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #334155; }
          .body { margin: 30px auto 0; max-width: 760px; font-size: 18px; line-height: 1.8; color: #1f2937; }
          .loyalty .body { margin-left: 0; max-width: 700px; }
          .given { margin: 34px auto 0; max-width: 720px; font-size: 16px; line-height: 1.7; color: #334155; }
          .loyalty .given { margin-left: 0; }
          .signature { margin: 76px 0 0 auto; width: 340px; padding-top: 10px; font: 700 14px Arial, sans-serif; color: #111827; text-align: center; }
          .best .signature { border-top: 1.5px solid #111827; }
          .loyalty .signature { margin-left: auto; }
          /* Without this, browsers strip the maroon border and the teal panel from the printout and
             the certificate comes out as plain text on white. */
          @media print {
            body { padding: 0; background: white; }
            .certificate { min-height: 100vh; border-width: 7px; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
          @page { size: landscape; margin: 10mm; }
        </style>
      </head>
      <body>
        <main class="certificate ${content.isLoyalty ? "loyalty" : "best"}">
          <div class="topbar">
            <div class="logo">
              <img src="/mgb.png" alt="MGB logo" />
              <span>Mines and<br />Geosciences Bureau</span>
            </div>
            ${topbarRight}
          </div>
          <div class="content">
            <h1>${escapeHtml(content.heading)}</h1>
            <p class="presented">${escapeHtml(content.presentedTo)}</p>
            <div class="recipient">${escapeHtml(content.recipient)}</div>
            <p class="nominee">${escapeHtml(content.nomineeLabel)}</p>
            <p class="category">${escapeHtml(content.categoryLine)}</p>
            <p class="body">${escapeHtml(content.body)}</p>
            <p class="given">${escapeHtml(content.given)}</p>
            <div class="signature">${escapeHtml(content.signatory)}</div>
          </div>
        </main>
        <script>
          window.onload = function () {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
