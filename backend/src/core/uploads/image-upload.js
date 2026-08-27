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

function hasBrand(buffer, brand) {
    for (let offset = 8; offset + 4 <= Math.min(buffer.length, 64); offset += 4) {
        if (buffer.toString('ascii', offset, offset + 4) === brand) return true;
    }
    return false;
}

function hasValidImageSignature(file) {
    if (!file || !Buffer.isBuffer(file.buffer)) return false;
    const buffer = file.buffer;

    if (file.mimetype === 'image/webp') {
        return buffer.length >= 12
            && buffer.toString('ascii', 0, 4) === 'RIFF'
            && buffer.toString('ascii', 8, 12) === 'WEBP';
    }

    if (file.mimetype === 'image/avif') {
        return buffer.length >= 12
            && buffer.toString('ascii', 4, 8) === 'ftyp'
            && (hasBrand(buffer, 'avif') || hasBrand(buffer, 'avis'));
    }

    return false;
}

module.exports = { upload, hasValidImageSignature };
