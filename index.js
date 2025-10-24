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

// === SUPABASE (tus datos) ===
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

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function normalizeDateToken(token) {
  // acepta 31/10, 31-10, 2025-10-31
  const dashISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
  const dm = /^(\d{1,2})[\/-](\d{1,2})$/;
  if (dashISO.test(token)) {
    const [, y, m, d] = token.match(dashISO);
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  if (dm.test(token)) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const [, d, m] = token.match(dm);
    return `${year}-${pad2(m)}-${pad2(d)}`;
  }
  return null;
}

function extractDateTimePrice(text) {
  let remaining = text;

  // time HH:MM (24h)
  let time = null;
  const timeRe = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
  const timeMatch = remaining.match(timeRe);
  if (timeMatch) {
    time = `${pad2(timeMatch[1])}:${timeMatch[2]}`;
    remaining = remaining.replace(timeMatch[0], " ").trim();
  }

  // date
  let date = null;
  const tokens = remaining.split(/\s+/);
  for (const t of tokens) {
    const norm = normalizeDateToken(t);
    if (norm) {
      date = norm;
      remaining = remaining.replace(t, " ").trim();
      break;
    }
  }

  // price (último número con posible $ o decimales)
  let price = null;
  const priceRe = /(?:\$?\s*)(\d+(?:[.,]\d{1,2})?)(?!\S)/g;
  let m, lastNum = null;
  while ((m = priceRe.exec(remaining)) !== null) {
    lastNum = m[1];
  }
  if (lastNum) {
    price = parseFloat(lastNum.replace(",", "."));
    remaining = remaining.replace(new RegExp(lastNum + "\\b"), " ").trim();
  }

  // service = lo que quede (limpio)
  let service = remaining.replace(/\s{2,}/g, " ").trim();
  if (!service) service = "Pendiente";

  // defaults si faltan
  if (!date) {
    const now = new Date();
    date = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
  }
  if (!time) time = "12:00";
  if (price == null || Number.isNaN(price)) price = 0;

  return { service, date, time, price };
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

// === WEBHOOK WHATSAPP (parsea y guarda) ===
app.post("/whatsapp", async (req, res) => {
  try {
    const from = req.body.From || "";
    const body = (req.body.Body || "").trim();
    const ref = genRef();

    const parsed = extractDateTimePrice(body);
    const row = {
      ref,
      phone: from,
      service: parsed.service,
      date: parsed.date,
      time: parsed.time,
      price: parsed.price,
      status: "pendiente",
    };

    await sbInsert(row);

    // Respuesta (si el sandbox permite)
    if (twilioClient && from) {
      const reply =
        `✅ Guardado. Ref ${ref}\n` +
        `Servicio: ${row.service}\n` +
        `Fecha: ${row.date} ${row.time}\n` +
        `Precio: $${row.price}`;
      try {
        await twilioClient.messages.create({
          from: req.body.To,
          to: from,
          body: reply,
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

// === TESTS SIN WHATSAPP ===
app.get("/test/insert", async (_req, res) => {
  try {
    const row = {
      ref: genRef(),
      phone: "whatsapp:+5210000000000",
      service: "Test",
      date: new Date().toISOString().slice(0, 10),
      time: "12:00",
      price: 0,
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

// Endpoint para probar el parser sin tocar BD: /parse-test?text=Barba%2031/10%2012:30%2090
app.get("/parse-test", (req, res) => {
  const text = (req.query.text || "").toString();
  if (!text) return res.json({ ok: false, error: "text vacío" });
  return res.json({ ok: true, parsed: extractDateTimePrice(text) });
});

// === START ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
