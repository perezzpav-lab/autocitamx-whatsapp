// ==============================
// AutoCitaMX WhatsApp - Render
// ==============================

const express = require("express");
const twilio = require("twilio");
const app = express();

// Permite leer datos que envía Twilio en formato x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

// Mensaje para verificar que el servidor está en línea
app.get("/", (_, res) => res.send("AutoCitaMX WhatsApp OK 🚀"));

// Webhook principal de WhatsApp
app.post("/whatsapp", (req, res) => {
  try {
    console.log("Webhook Twilio:", req.body);

    // Crear respuesta de Twilio (TwiML)
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "¡Hola! Soy AutoCitaMX 🤖\n\n" +
      "1️⃣ Agendar cita\n" +
      "2️⃣ Consultar cita\n" +
      "3️⃣ Cancelar cita\n\n" +
      "Responde con el número de la opción que desees."
    );

    // Enviar respuesta XML a Twilio
    return res.type("text/xml").status(200).send(twiml.toString());
  } catch (error) {
    console.error("Error en /whatsapp:", error);
    // Siempre responder 200 para que Twilio no marque error
    return res.type("text/xml").status(200).send("<Response></Response>");
  }
});

// Puerto que asigna Render automáticamente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AutoCitaMX WhatsApp corriendo en puerto ${PORT}`));

// Puerto asignado por Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AutoCitaMX WhatsApp corriendo en puerto ${PORT}`));
