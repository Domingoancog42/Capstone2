import React, { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import Button from "../../UI/button";
import ProfileField from "../ProfileField";
import ProfileFloatingCard from "../ProfileFloatingCard";
import ProfileSectionCard from "../ProfileSectionCard";
import { civilStatusOptions, genderOptions, nationalityOptions, profileSectionAnchorId, suffixOptions } from "../profileUtils";

const REASON_MIN = 10;
const REASON_MAX = 500;

/**
 * The one line of status the header shows, or null when there is nothing to say.
 *
 * A `used` request is spent history — it reads the same as never having asked, which is what the
 * employee needs to know: to correct something else, ask again.
 */
function describeRequest(request) {
  switch (request?.status) {
    case "pending":
      return { tone: "waiting", text: "Waiting for HR Head or Admin approval." };
    case "approved":
      return { tone: "open", text: "Editing unlocked. This approval covers one save." };
    case "declined":
      return {
        tone: "declined",
        text: request.decisionNote
          ? `HR declined your last request. ${request.decisionNote}`
          : "HR declined your last request.",
      };
    default:
      return null;
  }
}

const noticeToneClasses = {
  waiting: "border-amber-200 bg-amber-50 text-amber-900",
  open: "border-emerald-200 bg-emerald-50 text-emerald-900",
  declined: "border-slate-200 bg-slate-50 text-slate-700",
};

/**
 * Personal Details.
 *
 * These fields are the legal identity HR certifies on the PDS and CS Form No. 1, so they are not
 * the employee's to edit at will. The section stays read-only and offers a request instead; an
 * HR Head or Admin approving it unlocks the fields for a single save.
 *
 * Roles that maintain employee master records (`canRequestEdit === false`) are not gated here at
 * all — they already edit these fields from Employee Management, and the backend refuses their
 * request for exactly that reason.
 */
export default function PersonalDetailsSection({
  values,
  errors,
  readOnly,
  saving,
  onChange,
  onSave,
  canRequestEdit = false,
  editRequest = null,
  requestingEdit = false,
  onRequestEdit,
}) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");

  // A fresh card every time, so yesterday's reason is never submitted by accident.
  useEffect(() => {
    if (!reasonOpen) {
      setReason("");
      setReasonError("");
    }
  }, [reasonOpen]);

  const currentNationality = String(values.nationality || "");
  const nationalityChoices = [
    { label: "Select nationality", value: "" },
    ...(
      currentNationality && !nationalityOptions.includes(currentNationality)
        ? [{ label: currentNationality, value: currentNationality }]
        : []
    ),
    ...nationalityOptions.map((option) => ({ label: option, value: option })),
  ];

  const pending = editRequest?.status === "pending";
  const notice = canRequestEdit ? describeRequest(editRequest) : null;

  const handleSubmitReason = async (event) => {
    event.preventDefault();

    const trimmed = reason.trim();

    if (trimmed.length < REASON_MIN) {
      setReasonError(`Please describe the correction in at least ${REASON_MIN} characters.`);
      return;
    }

    const sent = await onRequestEdit?.(trimmed);

    if (sent) {
      setReasonOpen(false);
    }
  };

  return (
    <>
      <ProfileSectionCard
        id={profileSectionAnchorId("personal")}
        icon={UserRound}
        title="Personal Details"
        description="Your legal identity as HR certifies it. Ask HR to unlock this section to correct anything here."
        readOnly={readOnly}
        saving={saving}
        // No footer button while the section is locked -- a Save nobody can press is just clutter.
        onSave={readOnly ? undefined : onSave}
        actions={canRequestEdit ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setReasonOpen(true)}
            disabled={pending || requestingEdit}
          >
            {pending ? "Request Sent" : "Request Edit"}
          </Button>
        ) : null}
      >
        {notice ? (
          <p className={`m-0 rounded-lg border px-3 py-2 text-xs font-medium ${noticeToneClasses[notice.tone]}`}>
            {notice.text}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ProfileField label="First Name" name="firstName" value={values.firstName} onChange={onChange} required error={errors.firstName} readOnly={readOnly} />
          <ProfileField label="Middle Name" name="middleName" value={values.middleName} onChange={onChange} error={errors.middleName} readOnly={readOnly} />
          <ProfileField label="Last Name" name="lastName" value={values.lastName} onChange={onChange} required error={errors.lastName} readOnly={readOnly} />
          <ProfileField
            label="Suffix"
            name="suffix"
            as="select"
            value={values.suffix}
            onChange={onChange}
            error={errors.suffix}
            readOnly={readOnly}
            options={[{ label: "None", value: "" }, ...suffixOptions.map((option) => ({ label: option, value: option }))]}
          />
          <ProfileField label="Birth Date" name="dateOfBirth" type="date" value={values.dateOfBirth} onChange={onChange} required error={errors.dateOfBirth} readOnly={readOnly} />
          <ProfileField
            label="Gender"
            name="gender"
            as="select"
            value={values.gender}
            onChange={onChange}
            required
            error={errors.gender}
            readOnly={readOnly}
            options={[{ label: "Select gender", value: "" }, ...genderOptions.map((option) => ({ label: option, value: option }))]}
          />
          <ProfileField
            label="Civil Status"
            name="civilStatus"
            as="select"
            value={values.civilStatus}
            onChange={onChange}
            required
            error={errors.civilStatus}
            readOnly={readOnly}
            options={[{ label: "Select civil status", value: "" }, ...civilStatusOptions.map((option) => ({ label: option, value: option }))]}
          />
          <ProfileField
            label="Nationality"
            name="nationality"
            as="select"
            value={values.nationality}
            onChange={onChange}
            required
            error={errors.nationality}
            readOnly={readOnly}
            options={nationalityChoices}
          />
          <ProfileField label="Contact Number" name="phone" value={values.phone} onChange={onChange} required error={errors.phone} readOnly={readOnly} />
        </div>
      </ProfileSectionCard>

      <ProfileFloatingCard
        open={reasonOpen}
        onClose={() => setReasonOpen(false)}
        title="Request to edit personal details"
        subtitle="Tell HR what needs correcting. They read this reason when they decide."
      >
        <form className="grid gap-4" onSubmit={handleSubmitReason}>
          <div>
            <label htmlFor="personalEditReason" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Reason for editing
            </label>
            <textarea
              id="personalEditReason"
              name="personalEditReason"
              rows={4}
              maxLength={REASON_MAX}
              autoFocus
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError("");
              }}
              placeholder="My last name is misspelled on my record — it should read Dela Cruz."
              className={`min-h-[104px] w-full resize-y rounded-lg border px-3 py-2.5 text-sm text-slate-900 outline-none transition ${
                reasonError
                  ? "border-[#D61E1E] focus:border-[#B41818] focus:ring-2 focus:ring-[#D61E1E]/10"
                  : "border-slate-200 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              }`}
            />
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p className="m-0 text-xs font-semibold text-[#B41818]">{reasonError}</p>
              <p className="m-0 shrink-0 text-xs text-slate-400">
                {reason.trim().length}/{REASON_MAX}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="ghost" onClick={() => setReasonOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={requestingEdit}>
              Send Request
            </Button>
          </div>
        </form>
      </ProfileFloatingCard>
    </>
  );
}
