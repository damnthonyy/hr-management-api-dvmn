/**
 * Document types accepted by the API, with the signature ("magic bytes")
 * their content must start with. The declared MIME type is client
 * controlled, so the content is always checked against it.
 */
interface AllowedType {
  extension: string;
  matches: (head: Buffer) => boolean;
}

const startsWith = (bytes: number[]) => (head: Buffer) =>
  head.length >= bytes.length && bytes.every((byte, i) => head[i] === byte);

export const ALLOWED_DOCUMENT_TYPES: Record<string, AllowedType> = {
  "application/pdf": { extension: ".pdf", matches: startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]) }, // %PDF-
  "image/png": { extension: ".png", matches: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { extension: ".jpg", matches: startsWith([0xff, 0xd8, 0xff]) },
  // .docx is a ZIP container.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: ".docx",
    matches: startsWith([0x50, 0x4b, 0x03, 0x04]),
  },
};

/** Number of leading bytes needed to check any signature above. */
export const SIGNATURE_BYTES = 16;

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_DOCUMENT_TYPES, mimeType);
}

export function extensionFor(mimeType: string): string {
  return ALLOWED_DOCUMENT_TYPES[mimeType]?.extension ?? "";
}

/** True when `head` (the first bytes of the file) matches the declared type. */
export function contentMatchesType(mimeType: string, head: Buffer): boolean {
  return ALLOWED_DOCUMENT_TYPES[mimeType]?.matches(head) ?? false;
}
