export const PASSWORD_POLICY_MIN_LENGTH = 8;
export const PASSWORD_POLICY_DEFAULT_MAX_LENGTH = 64;

export const PASSWORD_POLICY_RULES = [
  {
    key: "minLength",
    label: `At least ${PASSWORD_POLICY_MIN_LENGTH} characters`,
  },
  {
    key: "letter",
    label: "Contains at least one letter",
  },
  {
    key: "number",
    label: "Contains at least one number",
  },
  {
    key: "symbol",
    label: "Contains at least one symbol",
  },
];

function resolveMaximumPasswordLength(options = {}) {
  const configuredLength = Number(options.maximumPasswordLength ?? options.maxLength);

  if (!Number.isFinite(configuredLength)) {
    return PASSWORD_POLICY_DEFAULT_MAX_LENGTH;
  }

  return Math.max(6, Math.min(256, Math.trunc(configuredLength)));
}

export function evaluatePasswordPolicy(password = "", options = {}) {
  const value = String(password ?? "");
  const maximumPasswordLength = resolveMaximumPasswordLength(options);
  const minimumPasswordLength = Math.min(PASSWORD_POLICY_MIN_LENGTH, maximumPasswordLength);
  const checks = {
    minLength: value.length >= minimumPasswordLength,
    maxLength: value.length <= maximumPasswordLength,
    letter: /[A-Za-z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
  const satisfiedCount = value.length === 0 ? 0 : Object.values(checks).filter(Boolean).length;
  const isValid = Object.values(checks).every(Boolean);

  let strength = "idle";
  let strengthLabel = "Password strength";
  let strengthMessage = `Use ${minimumPasswordLength} to ${maximumPasswordLength} characters with letters, numbers, and symbols.`;

  if (value.length > maximumPasswordLength) {
    strength = "weak";
    strengthLabel = "Too long";
    strengthMessage = `Use no more than ${maximumPasswordLength} characters.`;
  } else if (value.length > 0 && satisfiedCount <= 1) {
    strength = "weak";
    strengthLabel = "Weak password";
    strengthMessage = "This password is too weak. Add more variety and length.";
  } else if (value.length > 0 && !isValid) {
    strength = "medium";
    strengthLabel = "Not strong enough";
    strengthMessage = "Add the missing requirements below to continue.";
  } else if (isValid) {
    strength = "strong";
    strengthLabel = "Strong password";
    strengthMessage = "This password meets the reset requirements.";
  }

  return {
    ...checks,
    isValid,
    minimumPasswordLength,
    maximumPasswordLength,
    satisfiedCount,
    strength,
    strengthLabel,
    strengthMessage,
  };
}

export function getPasswordPolicyItems(password = "", options = {}) {
  const evaluation = evaluatePasswordPolicy(password, options);

  return [
    {
      key: "minLength",
      label: `At least ${evaluation.minimumPasswordLength} characters`,
    },
    {
      key: "maxLength",
      label: `No more than ${evaluation.maximumPasswordLength} characters`,
    },
    ...PASSWORD_POLICY_RULES.slice(1),
  ].map((rule) => ({
    ...rule,
    satisfied: evaluation[rule.key],
  }));
}
