import { BadgeCheck, GraduationCap, IdCard, ScrollText } from "lucide-react";

/**
 * The document kinds the profile collects, in the order both screens show them.
 *
 * The ids have to stay in step with employee_document_type_labels() in employee_documents.php. There
 * is no table behind this feature -- the stored file name is what carries the type -- so renaming an
 * id here would orphan every file already uploaded under the old one.
 */
export const EMPLOYEE_DOCUMENT_TYPES = [
  {
    id: "birth_certificate",
    label: "Birth Certificate",
    shortLabel: "Birth Certificate",
    description: "PSA or NSO issued copy of your birth certificate.",
    icon: BadgeCheck,
  },
  {
    id: "valid_id",
    label: "Valid IDs",
    shortLabel: "Valid ID",
    description: "Government-issued IDs such as UMID, passport, or driver's license.",
    icon: IdCard,
  },
  {
    id: "resume",
    label: "Resume / CV",
    shortLabel: "Resume / CV",
    description: "Your latest curriculum vitae or personal data sheet attachment.",
    icon: ScrollText,
  },
  {
    id: "diploma",
    label: "Diploma",
    shortLabel: "Diploma",
    description: "Diploma, transcript of records, or certificate of graduation.",
    icon: GraduationCap,
  },
];

/** Mirrors employee_documents_allowed_extensions() on the server. */
export const EMPLOYEE_DOCUMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
export const EMPLOYEE_DOCUMENT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp"];
export const EMPLOYEE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export function findEmployeeDocumentType(typeId) {
  return EMPLOYEE_DOCUMENT_TYPES.find((type) => type.id === typeId) || null;
}

/** Buckets a flat listing into `{ [typeId]: document[] }`, every known type present even when empty. */
export function groupEmployeeDocuments(documents = []) {
  const grouped = EMPLOYEE_DOCUMENT_TYPES.reduce(
    (current, type) => ({ ...current, [type.id]: [] }),
    {}
  );

  (documents || []).forEach((document) => {
    if (grouped[document?.documentType]) {
      grouped[document.documentType].push(document);
    }
  });

  return grouped;
}

export function documentExtension(document) {
  return String(document?.extension || "").toLowerCase();
}

export function isImageDocument(document) {
  return ["png", "jpg", "jpeg", "webp"].includes(documentExtension(document));
}

export function isPdfDocument(document) {
  return documentExtension(document) === "pdf";
}

export function formatDocumentSize(bytes) {
  const size = Number(bytes);

  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDocumentTimestamp(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  // The server sends "Y-m-d H:i:s"; Safari refuses that without the "T".
  const parsedDate = new Date(rawValue.replace(" ", "T"));

  if (Number.isNaN(parsedDate.getTime())) {
    return rawValue;
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsedDate);
}

/**
 * Rejects a file the server would reject anyway, so the user is told before a 10 MB upload.
 *
 * Returns an error message, or "" when the file is acceptable.
 */
export function validateEmployeeDocumentFile(file) {
  if (!file) {
    return "Choose a file to upload.";
  }

  const extension = String(file.name || "").split(".").pop().toLowerCase();

  if (!EMPLOYEE_DOCUMENT_EXTENSIONS.includes(extension)) {
    return "Documents must be a PDF, PNG, JPG, or WEBP file.";
  }

  if (Number(file.size) > EMPLOYEE_DOCUMENT_MAX_BYTES) {
    return "Documents must be 10 MB or smaller.";
  }

  return "";
}
