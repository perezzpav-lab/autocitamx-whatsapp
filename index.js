// ===== AutoCitaMX — index.js (Render, ES Modules, robusto con logs y GET/POST) =====
import express from "express";

const app = express();

// Parsers (Twilio envía x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- LOG de cada request (método, ruta, query, body) ----
app.use((req, _res, next) => {
  try {
    console.log(`[REQ] ${req.method} ${req.path} :: query=`, req.query, ":: body=", req.body);
  } catch {}
  next();
});

// ====== ENV ======
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  BUSINESS_API_SECRET,
  DEFAULT_NEGOCIO_NAME,           // nombre de negocio que usa tu RPC (ej. "spa_roma")
  ENABLE_OUTBOUND = "true",

  // Branding opcional (plantillas)
  BUSINESS_NAME = "Tu Negocio",
  BUSINESS_LOCATION = "Tu dirección o zona",
  BUSINESS_HOURS = "L–S 10:00–20:00",
  BUSINESS_PHONE = "55 0000 0000",
  BUSINESS_BRANCH = "Sucursal Principal",
  BUSINESS_HASHTAG = "tu_negocio",
} = process.env;

// Valida env mínimos
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BUSINESS_API_SECRET) {
  console.warn("⚠️ Falta configurar SUPABASE_URL / SUPABASE_ANON_KEY / BUSINESS_API_SECRET en Render → Environment.");
}

// ====== PLANTILLAS ======
const TEMPLATES = {
  WELCOME: `
🙌 ¡Hola! Soy el asistente de [[NOMBRE_NEGOCIO]].

Puedo ayudarte a:
1) Reservar cita
2) Cambiar o cancelar
3) Ver precios/servicios

✍️ *Escribe:* 
• "reservar 2025-10-31 12:30 [[Tu Nombre]] - [[Servicio]]"
• "cancelar [[ID_DE_CITA]]"
• "ayuda" para ver ejemplos

📍 Sucursal: [[UBICACIÓN_CORTA]]
🕒 Horario: [[HORARIO_RESUMEN]]
📱 Tel: [[TEL_CORTO]]
`.trim(),

  RESERVAR_GUIDE: `
🗓️ *Para reservar*, envía:
reservar AAAA-MM-DD HH:MM TuNombre - Servicio

Ejemplo:
reservar 2025-10-31 12:30 Juan - Corte

👉 Si manejas varias sucursales, agrega su hashtag (opcional):
#[[HASHTAG_NEGOCIO]]
`.trim(),

  CONFIRM: `
✅ *Cita confirmada*
ID: [[ID_CITA]]
👤 [[CLIENTE]]
💇 [[SERVICIO]]
📅 [[FECHA]] [[HORA]]
📍 [[SUCURSAL]]

ℹ️ Si necesitas cambiar o cancelar, escribe:
"cancelar [[ID_CITA]]"
`.trim(),

  CANCEL_OK: `
❌ *Cita cancelada*
ID: [[ID_CITA]]
👤 [[CLIENTE]] — [[SERVICIO]]

¿Deseas agendar otra fecha? Escribe: 
reservar AAAA-MM-DD HH:MM [[CLIENTE]] - [[SERVICIO]]
`.trim(),

  HELP: `
📲 AutoCitaMX:
• reservar YYYY-MM-DD HH:MM Nombre - Servicio
   ej: reservar 2025-11-05 10:00 Juan - Corte
• cancelar ID
   ej: cancelar ACMX-202511051000-ABCD
• negocio opcional: #[[HASHTAG_NEGOCIO]]
`.trim(),
};

// ====== UTIL ======
const twiml = (msg) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`;

function renderTemplate(str, map) {
  return str
    .replaceAll("[[NOMBRE_NEGOCIO]]", map.name || BUSINESS_NAME)
    .replaceAll("[[UBICACIÓN_CORTA]]", map.location || BUSINESS_LOCATION)
    .replaceAll("[[HORARIO_RESUMEN]]", map.hours || BUSINESS_HOURS)
    .replaceAll("[[TEL_CORTO]]", map.phone || BUSINESS_PHONE)
    .replaceAll("[[SUCURSAL]]", map.branch || BUSINESS_BRANCH)
    .replaceAll("[[HASHTAG_NEGOCIO]]", map.hashtag || BUSINESS_HASHTAG)
    .replaceAll("[[ID_CITA]]", map.id || "")
    .replaceAll("[[CLIENTE]]", map.client || "")
    .replaceAll("[[SERVICIO]]", map.service || "")
    .replaceAll("[[FECHA]]", map.date || "")
    .replaceAll("[[HORA]]", map.time || "");
}

function genId() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const ts =
    d.getFullYear() +
    "" +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ACMX-${ts}-${rnd}`;
}

async function rpc(fn, body) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`RPC ${fn} ${res.status}: ${txt}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

// ====== HEALTH ======
app.get("/", (_req, res) => {
  res
    .status(200)
    .send("✅ AutoCitaMX listening — / (GET) OK · /whatsapp (POST/GET) listo · /__echo (debug)");
});

// ====== GET para ver que /whatsapp está vivo (pruebas de navegador) ======
app.get("/whatsapp", (req, res) => {
  res
    .status(200)
    .send("OK /whatsapp — usa POST x-www-form-urlencoded (Twilio) o prueba con curl. También tienes /__echo para debug.");
});

// ====== DEBUG: echo para ver lo que llega ======
app.all("/__echo", (req, res) => {
  res.status(200).json({
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: req.body,
  });
});

// ====== WHATSAPP WEBHOOK (acepta POST de Twilio y GET para pruebas) ======
app.all("/whatsapp", async (req, res) => {
  try {
    // Twilio manda POST x-www-form-urlencoded: Body, From, WaId, ProfileName
    // Para GET de prueba desde navegador, también leemos de querystring
    const isPost = req.method === "POST";
    const src = isPost ? req.body : req.query;

    const rawBody = (src?.Body || "").toString();
    const waid = (src?.WaId || "").toString().trim();
    const profile = (src?.ProfileName || "").toString().trim();

    const body = rawBody.normalize("NFKC").replace(/\s+/g, " ").trim();
    const lower = body.toLowerCase();

    // Detectar negocio por hashtag o usar default
    const mTag = rawBody.match(/#([a-z0-9_\-]+)/i);
    const negocioName =
      mTag?.[1]?.toLowerCase() ||
      DEFAULT_NEGOCIO_NAME ||
      BUSINESS_HASHTAG ||
      "mi_negocio";

    // Si viene vacío, responde vacío (evita loops)
    if (!body) return res.type("text/xml").send(twiml(""));

    // MENÚ
    if (["hola", "menu", "menú"].includes(lower)) {
      const msg = renderTemplate(TEMPLATES.WELCOME, {
        name: BUSINESS_NAME,
        location: BUSINESS_LOCATION,
        hours: BUSINESS_HOURS,
        phone: BUSINESS_PHONE,
        branch: BUSINESS_BRANCH,
        hashtag: BUSINESS_HASHTAG,
      });
      return res.type("text/xml").send(twiml(msg));
    }

    // AYUDA
    if (["ayuda", "help", "?"].includes(lower)) {
      const msg = renderTemplate(TEMPLATES.HELP, { hashtag: negocioName });
      return res.type("text/xml").send(twiml(msg));
    }

    // CANCELAR
    if (lower.startsWith("cancelar")) {
      const id = body.split(" ")[1] || "";
      if (!id)
        return res.type("text/xml").send(twiml("Falta ID. Ej: cancelar ACMX-..."));
      try {
        await rpc("rpc_patch_cita", {
          p_secret: BUSINESS_API_SECRET,
          p_id: id,
          p_fields: { estado: "cancelada" },
        });
        const msg = renderTemplate(TEMPLATES.CANCEL_OK, {
          id,
          client: profile || (waid ? `WA:${waid}` : "Cliente"),
          service: "",
        });
        return res.type("text/xml").send(twiml(msg));
      } catch (e) {
        return res.type("text/xml").send(twiml(`⚠️ No se pudo cancelar: ${String(e).slice(0, 180)}`));
      }
    }

    // RESERVAR (solo palabra)
    if (lower === "reservar") {
      const msg = renderTemplate(TEMPLATES.RESERVAR_GUIDE, { hashtag: negocioName });
      return res.type("text/xml").send(twiml(msg));
    }

    // RESERVAR (con datos)
    if (lower.startsWith("reservar")) {
      // Formato: reservar YYYY-MM-DD HH:MM Nombre - Servicio
      const regex =
        /reservar\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+(.+?)(?:\s*-\s*(.+))?$/i;
      const mm = rawBody.normalize("NFKC").match(regex);
      if (!mm) {
        const msg = renderTemplate(TEMPLATES.RESERVAR_GUIDE, { hashtag: negocioName });
        return res.type("text/xml").send(twiml(msg));
      }

      const fecha = mm[1];
      const hora = mm[2];
      const cliente = (mm[3] || profile || `WA:${waid}`).trim();
      const servicio = (mm[4] || "Servicio").trim();

      const id = genId();
      try {
        await rpc("rpc_upsert_cita", {
          p_secret: BUSINESS_API_SECRET,
          p_id: id,
          p_negocio_id: negocioName, // OBLIGATORIO: nombre del negocio (texto) que coincide con tu tabla
          p_fecha: fecha,
          p_hora: hora,
          p_cliente: cliente,
          p_telefono: waid ? `+52${waid}` : "",
          p_servicio: servicio,
          p_estado: "confirmada",
          p_monto: 0,
          p_forma_pago: "",
          p_calendar_event_id: "",
        });

        const msg = renderTemplate(TEMPLATES.CONFIRM, {
          id,
          client: cliente,
          service: servicio,
          date: fecha,
          time: hora,
          branch: BUSINESS_BRANCH,
        });
        return res.type("text/xml").send(twiml(msg));
      } catch (e) {
        return res.type("text/xml").send(twiml(`⚠️ No se pudo reservar: ${String(e).slice(0, 180)}`));
      }
    }

    // Desconocido → Menú
    const msg = renderTemplate(TEMPLATES.WELCOME, {
      name: BUSINESS_NAME,
      location: BUSINESS_LOCATION,
      hours: BUSINESS_HOURS,
      phone: BUSINESS_PHONE,
      branch: BUSINESS_BRANCH,
      hashtag: BUSINESS_HASHTAG,
    });
    return res.type("text/xml").send(twiml(msg));
  } catch (err) {
    console.error("[ERR] /whatsapp handler:", err);
    return res.type("text/xml").send(twiml(`Error: ${String(err).slice(0, 180)}`));
  }
});

// 404 logger (cualquier ruta no encontrada)
app.use((req, res) => {
  console.warn("[404]", req.method, req.path);
  res.status(404).send("Not found");
});

// START
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("✅ AutoCitaMX listening on port " + port));
