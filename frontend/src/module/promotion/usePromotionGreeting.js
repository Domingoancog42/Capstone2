import { useCallback, useRef, useState } from "react";
import Swal from "sweetalert2";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { acknowledgePromotionGreeting, fetchPromotionGreetings } from "../../services/promotionService";
import { escapeHtml } from "../../utils/serverCaptchaPrompt";
import { formatDateDisplay } from "../../utils/leaveHelpers";
import { formatCurrency } from "../../utils/format";

/*
 * The congratulations card an employee sees on their dashboard after the Regional Director signs
 * their promotion.
 *
 * promotion.php stamps `greeted_at` when the card is closed and stops listing the promotion under
 * `resource=greetings`, so the card shows once -- on whichever device the employee next signs in
 * from, not once per browser the way a localStorage flag would. The hook listens on the `promotion`
 * live-update topic as well, so an employee already sitting on the dashboard when the Director
 * clicks Approve is congratulated on the spot rather than on their next visit.
 */

/*
 * Lucide outlines, inlined because SweetAlert takes markup, not React children. The names match
 * the lucide-react icons the rest of the dashboard draws with (TrendingUp, Briefcase, Building2,
 * CalendarDays, Banknote, Award, PartyPopper) so the card looks like it belongs to the same screen.
 */
const ICON_PATHS = {
  trendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  award: '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
  partyPopper: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
};

function iconSvg(name, size = 16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

function detailRow(iconName, label, value) {
  return `
    <li class="promotion-greeting-row">
      <span class="promotion-greeting-row-icon">${iconSvg(iconName)}</span>
      <span class="promotion-greeting-row-label">${escapeHtml(label)}</span>
      <span class="promotion-greeting-row-value">${escapeHtml(value)}</span>
    </li>
  `;
}

function salaryGradeLabel(promotion) {
  const grade = String(promotion?.salaryGrade || "").trim();
  const step = String(promotion?.stepIncrement || "").trim();

  if (!grade) {
    return "";
  }

  return step ? `SG ${grade}, Step ${step}` : `SG ${grade}`;
}

/** The first name the card addresses; the full name, then the username, when the record has none. */
export function promotionGreetingName(user) {
  const firstName = String(user?.first_name || "").trim();

  if (firstName) {
    return firstName;
  }

  const fullName = String(user?.full_name || "").trim();

  if (fullName) {
    return fullName.split(/\s+/)[0];
  }

  return String(user?.username || "").trim();
}

/** The confetti badge that replaces SweetAlert's stock icon. */
export function promotionGreetingIconHtml() {
  return `<span class="promotion-greeting-badge">${iconSvg("partyPopper", 38)}</span>`;
}

/** The body of the card. Exported so the markup can be checked without opening a SweetAlert. */
export function promotionGreetingHtml(promotion) {
  const fromDesignation = String(promotion?.fromDesignation || "").trim();
  const toDesignation = String(promotion?.toDesignation || "").trim() || "your new position";
  const toDivision = String(promotion?.toDivision || "").trim();
  const toSalary = Number(promotion?.toSalary);
  const grade = salaryGradeLabel(promotion);
  const approvedBy = String(promotion?.approvedBy || "").trim();

  const rows = [
    detailRow("briefcase", "New position", toDesignation),
    toDivision ? detailRow("building", "Division", toDivision) : "",
    detailRow("calendar", "Effective", formatDateDisplay(promotion?.effectiveDate)),
    Number.isFinite(toSalary) && toSalary > 0 ? detailRow("banknote", "Monthly salary", formatCurrency(toSalary)) : "",
    grade ? detailRow("award", "Salary grade", grade) : "",
  ].join("");

  return `
    <p class="promotion-greeting-lead">You are promoted to</p>
    <p class="promotion-greeting-designation">${escapeHtml(toDesignation)}</p>
    ${fromDesignation ? `
      <p class="promotion-greeting-path">
        <span>${escapeHtml(fromDesignation)}</span>
        <span class="promotion-greeting-path-icon">${iconSvg("trendingUp", 18)}</span>
        <span>${escapeHtml(toDesignation)}</span>
      </p>
    ` : ""}
    <ul class="promotion-greeting-details">${rows}</ul>
    <p class="promotion-greeting-footnote">
      Approved by the Regional Director${approvedBy ? `, ${escapeHtml(approvedBy)}` : ""}${promotion?.approvedAt ? ` on ${escapeHtml(formatDateDisplay(promotion.approvedAt))}` : ""}.
      Your employee record and service record already reflect the new appointment.
    </p>
  `;
}

/**
 * Opens the card for one promotion and resolves with SweetAlert's result. `canView` adds a second
 * button that takes the employee to their promotion history; the caller decides what that means.
 */
export function showPromotionGreeting(promotion, { user, canView = false } = {}) {
  const name = promotionGreetingName(user);

  return Swal.fire({
    title: name ? `Congratulations, ${name}!` : "Congratulations!",
    html: promotionGreetingHtml(promotion),
    iconHtml: promotionGreetingIconHtml(),
    width: 520,
    showCancelButton: canView,
    confirmButtonText: "Thank you!",
    cancelButtonText: "View my promotion",
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#64748b",
    // The card is a one-time greeting: it stays until the employee closes it themselves, so a stray
    // click on the backdrop does not spend it before they have read it.
    allowOutsideClick: false,
    customClass: {
      popup: "promotion-greeting-popup",
      icon: "promotion-greeting-icon",
      title: "promotion-greeting-title",
      htmlContainer: "promotion-greeting-body",
    },
  });
}

/**
 * Greets the signed-in employee for every approved promotion they have not yet seen, one card at a
 * time, and acknowledges each as it is closed.
 *
 * Returns `settled`: false until the first check has finished and every card it produced has been
 * closed. The dashboard holds its other entry prompts (the password-expiry modal) behind it so the
 * two never stack.
 */
export default function usePromotionGreeting({ user, onNavigate, promotionsPath = "" } = {}) {
  const [settled, setSettled] = useState(false);
  // Ids already put in front of the employee this mount. A refresh landing while the acknowledge
  // request is still in flight would otherwise list the same promotion a second time.
  const shownIdsRef = useRef(new Set());

  const checkGreetings = useCallback(async () => {
    try {
      const result = await fetchPromotionGreetings();
      const promotions = (Array.isArray(result?.promotions) ? result.promotions : [])
        .filter((promotion) => !shownIdsRef.current.has(promotion.id));

      for (const promotion of promotions) {
        shownIdsRef.current.add(promotion.id);

        const canView = Boolean(onNavigate && promotionsPath);
        // eslint-disable-next-line no-await-in-loop -- one card at a time, by design.
        const outcome = await showPromotionGreeting(promotion, { user, canView });

        try {
          // eslint-disable-next-line no-await-in-loop
          await acknowledgePromotionGreeting(promotion.id);
        } catch (acknowledgeError) {
          // The card was seen; if the stamp did not land it shows once more next time, which is
          // the better failure than a promotion nobody was ever told about.
          console.error("Failed to acknowledge promotion greeting:", acknowledgeError);
        }

        // SweetAlert reports the cancel button as `dismiss: "cancel"` (Swal.DismissReason.cancel).
        if (canView && outcome?.dismiss === "cancel") {
          onNavigate(promotionsPath);
        }
      }
    } catch (error) {
      console.error("Failed to check promotion greetings:", error);
    } finally {
      setSettled(true);
    }
  }, [onNavigate, promotionsPath, user]);

  useAutoRefreshOnChange(checkGreetings, {
    topics: ["promotion"],
    enabled: Boolean(user),
  });

  // With nobody signed in there is nothing to check, so nothing is held behind the greeting.
  return settled || !user;
}
