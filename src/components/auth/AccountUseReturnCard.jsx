import React from "react";
import { Undo2, UserRoundCheck } from "lucide-react";
import Button from "../UI/button";
import { getRoleLabel } from "../../utils/roleRoutes";

export default function AccountUseReturnCard({ user, returning = false, onReturn }) {
  const accountUse = user?.accountUse;

  if (!accountUse?.active) {
    return null;
  }

  const targetName = user?.full_name || user?.username || "this user";
  const adminName = accountUse.admin?.fullName || accountUse.admin?.username || "your Admin account";

  return (
    <aside
      className="account-use-return-card fixed left-3 right-3 top-[4.5rem] z-[65] overflow-hidden rounded-xl border border-amber-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.24)] sm:left-auto sm:right-4 sm:w-[360px]"
      aria-label="Temporary account access"
    >
      <div className="account-use-return-card-accent h-1 bg-amber-400" />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="account-use-return-card-icon grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700">
            <UserRoundCheck size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="account-use-return-card-label m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">
              Temporary Account
            </p>
            <p className="account-use-return-card-title m-0 mt-1 text-sm font-semibold text-slate-950">
              Using {targetName}
            </p>
            <p className="account-use-return-card-description m-0 mt-1 text-xs leading-5 text-slate-500">
              You are viewing the system as {getRoleLabel(user?.role)}. Your actions remain linked to {adminName}.
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          icon={Undo2}
          loading={returning}
          fullWidth
          className="mt-3"
          onClick={onReturn}
        >
          Return to Admin Dashboard
        </Button>
      </div>
    </aside>
  );
}
