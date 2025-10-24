// index.js (ESM)
import express from "express";
import dotenv from "dotenv";
import Twilio from "twilio";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// === ENV ===
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "";

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// === ESTADO EN MEMORIA (prototipo) ===
const sessions = new Map();

// === HELPERS ===
const pad2 = (n) => n.toString().padStart(2, "0");
const genRef = () => `ACT-${Math.floor(1000 + Math.random() * 9000)}`;

function normalizarFecha(token) {
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
  const dm = /^(\d{1,2})[\/-](\d{1,2})$/;
  if (ymd.test(token)) {
    const [, y, m, d] = token.match(ymd);
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  if (dm.test(token)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const [, d, m] = token.match(dm);
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  return null;
}

function parsear(texto) {
  let rest = (texto || "").trim();
  let hora = null;
  const reHora = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
  const mh = rest.match(reHora);
  if (mh) {
    hora = `${pad2(mh[1])}:${mh[2]}`;
    rest = rest.replace(mh[0], " ").trim();
  }
  let fecha = null;
  const tokens = rest.split(/\s+/);
  for (const t of tokens) {
    const f = normalizarFecha(t);
    if (f) {
      fecha = f;
      rest = rest.replace(t, " ").trim();
      break;
    }
  }
  let precio = null;
  const rePrecio = /(?:\$?\s*)(\d+(?:[.,]\d{1,2})?)(?!\S)/g;
  let m, last = null;
  while ((m = rePrecio.exec(rest)) !== null) last = m[1];
  if (last) {
    precio = parseFloat(last.replace(",", "."));
    rest = rest.replace(new RegExp(`${last}\\b`), " ").trim();
  }
  let servicio = rest.replace(/\s{2,}/g, " ").trim() || "Pendiente";
  if (!fecha) {
    const now = new Date();
    fecha = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }
  if (!hora) hora = "12:00";
  if (precio == null || Number.isNaN(precio)) precio = 0;
  return { servicio, fecha, hora, precio };
}

// === SUPABASE ===
const SUPABASE_URL = "https://qffstwhizihtexfompwe.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnN0d2hpemlodGV4Zm9tcHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNDE1NzcsImV4cCI6MjA3NjgxNzU3N30.RyY1ZLHxOfXoO_oVzNai4CMZuvMQUSKRGKT4YcCpesA";

async function sbInsert(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
async function sbSelect(limit = 10) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/appointments?select=*&order=created_at.desc&limit=${limit}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function firstName(profileName) {
  if (!profileName) return "Cliente";
  return profileName.toString().split(" ")[0];
}
function menuTexto(nombre = "Cliente") {
  return `Hola ${nombre} 👋\nElige tu servicio:\n1) Corte\n2) Barba\n3) Facial\n\nO mándame en una línea: Ej.\nBarba 31/10 12:30 90`;
}
function resumen(row) {
  return `Ref ${row.ref}\nServicio: ${row.service}\nFecha: ${row.date} ${row.time}\nPrecio: $${row.price}`;
}

// === SAFE TWILIO SEND ===
async function safeWhatsAppSend({ from, to, body }) {
  if (!twilioClient || !/^whatsapp:\+/.test(from) || !/^whatsapp:\+/.test(to)) {
    console.log("⚠️ No hay cliente Twilio o número inválido, se omite envío.");
    return { ok: false, skipped: true };
  }
  try {
    const msg = await twilioClient.messages.create({ from, to, body });
    console.log("✅ Enviado:", msg.sid);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    if (e?.status === 429 || e?.code === 63038) {
      console.warn("⚠️ Límite diario de Twilio alcanzado. No se enviará este mensaje.");
      return { ok: false, rateLimited: true, code: e.code };
    }
    console.error("❌ Error al enviar mensaje Twilio:", e?.message || e);
    return { ok: false, error: e?.message };
  }
}

// === ROUTES ===
app.get("/", (_req, res) => res.send("AutoCitaMX up ✅"));
app.get("/whatsapp", (_req, res) => res.send("WhatsApp webhook up ✅"));

app.post("/whatsapp", async (req, res) => {
  const from = req.body.From || req.body.from || "";
  let to = req.body.To || req.body.to || "";
  const body = (req.body.Body || req.body.body || "").trim();
  const nombre = firstName(req.body.ProfileName);
  if (!to && TWILIO_WHATSAPP_FROM) to = TWILIO_WHATSAPP_FROM;

  try {
    const lower = body.toLowerCase();

    if (["hola", "menu", "menú", "inicio", "start"].includes(lower)) {
      await safeWhatsAppSend({ from: to, to: from, body: menuTexto(nombre) });
      return res.status(200).send("OK");
    }

    if (sessions.has(from)) {
      if (["si", "sí", "si.", "sí.", "confirmo"].includes(lower)) {
        const s = sessions.get(from);
        const row = {
          ref: s.ref,
          phone: from,
          service: s.service,
          date: s.date,
          time: s.time,
          price: s.price,
          status: "confirmada",
        };
        await sbInsert(row);
        sessions.delete(from);
        await safeWhatsAppSend({ from: to, to: from, body: `✅ Confirmado.\n${resumen(row)}` });
        return res.status(200).send("OK");
      }
      if (["no", "no.", "cancelar", "cambiar"].includes(lower)) {
        sessions.delete(from);
        await safeWhatsAppSend({ from: to, to: from, body: `Sin problema, ${nombre}. ${menuTexto(nombre)}` });
        return res.status(200).send("OK");
      }
      const s = sessions.get(from);
      await safeWhatsAppSend({ from: to, to: from, body: `¿Confirmas esta cita? Responde SI o NO.\n${resumen(s)}` });
      return res.status(200).send("OK");
    }

    if (["1", "2", "3"].includes(lower)) {
      const servicios = { "1": "Corte", "2": "Barba", "3": "Facial" };
      const ref = genRef();
      const { fecha, hora } = parsear("");
      const s = { ref, service: servicios[lower], date: fecha, time: hora, price: 0 };
      sessions.set(from, s);
      await safeWhatsAppSend({
        from: to,
        to: from,
        body: `Perfecto: ${s.service}\nPropuesta: ${s.date} ${s.time} $${s.price}\n¿Confirmas? Responde **SI** o **NO**.\nTambién puedes mandar: "Barba 31/10 12:30 90"`,
      });
      return res.status(200).send("OK");
    }

    const parsed = parsear(body);
    const ref = genRef();
    const s = { ref, service: parsed.servicio, date: parsed.fecha, time: parsed.hora, price: parsed.precio };
    sessions.set(from, s);
    await safeWhatsAppSend({ from: to, to: from, body: `¿Confirmas esta cita, ${nombre}? Responde SI o NO.\n${resumen(s)}` });
    return res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Webhook error:", e?.message || e);
    return res.status(200).send("OK");
  }
});

// === START ===
// Usar puerto dinámico de Render (NO fijar manualmente)
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

