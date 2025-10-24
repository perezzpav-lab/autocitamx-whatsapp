// index.js (ESM)
import express from "express";
import dotenv from "dotenv";
import Twilio from "twilio";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true })); // necesario para Twilio
app.use(express.json());

// Variables de entorno (Render → Environment)
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Validación para evitar crash si falta algo
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn("⚠️ Faltan credenciales de Twilio en Render Environment");
}

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// Ruta principal (verificar que la app corre)
app.get("/", (_req, res) => {
  res.send("AutoCitaMX up ✅");
});

// Ruta de prueba (GET para navegador)
app.get("/whatsapp", (_req, res) => {
  res.send("WhatsApp webhook up ✅");
});

// Ruta real para Twilio (POST)
app.post("/whatsapp", async (req, res) => {
  try {
    console.log("Inbound WhatsApp:", req.body);

    // Si quieres responder por WhatsApp, ejemplo:
    if (twilioClient && req.body.From && req.body.Body) {
      await twilioClient.messages.create({
        from: req.body.To, // tu número de Twilio
        to: req.body.From, // el que escribió
        body: `Hola ${req.body.From}, recibí tu mensaje: "${req.body.Body}" ✅`,
      });
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error en webhook:", err.message);
    res.status(500).send("ERROR");
  }
});

// Iniciar servidor
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
