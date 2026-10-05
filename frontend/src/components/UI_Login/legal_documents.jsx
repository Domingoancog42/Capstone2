import React, { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, ShieldCheck, X } from "lucide-react";
import {
  AUTH_DEPARTMENT,
  AUTH_FOCUS_RING,
  AUTH_OFFICE_ADDRESS,
  AUTH_ORGANIZATION,
  cx,
} from "./ui/authTheme";

/**
 * The Privacy Policy and Terms of Use shown from the sign-in screen.
 *
 * These are deliberately not rendered through components/UI/modal.jsx. That modal carries `dark:`
 * variants, and the theme class stays on <html> across a sign-out, so a user who left the app in
 * dark mode would get a dark dialog over the light-only login page.
 */

const AGENCY_SHORT = `${AUTH_ORGANIZATION} (MGB) - Regional Office No. X`;
const AGENCY_FULL = `${AGENCY_SHORT}, ${AUTH_DEPARTMENT} (DENR)`;
const OFFICE_LOCATION = AUTH_OFFICE_ADDRESS.replace(/^Region X,\s*/, "");

/** Printed under each heading so readers can tell which revision they agreed to. */
const LEGAL_LAST_UPDATED = "08 August 2026";

const PRIVACY_POLICY = {
  key: "privacy",
  icon: ShieldCheck,
  title: "Privacy Policy",
  intro:
    `${AGENCY_FULL}, respects your right to privacy. This notice explains how the Human Resources `
    + "Information System (HRIS) collects, uses, stores, and protects your personal data, in "
    + "accordance with Republic Act No. 10173 (Data Privacy Act of 2012), its Implementing Rules and "
    + "Regulations, and the issuances of the National Privacy Commission.",
  sections: [
    {
      title: "Who processes your data",
      paragraphs: [
        `${AGENCY_SHORT}, with office address at ${OFFICE_LOCATION}, is the personal information `
        + "controller for the records kept in this system. Processing is carried out by the Human "
        + "Resource Management Office (HRMO) and by system administrators authorized by the Regional "
        + "Director.",
      ],
    },
    {
      title: "Personal data we collect",
      paragraphs: ["The system holds only what is needed to administer your employment record:"],
      items: [
        "Identity and contact details - full name, employee number, date of birth, sex, civil status, address, personal and official e-mail, and contact number.",
        "Employment details - position, salary grade, appointment status, division or section, immediate supervisor, and date of assumption.",
        "Attendance and time records - daily time-in and time-out entries, tardiness and undertime, pass slips, and official travel orders.",
        "Leave and benefit records - leave applications and balances, compensatory time-off, overtime, and leave monetization.",
        "Account and security data - your username, an irreversibly hashed password, two-factor authentication settings, sign-in timestamps, IP address, browser information, and the audit trail of actions you perform.",
        "Documents you upload - supporting attachments such as medical certificates, clearances, and other requirements for a request.",
      ],
    },
    {
      title: "Why we process it",
      items: [
        "To maintain your official employment (201) records.",
        "To process attendance, leave, overtime, compensatory time-off, pass slips, and travel orders.",
        "To compute and support payroll, leave credits, and leave monetization.",
        "To route each request to the correct approving officer and notify you of the result.",
        "To secure the system - detecting unauthorized access, enforcing the password policy, and keeping an audit trail.",
        "To comply with the reportorial and audit requirements of agencies with legal authority over government personnel records.",
      ],
    },
    {
      title: "Lawful basis",
      paragraphs: [
        "Your data is processed because it is necessary for the fulfilment of the mandate of a public "
        + "authority and for compliance with a legal obligation, as allowed under Sections 12 and 13 of "
        + "the Data Privacy Act. Where a purpose is not covered by those bases, your consent is obtained "
        + "first.",
      ],
    },
    {
      title: "Who your data is shared with",
      paragraphs: [
        "Access inside the office follows your role: you can always see your own record, supervisors "
        + "and approving officers see the records of the personnel they act on, and the HRMO and system "
        + "administrators see what their duties require.",
        "Records leave the office only when the law requires it - for example to the DENR and MGB "
        + "Central Offices, the Civil Service Commission, the Commission on Audit, the Department of "
        + "Budget and Management, GSIS, PhilHealth, Pag-IBIG, and the Bureau of Internal Revenue. Your "
        + "personal data is never sold, rented, or used for advertising.",
      ],
    },
    {
      title: "Storage, retention, and disposal",
      paragraphs: [
        "Records are stored on facilities controlled by the Regional Office. Employment records are "
        + "kept for the periods prescribed by the National Archives of the Philippines and by Civil "
        + "Service rules, then disposed of securely. Some records are archived rather than deleted "
        + "where a retention period or a pending case requires it.",
      ],
    },
    {
      title: "How we protect it",
      items: [
        "Passwords are stored as one-way hashes and are never visible to administrators.",
        "Accounts are issued individually and access is granted by role - accounts are not shared.",
        "Two-factor authentication and password expiry may be required for accounts with elevated access.",
        "Idle sessions end automatically, and repeated failed sign-ins temporarily lock the account.",
        "Actions taken in the system are logged for audit.",
      ],
    },
    {
      title: "Your rights as a data subject",
      paragraphs: [
        "Under the Data Privacy Act you have the right to be informed, to access your data, to object "
        + "to processing, to have inaccurate entries corrected, to have data blocked or erased on lawful "
        + "grounds, to data portability, and to be indemnified for damages arising from unlawful "
        + "processing.",
      ],
    },
    {
      title: "How to reach us",
      paragraphs: [
        "To exercise any of these rights, or to raise a concern about how your data is handled, contact "
        + `the Data Protection Officer through the Human Resource Management Office of ${AGENCY_SHORT}, `
        + `${OFFICE_LOCATION}. If you are not satisfied with the response, you may bring the matter to `
        + "the National Privacy Commission at privacy.gov.ph.",
      ],
    },
  ],
};

const TERMS_OF_USE = {
  key: "terms",
  icon: FileText,
  title: "Terms of Use",
  intro:
    `This is the official Human Resources Information System of ${AGENCY_FULL}. By signing in and `
    + "using the system, you accept the terms below.",
  sections: [
    {
      title: "Who may use this system",
      paragraphs: [
        "Accounts are issued only to officials and employees of the Regional Office and to personnel "
        + "expressly authorized by the Regional Director. Access ends when you separate from, or are "
        + "reassigned out of, the office.",
      ],
    },
    {
      title: "Your account",
      paragraphs: [
        "You are accountable for everything done under your account. Keep your password confidential, "
        + "do not lend or share your account, sign out on shared machines, and report a suspected "
        + "compromise to the HRMO or a system administrator immediately. Do not use another employee's "
        + "account, even with their permission.",
      ],
    },
    {
      title: "Accuracy of what you submit",
      paragraphs: [
        "Entries you file - attendance corrections, leave applications, overtime, compensatory "
        + "time-off, pass slips, travel orders, and their attachments - are official records. Filing a "
        + "false or misleading entry is falsification of an official document and is a ground for "
        + "administrative liability under the Revised Rules on Administrative Cases in the Civil "
        + "Service, without prejudice to criminal liability.",
      ],
    },
    {
      title: "Acceptable use",
      items: [
        "Use the system only for official business.",
        "Do not attempt to view or alter records you are not authorized to access.",
        "Do not bypass, disable, or probe the security controls of the system.",
        "Do not introduce malicious code, automate access, or place an unreasonable load on the system.",
        "Do not copy, forward, or publish another employee's personal data taken from this system.",
      ],
    },
    {
      title: "Monitoring and audit",
      paragraphs: [
        "Sign-ins and actions performed here are logged for security and audit purposes. There is no "
        + "expectation of privacy in what you do on this government system, although the personal data "
        + "those actions touch remains protected under the Privacy Policy.",
      ],
    },
    {
      title: "Availability",
      paragraphs: [
        "Access may be interrupted for maintenance, upgrades, or causes beyond the control of the "
        + "office. Where a deadline is affected, follow the manual procedure prescribed by the HRMO. "
        + "The office is not liable for losses arising from an interruption or from information entered "
        + "incorrectly by the user.",
      ],
    },
    {
      title: "Ownership",
      paragraphs: [
        "The system, its contents, and the official records it holds are property of the Government of "
        + "the Republic of the Philippines. No part may be reproduced or distributed outside official "
        + "use without written authority.",
      ],
    },
    {
      title: "Suspension of access",
      paragraphs: [
        "Access may be suspended or withdrawn without prior notice for a violation of these terms, for "
        + "a security concern, or upon separation from the service. This is without prejudice to "
        + "administrative or criminal proceedings.",
      ],
    },
    {
      title: "Changes to these terms",
      paragraphs: [
        "These terms may be updated as office policy or law requires. The version shown here is always "
        + "the current one, and continued use after an update means you accept it.",
      ],
    },
    {
      title: "Governing law",
      paragraphs: [
        "These terms are governed by the laws of the Republic of the Philippines, and any dispute is "
        + "subject to the government forum having jurisdiction over it.",
      ],
    },
  ],
};

const LEGAL_DOCUMENTS = {
  [PRIVACY_POLICY.key]: PRIVACY_POLICY,
  [TERMS_OF_USE.key]: TERMS_OF_USE,
};

function LegalDocumentDialog({ document: legalDocument, onClose }) {
  const headingId = useId();
  const panelRef = useRef(null);
  const Icon = legalDocument?.icon;

  /*
   * Escape closes, and the page behind is frozen while the dialog is up so a scroll gesture inside
   * a long policy does not run the sign-in column instead once it reaches the end.
   */
  useEffect(() => {
    if (!legalDocument) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    // Moves the reading position into the dialog; the caller puts it back on the link afterwards.
    panelRef.current?.focus();

    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [legalDocument, onClose]);

  return (
    <AnimatePresence>
      {legalDocument ? (
        <div className="fixed inset-0 z-[60] grid place-items-center p-3 sm:p-6">
          <motion.button
            animate={{ opacity: 1 }}
            aria-label={`Close ${legalDocument.title}`}
            className="fixed inset-0 border-0 bg-slate-950/55 backdrop-blur-[2px]"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={onClose}
            transition={{ duration: 0.18 }}
            type="button"
          />

          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            aria-labelledby={headingId}
            aria-modal="true"
            className="relative z-10 flex max-h-[90dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.28)] outline-none"
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="h-1 shrink-0 bg-[#D61E1E]" />

            <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-50 text-[#D61E1E]">
                {Icon ? <Icon aria-hidden="true" size={19} /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-base font-bold tracking-tight text-slate-900" id={headingId}>
                  {legalDocument.title}
                </h2>
                <p className="m-0 mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Last updated {LEGAL_LAST_UPDATED}
                </p>
              </div>
              <button
                aria-label={`Close ${legalDocument.title}`}
                className={cx(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-[#D61E1E]",
                  AUTH_FOCUS_RING,
                )}
                onClick={onClose}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </header>

            <div className="overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
              <p className="m-0 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] leading-6 text-slate-600">
                {legalDocument.intro}
              </p>

              <div className="mt-5 grid gap-5">
                {legalDocument.sections.map((section, index) => (
                  <section key={section.title}>
                    <h3 className="m-0 text-[13px] font-bold text-slate-900">
                      <span className="text-[#D61E1E]">{index + 1}.</span> {section.title}
                    </h3>

                    {section.paragraphs?.map((paragraph) => (
                      <p className="m-0 mt-1.5 text-[13px] leading-6 text-slate-600" key={paragraph}>
                        {paragraph}
                      </p>
                    ))}

                    {section.items ? (
                      <ul className="m-0 mt-2 grid list-disc gap-1.5 pl-5 text-[13px] leading-6 text-slate-600 marker:text-[#D61E1E]">
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>

            <footer className="flex shrink-0 justify-end border-t border-slate-200 px-4 py-3 sm:px-5">
              <button
                className={cx(
                  "inline-flex min-h-[40px] items-center justify-center rounded-md bg-[#D61E1E] px-5 text-sm font-semibold text-white transition hover:bg-[#B41818]",
                  AUTH_FOCUS_RING,
                )}
                onClick={onClose}
                type="button"
              >
                Close
              </button>
            </footer>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The consent line under the sign-in form. It owns the dialog state itself so the sign-in card does
 * not have to thread another pair of props through for something that is purely presentational.
 */
export default function LegalConsentNotice({ className = "" }) {
  const [activeKey, setActiveKey] = useState(null);
  const triggerRef = useRef(null);

  const openDocument = (key) => (event) => {
    // Remembered so closing returns the caret to the link that was used, not to the top of the page.
    triggerRef.current = event.currentTarget;
    setActiveKey(key);
  };

  const closeDocument = () => {
    setActiveKey(null);
    triggerRef.current?.focus();
  };

  const linkClass = cx(
    "rounded font-semibold text-[#D61E1E] underline underline-offset-2 transition hover:text-[#B41818]",
    AUTH_FOCUS_RING,
  );

  return (
    <>
      <p className={cx("m-0 text-center text-xs leading-5 text-slate-500", className)}>
        By continuing, you agree to our{" "}
        <button className={linkClass} onClick={openDocument(PRIVACY_POLICY.key)} type="button">
          Privacy Policy
        </button>{" "}
        and{" "}
        <button className={linkClass} onClick={openDocument(TERMS_OF_USE.key)} type="button">
          Terms of Use
        </button>
        .
      </p>

      <LegalDocumentDialog document={LEGAL_DOCUMENTS[activeKey] || null} onClose={closeDocument} />
    </>
  );
}
