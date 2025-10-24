// index.js (ESM)
import express from "express";
import dotenv from "dotenv";
import Twilio from "twilio";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== CONFIGURACIÓN ======
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SUPABASE_URL = "https://qffstwhizihtexfompwe.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnN0d2hpemlodGV4Zm9tcHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNDE1NzcsImV4cCI6MjA3NjgxNzU3N30.RyY1ZLHxOfXoO_oVzNai4CMZuvMQUSKRGKT4YcCpesA";

const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ====== FUNCIONES ======
async function guardarCitaEnSupabase(data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase error: ${res.status} - ${errText}`);
    }

    const json = await res.json();
    console.log("✅ Cita guardada en Supabase:", json);
    return true;
  } catch (err) {
    console.error("❌ Error guardando cita:", err.message);
    return false;
  }
}

// ====== RUTAS ======
app.get("/", (_req, res) => res.send("AutoCitaMX up ✅"));
app.get("/whatsapp", (_req, res) => res.send("WhatsApp webhook up ✅"));

// Webhook de WhatsApp (Twilio)
app.post("/whatsapp", async (req, res) => {
  try {
    console.log("Inbound WhatsApp:", req.body);

    const from = req.body.From || "";
    const body = req.body.Body || "";
    const profile = req.body.ProfileName || "Cliente";

    // Crear cita básica
    const cita = {
      customer_name: profile,
      phone: from,
      service_name: "Pendiente",
      requested_slot_text: body,
      status: "pending",
      payment_status: "unpaid",
    };

    await guardarCitaEnSupabase(cita);

    // Enviar confirmación si no superas el límite del sandbox
    try {
      await twilioClient.messages.create({
        from: req.body.To,
        to: from,
        body: `Gracias ${profile}! Guardé tu solicitud: "${body}". Te confirmaremos tu cita pronto ✅`,
      });
    } catch (twilioErr) {
      console.warn("⚠️ No se pudo enviar mensaje (sandbox limit o error):", twilioErr.message);
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Error en webhook:", e.message);
    res.status(500).send("ERROR");
  }
});

// ====== INICIAR SERVER ======
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

