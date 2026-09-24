const DEMO = {
  name: "Coastal Bend AI Campus",
  acres: 280,
  target_mw: 180,
  lat: 27.8621,
  lon: -97.3184,
  flood_zone: "X",
  available_mw_at_poii: 220,
  poii_distance_mi: 2.1,
  fiber_distance_mi: 4.4,
  water_mgy_available: 520,
  dry_cooling: false,
  pue: 1.22,
  setback_ft: 120,
  zoning_ok: true,
  noise_db_at_boundary: 57,
  jurisdiction: "Nueces County, TX (ERCOT)",
};

const SHEETS = [
  ["G-001", "Cover and index"],
  ["G-101", "Basis of design"],
  ["C-101", "Site plan"],
  ["A-101", "Typical IT hall"],
  ["E-101", "One-line"],
  ["P-101", "Process water"],
  ["SE-101", "Rings and SOC"],
  ["CD-001", "Schematic transmittal"],
];

function esc(value) {
  const amp = String.fromCharCode(38);
  return String(value)
    .replaceAll(amp, amp + "amp;")
    .replaceAll("<", amp + "lt;")
    .replaceAll(">", amp + "gt;")
    .replaceAll('"', amp + "quot;");
}

let site = { ...DEMO };
let view = "score";
let sheet = 0;
let timer = null;

function evaluate(s) {
  const hallSf = (s.target_mw * 1e6) / 150;
  const hallAc = hallSf / 43560;
  let coolAc = hallAc * 0.35 * (s.dry_cooling ? 1.35 : 1);
  const subAc = 2.4 * (s.target_mw / 100);
  const yardAc = 1.1 * (s.target_mw / 100);
  const staff = 45 * (s.target_mw / 100);
  const parkAc = 0.8 * (staff / 100);
  const usable = s.acres * (1 - Math.min(0.22, 0.04 + (s.setback_ft / 100) * 0.04));
  const program = hallAc + coolAc + subAc + yardAc + parkAc;
  const residual = usable - program;
  const water = s.dry_cooling ? 0 : (0.4 * s.target_mw * 8760 * 1000 * 0.264172) / 1e6;
  const checks = [];
  const add = (id, label, status, value, detail) => checks.push({ id, label, status, value, detail });
  if (residual >= 20) add("land", "Parcel fit", "pass", residual.toFixed(0) + " ac residual", "Program fits with reserve.");
  else if (residual >= 0) add("land", "Parcel fit", "warn", residual.toFixed(0) + " ac residual", "Fits, no expansion pad.");
  else add("land", "Parcel fit", "fail", residual.toFixed(0) + " ac residual", "Program overflows the parcel.");
  const head = s.available_mw_at_poii - s.target_mw;
  if (head >= 25) add("power", "POI injection", "pass", head.toFixed(0) + " MW headroom", "Covers target plus contingency.");
  else if (head >= 0) add("power", "POI injection", "warn", head.toFixed(0) + " MW headroom", "At the POI limit.");
  else add("power", "POI injection", "fail", head.toFixed(0) + " MW short", "Need a new tap or a lower load.");
  if (s.water_mgy_available >= water * 1.15 || s.dry_cooling) add("water", "Water", "pass", water.toFixed(0) + " MGY", s.dry_cooling ? "Dry coolers." : "Supply covers the load.");
  else if (s.water_mgy_available >= water) add("water", "Water", "warn", water.toFixed(0) + " MGY", "Tight in a drought year.");
  else add("water", "Water", "fail", water.toFixed(0) + " vs " + s.water_mgy_available.toFixed(0), "Need reuse or dry coolers.");
  if (s.target_mw >= 150 && s.target_mw <= 300) add("scope", "v1 MW band", "pass", s.target_mw + " MW", "Inside 150–300 MW IT.");
  else add("scope", "v1 MW band", "warn", s.target_mw + " MW", "Outside the v1 band. Still scored.");
  let score = 100;
  checks.forEach((c) => { if (c.status === "warn") score -= 8; if (c.status === "fail") score -= 18; });
  score = Math.max(0, score);
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  let verdict = "marginal — rethink program or site";
  if (fails) verdict = "not feasible as drawn";
  else if (score >= 80 && warns <= 1) verdict = "feasible";
  else if (score >= 60) verdict = "feasible with mitigations";
  return { site: s, checks, score, verdict, hallSf, residual, program, water, staff, coolAc, subAc };
}

function frame(id, title, inner, feas) {
  return `<svg class="sheet" viewBox="0 0 1100 780" role="img" aria-label="${id} ${title}">
    <rect x="18" y="18" width="1064" height="744" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="44" y="58" font-size="13" fill="currentColor">H.A.C.D. SCHEMATIC — NOT FOR CONSTRUCTION — NOT SEALED</text>
    <text x="44" y="80" font-size="12" fill="currentColor" opacity="0.7">${esc(feas.site.name)}</text>
    ${inner}
    <rect x="700" y="620" width="360" height="118" fill="#12181c" stroke="currentColor"/>
    <text x="714" y="664" font-size="16" fill="currentColor">${id}  ${title}</text>
    <text x="714" y="692" font-size="12" fill="currentColor" opacity="0.75">${feas.site.target_mw} MW · ${feas.site.acres} AC · ${feas.score}/100</text>
  </svg>`;
}

function drawing(feas) {
  const [id, title] = SHEETS[sheet];
  const halls = Math.max(1, Math.ceil(feas.hallSf / 200000));
  let inner = "";
  if (id === "G-001") {
    inner = SHEETS.map((s, i) => `<text x="44" y="${140 + i * 36}" font-size="16" fill="currentColor">${s[0]}    ${s[1]}</text>`).join("");
  } else if (id === "G-101") {
    inner = feas.checks.map((c, i) => `<text x="44" y="${150 + i * 56}" font-size="16" fill="currentColor">${c.status.toUpperCase()}  ${c.label} — ${c.value}</text>`).join("");
  } else if (id === "C-101") {
    inner = `<rect x="70" y="140" width="620" height="420" fill="none" stroke="currentColor" stroke-dasharray="6 4"/>
      <rect x="110" y="200" width="220" height="140" fill="none" stroke="currentColor"/><text x="124" y="250" fill="currentColor">IT HALLS</text>
      <rect x="350" y="200" width="140" height="100" fill="none" stroke="currentColor"/><text x="364" y="246" fill="currentColor">COOLING</text>
      <rect x="510" y="200" width="120" height="90" fill="none" stroke="currentColor"/><text x="522" y="246" fill="currentColor">SUB</text>
      <text x="110" y="400" fill="currentColor">${halls} halls · residual ${feas.residual.toFixed(0)} ac</text>`;
  } else if (id === "A-101") {
    inner = `<text x="44" y="120" fill="currentColor">${halls} halls · core and shell</text>` +
      Array.from({ length: 24 }, (_, i) => `<rect x="${70 + (i % 8) * 70}" y="${160 + Math.floor(i / 8) * 78}" width="58" height="60" fill="none" stroke="currentColor"/>`).join("");
  } else if (id === "E-101") {
    inner = ["POI", "SUBSTATION", "MV GEAR", "UPS", "HALLS"].map((n, i) =>
      `<rect x="${60 + i * 160}" y="240" width="130" height="64" fill="none" stroke="currentColor"/><text x="${72 + i * 160}" y="276" fill="currentColor">${n}</text>`
    ).join("") + `<text x="60" y="180" fill="currentColor">${feas.site.target_mw} MW IT · headroom ${feas.site.available_mw_at_poii - feas.site.target_mw} MW</text>`;
  } else if (id === "P-101") {
    inner = `<text x="44" y="180" font-size="18" fill="currentColor">${feas.water.toFixed(0)} MGY process water</text>
      <text x="44" y="220" fill="currentColor">${feas.site.dry_cooling ? "Dry path" : "Evaporative, WUE 0.40"} · staff ${feas.staff.toFixed(0)}</text>`;
  } else if (id === "SE-101") {
    inner = `<rect x="80" y="140" width="560" height="400" fill="none" stroke="currentColor" stroke-dasharray="5 4"/>
      <rect x="150" y="200" width="420" height="280" fill="none" stroke="currentColor"/>
      <rect x="280" y="300" width="140" height="80" fill="none" stroke="currentColor"/>
      <text x="310" y="346" fill="currentColor">SOC</text>`;
  } else {
    inner = `<text x="44" y="180" font-size="22" fill="currentColor">THIS IS A PLANNING SET</text>
      <text x="44" y="230" fill="currentColor">${feas.verdict} · ${feas.score}/100 · ${SHEETS.length} sheets</text>
      <text x="44" y="280" fill="currentColor">Not a survey, not calculations, not issued for construction.</text>`;
  }
  return frame(id, title, inner, feas);
}

function render() {
  const feas = evaluate(site);
  document.getElementById("campus-title").textContent = site.name;
  document.getElementById("campus-sub").textContent =
    `${site.acres} ac · ${site.target_mw} MW IT · ${site.jurisdiction}. Planning tool — not sealed engineering.`;
  document.getElementById("name").value = site.name;
  document.getElementById("acres").value = site.acres;
  document.getElementById("mw").value = site.target_mw;
  document.getElementById("market").value = site.jurisdiction;
  document.getElementById("dry").checked = site.dry_cooling;
  document.getElementById("tab-score").classList.toggle("on", view === "score");
  document.getElementById("tab-sheets").classList.toggle("on", view === "sheets");
  document.getElementById("score-view").classList.toggle("hidden", view !== "score");
  document.getElementById("sheet-view").classList.toggle("hidden", view !== "sheets");

  document.getElementById("score-view").innerHTML = `
    <article class="card">
      <p class="kicker">Verdict</p>
      <p class="verdict">${feas.verdict}</p>
      <p class="score">${feas.score}/100</p>
      <div class="stats">
        <div><div class="muted">Program</div><strong>${feas.program.toFixed(1)} ac</strong></div>
        <div><div class="muted">Residual</div><strong>${feas.residual.toFixed(1)} ac</strong></div>
        <div><div class="muted">Water</div><strong>${feas.water.toFixed(0)} MGY</strong></div>
        <div><div class="muted">Pin</div><strong>${site.lat.toFixed(2)} N</strong></div>
      </div>
    </article>
    <article class="card">
      <h2>Checks</h2>
      ${feas.checks.map((c) => `<div class="check-row"><div><strong>${c.label}</strong><div class="muted">${c.detail}</div></div><div><span class="pill ${c.status}">${c.status}</span><div>${c.value}</div></div></div>`).join("")}
    </article>`;

  document.getElementById("sheet-view").innerHTML = `
    <article class="card">
      <p class="kicker">Drawing set</p>
      <h2>${SHEETS[sheet][0]} ${SHEETS[sheet][1]}</h2>
      <div class="rail">${SHEETS.map((s, i) => `<button type="button" class="ghost ${i === sheet ? "on" : ""}" data-sheet="${i}">${s[0]}</button>`).join("")}</div>
      ${drawing(feas)}
    </article>`;
  document.querySelectorAll("[data-sheet]").forEach((btn) => {
    btn.onclick = () => { sheet = Number(btn.dataset.sheet); stop(); render(); };
  });
}

function read() {
  site = {
    ...site,
    name: document.getElementById("name").value || site.name,
    acres: Number(document.getElementById("acres").value) || site.acres,
    target_mw: Number(document.getElementById("mw").value) || site.target_mw,
    jurisdiction: document.getElementById("market").value || site.jurisdiction,
    dry_cooling: document.getElementById("dry").checked,
  };
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

document.getElementById("name").oninput = () => { read(); render(); };
document.getElementById("acres").oninput = () => { read(); render(); };
document.getElementById("mw").oninput = () => { read(); render(); };
document.getElementById("market").oninput = () => { read(); render(); };
document.getElementById("dry").onchange = () => { read(); render(); };
document.getElementById("tab-score").onclick = () => { view = "score"; stop(); render(); };
document.getElementById("tab-sheets").onclick = () => { view = "sheets"; stop(); render(); };
document.getElementById("generate").onclick = () => { read(); view = "sheets"; sheet = 0; stop(); render(); };
document.getElementById("run").onclick = () => {
  site = { ...DEMO };
  view = "sheets";
  sheet = 0;
  stop();
  render();
  timer = setInterval(() => { sheet = (sheet + 1) % SHEETS.length; render(); }, 2200);
};

render();
