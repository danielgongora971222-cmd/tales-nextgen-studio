import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// IMPORTANTE: este archivo vive en tools/preset-wizard/server.mjs
// Repo root = subir 2 niveles
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WEB_DIR = path.join(__dirname, "web");

const PORT = Number(process.env.PRESET_WIZARD_PORT || 5055);

const app = express();

// Servir la interfaz web
app.use(express.static(WEB_DIR));

// Upload (archivos en memoria -> luego los guardamos donde toca)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB por archivo
    files: 10,
  },
});

function slugFromName(name) {
  const s = (name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quitar acentos
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

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function extFromOriginalName(name) {
  const ext = path.extname(name || "").toLowerCase();
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return ext;
  return ".png";
}

function buildPresetTS({ presetId, presetName, prompt, coverUrl, exampleUrls }) {
  const promptSafe = escapeTemplateLiteral(prompt);
  const nameSafe = (presetName || "").replace(/"/g, '\\"');
  const idSafe = (presetId || "").replace(/"/g, '\\"');

  let out = "";
  out += `import type { ImagePreset } from "../presetTypes";\n\n`;
  out += `const preset: ImagePreset = {\n`;
  out += `  id: "${idSafe}",\n`;
  out += `  name: "${nameSafe}",\n`;
  if (coverUrl) out += `  coverUrl: "${coverUrl}",\n`;
  if (Array.isArray(exampleUrls) && exampleUrls.length > 0) {
    out += `  exampleUrls: [\n`;
    for (const u of exampleUrls) out += `    "${u}",\n`;
    out += `  ],\n`;
  }
  out += `  prompt: \`\n${promptSafe}\n  \`.trim(),\n`;
  out += `};\n\n`;
  out += `export default preset;\n`;
  return out;
}

function insertImport(indexText, varName, idFile) {
  const importLine = `import ${varName} from "./${idFile}";`;

  if (indexText.includes(`from "./${idFile}"`)) {
    throw new Error(`Ya existe un import para "./${idFile}" en el index.`);
  }

  const lines = indexText.split(/\r?\n/);

  // insertar después del último "import ... from ..."
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s.+from\s+["'].+["'];\s*$/.test(lines[i])) lastImport = i;
  }

  lines.splice(lastImport + 1, 0, importLine);
  return lines.join("\n");
}

function addToExportArray(indexText, exportConstName, varName) {
  // 1) Caso array en una línea:
  // export const STYLE_PRESETS: ImagePreset[] = [a, b];
  const oneLineRe = new RegExp(
    `export const ${exportConstName}: ImagePreset\\[] = \\[([^\\]]*)\\];`
  );
  const oneLineMatch = indexText.match(oneLineRe);
  if (oneLineMatch) {
    const inside = oneLineMatch[1].trim();
    if (new RegExp(`\\b${varName}\\b`).test(inside)) {
      throw new Error(`"${varName}" ya está en ${exportConstName}.`);
    }
    const nextInside = inside ? `${inside}, ${varName}` : `${varName}`;
    return indexText.replace(oneLineRe, `export const ${exportConstName}: ImagePreset[] = [${nextInside}];`);
  }

  // 2) Caso array multilínea:
  // export const LIGHTING_PRESETS: ImagePreset[] = [
  //   a,
  //   b,
  // ];
  const start = `export const ${exportConstName}: ImagePreset[] = [`;
  const startIdx = indexText.indexOf(start);
  if (startIdx === -1) {
    throw new Error(`No encontré "export const ${exportConstName}: ImagePreset[] = [" en el index.`);
  }

  const afterStart = indexText.slice(startIdx);
  const endIdxRel = afterStart.indexOf("];");
  if (endIdxRel === -1) {
    throw new Error(`No encontré el cierre "];" del array ${exportConstName}.`);
  }

  const block = afterStart.slice(0, endIdxRel + 2);
  if (new RegExp(`\\b${varName}\\b`).test(block)) {
    throw new Error(`"${varName}" ya está en ${exportConstName}.`);
  }

  const lines = block.split(/\r?\n/);
  // Insertar antes de la línea que contiene "];"
  const closeLineIndex = lines.findIndex((l) => l.includes("];"));
  if (closeLineIndex === -1) throw new Error("No encontré la línea de cierre '];'.");

  lines.splice(closeLineIndex, 0, `  ${varName},`);
  const newBlock = lines.join("\n");

  return indexText.slice(0, startIdx) + newBlock + afterStart.slice(endIdxRel + 2);
}

// Endpoint de creación
app.post(
  "/api/create-preset",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "examples", maxCount: 4 },
  ]),
  async (req, res) => {
    try {
      const kindRaw = String(req.body.kind || "").trim();
      const kind = kindRaw === "lightroom" ? "lightroom" : "restyle";

      const name = String(req.body.name || "").trim();
      const idInput = String(req.body.id || "").trim();
      const prompt = String(req.body.prompt || "").trim();

      if (!name) return res.status(400).json({ ok: false, message: "Falta el nombre del preset." });
      if (!prompt) return res.status(400).json({ ok: false, message: "Falta el prompt del preset." });

      const presetId = ensureValidId(idInput || slugFromName(name));
      const varName = idToVarName(presetId);

      const coverFile = req.files?.cover?.[0];
      if (!coverFile) {
        return res.status(400).json({ ok: false, message: "Falta el cover (portada)." });
      }

      const examplesFiles = req.files?.examples || [];

      const presetTsPath = path.join(REPO_ROOT, "config", "presets", kind, `${presetId}.ts`);
      const indexPath = path.join(REPO_ROOT, "config", "presets", kind, "index.ts");
      const publicPresetDir = path.join(REPO_ROOT, "public", "presets", kind, presetId);

      if (!(await pathExists(indexPath))) {
        return res.status(500).json({
          ok: false,
          message: `No existe el index del tipo "${kind}": ${indexPath}`,
        });
      }

      if (await pathExists(presetTsPath)) {
        return res.status(400).json({
          ok: false,
          message: `Ya existe un preset con ese ID (${presetId}). Cambia el ID.`,
        });
      }

      // Crear carpeta pública del preset
      await fs.mkdir(publicPresetDir, { recursive: true });

      // Guardar cover
      const coverExt = extFromOriginalName(coverFile.originalname);
      const coverName = `cover${coverExt}`;
      const coverDiskPath = path.join(publicPresetDir, coverName);
      await fs.writeFile(coverDiskPath, coverFile.buffer);

      const coverUrl = `/presets/${kind}/${presetId}/${coverName}`;

      // Guardar ejemplos (1..4)
      const exampleUrls = [];
      for (let i = 0; i < examplesFiles.length; i++) {
        const f = examplesFiles[i];
        const ext = extFromOriginalName(f.originalname);
        const diskName = `${i + 1}${ext}`;
        const diskPath = path.join(publicPresetDir, diskName);
        await fs.writeFile(diskPath, f.buffer);
        exampleUrls.push(`/presets/${kind}/${presetId}/${diskName}`);
      }

      // Crear archivo .ts del preset
      const presetTS = buildPresetTS({
        presetId,
        presetName: name,
        prompt,
        coverUrl,
        exampleUrls,
      });

      await fs.mkdir(path.dirname(presetTsPath), { recursive: true });
      await fs.writeFile(presetTsPath, presetTS, "utf8");

      // Actualizar index.ts (import + array)
      const exportName = kind === "lightroom" ? "LIGHTING_PRESETS" : "STYLE_PRESETS";
      const indexText = await fs.readFile(indexPath, "utf8");
      let next = insertImport(indexText, varName, presetId);
      next = addToExportArray(next, exportName, varName);
      await fs.writeFile(indexPath, next, "utf8");

      return res.json({
        ok: true,
        kind,
        presetId,
        presetFile: presetTsPath,
        publicFolder: publicPresetDir,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        message: err?.message || String(err),
      });
    }
  }
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\nPreset Wizard (LOCAL) corriendo en: http://localhost:${PORT}`);
  console.log(`Repo root: ${REPO_ROOT}`);
  console.log("Para detener: Ctrl + C\n");
});
