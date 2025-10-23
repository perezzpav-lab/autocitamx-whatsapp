const express = require("express");
const app = express();

// 👇 Necesario para leer el body x-www-form-urlencoded de Twilio
app.use(express.urlencoded({ extended: false }));

// (Opcional) Diagnóstico de env: ¡esto sí puede ir arriba porque no usa app!
console.log("ENV_DIAG", {
  SID: !!process.env.TWILIO_ACCOUNT_SID,
  TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
  FROM: process.env.WHATSAPP_FROM
});

// ✅ Ruta raíz para ver que el servicio está vivo
app.get("/", (_, res) => res.send("AutoCitaMX WhatsApp OK 🚀"));

// ✅ Ruta de diagnóstico (temporal). OJO: ahora sí DESPUÉS de crear app
app.get("/diag/env", (_, res) => {
  res.json({
    SID: !!process.env.TWILIO_ACCOUNT_SID,
    TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
    FROM: process.env.WHATSAPP_FROM || null
  });
});

// ✅ Webhook WhatsApp (versión mínima segura para probar)
app.post("/whatsapp", async (req, res) => {
  try {
    console.log("Webhook Twilio:", req.body);
    // Respuesta mínima válida para Twilio
    return res.type("text/xml").status(200).send("<Response></Response>");
  } catch (e) {
    console.error("Error /whatsapp:", e);
    return res.type("text/xml").status(200).send("<Response></Response>");
  }
});

// Puerto asignado por Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AutoCitaMX WhatsApp corriendo en puerto ${PORT}`));
