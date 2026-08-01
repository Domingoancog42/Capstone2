import { Heart, Medal } from "lucide-react";

/**
 * Presentation for each award category.
 *
 * The *rules* (who may be nominated, whether a period allows one winner, whether years of service
 * apply) live in `REWARD_CATEGORIES` in `backend/api/rewards.php` and are enforced there. This map
 * only says how a category looks and reads, so the two never contradict each other on anything
 * that matters.
 */

export const DEFAULT_CATEGORY = "best_employee_month";

/** Where nominations lived before awards were stored on the server. Read once, for the hand-over. */
export const LEGACY_STORAGE_KEY = "hris.rewardsRecognition.nominations";

export const REWARD_CATEGORIES = {
  best_employee_month: {
    label: "Best Employee of the Month",
    shortLabel: "Employee of the Month",
    description: "One recipient per month, recognising outstanding performance.",
    icon: Medal,
    usesYearsOfService: false,
    accentClass: "border-violet-200 bg-violet-50",
    iconClass: "bg-violet-100 text-violet-700",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
    certificateAccent: "#8f1717",
  },
  loyalty: {
    label: "Loyalty Award",
    shortLabel: "Loyalty Award",
    description: "Honouring service milestones. Any number of recipients per year.",
    icon: Heart,
    usesYearsOfService: true,
    accentClass: "border-amber-200 bg-amber-50",
    iconClass: "bg-amber-100 text-amber-700",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    certificateAccent: "#0f766e",
  },
};

export const CATEGORY_KEYS = Object.keys(REWARD_CATEGORIES);

export const CATEGORY_OPTIONS = CATEGORY_KEYS.map((key) => ({
  value: key,
  label: REWARD_CATEGORIES[key].label,
}));

export const REWARD_STATUSES = {
  Pending: {
    label: "Pending",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    dotClass: "bg-amber-500",
  },
  Approved: {
    label: "Approved",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dotClass: "bg-emerald-500",
  },
  Rejected: {
    label: "Rejected",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
    dotClass: "bg-rose-500",
  },
};

export const STATUS_KEYS = Object.keys(REWARD_STATUSES);

export const STATUS_OPTIONS = STATUS_KEYS.map((key) => ({ value: key, label: key }));

export function categoryDetail(key) {
  return REWARD_CATEGORIES[key] || REWARD_CATEGORIES[DEFAULT_CATEGORY];
}

export function statusDetail(key) {
  return REWARD_STATUSES[key] || REWARD_STATUSES.Pending;
}
