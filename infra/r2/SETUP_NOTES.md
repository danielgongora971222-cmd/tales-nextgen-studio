# Cloudflare R2 setup notes (storage)

Goal: store generated images/videos in object storage so you can scale to multiple servers.

## What you create in Cloudflare
1) An R2 Bucket, e.g. `tales-assets`
2) An API Token (R2 Read/Write) OR Access Key + Secret
3) A public domain for assets (recommended):
   - Use Cloudflare "R2 Public Buckets" (if enabled for your account) OR
   - Put Cloudflare Workers / Pages in front of R2 OR
   - Use a custom domain with Cloudflare.

## Recommended approach (safe + scalable)
- Frontend never uploads with your secret.
- Frontend asks your API for a **pre-signed upload URL**.
- The browser uploads directly to R2 using that URL.
- Your API writes metadata to Supabase (assets table).

## Env vars your API will need
R2_ENDPOINT=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_BASE_URL=  # e.g. https://assets.yourdomain.com

Later we will implement endpoints:
- POST /api/storage/presign-upload
- POST /api/assets (metadata)
