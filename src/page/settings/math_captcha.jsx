import React from "react";
import { MailCheck, ShieldCheck } from "lucide-react";
import { SettingsPanel, SettingsToggleRow } from "../../components/settings";

export default function MathCaptchaSettings({
  payrollOtpEnabled = true,
  message = "",
  messageTone = "info",
  saving = false,
  onTogglePayrollOtp,
}) {
  return (
    <SettingsPanel
      icon={ShieldCheck}
      title="Payroll Verification"
      description="Control the email OTP required for protected payroll actions."
      notice={message}
      noticeTone={messageTone}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            payrollOtpEnabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"
          }`}>
            {payrollOtpEnabled ? "Payroll OTP enabled" : "Payroll OTP disabled"}
          </span>
        </div>
      }
    >
      <div className="grid gap-3">
        <SettingsToggleRow
          id="payrollOtpVerification"
          icon={MailCheck}
          label="Payroll email OTP verification"
          description="When enabled, payroll submission, approval, and payslip release require the authorization code sent to the acting user's email. The payroll math security check remains required."
          checked={payrollOtpEnabled}
          disabled={saving}
          onToggle={onTogglePayrollOtp}
        />
      </div>
    </SettingsPanel>
  );
}
