/*
 * Splitting a stored full name back into the boxes a CS form prints.
 *
 * The three request forms that print a name (leave, loan, leave monetization) each carry only the
 * employee's assembled `fullName`, so each one has to take it apart again. They used to keep their
 * own identical copy of this; it lives here now because the rule changed once and had to change in
 * three places.
 *
 * The name extension is the part that makes this more than a split on spaces: `employees.suffix` is
 * folded into `fullName` by employee.php, so "Juan P. Cruz Jr." would otherwise come apart with
 * "Jr." as the surname and "P. Cruz" as the middle name. A trailing extension is peeled off first
 * and rejoined to the surname, which is how it reads on the printed form.
 */

const NAME_EXTENSION_PATTERN = /^(jr|sr|ii|iii|iv|v|vi|vii)\.?$/i;

function peelNameExtension(parts) {
  // Only ever one, and never the whole name: "Jr." alone is a surname, not an extension.
  if (parts.length > 1 && NAME_EXTENSION_PATTERN.test(parts[parts.length - 1])) {
    return { parts: parts.slice(0, -1), suffix: parts[parts.length - 1] };
  }

  return { parts, suffix: "" };
}

function withSuffix(lastName, suffix) {
  return [lastName, suffix].filter(Boolean).join(" ");
}

export function splitEmployeeName(fullName) {
  const name = String(fullName || "").trim();
  if (!name) {
    return { firstName: "", middleName: "", lastName: "" };
  }

  if (name.includes(",")) {
    const [lastName, remaining = ""] = name.split(",");
    const parts = remaining.trim().split(/\s+/).filter(Boolean);
    return {
      lastName: lastName.trim(),
      firstName: parts[0] || "",
      middleName: parts.slice(1).join(" "),
    };
  }

  const { parts, suffix } = peelNameExtension(name.split(/\s+/).filter(Boolean));

  if (parts.length === 1) {
    return { firstName: parts[0], middleName: "", lastName: withSuffix("", suffix) };
  }

  if (parts.length === 2) {
    return { firstName: parts[0], middleName: "", lastName: withSuffix(parts[1], suffix) };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: withSuffix(parts[parts.length - 1], suffix),
  };
}

export default splitEmployeeName;
