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
function todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
    const service = body || "Pendiente";
    const ref = genRef();

    // Inserta SOLO columnas que existen en tu tabla:
    const row = {
      ref,                     // ej: ACT-1234
      phone: from,             // 'whatsapp:+52...'
      service,                 // texto
      date: todayISO(),        // <-- requerido por tu NOT NULL
      time: "00:00",           // por defecto
      price: 0,                // por defecto
      status: "confirmada"     // usa uno válido en tu tabla
    };

    await sbInsert(row);

    if (twilioClient && from) {
      try {
        await twilioClient.messages.create({
          from: req.body.To,
          to: from,
          body: `¡Recibido! Ref ${ref}. Servicio: "${service}". Te confirmamos en breve ✅`,
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

// === TEST SIN WHATSAPP ===
app.get("/test/insert", async (_req, res) => {
  try {
    const row = {
      ref: genRef(),
      phone: "whatsapp:+5210000000000",
      service: "Test",
      date: todayISO(),  // <-- requerido
      time: "12:00",     // default
      price: 0,          // default
      status: "confirmada"
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

