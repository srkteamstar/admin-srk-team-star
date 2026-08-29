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
const sharp = require('sharp');

const MAX_IMAGE_PIXELS = 24_000_000;
const MAX_IMAGE_EDGE = 6000;

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

class ImageValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ImageValidationError';
        this.code = 'INVALID_IMAGE';
    }
}

async function normalizeImage(file) {
    if (!hasValidImageSignature(file)) {
        throw new ImageValidationError('The uploaded file is not a valid AVIF or WebP image.');
    }

    try {
        const source = sharp(file.buffer, {
            failOn: 'error',
            limitInputPixels: MAX_IMAGE_PIXELS,
            animated: false
        });
        const metadata = await source.metadata();
        const width = Number(metadata.width) || 0;
        const height = Number(metadata.height) || 0;

        if (!width || !height || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE
            || width * height > MAX_IMAGE_PIXELS || (metadata.pages || 1) !== 1) {
            throw new ImageValidationError(
                `Images must be a single frame no larger than ${MAX_IMAGE_EDGE} × ${MAX_IMAGE_EDGE} pixels.`
            );
        }

        const pipeline = source.rotate();
        const buffer = file.mimetype === 'image/avif'
            ? await pipeline.avif({ quality: 60, effort: 4 }).toBuffer()
            : await pipeline.webp({ quality: 84, effort: 4 }).toBuffer();

        return Object.assign({}, file, { buffer, size: buffer.length });
    } catch (error) {
        if (error instanceof ImageValidationError) throw error;
        throw new ImageValidationError('The uploaded image could not be decoded safely.');
    }
}

module.exports = {
    upload,
    hasValidImageSignature,
    normalizeImage,
    ImageValidationError,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_EDGE
};
