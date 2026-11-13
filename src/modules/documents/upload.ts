import multer from "multer";
import { randomToken } from "../../utils/tokens";
import { uploadsDir, ensureStorage } from "../../lib/storage";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import { extensionFor, isAllowedMimeType } from "../../lib/fileType";

ensureStorage();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir());
  },
  // Server-generated name; the extension comes from the (allowlisted)
  // type, never from the client's file name.
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${randomToken(8)}${extensionFor(file.mimetype)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 1, fields: 10, fieldSize: 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMimeType(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(ApiError.unsupportedMediaType("Only PDF, DOCX, PNG and JPEG files are accepted"));
  },
});
