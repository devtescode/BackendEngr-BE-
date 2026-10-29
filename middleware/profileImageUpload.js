const multer = require("multer");

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const INVALID_IMAGE_MESSAGE = "Please upload a JPEG, PNG or WebP image.";

const upload = multer({
  storage: multer.memoryStorage(),
  // Only the single file part is allowed, so no text fields can be buffered.
  limits: {
    fileSize: MAX_PROFILE_IMAGE_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
    fieldSize: 1024,
    fieldNameSize: 100,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    const err = new Error(INVALID_IMAGE_MESSAGE);
    err.code = "INVALID_IMAGE";
    return cb(err);
  },
}).single("image");

// The mimetype is client-supplied, so also check the file's magic bytes.
const hasImageSignature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp =
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP";
  return isJpeg || isPng || isWebp;
};

// Single "image" field; multer/filter errors become 400 JSON responses.
const profileImageUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (!err) {
      if (req.file && !hasImageSignature(req.file.buffer)) {
        return res.status(400).json({
          success: false,
          code: "INVALID_IMAGE",
          message: INVALID_IMAGE_MESSAGE,
        });
      }
      return next();
    }

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        code: "IMAGE_TOO_LARGE",
        message: "Image must be 5 MB or smaller.",
      });
    }

    return res.status(400).json({
      success: false,
      code: "INVALID_IMAGE",
      message: INVALID_IMAGE_MESSAGE,
    });
  });
};

module.exports = profileImageUpload;
module.exports.MAX_PROFILE_IMAGE_BYTES = MAX_PROFILE_IMAGE_BYTES;
module.exports.ALLOWED_MIME_TYPES = ALLOWED_MIME_TYPES;
