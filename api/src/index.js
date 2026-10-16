import { STATION_MODELS_HTML, STATION_MODELS_CSS, STATION_MODELS_JS } from "./station-models-assets.js";
import { stationModelsApi } from "./station-models-api.js";
import { STATION_DIRECTORY_HTML, STATION_DIRECTORY_CSS, STATION_DIRECTORY_JS } from "./station-directory-assets.js";
import { stationDirectoryApi } from "./station-directory-api.js";
import { STATION_IMPORT_COMMIT_JS } from "./station-import-commit-assets.js";
import { stationImportWriteApi } from "./station-import-write-api.js";
import { STATION_IMPORT_HTML, STATION_IMPORT_CSS, STATION_IMPORT_JS } from "./station-import-assets.js";
import { stationImportApi } from "./station-import-api.js";
import { stationCompareApi } from "./station-compare-api.js";
import { ORG_DIRECTORY_HTML, ORG_DIRECTORY_JS } from "./org-directory-assets.js";
import { ORG_IMPORT_HTML, ORG_IMPORT_CSS, ORG_IMPORT_JS } from "./org-import-assets.js";
import { orgApi } from "./org-directories.js";
import { DIRECTORY_CATALOG_HTML, DIRECTORY_CATALOG_JS } from "./directory-catalog-assets.js";
import { DIRECTORY_EDIT_JS } from "./directory-edit-assets.js";
import { DIRECTORY_VIEW_HTML, DIRECTORY_VIEW_JS } from "./directory-view-assets.js";
import { DIRECTORY_IMPORT_HTML, DIRECTORY_IMPORT_CSS, DIRECTORY_IMPORT_JS } from "./directory-import-assets.js";
import { directoryApi } from "./directories.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { APP_HTML, APP_CSS, APP_JS } from "./app-assets.js";
import { IMPORT_JS, IMPORT_CSS } from "./import-demo.js";

const MAX_JSON_BYTES = 65_536;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; connect-src 'self'",
};

const now = () => new Date().toISOString();
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const error = (status, message) => reply({ error: message }, status);
const validEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
const str = (v, max) => typeof v === "string" ? v.trim().slice(0, max + 1) : "";
const uuid = () => crypto.randomUUID();

async function parseBody(req) {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new Error("Потрібен Content-Type: application/json");
  }
  if (Number(req.headers.get("content-length") || 0) > MAX_JSON_BYTES) throw new Error("Завеликий запит");
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_JSON_BYTES) throw new Error("Завеликий запит");
  const value = JSON.parse(body);
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Очікується JSON-об'єкт");
  return value;
}

async function identity(req, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").replace(/\/+$/, "");
  const audience = String(env.ACCESS_AUD || "");
  if (!team.startsWith("https://") || !audience || !env.DB) return { err: error(503, "Сервер не налаштований") };
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { err: error(401, "Потрібна авторизація Cloudflare Access") };
  let claims;
  try {
    const jwks = createRemoteJWKSet(new URL(team + "/cdn-cgi/access/certs"));
    const result = await jwtVerify(token, jwks, { issuer: team, audience });
    claims = result.payload;
  } catch {
    return { err: error(401, "Неправильний токен доступу") };
  }
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return { err: error(403, "Відсутня підтверджена адреса користувача") };
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!validEmail(adminEmail)) return { err: error(503, "Адміністратор не налаштований") };
  if (email === adminEmail) {
    const at = now();
    await env.DB.prepare(
      "INSERT INTO users (id,email,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING"
    ).bind(uuid(), email, "admin", 1, at, at).run();
  }
  const user = await env.DB.prepare("SELECT id,email,role,active FROM users WHERE email=?").bind(email).first();
  if (!user || user.active !== 1) return { err: error(403, "Обліковий запис не дозволений") };
  return { user };
}

function mustBeAdmin(user) { return user.role === "admin"; }

function validRecord(body) {
  const source_name = str(body.source_name, 160);
  const external_code = str(body.external_code, 80);
  const category = str(body.category, 120);
  const note = body.note == null ? "" : str(body.note, 2000);
  const event_at = body.event_at == null || body.event_at === "" ? null : String(body.event_at);
  if (!source_name || source_name.length > 160 ||
      !external_code || external_code.length > 80 ||
      !category || category.length > 120 || note.length > 2000) {
    throw new Error("Невірні назва джерела, код, категорія або примітка");
  }
  if (event_at && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(event_at) ||
    Number.isNaN(Date.parse(event_at)))) throw new Error("event_at має бути UTC ISO 8601 із Z");
  return { source_name, external_code, category, note, event_at };
}

async function recordsApi(req, env, user, segments) {
  const method = req.method;
  if (segments.length === 2 && method === "GET") {
    const params = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.get("limit") || "50", 10) || 50));
    const offset = Math.max(0, Math.min(10000, Number.parseInt(params.get("offset") || "0", 10) || 0));
    const result = await env.DB.prepare(
      "SELECT id,source_name,external_code,category,note,event_at,version,created_at,updated_at FROM records WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    ).bind(limit, offset).all();
    return reply({ items: result.results, limit, offset });
  }
  if (segments.length === 2 && method === "POST") {
    const body = validRecord(await parseBody(req)), id = uuid(), at = now();
    await env.DB.prepare(
      "INSERT INTO records (id,source_name,external_code,category,note,event_at,version,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)"
    ).bind(id, body.source_name, body.external_code, body.category, body.note, body.event_at, user.id, user.id, at, at).run();
    return reply({ id, version: 1 }, 201);
  }
  const id = segments[2];
  if (!id || segments.length !== 3) return error(404, "Невідомий маршрут");
  if (method === "PATCH") {
    const body = await parseBody(req);
    if (!Number.isInteger(body.version) || body.version < 1) return error(400, "Потрібна версія запису");
    const clean = validRecord(body), at = now();
    const result = await env.DB.prepare(
      "UPDATE records SET source_name=?,external_code=?,category=?,note=?,event_at=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL"
    ).bind(clean.source_name,clean.external_code,clean.category,clean.note,clean.event_at,user.id,at,id,body.version).run();
    if (!result.meta.changes) return error(409, "Запис уже змінений або видалений");
    return reply({ id, version: body.version + 1 });
  }
  if (method === "DELETE") {
    const body = await parseBody(req);
    if (!Number.isInteger(body.version) || body.version < 1) return error(400, "Потрібна версія запису");
    const reason = str(body.reason, 400);
    if (!reason || reason.length > 400) return error(400, "Потрібна причина видалення");
    const at = now();
    const result = await env.DB.prepare(
      "UPDATE records SET deleted_at=?,deletion_reason=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL"
    ).bind(at,reason,user.id,at,id,body.version).run();
    if (!result.meta.changes) return error(409, "Запис уже змінений або видалений");
    return reply({ id, deleted: true });
  }
  return error(405, "Непідтримувана дія");
}

async function referencesApi(req, env, user, seg) {
  if (seg.length === 2 && req.method === "GET") {
    const kind = new URL(req.url).searchParams.get("kind");
    const statement = kind
      ? env.DB.prepare("SELECT id,kind,name,version,created_at,updated_at FROM references_catalog WHERE kind=? AND archived_at IS NULL ORDER BY name LIMIT 200").bind(kind)
      : env.DB.prepare("SELECT id,kind,name,version,created_at,updated_at FROM references_catalog WHERE archived_at IS NULL ORDER BY kind,name LIMIT 200");
    const data = await statement.all();
    return reply({ items: data.results });
  }
  if (seg.length === 2 && req.method === "POST") {
    const body = await parseBody(req), kind = str(body.kind, 60), name = str(body.name, 160);
    if (!kind || !name || kind.length > 60 || name.length > 160) return error(400, "Невірна назва довідника");
    const id = uuid(), at = now();
    await env.DB.prepare("INSERT INTO references_catalog(id,kind,name,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id,kind,name,user.id,user.id,at,at).run();
    return reply({id,version:1},201);
  }
  if (seg.length !== 3) return error(404, "Невідомий маршрут");
  const id = seg[2], body = await parseBody(req);
  if (!Number.isInteger(body.version) || body.version < 1) return error(400, "Потрібна версія");
  if (req.method === "PATCH") {
    const name = str(body.name,160);
    if (!name || name.length > 160) return error(400, "Порожня назва");
    const result = await env.DB.prepare(
      "UPDATE references_catalog SET name=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND archived_at IS NULL"
    ).bind(name,user.id,now(),id,body.version).run();
    if (!result.meta.changes) return error(409,"Довідник уже змінено");
    return reply({id,version:body.version+1});
  }
  if (req.method === "DELETE") {
    const at=now(), result=await env.DB.prepare(
      "UPDATE references_catalog SET archived_at=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND archived_at IS NULL"
    ).bind(at,user.id,at,id,body.version).run();
    if (!result.meta.changes) return error(409,"Довідник уже змінено");
    return reply({id,archived:true});
  }
  return error(405,"Непідтримувана дія");
}

async function usersApi(req, env, user) {
  if (!mustBeAdmin(user)) return error(403, "Лише адміністратор");
  if (req.method === "GET") {
    const data = await env.DB.prepare("SELECT id,email,role,active,created_at,updated_at FROM users ORDER BY created_at DESC LIMIT 200").all();
    return reply({ items: data.results });
  }
  if (req.method === "POST") {
    const body=await parseBody(req), email=str(body.email,254).toLowerCase();
    if (!validEmail(email) || !["duty","admin"].includes(body.role)) return error(400,"Невірні email або роль");
    const at=now(), id=uuid();
    await env.DB.prepare("INSERT INTO users(id,email,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id,email,body.role,1,at,at).run();
    return reply({id,email,role:body.role},201);
  }
  return error(405,"Непідтримувана дія");
}

async function filesApi(req, env, user, seg) {
  if (!env.DOCUMENTS) return error(503, "Приватне сховище не підключене");
  if (seg.length === 2 && req.method === "GET") {
    const result=await env.DB.prepare("SELECT id,original_name,mime_type,byte_size,sha256,uploaded_at FROM source_files ORDER BY uploaded_at DESC LIMIT 100").all();
    return reply({items:result.results});
  }
  if (seg.length === 2 && req.method === "POST") {
    if (env.FILE_UPLOAD_ENABLED !== "true") return error(403,"Завантаження вимкнене до перевірки середовища");
    const length=Number(req.headers.get("content-length")||0);
    if (length>MAX_FILE_BYTES+1024*1024) return error(413,"Завеликий файл");
    const form=await req.formData(),file=form.get("file");
    if (!(file instanceof File)) return error(400,"Потрібне поле file");
    const name=str(file.name,220);
    if (!name || name.length>220 || file.size>MAX_FILE_BYTES || file.size<8) return error(400,"Невірне ім'я або розмір файла");
    const ext=name.split(".").pop()?.toLowerCase(),buf=await file.arrayBuffer(),bytes=new Uint8Array(buf);
    const zipped=bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04;
    const oldDoc=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((n,i)=>bytes[i]===n);
    if (!((["docx","xlsx"].includes(ext)&&zipped)||(ext==="doc"&&oldDoc))) return error(415,"Формат не відповідає розширенню");
    const mime=ext==="doc"?"application/msword":ext==="docx"?
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const hashBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",buf));
    const hash=Array.from(hashBytes).map(b=>b.toString(16).padStart(2,"0")).join("");
    const id=uuid(),key="originals/"+id,at=now();
    await env.DOCUMENTS.put(key,buf,{httpMetadata:{contentType:mime}});
    try {
      await env.DB.prepare("INSERT INTO source_files(id,object_key,original_name,mime_type,byte_size,sha256,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id,key,name,mime,bytes.length,hash,user.id,at).run();
    } catch (e) {
      await env.DOCUMENTS.delete(key).catch(()=>{});
      throw e;
    }
    return reply({id,original_name:name,byte_size:bytes.length,sha256:hash,status:"stored_unparsed"},201);
  }
  if (seg.length===4&&seg[3]==="download"&&req.method==="GET") {
    const item=await env.DB.prepare("SELECT object_key,original_name,mime_type FROM source_files WHERE id=?").bind(seg[2]).first();
    if(!item)return error(404,"Файл не знайдено");
    const object=await env.DOCUMENTS.get(item.object_key);
    if(!object)return error(404,"Об'єкт не знайдено");
    const safe=encodeURIComponent(item.original_name);
    return new Response(object.body,{headers:{
      "content-type":"application/octet-stream","content-disposition":"attachment; filename*=UTF-8''"+safe,
      "cache-control":"private, no-store","x-content-type-options":"nosniff",
      "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'"
    }});
  }
  return error(404,"Невідомий маршрут");
}


// Isolated same-origin diagnostics. Access JWT is verified before these routes.
const TEST_HTML = "<!doctype html>\n<html lang=\"uk\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\">\n<title>ANALISE — перевірка API</title>\n<link rel=\"stylesheet\" href=\"/api/test.css\">\n<script src=\"/api/test.js\" defer></script>\n</head>\n<body>\n<main class=\"shell\">\n<p class=\"eyebrow\">ANALISE / ACCESS-PROTECTED DIAGNOSTICS</p>\n<h1>Тестування бази D1 · контрольна збірка</h1>\n<p class=\"intro\">Це окремий діагностичний екран для адміністратора. Записи — тільки штучні. Він не є основним інтерфейсом і не дозволяє завантажувати документи.</p>\n<div class=\"grid\">\n<article><span>Авторизація</span><strong id=\"identity\">Перевіряємо…</strong></article>\n<article><span>Підключення</span><strong id=\"health\">Перевіряємо…</strong></article>\n<article><span>Записів у вибірці</span><strong id=\"count\">—</strong></article>\n</div>\n<div class=\"actions\">\n<button id=\"read\" type=\"button\">Оновити журнал</button>\n<button id=\"create\" type=\"button\" class=\"primary\">+ Створити тестовий запис</button>\n</div>\n<p id=\"notice\" role=\"status\" aria-live=\"polite\">Підключення до захищеного API…</p>\n<h2>Результат запиту</h2>\n<pre id=\"result\">Очікуємо відповідь…</pre>\n<p class=\"foot\">Завантаження документів залишається вимкненим. Після створення запису можна оновити сторінку: запис зберігається у D1.</p>\n</main>\n</body>\n</html>";
const TEST_JS = "'use strict';\nconst $ = (id) => document.getElementById(id);\nconst show = (data) => { $('result').textContent = JSON.stringify(data, null, 2); };\nasync function request(url, options) {\n  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });\n  const body = await response.json();\n  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (body.error || JSON.stringify(body)));\n  return body;\n}\nasync function load() {\n  $('notice').textContent = 'Читаємо журнал…';\n  try {\n    const data = await request('/api/records');\n    $('count').textContent = String(data.items.length);\n    $('notice').textContent = 'Завантажено ' + data.items.length + ' тестових записів (у поточній вибірці).';\n    show(data);\n  } catch (error) {\n    $('notice').textContent = 'Помилка читання: ' + error.message;\n    show({ error: error.message });\n  }\n}\nasync function create() {\n  $('create').disabled = true;\n  $('notice').textContent = 'Створюємо синтетичний запис…';\n  try {\n    const data = await request('/api/records', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        source_name: 'ANALISE TEST UI',\n        external_code: 'DEMO-' + Date.now() + '-' + crypto.randomUUID().slice(0, 6),\n        category: 'Навчальна подія',\n        note: 'Штучний запис, створений захищеною тестовою сторінкою',\n        event_at: new Date().toISOString()\n      })\n    });\n    $('notice').textContent = 'Успіх: HTTP 201. Запис збережено у D1.';\n    show(data);\n    await load();\n  } catch (error) {\n    $('notice').textContent = 'Помилка запису: ' + error.message;\n    show({ error: error.message });\n  } finally {\n    $('create').disabled = false;\n  }\n}\nasync function init() {\n  try {\n    const [me, health] = await Promise.all([request('/api/me'), request('/api/health')]);\n    $('identity').textContent = me.role === 'admin' ? 'Адміністратор' : 'Невідома роль';\n    $('health').textContent = health.ok && health.database ? 'D1 доступна' : 'Перевірити';\n  } catch (error) {\n    $('notice').textContent = 'Авторизація або підключення: ' + error.message;\n  }\n  await load();\n}\n$('read').addEventListener('click', load);\n$('create').addEventListener('click', create);\ninit();";
const TEST_CSS = ":root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#071524;color:#e7f3fd}\n*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#163b46 0,transparent 50%),#071524}\n.shell{max-width:980px;margin:auto;padding:60px 24px}.eyebrow{color:#64e1ce;font-size:12px;font-weight:800;letter-spacing:.13em}\nh1{font-size:clamp(27px,5vw,43px);margin:8px 0}h2{margin-top:34px;font-size:18px}.intro,.foot{color:#b8cce1;line-height:1.6;max-width:760px}\n.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:30px 0}\narticle{background:#11253a;border:1px solid #24475a;border-radius:14px;padding:18px;min-height:110px;display:flex;flex-direction:column;gap:20px}\narticle span{color:#9cb9ca;font-size:13px}article strong{color:#6fe9d2;font-size:18px}\n.actions{display:flex;gap:12px;flex-wrap:wrap}button{border:1px solid #355f72;background:#153348;color:#e7f3fd;padding:13px 20px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}\nbutton.primary{background:#60e1cd;border-color:#60e1cd;color:#092735}button:disabled{opacity:.55;cursor:wait}\n#notice{padding:13px 16px;border:1px solid #355f72;border-radius:10px;margin-top:24px;min-height:48px;color:#ccedec}\npre{background:#050f1a;border:1px solid #24475a;border-radius:14px;padding:20px;max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#b6dcfe;line-height:1.55}\n@media(max-width:630px){.shell{padding:32px 16px}.grid{grid-template-columns:1fr}article{min-height:80px;gap:8px}.actions{flex-direction:column}button{width:100%}}";
const TEST_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function testAsset(body, contentType, csp) {
  return new Response(body, { headers: {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": csp
  }});
}


const APP_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function appAsset(body, contentType) {
  return new Response(body, { status:200, headers:{
    "content-type":contentType,
    "cache-control":"no-store, private",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer",
    "x-frame-options":"DENY",
    "content-security-policy":APP_CSP
  }});
}

export default {
  async fetch(req, env) {
    const url=new URL(req.url),seg=url.pathname.split("/").filter(Boolean);
    if (seg[0]!=="api") return error(404,"Не знайдено");
    // Browsers must use same-origin for mutations; no permissive CORS or credentials.
    if (!["GET","HEAD"].includes(req.method)) {
      const origin=req.headers.get("origin");
      if (origin && origin!==url.origin) return error(403,"Інший origin заборонений");
    }
    try {
      const auth=await identity(req,env);
      if(auth.err)return auth.err;
      const user=auth.user;
      // Private working interface: HTML, CSS and JS are all Access-protected.
      if (["/api/app","/api/app.css","/api/app.js","/api/import.js","/api/import.css"].includes(url.pathname)) {
        if (req.method !== "GET") return error(405, "Дозволено лише GET");
        if (url.pathname === "/api/app") return appAsset(APP_HTML, "text/html; charset=utf-8");
        if (url.pathname === "/api/app.css") return appAsset(APP_CSS, "text/css; charset=utf-8");
        if(url.pathname==="/api/import.js")return appAsset(IMPORT_JS,"text/javascript; charset=utf-8");
        if(url.pathname==="/api/import.css")return appAsset(IMPORT_CSS,"text/css; charset=utf-8");
        return appAsset(APP_JS, "text/javascript; charset=utf-8");
      }
      if (["/api/station-models","/api/station-models.js","/api/station-models.css"].includes(url.pathname)) {
        if(req.method!=="GET")return error(405,"Дозволено лише GET");
        if(user.role!=="admin")return error(403,"Лише адміністратор");
        if(url.pathname==="/api/station-models")return appAsset(STATION_MODELS_HTML,"text/html; charset=utf-8");
        if(url.pathname==="/api/station-models.js")return appAsset(STATION_MODELS_JS,"text/javascript; charset=utf-8");
        return appAsset(STATION_MODELS_CSS,"text/css; charset=utf-8");
      }
      if (["/api/station-directory","/api/station-directory.js","/api/station-directory.css"].includes(url.pathname)) {
        if(req.method!=="GET")return error(405,"Дозволено лише GET");
        if(user.role!=="admin")return error(403,"Лише адміністратор");
        if(url.pathname==="/api/station-directory")return appAsset(STATION_DIRECTORY_HTML,"text/html; charset=utf-8");
        if(url.pathname==="/api/station-directory.js")return appAsset(STATION_DIRECTORY_JS,"text/javascript; charset=utf-8");
        return appAsset(STATION_DIRECTORY_CSS,"text/css; charset=utf-8");
      }
      if (url.pathname === "/api/station-compare") return stationCompareApi(req, env, user);
      if (["/api/station-import","/api/station-import.js","/api/station-import.css","/api/station-import-commit.js"].includes(url.pathname)) {
        if(req.method!=="GET")return error(405,"Дозволено лише GET");
        if(user.role!=="admin")return error(403,"Лише адміністратор");
        if(url.pathname==="/api/station-import")return appAsset(STATION_IMPORT_HTML,"text/html; charset=utf-8");
        if(url.pathname==="/api/station-import.js")return appAsset(STATION_IMPORT_JS,"text/javascript; charset=utf-8");
        if(url.pathname==="/api/station-import-commit.js")return appAsset(STATION_IMPORT_COMMIT_JS,"text/javascript; charset=utf-8");
        return appAsset(STATION_IMPORT_CSS,"text/css; charset=utf-8");
      }
      if (url.pathname === "/api/org-directory" || url.pathname === "/api/org-directory.js") {
        if (req.method !== "GET") return error(405, "Дозволено лише GET");
        if (user.role !== "admin") return error(403, "Лише адміністратор");
        return appAsset(url.pathname.endsWith(".js") ? ORG_DIRECTORY_JS : ORG_DIRECTORY_HTML, url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
      }
      if (["/api/org-import","/api/org-import.js","/api/org-import.css"].includes(url.pathname)) {
        if(req.method!=="GET")return error(405,"Дозволено лише GET");
        if(user.role!=="admin")return error(403,"Лише адміністратор");
        if(url.pathname==="/api/org-import")return appAsset(ORG_IMPORT_HTML,"text/html; charset=utf-8");
        if(url.pathname==="/api/org-import.js")return appAsset(ORG_IMPORT_JS,"text/javascript; charset=utf-8");
        return appAsset(ORG_IMPORT_CSS,"text/css; charset=utf-8");
      }
      if (url.pathname === "/api/directory-catalog" || url.pathname === "/api/directory-catalog.js") {
        if(req.method!=="GET")return error(405,"Дозволено лише GET");
        return appAsset(url.pathname.endsWith(".js")?DIRECTORY_CATALOG_JS:DIRECTORY_CATALOG_HTML,url.pathname.endsWith(".js")?"text/javascript; charset=utf-8":"text/html; charset=utf-8");
      }
      if (url.pathname === "/api/directory-edit.js" && req.method === "GET") return appAsset(DIRECTORY_EDIT_JS,"text/javascript; charset=utf-8");
      if (url.pathname === "/api/directory-view" || url.pathname === "/api/directory-view.js") {
        if (req.method !== "GET") return error(405,"Дозволено лише GET");
        return appAsset(url.pathname.endsWith(".js") ? DIRECTORY_VIEW_JS : DIRECTORY_VIEW_HTML,
          url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
      }
      if (["/api/directory-import","/api/directory-import.js","/api/directory-import.css"].includes(url.pathname)) {
        if(req.method!=="GET")return error(405,"Дозволено лише GET");
        if(user.role!=="admin")return error(403,"Лише адміністратор");
        if(url.pathname==="/api/directory-import")return appAsset(DIRECTORY_IMPORT_HTML,"text/html; charset=utf-8");
        if(url.pathname==="/api/directory-import.js")return appAsset(DIRECTORY_IMPORT_JS,"text/javascript; charset=utf-8");
        return appAsset(DIRECTORY_IMPORT_CSS,"text/css; charset=utf-8");
      }
      if (url.pathname === "/api/test" || url.pathname === "/api/test.js" || url.pathname === "/api/test.css") {
        if (req.method !== "GET") return error(405, "Дозволено лише GET");
        if (user.role !== "admin") return error(403, "Тестування доступне лише адміністратору");
        if (url.pathname === "/api/test") return testAsset(TEST_HTML, "text/html; charset=utf-8", TEST_CSP);
        if (url.pathname === "/api/test.js") return testAsset(TEST_JS, "text/javascript; charset=utf-8", "default-src 'none'");
        return testAsset(TEST_CSS, "text/css; charset=utf-8", "default-src 'none'");
      }
      if(url.pathname==="/api/me"&&req.method==="GET")return reply({id:user.id,email:user.email,role:user.role});
      if(url.pathname==="/api/health"&&req.method==="GET"){
        await env.DB.prepare("SELECT 1 AS ok").first();
        return reply({ok:true,database:true,private_files:!!env.DOCUMENTS,files_enabled:env.FILE_UPLOAD_ENABLED==="true"});
      }
      if(seg[1]==="station-models")return await stationModelsApi(req,env,user,seg);
      if(seg[1]==="station-directory")return await stationDirectoryApi(req,env,user,seg);
      if(seg[1]==="station-import"){
        if(seg[2]==="preview")return await stationImportApi(req,user,seg);
        return await stationImportWriteApi(req,env,user,seg);
      }
      if(seg[1]==="org-directories")return await orgApi(req,env,user,seg);
      if(seg[1]==="directories")return await directoryApi(req,env,user,seg);
      if(seg[1]==="records")return await recordsApi(req,env,user,seg);
      if(seg[1]==="references")return await referencesApi(req,env,user,seg);
      if(seg[1]==="users"&&seg.length===2)return await usersApi(req,env,user);
      if(seg[1]==="files")return await filesApi(req,env,user,seg);
      if(seg[1]==="audit"&&seg.length===3&&req.method==="GET"){
        const rec=await env.DB.prepare("SELECT id FROM records WHERE id=?").bind(seg[2]).first();
        if(!rec)return error(404,"Запис не знайдено");
        const result=await env.DB.prepare("SELECT action,actor_id,before_json,after_json,at FROM record_audit WHERE record_id=? ORDER BY id DESC LIMIT 100").bind(seg[2]).all();
        return reply({items:result.results});
      }
      return error(404,"Невідомий маршрут");
    } catch(e) {
      // Never expose SQL, tokens, uploaded document content or stack traces.
      const msg=String(e?.message||"");
      if(e instanceof SyntaxError || msg==="Завеликий запит" || msg.startsWith("Потрібен Content-Type") || msg.startsWith("Очікується JSON") || msg.startsWith("Невірні") || msg.startsWith("event_at"))return error(400,"Некоректний запит: "+msg);
      if(/UNIQUE constraint failed/.test(msg))return error(409,"Такий запис уже існує");
      return error(500,"Внутрішня помилка сервера");
    }
  }
};
