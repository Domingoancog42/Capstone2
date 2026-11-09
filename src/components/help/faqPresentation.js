import { CalendarDays, FileText, Folder, Image, MoreHorizontal, Settings, TrendingUp, Trophy, UserRound, Wallet } from "lucide-react";

export const FAQ_CATEGORY_GROUPS = [
  { id: "", label: "All Areas", icon: Folder },
  { id: "hr", label: "HR Management", icon: UserRound },
  { id: "leave", label: "Leave & Attendance", icon: CalendarDays },
  { id: "payroll", label: "Payroll & Benefits", icon: Wallet },
  { id: "performance", label: "Performance", icon: TrendingUp },
  { id: "rewards", label: "Rewards & Recognition", icon: Trophy },
  { id: "settings", label: "System Settings", icon: Settings },
  { id: "other", label: "Others", icon: MoreHorizontal },
];

export function faqCategoryGroup(faq) {
  const category = faq.category || "";
  if (/attendance|dtr/i.test(faq.module || faq.id || "")) return "leave";
  if (/Attendance & pay/i.test(category)) return "payroll";
  if (/Leave|requests/i.test(category)) return "leave";
  if (/Profile|Employees|HR Management/i.test(category)) return "hr";
  if (/Performance/i.test(category)) return "performance";
  if (/Rewards/i.test(category)) return "rewards";
  if (/Settings/i.test(category)) return "settings";
  return "other";
}

export function faqRowIcon(faq) {
  if (/photo|picture|image/i.test(faq.question)) return Image;
  return FAQ_CATEGORY_GROUPS.find((group) => group.id === faqCategoryGroup(faq))?.icon || FileText;
}
