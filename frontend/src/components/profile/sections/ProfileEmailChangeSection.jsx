import React from "react";
import { MailCheck } from "lucide-react";
import ChangeEmailSection from "./ChangeEmailSection";
import ProfileSectionCard from "../ProfileSectionCard";

export default function ProfileEmailChangeSection({ onUserChange }) {
  return (
    <ProfileSectionCard
      icon={MailCheck}
      title="Change Email"
      description="Enter your new address and authorize the change with the 6-digit OTP sent to your current email."
    >
      <ChangeEmailSection onUserChange={onUserChange} />
    </ProfileSectionCard>
  );
}
