# Cloudflare R2 notes (Object Storage)

Goal: store images/videos outside your app server so you can scale horizontally.

## Recommended flow (production)
1) Client asks your API: "give me an upload URL" for a new file
2) API returns a *pre-signed URL* for R2 (S3-compatible)
3) Client uploads directly to R2 using that URL
4) Client notifies API (or API already knows) and an `assets` row is created in Postgres

Why this is best:
- Your API server never handles big file uploads (faster, cheaper)
- You can scale to many users without filling server disk

## What you'll need later
- R2 bucket name (e.g. tales-assets)
- R2 endpoint URL (shown in Cloudflare dashboard)
- Access Key ID + Secret Access Key
- A public domain for downloads (Cloudflare can map a custom domain to R2)
