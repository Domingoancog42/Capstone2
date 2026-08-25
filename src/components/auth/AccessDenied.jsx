import React from "react";
import { AlertTriangle, Lock, Mail, ShieldQuestion } from "lucide-react";

/**
 * AccessDenied Component
 * 
 * Displays an access denied message when a user tries to access a page
 * they don't have permission to view.
 * 
 * @param {Object} props
 * @param {string} props.title - Custom title (default: "Access Denied")
 * @param {string} props.message - Custom message
 * @param {string} props.pageName - Name of the restricted page
 * @param {Function} props.onNavigateBack - Optional callback to navigate back
 * @param {boolean} props.showContactAdmin - Show contact admin message (default: true)
 */
export default function AccessDenied({
  title = "Access Denied",
  message,
  pageName,
  onNavigateBack,
  showContactAdmin = true,
}) {
  const defaultMessage = pageName
    ? `You don't have permission to access the ${pageName} page.`
    : "You don't have permission to access this page.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent dark:bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-white dark:bg-slate-800 p-5 shadow-lg border border-slate-200 dark:border-slate-700">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4">
              <Lock className="h-12 w-12 text-red-600 dark:text-red-400" />
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-3 text-center text-lg font-bold text-slate-800 dark:text-slate-100">
            {title}
          </h1>

          {/* Message */}
          <p className="mb-6 text-center text-slate-600 dark:text-slate-300">
            {message || defaultMessage}
          </p>

          {/* Warning Box */}
          <div className="mb-6 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-amber-800 dark:text-amber-300 font-medium mb-1">
                  Restricted Access
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  This page is restricted to authorized users only. If you believe
                  you should have access, please contact your administrator.
                </p>
              </div>
            </div>
          </div>

          {/* Contact Admin Section */}
          {showContactAdmin && (
            <div className="mb-6 rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-4">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-blue-800 dark:text-blue-300 font-medium mb-1">
                    Need Access?
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    Contact your system administrator to request access to this feature.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {onNavigateBack && (
              <button
                onClick={onNavigateBack}
                className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
              >
                Go Back
              </button>
            )}
            <button
              onClick={() => window.history.back()}
              className="w-full rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
            >
              Return to Previous Page
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            If you continue to experience access issues, please contact technical support.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact version for inline use within layouts.
 *
 * `onRequestAccess` replaces the old "Return" button. Backing out of a page you were sent to is a
 * dead end — asking for it is the thing someone actually wants to do here. It resolves to the
 * message shown under the buttons, so the outcome is reported without a toast the user may miss.
 */
export function AccessDeniedInline({
  message = "You don't have permission to view this content.",
  onNavigateBack,
  onRequestAccess,
}) {
  const [requestState, setRequestState] = React.useState("idle");
  const [requestMessage, setRequestMessage] = React.useState("");

  const handleRequestAccess = async () => {
    if (!onRequestAccess || requestState === "sending" || requestState === "sent") {
      return;
    }

    setRequestState("sending");
    setRequestMessage("");

    try {
      const result = await onRequestAccess();

      setRequestState("sent");
      setRequestMessage(result?.message || "Your request has been sent to the administrator.");
    } catch (error) {
      setRequestState("idle");
      setRequestMessage(
        error?.response?.data?.message || "Unable to send the request. Please try again."
      );
    }
  };

  return (
    <div className="flex items-center justify-center p-5">
      <div className="max-w-md text-center">
        <div className="mb-4 inline-flex rounded-full bg-red-100 dark:bg-red-900/20 p-3">
          <Lock className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
          Access Denied
        </h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{message}</p>
        <div className="flex justify-center gap-3">
          {onNavigateBack && (
            <button
              onClick={onNavigateBack}
              className="rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              Go Back
            </button>
          )}
          {onRequestAccess && (
            <button
              onClick={handleRequestAccess}
              disabled={requestState === "sending" || requestState === "sent"}
              className="inline-flex items-center gap-2 rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldQuestion className="h-4 w-4" />
              {requestState === "sending"
                ? "Sending..."
                : requestState === "sent"
                  ? "Request Sent"
                  : "Request Access"}
            </button>
          )}
        </div>
        {requestMessage ? (
          <p
            className={`mt-4 text-sm ${
              requestState === "sent"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-amber-700 dark:text-amber-400"
            }`}
          >
            {requestMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
