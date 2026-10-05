export const GOVERNMENT_ID_FORMATS = {
  gsisIdNo: {
    label: "GSIS number",
    groups: [11],
    validDigitCounts: [11],
  },
  philhealthIdNo: {
    label: "PhilHealth number",
    groups: [2, 9, 1],
    validDigitCounts: [12],
  },
  pagibigIdNo: {
    label: "Pag-IBIG number",
    groups: [4, 4, 4],
    validDigitCounts: [12],
  },
  tinNo: {
    label: "TIN number",
    groups: [3, 3, 3, 3],
    validDigitCounts: [9, 12],
  },
};

export function getGovernmentIdDigitLimit(name) {
  const format = GOVERNMENT_ID_FORMATS[name];
  return format ? Math.max(...format.validDigitCounts) : 0;
}

export function getGovernmentIdMaxLength(name) {
  const format = GOVERNMENT_ID_FORMATS[name];
  return format ? getGovernmentIdDigitLimit(name) + format.groups.length - 1 : undefined;
}

export function formatGovernmentId(name, value) {
  const format = GOVERNMENT_ID_FORMATS[name];

  if (!format) {
    return String(value ?? "");
  }

  const digits = String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, getGovernmentIdDigitLimit(name));
  const blocks = [];
  let cursor = 0;

  for (const size of format.groups) {
    if (cursor >= digits.length) {
      break;
    }

    blocks.push(digits.slice(cursor, cursor + size));
    cursor += size;
  }

  return blocks.join("-");
}

export function validateGovernmentId(name, value) {
  const format = GOVERNMENT_ID_FORMATS[name];
  const text = String(value ?? "").trim();

  if (!format || !text) {
    return "";
  }

  if (!/^[\d-]+$/.test(text)) {
    return `${format.label} can contain numbers only.`;
  }

  const digitCount = text.replace(/\D/g, "").length;
  if (format.validDigitCounts.includes(digitCount)) {
    return "";
  }

  const expected = format.validDigitCounts.join(" or ");
  return `${format.label} must contain exactly ${expected} digits.`;
}
