import React, { useEffect, useMemo, useState } from "react";
import { IdCard, Mail, UserRound } from "lucide-react";
import InputField from "../../components/UI/InputField";
import Button from "../../components/UI/button";
import { decorateRequiredFieldLabel } from "../../components/UI/RequiredFieldLabel";
import { normalizeRole } from "../../utils/roleRoutes";
import { sendAdminUserOtp } from "../../services/api";

export function UserSelectField({ label, name, value, onChange, error, children, helper, disabled = false }) {
  return (
    <div className="w-full">
      <label htmlFor={name} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {decorateRequiredFieldLabel(label)}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`min-h-[46px] w-full rounded-2xl border bg-white px-3.5 py-3 text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 ${
          error ? "border-rose-600" : "border-slate-200"
        }`}
      >
        {children}
      </select>
      {helper ? <p className="mt-2 text-sm leading-6 text-slate-500">{helper}</p> : null}
      {error ? <p className="mt-1.5 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

/* Roles placed in a division as part of creating the account; every other role has its
   placement completed later from Employee Management. */
const PLACEMENT_ROLE_KEYS = new Set(["hrstaff", "chief"]);

export default function CreateLinkedUserForm({
  nextEmployeeId = "",
  roles = [],
  divisions = [],
  designations = [],
  onSubmit,
  submitting = false,
  error = "",
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [errors, setErrors] = useState({});
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const roleKey = normalizeRole(roles.find((role) => String(role.id) === roleId)?.name);
  const isAdmin = roleKey === "admin";
  const requiresPlacement = PLACEMENT_ROLE_KEYS.has(roleKey);
  const filteredDesignations = useMemo(
    () => designations.filter((item) => String(item.division_id ?? item.divisionId ?? "") === divisionId),
    [designations, divisionId]
  );

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = setTimeout(() => setResendSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const resetOtp = () => {
    setOtpCode("");
    setOtpSent(false);
    setOtpMessage("");
    setErrors((current) => ({ ...current, otpCode: "" }));
  };

  const handleSendOtp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrors((current) => ({ ...current, email: "Enter a valid email address." }));
      return;
    }
    setOtpSending(true);
    setOtpMessage("");
    setOtpSent(false);
    setOtpCode("");
    setErrors((current) => ({ ...current, otpCode: "" }));
    try {
      const result = await sendAdminUserOtp({ email: email.trim(), roleId });
      setOtpSent(true);
      setOtpMessage(result.message);
      setResendSeconds(result.resendAfterSeconds || 30);
    } catch (sendError) {
      setErrors((current) => ({ ...current, otpCode: sendError.response?.data?.message || "Unable to send verification code." }));
    } finally {
      setOtpSending(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    const normalizedFullName = fullName.trim().replace(/\s+/g, " ");
    const normalizedEmail = email.trim();

    if (!isAdmin && !nextEmployeeId) {
      nextErrors.employeeId = "The next employee ID could not be generated.";
    }
    if (normalizedFullName.split(" ").filter(Boolean).length < 2) {
      nextErrors.fullName = "Enter the user's first and last name.";
    }
    if (!normalizedEmail) {
      nextErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!roleId) {
      nextErrors.roleId = "Role is required.";
    }
    if (isAdmin && (!otpSent || !/^\d{6}$/.test(otpCode))) {
      nextErrors.otpCode = "Send a verification code and enter the six-digit code from your email.";
    }
    if (requiresPlacement) {
      if (!divisionId) nextErrors.divisionId = "Division is required.";
      if (!designationId) nextErrors.designationId = "Position is required.";
    }
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0) {
      onSubmit?.({
        fullName: normalizedFullName,
        email: normalizedEmail,
        roleId,
        ...(isAdmin ? { otpCode } : {}),
        ...(requiresPlacement ? { divisionId, designationId } : {}),
      });
    }
  };

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      {!isAdmin ? <InputField
        label="Employee ID *"
        name="linkedEmployeeId"
        value={nextEmployeeId}
        icon={IdCard}
        readOnly
        error={errors.employeeId}
        inputClassName="cursor-not-allowed bg-slate-50 font-semibold text-slate-600"
      /> : null}

      <InputField
        label="Full Name *"
        name="linkedEmployeeFullName"
        value={fullName}
        onChange={(event) => {
          setFullName(event.target.value);
          setErrors((current) => ({ ...current, fullName: "" }));
        }}
        placeholder="Enter first and last name"
        icon={UserRound}
        error={errors.fullName}
        maxLength={200}
      />

      <InputField
        label="Email *"
        name="linkedEmployeeEmail"
        type="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          resetOtp();
          setErrors((current) => ({ ...current, email: "" }));
        }}
        placeholder={isAdmin ? "Enter new Admin email" : "Enter employee email"}
        disabled={otpSending || submitting}
        icon={Mail}
        error={errors.email}
        maxLength={150}
      />

      <UserSelectField
        label="Role *"
        name="linkedEmployeeRoleId"
        value={roleId}
        onChange={(event) => {
          setRoleId(event.target.value);
          setDivisionId("");
          setDesignationId("");
          resetOtp();
          setErrors((current) => ({ ...current, roleId: "", divisionId: "", designationId: "" }));
        }}
        error={errors.roleId}
        disabled={otpSending || submitting}
      >
        <option value="">Select role</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label || role.name}
          </option>
        ))}
      </UserSelectField>

      {requiresPlacement ? (
        <>
          <UserSelectField
            label="Division *"
            name="linkedEmployeeDivisionId"
            value={divisionId}
            onChange={(event) => {
              setDivisionId(event.target.value);
              setDesignationId("");
              setErrors((current) => ({ ...current, divisionId: "", designationId: "" }));
            }}
            error={errors.divisionId}
            disabled={submitting}
          >
            <option value="">Select division</option>
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </UserSelectField>

          <UserSelectField
            label="Position *"
            name="linkedEmployeeDesignationId"
            value={designationId}
            onChange={(event) => {
              setDesignationId(event.target.value);
              setErrors((current) => ({ ...current, designationId: "" }));
            }}
            error={errors.designationId}
            disabled={!divisionId || submitting}
          >
            <option value="">{divisionId ? "Select position" : "Select division first"}</option>
            {filteredDesignations.map((designation) => (
              <option key={designation.id} value={designation.id}>
                {designation.name}
              </option>
            ))}
          </UserSelectField>
        </>
      ) : null}

      {isAdmin ? (
        <div className="grid gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="m-0 text-sm leading-6 text-sky-800">The verification code will be sent to your signed-in account email to approve creating the new Admin. Admin accounts do not need an Employee ID.</p>
          <Button type="button" onClick={handleSendOtp} loading={otpSending} disabled={submitting || otpSending || resendSeconds > 0}>
            {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : otpSent ? "Resend OTP Code" : "Send OTP Code"}
          </Button>
          {otpMessage ? <p role="status" className="m-0 text-sm text-emerald-700">{otpMessage}</p> : null}
          <InputField
            label="OTP Code *"
            name="adminOtpCode"
            value={otpCode}
            onChange={(event) => {
              setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              setErrors((current) => ({ ...current, otpCode: "" }));
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Enter six-digit code"
            disabled={!otpSent || otpSending || submitting}
            error={errors.otpCode}
          />
        </div>
      ) : (
      <p className="m-0 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
        {requiresPlacement
          ? "The employee is added to Employee Management with this ID, name, email, role, division, and position. The remaining profile details are completed there."
          : "The employee is added to Employee Management with this ID, name, email, and role. Division, position, and the remaining profile details are completed there."}
      </p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
        <Button type="submit" icon={IdCard} loading={submitting} disabled={submitting || otpSending || (isAdmin && (!otpSent || otpCode.length !== 6))}>
          Create User
        </Button>
      </div>
    </form>
  );
}
