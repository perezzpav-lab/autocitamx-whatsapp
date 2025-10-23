const express = require("express");
const twilio = require("twilio");
// === DIAGNÓSTICO DE ENV (puedes borrar luego) ===
console.log("ENV_DIAG", {
  SID: !!process.env.TWILIO_ACCOUNT_SID,
  TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
  FROM: process.env.WHATSAPP_FROM
});

// Ruta temporal para ver env desde el navegador
app.get("/diag/env", (_, res) => {
  res.json({
    SID: !!process.env.TWILIO_ACCOUNT_SID,
    TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
    FROM: process.env.WHATSAPP_FROM || null
  });
});
// === FIN DIAGNÓSTICO ===

require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: true }));

// Sesiones en memoria (demo). En producción: Redis/DB.
const sessions = new Map();

// Catálogo demo (barbería)
const SERVICES = [
  { name: "Corte", mins: 30 },
  { name: "Barba", mins: 20 },
  { name: "Corte+Barba", mins: 45 },
  { name: "Tinte", mins: 60 },
];

const MAIN_MENU =
  "👋 *AutoCitaMX*\n" +
  "1) Agendar cita\n" +
  "2) Consultar cita\n" +
  "3) Pagar\n" +
  "Escribe el *número* de opción.";

app.get("/", (_, res) => res.send("AutoCitaMX WhatsApp OK 🚀"));

app.post("/whatsapp", (req, res) => {
  const { From = "", Body = "" } = req.body || {};
  const body = (Body || "").trim();
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  const s = sessions.get(From) || { step: "menu", data: {} };

  try {
    if (s.step === "menu") {
      if (["1","2","3"].includes(body)) {
        if (body === "1") {
          s.step = "service";
          const list = SERVICES.map((x, i) => `${i+1}) ${x.name}`).join("\n");
          twiml.message(`🗓️ ¿Qué servicio?\n${list}\n\nResponde con el *número*.`);
        }
        if (body === "2") {
          s.step = "lookupRef";
          twiml.message("🔎 Dame tu *folio de cita* (ej. ACT-1234).");
        }
        if (body === "3") {
          s.step = "payRef";
          twiml.message("💳 Dame tu *folio de pago/cita*.");
        }
      } else {
        twiml.message(MAIN_MENU);
      }
    }
    else if (s.step === "service") {
      const idx = parseInt(body, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= SERVICES.length) {
        twiml.message("❌ Opción no válida. Elige un número del menú de servicios.");
      } else {
        s.data.service = SERVICES[idx].name;
        s.step = "date";
        twiml.message("📅 Indica fecha en formato *YYYY-MM-DD* (ej. 2025-10-25).");
      }
    }
    else if (s.step === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body)) {
        twiml.message("❌ Formato inválido. Usa *YYYY-MM-DD* (ej. 2025-10-25).");
      } else {
        s.data.date = body;
        s.step = "time";
        twiml.message("⏰ Indica hora 24h (ej. 15:30).");
      }
    }
    else if (s.step === "time") {
      if (!/^\d{2}:\d{2}$/.test(body)) {
        twiml.message("❌ Formato inválido. Usa *HH:MM* 24h (ej. 15:30).");
      } else {
        s.data.time = body;
        const ref = "ACT-" + Math.floor(1000 + Math.random() * 9000);
        s.step = "menu";
        twiml.message(
          "✅ *Cita confirmada*\n" +
          `• Servicio: *${s.data.service}*\n` +
          `• Fecha: *${s.data.date}* a las *${s.data.time}*\n` +
          `• Folio: *${ref}*\n\n` +
          'Para pagar, responde "3".'
        );
        s.data = {};
      }
    }
    else if (s.step === "lookupRef") {
      const ref = body.toUpperCase();
      s.step = "menu";
      twiml.message(
        `📄 Detalles de *${ref}*:\n` +
        "• Estado: Confirmada\n" +
        "• Fecha/Hora: 2025-10-25 15:30\n" +
        "• Servicio: Corte\n" +
        "¿Deseas reprogramar o cancelar?"
      );
    }
    else if (s.step === "payRef") {
      const ref = body.toUpperCase();
      s.step = "menu";
      const fakeLink = `https://autocitamx.mx/pagar/${encodeURIComponent(ref)}`;
      twiml.message(
        `💳 Para pagar tu cita *${ref}*, usa este enlace:\n${fakeLink}\n\n` +
        "Al confirmar el pago te enviaremos recibo por WhatsApp."
      );
    }
  } catch (err) {
    s.step = "menu";
    twiml.message("😖 Ocurrió un error. Volvamos al menú:\n\n" + MAIN_MENU);
  }

  sessions.set(From, s);
  res.type("text/xml").status(200).send(twiml.toString());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`AutoCitaMX WhatsApp corriendo en puerto ${port}`);
});
