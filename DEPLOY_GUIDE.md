# Deploy Guide (Scalable structure)

This guide sets up the project in a scalable structure:
- Frontend (static) -> Vercel
- API + Worker -> Render
- Database + Auth -> Supabase
- File storage -> Cloudflare R2

The goal is to start small (low cost) but be able to scale up later without rewriting.

---

## 0) One-time prerequisites on your PC (Windows)
1) Install Node.js LTS
2) Install Git
3) Create accounts:
   - GitHub
   - Vercel
   - Render
   - Supabase
   - Cloudflare

---

## 1) Run locally first (quick sanity check)
1) Copy `.env.example` -> `.env` (same folder as package.json)
2) Put your Gemini key:
   - `GEMINI_API_KEY=...`
3) Install + run:
   ```powershell
   npm install
   npm run dev
   ```
4) Open:
   - Frontend: http://localhost:3000
   - API health: http://localhost:8788/api/health

You should see `ok: true` and `hasKey: true`.

---

## 2) Put the project in GitHub (so Vercel/Render can deploy)
1) Create a new repo in GitHub (private is fine)
2) In the project folder:
   ```powershell
   git init
   git add .
   git commit -m "Initial deploy-ready setup"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

---

## 3) Create the database (Supabase)
1) Create a new Supabase project
2) In Supabase -> SQL Editor -> New query
3) Paste and run:
   - `infra/supabase/schema.sql`

Save these for later (Settings -> Database):
- `DATABASE_URL` (or the connection string)

---

## 4) Create storage (Cloudflare R2)
Follow `infra/r2/SETUP.md`.

At the end you should have:
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_ENDPOINT
- R2_BUCKET
- (optional) R2_PUBLIC_BASE_URL

---

## 5) Deploy the API to Render
1) Render -> New -> Web Service
2) Connect your GitHub repo
3) Settings:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm run start:api`
4) Add Environment Variables:
   - GEMINI_API_KEY
   - PORT=8788
   - SERVE_CLIENT=0
   - DATABASE_URL (from Supabase)
   - R2_ACCESS_KEY_ID
   - R2_SECRET_ACCESS_KEY
   - R2_ENDPOINT
   - R2_BUCKET
   - JWT_SECRET (generate a random long string)

5) Deploy
6) Test:
   - Open: `https://YOUR-RENDER-URL/api/health`
   - You should see `{ ok: true, hasKey: true }`

---

## 6) Deploy the frontend to Vercel
1) Vercel -> New Project -> Import Git repo
2) Framework preset: Vite
3) Build command: `npm run build`
4) Output: `dist`
5) Add Environment Variable:
   - `VITE_API_BASE_URL=https://YOUR-RENDER-URL`
6) Deploy

Test:
- Open your Vercel URL
- Try Image Generator (it should call Render through VITE_API_BASE_URL)

---

## 7) What is missing (next dev milestone)
The UI currently stores "assets" in localStorage (demo mode).
To make it production-ready you will implement:
1) Upload assets to R2 (not localStorage)
2) Save metadata in Supabase (assets table)
3) Replace History/Gallery queries with Supabase
4) Add Jobs + Worker for heavy tasks (video, big upscale)

