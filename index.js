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

// === SUPABASE ===
const SUPABASE_URL = "https://qffstwhizihtexfompwe.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnN0d2hpemlodGV4Zm9tcHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNDE1NzcsImV4cCI6MjA3NjgxNzU3N30.RyY1ZLHxOfXoO_oVzNai4CMZuvMQUSKRGKT4YcCpesA";

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// === HELPERS ===
function genRef() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `ACT-${n}`;
}
const pad2 = (n) => n.toString().padStart(2, "0");

function normalizarFecha(token) {
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;     // 2025-10-31
  const dm = /^(\d{1,2})[\/-](\d{1,2})$/;                // 31/10 o 31-10
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

  // hora HH:MM
  let hora = null;
  const reHora = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
  const mh = rest.match(reHora);
  if (mh) {
    hora = `${pad2(mh[1])}:${mh[2]}`;
    rest = rest.replace(mh[0], " ").trim();
  }

  // fecha
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

  // precio (último número)
  let precio = null;
  const rePrecio = /(?:\$?\s*)(\d+(?:[.,]\d{1,2})?)(?!\S)/g;
  let m, last = null;
  while ((m = rePrecio.exec(rest)) !== null) last = m[1];
  if (last) {
    precio = parseFloat(last.replace(",", "."));
    rest = rest.replace(new RegExp(`${last}\\b`), " ").trim();
  }

  // servicio = lo que quede
  let servicio = rest.replace(/\s{2,}/g, " ").trim();
  if (!servicio) servicio = "Pendiente";

  // defaults
  if (!fecha) {
    const now = new Date();
    fecha = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
  }
  if (!hora) hora = "12:00";
  if (precio == null || Number.isNaN(precio)) precio = 0;

  return { servicio, fecha, hora, precio };
}

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

// === HEALTH ===
app.get("/", (_req, res) => res.send("AutoCitaMX up ✅"));
app.get("/whatsapp", (_req, res) => res.send("WhatsApp webhook up ✅"));

// === WEBHOOK WHATSAPP ===
app.post("/whatsapp", async (req, res) => {
  try {
    const from = req.body.From || "";
    const body = (req.body.Body || "").trim();
    const { servicio, fecha, hora, precio } = parsear(body);
    const ref = genRef();

    const row = {
      ref,
      phone: from,
      service: servicio,
      date: fecha,
      time: hora,
      price: precio,
      status: "pendiente",
    };

    await sbInsert(row);

    // Respuesta (si sandbox lo permite). Comenta este bloque si no quieres gastar cuota:
    if (twilioClient && from) {
      try {
        await twilioClient.messages.create({
          from: req.body.To,
          to: from,
          body:
            `✅ Guardado. Ref ${ref}\n` +
            `Servicio: ${row.service}\n` +
            `Fecha: ${row.date} ${row.time}\n` +
            `Precio: $${row.price}`,
        });
      } catch (e) {
        console.warn("⚠️ Respuesta omitida:", e.message);
      }
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Webhook error:", e.message);
    res.status(500).send("ERROR");
  }
});

// === TESTS ===
app.get("/parse-test", (req, res) => {
  const text = (req.query.text || "").toString();
  if (!text) return res.json({ ok: false, error: "text vacío" });
  return res.json({ ok: true, parsed: parsear(text) });
});

app.get("/test/insert", async (_req, res) => {
  try {
    const { servicio, fecha, hora, precio } = parsear("Test 12:00 0");
    const row = {
      ref: genRef(),
      phone: "whatsapp:+5210000000000",
      service: servicio,
      date: fecha,
      time: hora,
      price: precio,
      status: "confirmada",
    };
    const inserted = await sbInsert(row);
    res.json({ ok: true, inserted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/appointments", async (_req, res) => {
  try {
    const rows = await sbSelect(10);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// === START ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
