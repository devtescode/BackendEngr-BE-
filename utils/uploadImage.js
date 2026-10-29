const cloudinary = require("../config/cloudinary");

// `options` are merged over the default product folder, so
// uploadImage(buffer) behaves exactly as before.
const uploadImage = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: "euhardwarestore-products", ...options }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      })
      .end(buffer);
  });
};

// Deletes an asset by public ID and invalidates CDN-cached copies.
const deleteImage = (publicId) =>
  cloudinary.uploader.destroy(publicId, { invalidate: true });

module.exports = uploadImage;
module.exports.deleteImage = deleteImage;
