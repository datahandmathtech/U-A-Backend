"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadBase64ToCloudinary = uploadBase64ToCloudinary;
exports.sanitizePhotos = sanitizePhotos;
const cloudinary_1 = require("cloudinary");
// Configure Cloudinary
cloudinary_1.v2.config({
    cloud_name: 'dlffvoetz',
    api_key: '662962781115292',
    api_secret: 'vqtMiYWA_5Kiyk0Et1i95BEdJw8'
});
async function uploadBase64ToCloudinary(base64Str, folder = 'unnati-erp/approvals') {
    if (!base64Str || typeof base64Str !== 'string')
        return base64Str;
    if (!base64Str.startsWith('data:image/'))
        return base64Str;
    try {
        const result = await cloudinary_1.v2.uploader.upload(base64Str, {
            folder,
            resource_type: 'image',
            transformation: [{ width: 1200, crop: 'limit', quality: 'auto:good' }]
        });
        return result.secure_url;
    }
    catch (err) {
        console.error('Failed to upload base64 to Cloudinary:', err);
        return base64Str;
    }
}
async function sanitizePhotos(photos) {
    if (!photos)
        return photos;
    if (typeof photos === 'string') {
        return await uploadBase64ToCloudinary(photos);
    }
    if (typeof photos === 'object') {
        const res = Array.isArray(photos) ? [] : {};
        for (const key of Object.keys(photos)) {
            const val = photos[key];
            if (typeof val === 'string' && val.startsWith('data:image/')) {
                res[key] = await uploadBase64ToCloudinary(val);
            }
            else {
                res[key] = val;
            }
        }
        return res;
    }
    return photos;
}
//# sourceMappingURL=cloudinaryHelper.js.map