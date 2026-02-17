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

function setStep(n) {
  const steps = [1, 2, 3, 4];
  for (const i of steps) {
    document.getElementById(`step${i}`).classList.toggle("hidden", i !== n);
    document.getElementById(`s${i}`).classList.toggle("active", i === n);
  }
}

const state = {
  kind: "restyle",
  name: "",
  id: "",
  cover: null,
  examples: [],
  prompt: "",
};

const elName = document.getElementById("name");
const elId = document.getElementById("id");
const elCover = document.getElementById("cover");
const elExamples = document.getElementById("examples");
const elPrompt = document.getElementById("prompt");
const elSavePath = document.getElementById("savePath");

const coverInfo = document.getElementById("coverInfo");
const examplesInfo = document.getElementById("examplesInfo");

function refreshSavePath() {
  const kind = state.kind;
  const id = state.id || "preset";
  elSavePath.textContent = `config/presets/${kind}/${id}.ts  +  public/presets/${kind}/${id}/`;
}

function refreshFilesUI() {
  coverInfo.textContent = state.cover ? state.cover.name : "No cargado";
  examplesInfo.textContent = `${state.examples.length} archivo(s): ${state.examples.map(f => f.name).join(", ") || ""}`.trim();
}

function refreshSummary() {
  document.getElementById("sumKind").textContent =
    state.kind === "lightroom" ? "Lighting (Lightroom)" : "Styles (Restyle)";

  document.getElementById("sumName").textContent = state.name || "-";
  document.getElementById("sumId").textContent = state.id || "-";
  document.getElementById("sumCover").textContent = state.cover ? state.cover.name : "-";
  document.getElementById("sumExamples").textContent = state.examples.length ? state.examples.length : "0";
}

document.getElementById("next1").addEventListener("click", () => {
  state.kind = getKind();
  refreshSavePath();
  setStep(2);
});

document.getElementById("back2").addEventListener("click", () => setStep(1));
document.getElementById("back3").addEventListener("click", () => setStep(2));
document.getElementById("back4").addEventListener("click", () => setStep(3));

elName.addEventListener("input", () => {
  state.name = elName.value;
  // autogenera ID si el usuario no lo tocó o está vacío
  if (!elId.dataset.touched || elId.value.trim() === "") {
    const auto = slugFromName(state.name);
    state.id = auto;
    elId.value = auto;
  }
  refreshSavePath();
});

elId.addEventListener("input", () => {
  elId.dataset.touched = "1";
  state.id = elId.value.trim();
  refreshSavePath();
});

elCover.addEventListener("change", () => {
  state.cover = elCover.files && elCover.files[0] ? elCover.files[0] : null;
  refreshFilesUI();
});

elExamples.addEventListener("change", () => {
  const list = elExamples.files ? Array.from(elExamples.files) : [];
  state.examples = list.slice(0, 4);
  refreshFilesUI();
});

document.getElementById("next2").addEventListener("click", () => {
  state.name = elName.value.trim();
  state.id = elId.value.trim();

  if (!state.name) {
    alert("Falta el nombre del preset.");
    return;
  }
  if (!state.id) {
    alert("Falta el ID.");
    return;
  }
  if (!state.cover) {
    alert("Falta el cover (portada).");
    return;
  }

  refreshSavePath();
  setStep(3);
});

document.getElementById("next3").addEventListener("click", () => {
  state.prompt = elPrompt.value.trim();
  if (!state.prompt) {
    alert("Falta el prompt.");
    return;
  }

  refreshSummary();
  setStep(4);
});

document.getElementById("create").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const result = document.getElementById("result");
  result.classList.add("hidden");
  result.textContent = "";
  status.textContent = "Creando preset...";
  status.classList.remove("error", "ok");

  try {
    const fd = new FormData();
    fd.append("kind", state.kind);
    fd.append("name", state.name);
    fd.append("id", state.id);
    fd.append("prompt", state.prompt);

    fd.append("cover", state.cover);
    for (const f of state.examples) fd.append("examples", f);

    const resp = await fetch("/api/create-preset", {
      method: "POST",
      body: fd,
    });

    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      status.textContent = data?.message || "Error desconocido.";
      status.classList.add("error");
      return;
    }

    status.textContent = "✅ Preset creado correctamente.";
    status.classList.add("ok");

    result.classList.remove("hidden");
    result.textContent =
      `Listo.\n\n` +
      `Tipo: ${data.kind}\n` +
      `ID: ${data.presetId}\n\n` +
      `Archivo preset:\n${data.presetFile}\n\n` +
      `Carpeta imágenes:\n${data.publicFolder}\n\n` +
      `Ahora abre tu app y revisa el selector.`;
  } catch (e) {
    status.textContent = e?.message || String(e);
    status.classList.add("error");
  }
});

// inicial
state.kind = getKind();
refreshSavePath();
refreshFilesUI();
setStep(1);
