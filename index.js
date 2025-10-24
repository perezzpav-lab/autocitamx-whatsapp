// index.js (ESM)
import express from "express";
import dotenv from "dotenv";
import Twilio from "twilio";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// ⚠️ Tus datos de Supabase (los que me pasaste)
const SUPABASE_URL = "https://qffstwhizihtexfompwe.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnN0d2hpemlodGV4Zm9tcHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNDE1NzcsImV4cCI6MjA3NjgxNzU3N30.RyY1ZLHxOfXoO_oVzNai4CMZuvMQUSKRGKT4YcCpesA";

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// ====== HELPERS ======
async function supabaseInsertAppointments(payload) {
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

async function supabaseSelectAppointments(limit = 10) {
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

// ====== RUTAS ======
app.get("/", (_req, res) => res.send("AutoCitaMX up ✅"));
app.get("/whatsapp", (_req, res) => res.send("WhatsApp webhook up ✅"));

// Webhook real para Twilio (POST)
app.post("/whatsapp", async (req, res) => {
  try {
    console.log("Inbound WhatsApp:", req.body);

    const from = req.body.From || "";
    const body = req.body.Body || "";
    const profile = req.body.ProfileName || "Cliente";

    const cita = {
      customer_name: profile,
      phone: from,
      service_name: "Pendiente",
      requested_slot_text: body,
      status: "pending",
      payment_status: "unpaid",
    };

    await supabaseInsertAppointments(cita);

    // Responder (puede fallar si el sandbox alcanzó el límite)
    if (twilioClient && from && body) {
      try {
        await twilioClient.messages.create({
          from: req.body.To,
          to: from,
          body: `Gracias ${profile}! Guardé tu solicitud: "${body}". Te confirmaremos pronto ✅`,
        });
      } catch (e) {
        console.warn("⚠️ Respuesta Twilio omitida:", e.message);
      }
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Error en webhook:", e.message);
    res.status(500).send("ERROR");
  }
});

/**
 * 🔎 Verificación SIN WhatsApp:
 * 1) Inserta una cita de prueba → GET /test/insert
 * 2) Lista últimas 10 citas → GET /appointments
 */

// Inserta una cita de prueba rápida
app.get("/test/insert", async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const payload = {
      customer_name: "Prueba",
      phone: "whatsapp:+5210000000000",
      service_name: "Test",
      requested_slot_text: `test ${now}`,
      status: "pending",
      payment_status: "unpaid",
    };
    const inserted = await supabaseInsertAppointments(payload);
    res.json({ ok: true, inserted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Lista últimas 10 citas
app.get("/appointments", async (_req, res) => {
  try {
    const rows = await supabaseSelectAppointments(10);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====== START ======
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
