import { createRemoteJWKSet, jwtVerify } from "jose";

const MAX_JSON_BYTES = 65_536;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'",
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
      if(url.pathname==="/api/me"&&req.method==="GET")return reply({id:user.id,email:user.email,role:user.role});
      if(url.pathname==="/api/health"&&req.method==="GET"){
        await env.DB.prepare("SELECT 1 AS ok").first();
        return reply({ok:true,database:true,private_files:!!env.DOCUMENTS,files_enabled:env.FILE_UPLOAD_ENABLED==="true"});
      }
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
