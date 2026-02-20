import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// Load env from .env.local first, then default .env (if present)
dotenv.config({ path: ".env.local" });
dotenv.config();

function mimeFromPath(path) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".mp4")) return "video/mp4";
  if (p.endsWith(".mov")) return "video/quicktime";
  if (p.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function boolFromEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const DELETE_SOURCE =
  process.argv.includes("--delete-source") ||
  boolFromEnv("MIGRATE_DELETE_SOURCE", false);

const OVERWRITE =
  process.argv.includes("--overwrite") ||
  boolFromEnv("MIGRATE_OVERWRITE", false);

// Por defecto NO fallamos si el objeto ya existe en R2 (para que el script sea idempotente).
// Si quieres que falle (modo estricto), usa --fail-on-existing o MIGRATE_FAIL_ON_EXISTING=true
const FAIL_ON_EXISTING =
  process.argv.includes("--fail-on-existing") ||
  boolFromEnv("MIGRATE_FAIL_ON_EXISTING", false);

const SKIP_EXISTING = !FAIL_ON_EXISTING;

// Dedupe dentro de la misma ejecución (evita que preview_path e image_paths repitan el mismo key)
const SEEN_KEYS = new Set();

const SUPABASE_URL = required("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "assets";

const R2_ACCESS_KEY_ID = required("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = required("R2_SECRET_ACCESS_KEY");
const R2_ENDPOINT = required("R2_ENDPOINT"); // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
const R2_BUCKET = required("R2_BUCKET");
const R2_REGION = process.env.R2_REGION || "auto";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

async function r2Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadFromSupabase(key) {
  const dl = await supabaseAdmin.storage.from(SUPABASE_BUCKET).download(key);
  if (dl.error || !dl.data) {
    throw new Error(dl.error?.message || `Supabase download failed for ${key}`);
  }
  const blob = dl.data;
  const ab = await blob.arrayBuffer();
  const buffer = Buffer.from(ab);
  const ct = blob.type || mimeFromPath(key);
  return { buffer, contentType: ct };
}

async function uploadToR2({ key, buffer, contentType }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || mimeFromPath(key),
    })
  );
}

async function deleteFromSupabase(key) {
  const rm = await supabaseAdmin.storage.from(SUPABASE_BUCKET).remove([key]);
  if (rm.error) throw new Error(rm.error.message);
}

function fromStoragePathToKey(storagePath) {
  const raw = String(storagePath || "");
  return raw.startsWith("r2:") ? raw.slice(3) : raw;
}

async function migrateKey({ sourcePath }) {
  const key = fromStoragePathToKey(sourcePath);
  if (!key) return null;

  // Si ya está en R2, no hacemos nada
  if (String(sourcePath).startsWith("r2:")) {
    return { key, targetPath: sourcePath, migrated: false };
  }

  // Dedupe en esta misma ejecución (preview + image_paths, o repeticiones entre rows)
  if (SEEN_KEYS.has(key)) {
    return { key, targetPath: `r2:${key}`, migrated: false, deduped: true };
  }
  SEEN_KEYS.add(key);

  // Si ya existe en R2, por defecto lo saltamos (idempotente)
  if (!OVERWRITE) {
    const exists = await r2Exists(key);
    if (exists) {
      if (SKIP_EXISTING) {
        return { key, targetPath: `r2:${key}`, migrated: false, skippedExisting: true };
      }
      throw new Error(`R2 object already exists and overwrite is disabled: ${key}`);
    }
  }

  // Solo descargamos de Supabase si realmente necesitamos subir
  const { buffer, contentType } = await downloadFromSupabase(key);
  await uploadToR2({ key, buffer, contentType });

  if (DELETE_SOURCE) {
    await deleteFromSupabase(key);
  }

  return { key, targetPath: `r2:${key}`, migrated: true };
}

async function paginate(table, select, filterFn) {
  const pageSize = 500;
  let offset = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(select)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`${table} select failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (filterFn(row)) rows.push(row);
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function migrateAssets() {
  const rows = await paginate(
    "assets",
    "id, storage_path",
    (r) => r.storage_path && !String(r.storage_path).startsWith("r2:")
  );

  console.log(`assets to migrate: ${rows.length}`);

  for (const row of rows) {
    const sourcePath = row.storage_path;
    const key = fromStoragePathToKey(sourcePath);

    console.log(`- assets.${row.id}: ${sourcePath} -> r2:${key}`);

    if (DRY_RUN) continue;

    await migrateKey({ sourcePath });

    const { error: updErr } = await supabaseAdmin
      .from("assets")
      .update({ storage_path: `r2:${key}` })
      .eq("id", row.id);

    if (updErr) {
      throw new Error(`assets update failed for ${row.id}: ${updErr.message}`);
    }
  }
}

async function migrateKlingElements() {
  const rows = await paginate(
    "kling_elements",
    "id, preview_path, image_paths",
    (r) => {
      const previewNeeds =
        r.preview_path && !String(r.preview_path).startsWith("r2:");
      const imgs = Array.isArray(r.image_paths) ? r.image_paths : [];
      const imgsNeed = imgs.some((p) => p && !String(p).startsWith("r2:"));
      return previewNeeds || imgsNeed;
    }
  );

  console.log(`kling_elements to migrate: ${rows.length}`);

  for (const row of rows) {
    const update = {};

    if (row.preview_path && !String(row.preview_path).startsWith("r2:")) {
      const key = fromStoragePathToKey(row.preview_path);
      console.log(
        `- kling_elements.${row.id} preview: ${row.preview_path} -> r2:${key}`
      );

      if (!DRY_RUN) {
        await migrateKey({ sourcePath: row.preview_path });
      }

      update.preview_path = `r2:${key}`;
    }

    if (Array.isArray(row.image_paths) && row.image_paths.length) {
      const newPaths = [];
      for (const p of row.image_paths) {
        if (!p) continue;
        if (String(p).startsWith("r2:")) {
          newPaths.push(p);
          continue;
        }
        const key = fromStoragePathToKey(p);
        console.log(`- kling_elements.${row.id} image: ${p} -> r2:${key}`);

        if (!DRY_RUN) {
          await migrateKey({ sourcePath: p });
        }

        newPaths.push(`r2:${key}`);
      }

      update.image_paths = newPaths;
    }

    const keys = Object.keys(update);
    if (!keys.length) continue;

    if (DRY_RUN) continue;

    const { error: updErr } = await supabaseAdmin
      .from("kling_elements")
      .update(update)
      .eq("id", row.id);

    if (updErr) {
      throw new Error(
        `kling_elements update failed for ${row.id}: ${updErr.message}`
      );
    }
  }
}

async function main() {
  console.log("=== migrate storage to Cloudflare R2 ===");
  console.log(`SUPABASE_BUCKET=${SUPABASE_BUCKET}`);
  console.log(`R2_ENDPOINT=${R2_ENDPOINT}`);
  console.log(`R2_BUCKET=${R2_BUCKET}`);
  console.log(`DRY_RUN=${DRY_RUN}`);
  console.log(`DELETE_SOURCE=${DELETE_SOURCE}`);
  console.log(`OVERWRITE=${OVERWRITE}`);
  console.log(`FAIL_ON_EXISTING=${FAIL_ON_EXISTING}`);
  console.log(`SKIP_EXISTING=${SKIP_EXISTING}`);
  console.log("");

  await migrateAssets();
  await migrateKlingElements();

  console.log("");
  console.log("DONE ✅");
  if (DRY_RUN) {
    console.log(
      "Esto fue DRY-RUN. Para aplicar cambios: node tools/migrate-storage-to-r2.mjs --apply"
    );
  }
}

main().catch((e) => {
  console.error("FAILED ❌", e);
  process.exit(1);
});