import React from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import Modal from "../UI/modal";
import Button from "../UI/button";

export default function PasswordExpiryModal({
  open,
  daysUntilExpiry,
  onClose,
  onChangePassword,
}) {
  const isUrgent = daysUntilExpiry <= 7;
  const isCritical = daysUntilExpiry <= 3;

  const getAlertColor = () => {
    if (isCritical) {
      return {
        bg: "bg-rose-50",
        border: "border-rose-200",
        icon: "text-rose-600",
        text: "text-rose-900",
      };
    }
    if (isUrgent) {
      return {
        bg: "bg-orange-50",
        border: "border-orange-200",
        icon: "text-orange-600",
        text: "text-orange-900",
      };
    }
    return {
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: "text-amber-600",
      text: "text-amber-900",
    };
  };

  const colors = getAlertColor();

  return (
    <Modal
      open={open}
      title="Password Expiry Reminder"
      onClose={onClose}
      maxWidth="max-w-[480px]"
      footer={
        <div className="flex w-full items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Remind Me Later
          </Button>
          <Button variant="primary" onClick={onChangePassword}>
            Change Password Now
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 ${colors.bg} ${colors.border}`}
        >
          <AlertCircle className={`mt-0.5 shrink-0 ${colors.icon}`} size={24} />
          <div>
            <p className={`m-0 text-base font-semibold ${colors.text}`}>
              Your password will expire in {daysUntilExpiry}{" "}
              {daysUntilExpiry === 1 ? "day" : "days"}
            </p>
            <p className={`m-0 mt-1 text-sm ${colors.text}`}>
              Please change your password to continue accessing your account without
              interruption.
            </p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-slate-700">
          <p className="m-0">
            <strong>Why change your password regularly?</strong>
          </p>
          <ul className="m-0 space-y-2 pl-5">
            <li>Protects your account from unauthorized access</li>
            <li>Reduces the risk of compromised credentials</li>
            <li>Ensures compliance with security policies</li>
          </ul>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <KeyRound size={18} className="shrink-0 text-slate-500" />
          <p className="m-0">
            You can change your password anytime from your Profile settings.
          </p>
        </div>
      </div>
    </Modal>
  );
}
