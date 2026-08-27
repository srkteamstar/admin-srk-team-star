/*
 * core/uploads/image-upload.js — the one multipart parser
 * ============================================================================
 *
 * Shared by the three admin routes that accept a cover image (products,
 * categories, projects). In core rather than in one of those modules because
 * no module owns it and copying it into three would let the file-type filter
 * drift — which is the one part of it that is a security control rather than a
 * convenience.
 */
const multer = require('multer');

// MULTER CONFIGURATION WITH WEBP & AVIF FILE FILTER
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/avif', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_FILE_TYPE: Only .avif and .webp image formats are allowed.'));
        }
    }
});

module.exports = { upload };
