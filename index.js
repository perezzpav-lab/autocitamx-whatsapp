// index.js (ESM)
import express from "express";
import dotenv from "dotenv";
import Twilio from "twilio";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variables de entorno (Render → Dashboard → Environment)
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Salud
app.get("/", (_req, res) => {
  res.send("AutoCitaMX up ✅");
});

// Ejemplo de webhook Twilio (si lo usas)
app.post("/whatsapp/webhook", async (req, res) => {
  try {
    // Aquí iría tu lógica actual (leer req.body, guardar en Supabase, etc.)
    console.log("Inbound WhatsApp:", req.body);
    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(500).send("ERROR");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
