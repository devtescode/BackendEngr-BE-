# Profile images

Students can upload a profile picture. It is stored on Cloudinary using the existing
`config/cloudinary.js` instance (no extra env vars) in the folder
`euhardwarestore-profile-images` (product images stay in `euhardwarestore-products`).

## Endpoints (mounted under `/engineering`, both require `verifyToken` + verified email)

| Method | Path             | Notes |
| ------ | ---------------- | ----- |
| GET    | `/profile`       | `{ success, user }` |
| POST   | `/profile-image` | multipart, field `image`; rate limited 10 / 15 min per IP |

`user` shape: `{ id, fullName, email, matric, phoneNumber, gender, role, profileImageUrl }`
(`profileImageUrl` is `null` when not set). The login response `user` includes
`profileImageUrl` as well.

Upload success: `{ success: true, message, profileImageUrl, user }`.

Errors use `{ success: false, code?, message }`:

| Status | code              | When |
| ------ | ----------------- | ---- |
| 400    | `INVALID_IMAGE`   | no file, wrong field, or not JPEG/PNG/WebP |
| 400    | `IMAGE_TOO_LARGE` | file over 5 MB |
| 401/403|                   | missing/invalid token, unverified email |
| 404    |                   | user no longer exists (new asset is deleted) |
| 429    | `RATE_LIMITED`    | too many uploads |
| 500    |                   | DB save failed (new asset is deleted) |
| 502    | `UPLOAD_FAILED`   | Cloudinary upload failed (nothing saved) |

## Storage and replacement order

Images are cropped to 512x512 (`crop: "fill", gravity: "face"`). The user document stores
`profileImageUrl` and `profileImagePublicId` (`select: false`, stripped by `toJSON`, never sent
to clients).

1. Upload the new image to Cloudinary.
2. Atomically save the new URL + public ID with `findOneAndUpdate(..., { returnDocument: "before" })`,
   which returns the previous public ID.
3. If the save fails or the user is missing, delete the newly uploaded asset.
4. Otherwise delete the previous asset (if any). This is best-effort: failures are only logged.
5. Emit `users:updated` with `{ userId }` over Socket.io (when `req.io` is available) so the
   admin users page refreshes.

`utils/uploadImage.js`: `uploadImage(buffer, options = {})` merges `options` over
`{ folder: "euhardwarestore-products" }`, so product uploads are unchanged;
`uploadImage.deleteImage(publicId)` calls `destroy(publicId, { invalidate: true })`.
