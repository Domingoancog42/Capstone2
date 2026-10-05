export const defaultEmailDomainPolicy = {
  enabled: false,
  allowListedOnly: false,
  allowedDomains: ["gmail.com"],
  blockedDomains: [
    "10minutemail.com",
    "guerrillamail.com",
    "mailinator.com",
    "tempmail.com",
    "temp-mail.org",
    "yopmail.com",
  ],
};

export function normalizeEmailDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^[@.]+/, "");
}

export function normalizeEmailDomainList(values) {
  const source = Array.isArray(values) ? values : String(values || "").split(/[\s,;]+/);

  return Array.from(
    new Set(
      source
        .map(normalizeEmailDomain)
        .filter((domain) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain))
    )
  );
}

export function normalizeEmailDomainPolicy(policy = {}) {
  return {
    ...defaultEmailDomainPolicy,
    ...policy,
    enabled: Boolean(policy.enabled),
    allowListedOnly: Boolean(policy.allowListedOnly),
    allowedDomains: normalizeEmailDomainList(policy.allowedDomains ?? defaultEmailDomainPolicy.allowedDomains),
    blockedDomains: normalizeEmailDomainList(policy.blockedDomains ?? defaultEmailDomainPolicy.blockedDomains),
  };
}

export function emailDomainMatches(domain, rules = []) {
  return rules.some((rule) => domain === rule || domain.endsWith(`.${rule}`));
}

export function getEmailDomainPolicyViolation(email, policy = {}) {
  const normalizedPolicy = normalizeEmailDomainPolicy(policy);

  if (!normalizedPolicy.enabled) {
    return "";
  }

  const atIndex = String(email || "").lastIndexOf("@");
  const domain = normalizeEmailDomain(atIndex >= 0 ? String(email).slice(atIndex + 1) : "");

  if (!domain) {
    return "Enter a valid email address.";
  }

  if (emailDomainMatches(domain, normalizedPolicy.blockedDomains)) {
    if (normalizedPolicy.allowListedOnly && normalizedPolicy.allowedDomains.length === 1) {
      return `Email addresses from ${domain} cannot be used. Only ${normalizedPolicy.allowedDomains[0]} email addresses are allowed.`;
    }

    if (normalizedPolicy.allowListedOnly && normalizedPolicy.allowedDomains.length > 1) {
      return `Email addresses from ${domain} cannot be used. Use an allowed domain: ${normalizedPolicy.allowedDomains.join(", ")}.`;
    }

    return `Email addresses from ${domain} cannot be used because this domain is blocked by the Temp Mail Blocker.`;
  }

  if (
    normalizedPolicy.allowListedOnly
    && !emailDomainMatches(domain, normalizedPolicy.allowedDomains)
  ) {
    if (normalizedPolicy.allowedDomains.length === 1) {
      return `Only ${normalizedPolicy.allowedDomains[0]} email addresses are allowed.`;
    }

    return `Use an allowed email domain: ${normalizedPolicy.allowedDomains.join(", ")}.`;
  }

  return "";
}
