import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WEB_DIR = path.join(__dirname, "web");
const PORT = Number(process.env.PRESET_WIZARD_PORT || 5055);

const app = express();

app.use("/presets", express.static(path.join(REPO_ROOT, "public", "presets")));
app.use("/style-presets", express.static(path.join(REPO_ROOT, "public", "style-presets")));
app.use(express.static(WEB_DIR));
app.use(express.json({ limit: "10mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 20,
  },
});

function normalizeKind(kindRaw) {
  return String(kindRaw || "").trim() === "lightroom" ? "lightroom" : "restyle";
}

function slugFromName(name) {
  const s = (name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = s
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return slug || "preset";
}

function ensureValidId(id) {
  const cleaned = (id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return cleaned || "preset";
}

function idToVarName(id) {
  const base = ensureValidId(id);
  const camel = base
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/_/g, "");
  if (!camel) return "preset";
  if (/^[0-9]/.test(camel)) return `p${camel}`;
  return camel;
}

function escapeTemplateLiteral(s) {
  return (s || "").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function extFromOriginalName(name) {
  const ext = path.extname(name || "").toLowerCase();
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return ext;
  return ".png";
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(p) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {}
}

function ensureStyleReferenceGuard(kind, prompt) {
  const base = String(prompt || "").trim();
  if (kind !== "restyle") return base;

  if (base.includes("STYLE REFERENCE HANDLING:")) return base;

  const guard = `
STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim();

  return `${base}\n\n${guard}`.trim();
}

function buildPresetTS({
  kind,
  presetId,
  presetName,
  prompt,
  coverUrl,
  exampleUrls,
  referenceGridUrl,
}) {
  const promptSafe = escapeTemplateLiteral(ensureStyleReferenceGuard(kind, prompt));
  const nameSafe = String(presetName || "").replace(/"/g, '\\"');
  const idSafe = String(presetId || "").replace(/"/g, '\\"');

  let out = "";
  out += `import type { ImagePreset } from "../presetTypes";\n\n`;
  out += `const preset: ImagePreset = {\n`;
  out += `  id: "${idSafe}",\n`;
  out += `  name: "${nameSafe}",\n`;
  out += `  kind: "${kind}",\n`;
  if (coverUrl) out += `  coverUrl: "${coverUrl}",\n`;
  if (Array.isArray(exampleUrls) && exampleUrls.length > 0) {
    out += `  exampleUrls: [\n`;
    for (const u of exampleUrls) out += `    "${u}",\n`;
    out += `  ],\n`;
  }
  if (referenceGridUrl) {
    out += `  referenceGridUrl: "${referenceGridUrl}",\n`;
  }
  out += `  prompt: \`\n${promptSafe}\n  \`.trim(),\n`;
  out += `};\n\n`;
  out += `export default preset;\n`;
  return out;
}

function getPresetFolder(kind, presetId) {
  return path.join(REPO_ROOT, "public", "presets", kind, presetId);
}

function getPresetTsPath(kind, presetId) {
  return path.join(REPO_ROOT, "config", "presets", kind, `${presetId}.ts`);
}

function getPresetIndexPath(kind) {
  return path.join(REPO_ROOT, "config", "presets", kind, "index.ts");
}

async function deleteStemFiles(dir, stem) {
  const candidates = [".png", ".jpg", ".jpeg", ".webp"];
  for (const ext of candidates) {
    await removeIfExists(path.join(dir, `${stem}${ext}`));
  }
}

async function writeUploadedFile(dir, stem, file) {
  const ext = extFromOriginalName(file.originalname);
  await deleteStemFiles(dir, stem);
  const diskName = `${stem}${ext}`;
  const diskPath = path.join(dir, diskName);
  await fs.writeFile(diskPath, file.buffer);
  return diskName;
}

async function findStemUrl(kind, presetId, dir, stem) {
  const candidates = [".png", ".jpg", ".jpeg", ".webp"];
  for (const ext of candidates) {
    const diskPath = path.join(dir, `${stem}${ext}`);
    if (await pathExists(diskPath)) {
      return `/presets/${kind}/${presetId}/${stem}${ext}`;
    }
  }
  return null;
}

async function parsePresetFile(kind, presetId) {
  const presetTsPath = getPresetTsPath(kind, presetId);
  if (!(await pathExists(presetTsPath))) return null;

  const raw = await fs.readFile(presetTsPath, "utf8");

  const idMatch = raw.match(/id:\s*"([^"]+)"/);
  const nameMatch = raw.match(/name:\s*"([^"]+)"/);
  const coverMatch = raw.match(/coverUrl:\s*"([^"]+)"/);
  const refGridMatch = raw.match(/referenceGridUrl:\s*"([^"]+)"/);
  const promptMatch = raw.match(/prompt:\s*`\n?([\s\S]*?)\n\s*`\.trim\(\),/);

  const examples = [];
  const examplesBlockMatch = raw.match(/exampleUrls:\s*\[([\s\S]*?)\]/);
  if (examplesBlockMatch) {
    const urls = [...examplesBlockMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const u of urls) examples.push(u);
  }

  return {
    kind,
    id: idMatch?.[1] || presetId,
    name: nameMatch?.[1] || presetId,
    coverUrl: coverMatch?.[1] || null,
    exampleUrls: examples,
    referenceGridUrl: refGridMatch?.[1] || null,
    prompt: (promptMatch?.[1] || "").trim(),
  };
}

async function listPresetIds(kind) {
  const dir = path.join(REPO_ROOT, "config", "presets", kind);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => name !== "index.ts")
    .map((name) => name.replace(/\.ts$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

async function listPresets(kind) {
  const ids = await listPresetIds(kind);
  const out = [];
  for (const id of ids) {
    const preset = await parsePresetFile(kind, id);
    if (preset) out.push(preset);
  }
  return out;
}

async function rewriteIndex(kind) {
  const ids = await listPresetIds(kind);
  const exportName = kind === "lightroom" ? "LIGHTING_PRESETS" : "STYLE_PRESETS";
  const varNames = ids.map((id) => ({ id, varName: idToVarName(id) }));

  let out = `import type { ImagePreset } from "../presetTypes";\n\n`;
  for (const item of varNames) {
    out += `import ${item.varName} from "./${item.id}";\n`;
  }

  out += `\nexport const ${exportName}: ImagePreset[] = [\n`;
  for (const item of varNames) {
    out += `  ${item.varName},\n`;
  }
  out += `];\n\n`;
  out += `const _seen = new Set<string>();\n`;
  out += `for (const p of ${exportName}) {\n`;
  out += `  if (_seen.has(p.id)) throw new Error(\`Duplicate ${exportName} id: \${p.id}\`);\n`;
  out += `  _seen.add(p.id);\n`;
  out += `}\n`;

  await fs.writeFile(getPresetIndexPath(kind), out, "utf8");
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/presets", async (req, res) => {
  try {
    const kind = normalizeKind(req.query.kind);
    const presets = await listPresets(kind);
    return res.json({ ok: true, kind, presets });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

app.get("/api/presets/:kind/:id", async (req, res) => {
  try {
    const kind = normalizeKind(req.params.kind);
    const presetId = ensureValidId(req.params.id);
    const preset = await parsePresetFile(kind, presetId);
    if (!preset) {
      return res.status(404).json({ ok: false, message: "Preset no encontrado." });
    }
    return res.json({ ok: true, preset });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

app.post(
  "/api/save-preset",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "referenceGrid", maxCount: 1 },
    { name: "example1", maxCount: 1 },
    { name: "example2", maxCount: 1 },
    { name: "example3", maxCount: 1 },
    { name: "example4", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const kind = normalizeKind(req.body.kind);
      const existingIdRaw = String(req.body.existingId || "").trim();
      const existingId = existingIdRaw ? ensureValidId(existingIdRaw) : "";
      const name = String(req.body.name || "").trim();
      const nextId = ensureValidId(String(req.body.id || "").trim() || slugFromName(name));
      const prompt = String(req.body.prompt || "").trim();

      const clearCover = String(req.body.clearCover || "") === "1";
      const clearReferenceGrid = String(req.body.clearReferenceGrid || "") === "1";

      let clearExampleSlots = [false, false, false, false];
      try {
        const parsed = JSON.parse(String(req.body.clearExampleSlots || "[false,false,false,false]"));
        if (Array.isArray(parsed) && parsed.length === 4) {
          clearExampleSlots = parsed.map((x) => Boolean(x));
        }
      } catch {}

      if (!name) {
        return res.status(400).json({ ok: false, message: "Falta el nombre del preset." });
      }
      if (!prompt) {
        return res.status(400).json({ ok: false, message: "Falta el prompt del preset." });
      }

      const prevTsPath = existingId ? getPresetTsPath(kind, existingId) : null;
      const nextTsPath = getPresetTsPath(kind, nextId);

      if (!existingId && (await pathExists(nextTsPath))) {
        return res.status(400).json({
          ok: false,
          message: `Ya existe un preset con ese ID (${nextId}).`,
        });
      }

      if (existingId && existingId !== nextId && (await pathExists(nextTsPath))) {
        return res.status(400).json({
          ok: false,
          message: `Ya existe otro preset con el ID destino (${nextId}).`,
        });
      }

      const prevDir = existingId ? getPresetFolder(kind, existingId) : null;
      const nextDir = getPresetFolder(kind, nextId);

      if (existingId && prevDir && existingId !== nextId && (await pathExists(prevDir))) {
        await fs.mkdir(path.dirname(nextDir), { recursive: true });
        await removeIfExists(nextDir);
        await fs.rename(prevDir, nextDir);
      } else {
        await fs.mkdir(nextDir, { recursive: true });
      }

      const files = req.files || {};
      const coverFile = files.cover?.[0] || null;
      const refGridFile = files.referenceGrid?.[0] || null;

      if (coverFile) {
        await writeUploadedFile(nextDir, "cover", coverFile);
      } else if (clearCover) {
        await deleteStemFiles(nextDir, "cover");
      }

      if (refGridFile) {
        await writeUploadedFile(nextDir, "reference_grid", refGridFile);
      } else if (clearReferenceGrid) {
        await deleteStemFiles(nextDir, "reference_grid");
      }

      for (let i = 1; i <= 4; i++) {
        const file = files[`example${i}`]?.[0] || null;
        if (file) {
          await writeUploadedFile(nextDir, String(i), file);
        } else if (clearExampleSlots[i - 1]) {
          await deleteStemFiles(nextDir, String(i));
        }
      }

      const coverUrl = await findStemUrl(kind, nextId, nextDir, "cover");
      const referenceGridUrl = await findStemUrl(kind, nextId, nextDir, "reference_grid");
      const exampleUrls = [];
      for (let i = 1; i <= 4; i++) {
        const url = await findStemUrl(kind, nextId, nextDir, String(i));
        if (url) exampleUrls.push(url);
      }

      const presetTS = buildPresetTS({
        kind,
        presetId: nextId,
        presetName: name,
        prompt,
        coverUrl,
        exampleUrls,
        referenceGridUrl,
      });

      await fs.mkdir(path.dirname(nextTsPath), { recursive: true });
      await fs.writeFile(nextTsPath, presetTS, "utf8");

      if (existingId && existingId !== nextId && prevTsPath) {
        await removeIfExists(prevTsPath);
      }

      await rewriteIndex(kind);

      const preset = await parsePresetFile(kind, nextId);

      return res.json({
        ok: true,
        kind,
        mode: existingId ? "update" : "create",
        preset,
        presetFile: nextTsPath,
        publicFolder: nextDir,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, message: err?.message || String(err) });
    }
  }
);

app.delete("/api/presets/:kind/:id", async (req, res) => {
  try {
    const kind = normalizeKind(req.params.kind);
    const presetId = ensureValidId(req.params.id);

    const presetTsPath = getPresetTsPath(kind, presetId);
    const presetDir = getPresetFolder(kind, presetId);

    await removeIfExists(presetTsPath);
    await removeIfExists(presetDir);
    await rewriteIndex(kind);

    return res.json({ ok: true, kind, presetId });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\nPreset Manager (LOCAL) corriendo en: http://localhost:${PORT}`);
});