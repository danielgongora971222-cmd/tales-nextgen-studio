# Cloudflare R2 setup (storage)

Why: storing images/videos on the web server breaks when you scale to multiple server instances. Object storage (R2) scales independently.

## 1) Create the bucket
1. Open Cloudflare Dashboard
2. Go to **R2**
3. Click **Create bucket**
4. Bucket name: `tales-assets` (or any name you prefer)

## 2) Create credentials (API token)
1. In R2, open **Manage R2 API Tokens**
2. Create a token with **Read & Write** permissions for your bucket
3. Save these values:
   - Access Key ID
   - Secret Access Key
   - Endpoint (S3-compatible)

## 3) Backend environment variables
Set these on your backend (Render) as environment variables:
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_ENDPOINT
- R2_BUCKET
- R2_PUBLIC_BASE_URL  (optional; example: https://cdn.yourdomain.com)

## 4) How uploads should work (recommended)
- The browser should NOT upload through your API server.
- Your API should return a short-lived "presigned URL".
- The browser uploads directly to R2 using that URL.
- Then your API stores the file metadata and public URL in the database.

This prevents your API from becoming slow/expensive and keeps scaling easy.

## 5) IMPORTANT: CORS for browser direct uploads (R2)
If your frontend uploads **directly** to R2 using a presigned PUT URL, your bucket MUST allow CORS.

In Cloudflare Dashboard:
1. R2 → your bucket → **Settings**
2. **CORS policy** → Add policy/rule
3. Use something like:

```json
[
  {
    "AllowedOrigins": [
      "https://<TU-DOMINIO-PROD>",
      "https://<TU-DOMINIO-STAGING>",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]