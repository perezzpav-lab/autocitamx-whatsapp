// ===== AutoCitaMX — index.js (Render, Twilio WhatsApp + Supabase RPCs 'citas') =====
// Node 18+ (fetch nativo). Si usas Node <=16, instala node-fetch y cámbialo.

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: true })); // Twilio envía x-www-form-urlencoded
app.use(bodyParser.json());

// ====== ENV ======
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  BUSINESS_API_SECRET,     // secret por negocio (tabla businesses.api_secret)
  DEFAULT_NEGOCIO_NAME,    // nombre del negocio (texto), ej. "spa_roma"
  ENABLE_OUTBOUND = "true",

  // Opcionales: personalización de plantillas
  BUSINESS_NAME = "Tu Negocio",
  BUSINESS_LOCATION = "Tu dirección o zona",
  BUSINESS_HOURS = "L–S 10:00–20:00",
  BUSINESS_PHONE = "55 0000 0000",
  BUSINESS_BRANCH = "Sucursal Principal",
  BUSINESS_HASHTAG = "tu_negocio",
} = process.env;

// ====== Plantillas con placeholders [[...]] ======
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

  REMINDER_24H: `
⏰ *Recordatorio de tu cita para mañana*
👤 [[CLIENTE]]
💇 [[SERVICIO]]
📅 [[FECHA]] [[HORA]]
📍 [[SUCURSAL]]

Por favor llega 5–10 min antes. 
Responde "reprogramar" si necesitas moverla.
`.trim(),

  REMINDER_3H: `
🔔 *Nos vemos hoy*
👤 [[CLIENTE]]
💇 [[SERVICIO]]
🕒 [[HORA]] — [[SUCURSAL]]

Si no puedes asistir, responde "reprogramar".
`.trim(),

  REPROGRAM: `
🔄 ¡Claro! Para reprogramar tu cita:
• Escribe: reservar AAAA-MM-DD HH:MM [[CLIENTE]] - [[SERVICIO]]
• O dime el rango que prefieres (ej. “mañana después de las 4 pm”).

Te ofrezco opciones si me das día y horario aproximado 😉
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

// ====== Utilidades ======
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

function twiml(msg) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`;
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
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
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

// ====== Health ======
app.get("/", (_, res) => res.status(200).send("OK AutoCitaMX"));

// ====== WhatsApp Webhook ======
app.post("/whatsapp", async (req, res) => {
  try {
    // Twilio envía x-www-form-urlencoded: Body, From, WaId, ProfileName
    const rawBody = (req.body.Body || "").toString();
    const waid = (req.body.WaId || "").toString().trim();          // solo números
    const profile = (req.body.ProfileName || "").toString().trim(); // nombre de contacto

    // Normalización del texto para parseo
    const body = rawBody.normalize("NFKC").replace(/\s+/g, " ").trim();
    const lower = body.toLowerCase();

    // Detectar negocio por hashtag (#mi_negocio) o default
    const mTag = rawBody.match(/#([a-z0-9_\-]+)/i);
    const negocioName = mTag ? mTag[1].toLowerCase() : (DEFAULT_NEGOCIO_NAME || BUSINESS_HASHTAG || "mi_negocio");

    // Mensajes vacíos → no respondas con error (evita loops)
    if (!body) return res.type("text/xml").send(twiml(""));

    // ==== AYUDA / MENÚ ====
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

    if (lower === "ayuda" || lower === "help" || lower === "?") {
      const msg = renderTemplate(TEMPLATES.HELP, { hashtag: negocioName || BUSINESS_HASHTAG });
      return res.type("text/xml").send(twiml(msg));
    }

    // ==== CANCELAR ====
    if (lower.startsWith("cancelar")) {
      const id = body.split(" ")[1] || "";
      if (!id) {
        return res.type("text/xml").send(twiml("Falta ID. Ej: cancelar ACMX-..."));
      }
      try {
        await rpc("rpc_patch_cita", {
          p_secret: BUSINESS_API_SECRET,
          p_id: id,
          p_fields: { estado: "cancelada" },
        });
        const msg = renderTemplate(TEMPLATES.CANCEL_OK, {
          id,
          client: profile || (waid ? `WA:${waid}` : "Cliente"),
          service: "", // opcional
        });
        return res.type("text/xml").send(twiml(msg));
      } catch (e) {
        return res.type("text/xml").send(twiml(`⚠️ No se pudo cancelar: ${String(e).slice(0, 180)}`));
      }
    }

    // ==== RESERVAR ====
    if (lower === "reservar") {
      const msg = renderTemplate(TEMPLATES.RESERVAR_GUIDE, { hashtag: negocioName });
      return res.type("text/xml").send(twiml(msg));
    }

    if (lower.startsWith("reservar")) {
      // Soporta: reservar YYYY-MM-DD HH:MM Nombre - Servicio
      const regex = /reservar\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+(.+?)(?:\s*-\s*(.+))?$/i;
      const mm = rawBody.normalize("NFKC").match(regex);
      if (!mm) {
        const msg = renderTemplate(TEMPLATES.RESERVAR_GUIDE, { hashtag: negocioName });
        return res.type("text/xml").send(twiml(msg));
      }

      const fecha = mm[1];
      const hora = mm[2];
      const nombreCrudo = (mm[3] || "").trim();
      const servicioCrudo = (mm[4] || "").trim();

      const cliente = nombreCrudo || profile || (waid ? `WA:${waid}` : "Cliente");
      const servicio = servicioCrudo || "Servicio";

      const id = genId();
      try {
        // Tu RPC espera p_negocio_id = NOMBRE del negocio (texto)
        await rpc("rpc_upsert_cita", {
          p_secret: BUSINESS_API_SECRET,
          p_id: id,
          p_negocio_id: negocioName,
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

    // ==== REPROGRAMAR ====
    if (lower.startsWith("reprogramar")) {
      const msg = renderTemplate(TEMPLATES.REPROGRAM, {
        client: profile || (waid ? `WA:${waid}` : "Cliente"),
        service: "servicio",
      });
      return res.type("text/xml").send(twiml(msg));
    }

    // ==== Desconocido → menú ====
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
    return res.type("text/xml").send(twiml(`Error: ${String(err).slice(0, 180)}`));
  }
});

// ====== Start ======
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("AutoCitaMX listening on " + port));
