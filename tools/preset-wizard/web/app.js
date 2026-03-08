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

function getKind() {
  const el = document.querySelector('input[name="kind"]:checked');
  return el ? el.value : "restyle";
}

function makeObjectUrl(file) {
  if (!file) return "";
  return URL.createObjectURL(file);
}

const state = {
  kind: "restyle",
  existingId: "",
  name: "",
  id: "",
  prompt: "",
  cover: { file: null, url: "", cleared: false },
  examples: [
    { file: null, url: "", cleared: false },
    { file: null, url: "", cleared: false },
    { file: null, url: "", cleared: false },
    { file: null, url: "", cleared: false },
  ],
  referenceGrid: { file: null, url: "", cleared: false },
  presets: [],
  filter: "",
};

const elSearch = document.getElementById("search");
const elName = document.getElementById("name");
const elId = document.getElementById("id");
const elPrompt = document.getElementById("prompt");
const elSavePathTs = document.getElementById("savePathTs");
const elSavePathPublic = document.getElementById("savePathPublic");
const elEditorTitle = document.getElementById("editorTitle");
const elPresetList = document.getElementById("presetList");
const elStatus = document.getElementById("status");
const elResult = document.getElementById("result");

const elCover = document.getElementById("cover");
const elCoverPreview = document.getElementById("coverPreview");
const elReferenceGrid = document.getElementById("referenceGrid");
const elReferenceGridPreview = document.getElementById("referenceGridPreview");

const exampleInputs = [
  document.getElementById("example1"),
  document.getElementById("example2"),
  document.getElementById("example3"),
  document.getElementById("example4"),
];

const examplePreviewEls = [
  document.getElementById("examplePreview1"),
  document.getElementById("examplePreview2"),
  document.getElementById("examplePreview3"),
  document.getElementById("examplePreview4"),
];

function setStatus(message, mode) {
  elStatus.textContent = message || "";
  elStatus.classList.remove("ok", "error");
  if (mode) elStatus.classList.add(mode);
}

function renderPreview(el, url, label) {
  if (!url) {
    el.innerHTML = `<div class="preview-empty">${label || "Vacío"}</div>`;
    return;
  }
  el.innerHTML = `<img src="${url}" alt="${label || "preview"}" />`;
}

function refreshPaths() {
  const kind = state.kind;
  const id = state.id || "preset";
  elSavePathTs.textContent = `config/presets/${kind}/${id}.ts`;
  elSavePathPublic.textContent = `public/presets/${kind}/${id}/`;
}

function refreshEditor() {
  elEditorTitle.textContent = state.existingId ? `Editar: ${state.name || state.existingId}` : "Nuevo preset";

  elName.value = state.name;
  elId.value = state.id;
  elPrompt.value = state.prompt;

  renderPreview(elCoverPreview, state.cover.url, "Cover");
  renderPreview(elReferenceGridPreview, state.referenceGrid.url, "Grid 2x2");

  for (let i = 0; i < 4; i++) {
    renderPreview(examplePreviewEls[i], state.examples[i].url, `Ejemplo ${i + 1}`);
  }

  refreshPaths();
}

function resetEditor() {
  state.existingId = "";
  state.name = "";
  state.id = "";
  state.prompt = "";
  state.cover = { file: null, url: "", cleared: false };
  state.examples = [
    { file: null, url: "", cleared: false },
    { file: null, url: "", cleared: false },
    { file: null, url: "", cleared: false },
    { file: null, url: "", cleared: false },
  ];
  state.referenceGrid = { file: null, url: "", cleared: false };
  refreshEditor();
}

function hydrateFromPreset(preset) {
  state.existingId = preset.id || "";
  state.name = preset.name || "";
  state.id = preset.id || "";
  state.prompt = preset.prompt || "";
  state.cover = { file: null, url: preset.coverUrl || "", cleared: false };
  state.referenceGrid = { file: null, url: preset.referenceGridUrl || "", cleared: false };

  const examples = Array.isArray(preset.exampleUrls) ? preset.exampleUrls : [];
  state.examples = [0, 1, 2, 3].map((idx) => ({
    file: null,
    url: examples[idx] || "",
    cleared: false,
  }));

  refreshEditor();
}

function filteredPresets() {
  const q = (state.filter || "").trim().toLowerCase();
  if (!q) return state.presets;
  return state.presets.filter((p) => {
    const hay =
      String(p.name || "").toLowerCase().includes(q) ||
      String(p.id || "").toLowerCase().includes(q);
    return hay;
  });
}

function renderPresetList() {
  const list = filteredPresets();

  if (!list.length) {
    elPresetList.innerHTML = `<div class="list-empty">No hay presets para mostrar.</div>`;
    return;
  }

  elPresetList.innerHTML = list
    .map((p) => {
      const active = state.existingId && p.id === state.existingId;
      const thumb = p.coverUrl
        ? `<img src="${p.coverUrl}" alt="${p.name}" />`
        : `<div class="list-thumb-empty">—</div>`;

      return `
        <button class="list-item ${active ? "active" : ""}" data-preset-id="${p.id}">
          <div class="list-thumb">${thumb}</div>
          <div class="list-copy">
            <div class="list-name">${p.name}</div>
            <div class="list-id">${p.id}</div>
          </div>
        </button>
      `;
    })
    .join("");
}

async function loadPresets() {
  state.kind = getKind();
  setStatus("Cargando presets...", null);

  const resp = await fetch(`/api/presets?kind=${encodeURIComponent(state.kind)}`);
  const data = await resp.json();

  if (!resp.ok || !data.ok) {
    throw new Error(data?.message || "No se pudieron cargar los presets.");
  }

  state.presets = Array.isArray(data.presets) ? data.presets : [];
  renderPresetList();
  refreshPaths();
  setStatus("Listo.", "ok");
}

async function loadPresetDetail(id) {
  const resp = await fetch(`/api/presets/${encodeURIComponent(state.kind)}/${encodeURIComponent(id)}`);
  const data = await resp.json();

  if (!resp.ok || !data.ok) {
    throw new Error(data?.message || "No se pudo abrir el preset.");
  }

  hydrateFromPreset(data.preset);
}

function drawContain(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function fileToObjectUrl(file) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      resolve(url);
    } catch (err) {
      reject(err);
    }
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar una imagen del grid."));
    img.src = src;
  });
}

async function currentExampleSources() {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const slot = state.examples[i];
    if (slot.file) {
      out.push(await fileToObjectUrl(slot.file));
    } else if (slot.url) {
      out.push(slot.url);
    } else {
      out.push(null);
    }
  }
  return out;
}

async function generateReferenceGridFromExamples() {
  const sources = await currentExampleSources();

  if (!sources[0]) {
    throw new Error("El ejemplo 1 es obligatorio para construir el grid 2x2.");
  }

  const loaded = [];
  try {
    for (const src of sources) {
      if (!src) {
        loaded.push(null);
        continue;
      }
      loaded.push(await loadImage(src));
    }

    const first = loaded[0];
    const w1 = first.naturalWidth || 1024;
    const h1 = first.naturalHeight || 1024;

    const MAX_CELL = 1280;
    const down = Math.min(1, MAX_CELL / Math.max(w1, h1));
    const cellW = Math.max(1, Math.round(w1 * down));
    const cellH = Math.max(1, Math.round(h1 * down));

    const canvas = document.createElement("canvas");
    canvas.width = cellW * 2;
    canvas.height = cellH * 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el canvas del grid.");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const coords = [
      { x: 0, y: 0 },
      { x: cellW, y: 0 },
      { x: 0, y: cellH },
      { x: cellW, y: cellH },
    ];

    for (let i = 0; i < 4; i++) {
      const img = loaded[i];
      if (!img) continue;
      drawContain(ctx, img, coords[i].x, coords[i].y, cellW, cellH);
    }

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo exportar el grid."))), "image/jpeg", 0.92);
    });

    const file = new File([blob], "reference_grid.jpg", { type: "image/jpeg" });
    state.referenceGrid = {
      file,
      url: makeObjectUrl(file),
      cleared: false,
    };

    refreshEditor();
  } finally {
    for (const src of sources) {
      if (typeof src === "string" && src.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    }
  }
}

function buildSaveFormData() {
  const fd = new FormData();
  fd.append("kind", state.kind);
  fd.append("existingId", state.existingId || "");
  fd.append("name", state.name);
  fd.append("id", state.id);
  fd.append("prompt", state.prompt);
  fd.append("clearCover", state.cover.cleared ? "1" : "0");
  fd.append("clearReferenceGrid", state.referenceGrid.cleared ? "1" : "0");
  fd.append(
    "clearExampleSlots",
    JSON.stringify(state.examples.map((x) => Boolean(x.cleared)))
  );

  if (state.cover.file) fd.append("cover", state.cover.file);
  if (state.referenceGrid.file) fd.append("referenceGrid", state.referenceGrid.file);

  for (let i = 0; i < 4; i++) {
    if (state.examples[i].file) {
      fd.append(`example${i + 1}`, state.examples[i].file);
    }
  }

  return fd;
}

async function savePreset() {
  state.kind = getKind();
  state.name = elName.value.trim();
  state.id = (elId.value.trim() || slugFromName(state.name)).trim();
  state.prompt = elPrompt.value.trim();

  if (!state.name) throw new Error("Falta el nombre del preset.");
  if (!state.id) throw new Error("Falta el ID del preset.");
  if (!state.prompt) throw new Error("Falta el prompt del preset.");

  setStatus("Guardando preset...", null);
  elResult.classList.add("hidden");
  elResult.textContent = "";

  const resp = await fetch("/api/save-preset", {
    method: "POST",
    body: buildSaveFormData(),
  });

  const data = await resp.json();

  if (!resp.ok || !data.ok) {
    throw new Error(data?.message || "No se pudo guardar el preset.");
  }

  await loadPresets();
  if (data.preset?.id) {
    await loadPresetDetail(data.preset.id);
  }

  setStatus("✅ Preset guardado correctamente.", "ok");
  elResult.classList.remove("hidden");
  elResult.textContent =
    `Tipo: ${data.kind}\n` +
    `Modo: ${data.mode}\n` +
    `ID: ${data.preset?.id || ""}\n` +
    `Archivo: ${data.presetFile}\n` +
    `Carpeta pública: ${data.publicFolder}`;
}

async function deleteCurrentPreset() {
  if (!state.existingId) {
    throw new Error("No hay un preset existente seleccionado para eliminar.");
  }

  const ok = window.confirm(
    `¿Seguro que deseas eliminar completamente el preset "${state.existingId}"?\n\n` +
      `Se borrará su archivo TS, su carpeta pública y saldrá del index.`
  );

  if (!ok) return;

  setStatus("Eliminando preset...", null);

  const resp = await fetch(
    `/api/presets/${encodeURIComponent(state.kind)}/${encodeURIComponent(state.existingId)}`,
    { method: "DELETE" }
  );

  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data?.message || "No se pudo eliminar el preset.");
  }

  await loadPresets();
  resetEditor();
  setStatus("✅ Preset eliminado.", "ok");
}

document.querySelectorAll('input[name="kind"]').forEach((el) => {
  el.addEventListener("change", async () => {
    state.kind = getKind();
    resetEditor();
    await loadPresets();
  });
});

elSearch.addEventListener("input", () => {
  state.filter = elSearch.value;
  renderPresetList();
});

document.getElementById("newPreset").addEventListener("click", () => {
  resetEditor();
  state.kind = getKind();
  refreshPaths();
  setStatus("Creando preset nuevo.", null);
});

elName.addEventListener("input", () => {
  state.name = elName.value;
  if (!state.existingId || !elId.dataset.touched || !elId.value.trim()) {
    const auto = slugFromName(state.name);
    state.id = auto;
    elId.value = auto;
  }
  refreshPaths();
});

elId.addEventListener("input", () => {
  elId.dataset.touched = "1";
  state.id = elId.value.trim();
  refreshPaths();
});

elPrompt.addEventListener("input", () => {
  state.prompt = elPrompt.value;
});

elCover.addEventListener("change", () => {
  const file = elCover.files?.[0] || null;
  state.cover = {
    file,
    url: file ? makeObjectUrl(file) : state.cover.url,
    cleared: !file ? state.cover.cleared : false,
  };
  refreshEditor();
});

document.getElementById("clearCover").addEventListener("click", () => {
  state.cover = { file: null, url: "", cleared: true };
  elCover.value = "";
  refreshEditor();
});

elReferenceGrid.addEventListener("change", () => {
  const file = elReferenceGrid.files?.[0] || null;
  state.referenceGrid = {
    file,
    url: file ? makeObjectUrl(file) : state.referenceGrid.url,
    cleared: !file ? state.referenceGrid.cleared : false,
  };
  refreshEditor();
});

document.getElementById("clearReferenceGrid").addEventListener("click", () => {
  state.referenceGrid = { file: null, url: "", cleared: true };
  elReferenceGrid.value = "";
  refreshEditor();
});

exampleInputs.forEach((input, idx) => {
  input.addEventListener("change", () => {
    const file = input.files?.[0] || null;
    state.examples[idx] = {
      file,
      url: file ? makeObjectUrl(file) : state.examples[idx].url,
      cleared: !file ? state.examples[idx].cleared : false,
    };
    refreshEditor();
  });
});

document.querySelectorAll(".clear-example").forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = Number(btn.getAttribute("data-clear-example")) - 1;
    if (idx < 0 || idx > 3) return;
    state.examples[idx] = { file: null, url: "", cleared: true };
    exampleInputs[idx].value = "";
    refreshEditor();
  });
});

document.getElementById("generateGrid").addEventListener("click", async () => {
  try {
    setStatus("Generando grid 2x2...", null);
    await generateReferenceGridFromExamples();
    setStatus("✅ Grid 2x2 generado. Ahora guarda el preset.", "ok");
  } catch (err) {
    setStatus(err?.message || String(err), "error");
  }
});

document.getElementById("savePreset").addEventListener("click", async () => {
  try {
    await savePreset();
  } catch (err) {
    setStatus(err?.message || String(err), "error");
  }
});

document.getElementById("deletePreset").addEventListener("click", async () => {
  try {
    await deleteCurrentPreset();
  } catch (err) {
    setStatus(err?.message || String(err), "error");
  }
});

elPresetList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-preset-id]");
  if (!btn) return;

  const presetId = btn.getAttribute("data-preset-id");
  if (!presetId) return;

  try {
    setStatus("Abriendo preset...", null);
    await loadPresetDetail(presetId);
    renderPresetList();
    setStatus("Listo.", "ok");
  } catch (err) {
    setStatus(err?.message || String(err), "error");
  }
});

(async function init() {
  try {
    state.kind = getKind();
    resetEditor();
    await loadPresets();
  } catch (err) {
    setStatus(err?.message || String(err), "error");
  }
})();