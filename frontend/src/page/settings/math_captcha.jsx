import React from "react";
import { MailCheck, ShieldCheck } from "lucide-react";
import { SettingsPanel, SettingsToggleRow } from "../../components/settings";

export default function MathCaptchaSettings({
  mathEnabled = true,
  payrollOtpEnabled = true,
  message = "",
  messageTone = "info",
  saving = false,
  onToggleMath,
  onTogglePayrollOtp,
}) {
  return (
    <SettingsPanel
      icon={ShieldCheck}
      title="Captcha"
      description="Control the login math captcha and the email OTP required for protected payroll actions."
      notice={message}
      noticeTone={messageTone}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            mathEnabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"
          }`}>
            {mathEnabled ? "Math enabled" : "Math disabled"}
          </span>
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
          id="loginMathCaptcha"
          icon={ShieldCheck}
          label="Login math captcha"
          description="When enabled, users must answer a math captcha before their credentials are checked."
          checked={mathEnabled}
          disabled={saving}
          onToggle={onToggleMath}
        />

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
