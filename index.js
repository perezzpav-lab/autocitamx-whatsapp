// ==============================
// AutoCitaMX WhatsApp - Render
// ==============================

const express = require("express");
const twilio = require("twilio");
const app = express();

// Body parser para Twilio (x-www-form-urlencoded)
app.use(express.urlencoded({ extended: false }));

// Salud/raíz
app.get("/", (_, res) => res.send("AutoCitaMX WhatsApp OK 🚀"));

// Webhook principal de WhatsApp
app.post("/whatsapp", (req, res) => {
  try {
    console.log("Webhook Twilio:", req.body);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "¡Hola! Soy AutoCitaMX 🤖\n\n" +
      "1️⃣ Agendar cita\n" +
      "2️⃣ Consultar cita\n" +
      "3️⃣ Cancelar cita\n\n" +
      "Responde con el número de la opción que desees."
    );

    return res.type("text/xml").status(200).send(twiml.toString());
  } catch (error) {
    console.error("Error en /whatsapp:", error);
    return res.type("text/xml").status(200).send("<Response></Response>");
  }
});

// IMPORTANTE: una sola declaración y un solo listen
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AutoCitaMX WhatsApp corriendo en puerto ${port}`));
