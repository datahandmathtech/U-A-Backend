import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'dlffvoetz',
  api_key: '662962781115292',
  api_secret: 'vqtMiYWA_5Kiyk0Et1i95BEdJw8'
});

export async function uploadBase64ToCloudinary(base64Str: string, folder = 'unnati-erp/approvals'): Promise<string> {
  if (!base64Str || typeof base64Str !== 'string') return base64Str;
  if (!base64Str.startsWith('data:image/')) return base64Str;
  try {
    const result = await cloudinary.uploader.upload(base64Str, {
      folder,
      resource_type: 'image',
      transformation: [{ width: 1200, crop: 'limit', quality: 'auto:good' }]
    });
    return result.secure_url;
  } catch (err) {
    console.error('Failed to upload base64 to Cloudinary:', err);
    return base64Str;
  }
}

export async function sanitizePhotos(photos: any): Promise<any> {
  if (!photos) return photos;
  if (typeof photos === 'string') {
    return await uploadBase64ToCloudinary(photos);
  }
  if (typeof photos === 'object') {
    const res: any = Array.isArray(photos) ? [] : {};
    for (const key of Object.keys(photos)) {
      const val = photos[key];
      if (typeof val === 'string' && val.startsWith('data:image/')) {
        res[key] = await uploadBase64ToCloudinary(val);
      } else {
        res[key] = val;
      }
    }
    return res;
  }
  return photos;
}
