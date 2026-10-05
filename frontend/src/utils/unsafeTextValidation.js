export const DISALLOWED_TEXT_MESSAGE = "This text cannot be used.";

const DISALLOWED_TEXT_PATTERNS = [
  // Reject markup-shaped input, including an empty tag (`<>`) and ordinary HTML tags.
  /<[^>]*>/u,
  /(?:<|&lt;|&#0*60;|&#x0*3c;)\s*\/?\s*(?:script|iframe|object|embed|svg|math|style|link|meta)\b/iu,
  /<[^>]*\bon[a-z]+\s*=/iu,
  /\b(?:javascript|vbscript)\s*:/iu,
];

export function containsDisallowedText(value) {
  const text = String(value ?? "");

  return DISALLOWED_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

export function getDisallowedTextMessage(value) {
  return containsDisallowedText(value) ? DISALLOWED_TEXT_MESSAGE : "";
}
