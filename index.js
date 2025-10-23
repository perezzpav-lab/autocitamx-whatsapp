const express = require("express");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
// Twilio envía application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// ⚠️ Sesiones en memoria (demo). En producción: DB/Redis.
const sessions = new Map();

// Catálogo de servicios (ejemplo barbershop)
const SERVICES = [
  { name: "Corte", mins: 30, price: 120 },
  { name: "Barba", mins: 20, price: 90 },
  { name: "Corte+Barba", mins: 45, price: 190 },
  { name: "Tinte", mins: 60, price: 350 },
];

const MAIN_MENU =
  "👋 *AutoCitaMX*\n" +
  "1) Agendar cita\n" +
  "2) Consultar cita\n" +
  "3) Pagar\n\n" +
  "Escribe el *número* de opción.\n" +
  "_Comandos: *menu*, *reiniciar*._";

// Utilidad: normalizar texto entrante
function norm(text = "") {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos
}

// Raíz para chequeo rápido
app.get("/", (_, res) => res.send("AutoCitaMX WhatsApp OK 🚀"));

// Webhook de WhatsApp
app.post("/whatsapp", (req, res) => {
  const { From = "", Body = "" } = req.body || {};
  const bodyRaw = (Body || "").trim();
  const body = norm(bodyRaw);
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  // Recuperar/crear sesión
  const s = sessions.get(From) || { step: "menu", data: {} };

  // Logs para depurar en terminal
  console.log("IN:", { From, Body: bodyRaw, step: s.step, data: s.data });

  try {
    // Comandos globales
    if (["menu", "reiniciar", "inicio", "start"].includes(body)) {
      s.step = "menu";
      s.data = {};
      twiml.message(MAIN_MENU);
      sessions.set(From, s);
      res.type("text/xml").status(200).send(twiml.toString());
      return;
    }

    // Máquina de estados
    switch (s.step) {
      case "menu": {
        if (["1", "2", "3"].includes(body)) {
          if (body === "1") {
            s.step = "service";
            const list = SERVICES.map((x, i) => `${i + 1}) ${x.name} — ~$${x.price} MXN`).join("\n");
            twiml.message(`🗓️ ¿Qué servicio?\n${list}\n\nResponde con el *número*.`);
          }
          if (body === "2") {
            s.step = "lookupRef";
            twiml.message("🔎 Dame tu *folio de cita* (ej. ACT-1234).");
          }
          if (body === "3") {
            s.step = "payRef";
            twiml.message("💳 Dame tu *folio de pago/cita* (ej. ACT-1234).");
          }
        } else {
          // Si pone “hola”, “buenas”, números no válidos, etc → vuelve a menú
          twiml.message(MAIN_MENU);
        }
        break;
      }

      case "service": {
        const idx = parseInt(body, 10) - 1;
        if (Number.isNaN(idx) || idx < 0 || idx >= SERVICES.length) {
          const list = SERVICES.map((x, i) => `${i + 1}) ${x.name} — ~$${x.price} MXN`).join("\n");
          twiml.message(`❌ Opción no válida.\n\n${list}\nResponde con el *número*.`);
        } else {
          s.data.service = SERVICES[idx].name;
          s.data.price = SERVICES[idx].price;
          s.step = "date";
          twiml.message(
            `📌 Servicio: *${s.data.service}* (~$${s.data.price} MXN)\n` +
            "📅 Indica fecha en formato *YYYY-MM-DD* (ej. 2025-10-25)."
          );
        }
        break;
      }

      case "date": {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bodyRaw)) {
          twiml.message("❌ Formato inválido. Usa *YYYY-MM-DD* (ej. 2025-10-25).");
        } else {
          s.data.date = bodyRaw;
          s.step = "time";
          twiml.message("⏰ Indica hora 24h (ej. 15:30).");
        }
        break;
      }

      case "time": {
        if (!/^\d{2}:\d{2}$/.test(bodyRaw)) {
          twiml.message("❌ Formato inválido. Usa *HH:MM* 24h (ej. 15:30).");
        } else {
          s.data.time = bodyRaw;
          const ref = "ACT-" + Math.floor(1000 + Math.random() * 9000);
          s.data.ref = ref;
          s.step = "menu";

          const payLink = `https://autocitamx.mx/pagar/${encodeURIComponent(ref)}`; // demo
          twiml.message(
            "✅ *Cita confirmada*\n" +
            `• Servicio: *${s.data.service}*\n` +
            `• Fecha: *${s.data.date}* a las *${s.data.time}*\n` +
            `• Folio: *${ref}*\n` +
            `• Estimado: ~$${s.data.price} MXN\n\n` +
            `💳 Para pagar ahora: ${payLink}\n` +
            'O responde "3" en cualquier momento.'
          );

          // Limpia datos de la cita (en demo) y regresa a menú
          s.data = {};
        }
        break;
      }

      case "lookupRef": {
        const ref = bodyRaw.toUpperCase().replace(/\s+/g, "");
        if (!/^ACT-\d{4}$/.test(ref)) {
          twiml.message("❌ Folio inválido. Formato: *ACT-1234*.\nIntenta de nuevo o escribe *menu*.");
        } else {
          s.step = "menu";
          twiml.message(
            `📄 Detalles de *${ref}*:\n` +
            "• Estado: Confirmada\n" +
            "• Fecha/Hora: 2025-10-25 15:30\n" +
            "• Servicio: Corte\n" +
            "• Pago: Pendiente\n\n" +
            "Escribe *pagar* o *menu*."
          );
        }
        break;
      }

      case "payRef": {
        const ref = bodyRaw.toUpperCase().replace(/\s+/g, "");
        if (!/^ACT-\d{4}$/.test(ref)) {
          twiml.message("❌ Folio inválido. Formato: *ACT-1234*.\nIntenta de nuevo o escribe *menu*.");
        } else {
          s.step = "menu";
          const payLink = `https://autocitamx.mx/pagar/${encodeURIComponent(ref)}`; // demo
          twiml.message(
            `💳 Pago para *${ref}*\n` +
            `Enlace: ${payLink}\n\n` +
            "Te enviaremos recibo por WhatsApp al confirmar."
          );
        }
        break;
      }

      default: {
        s.step = "menu";
        s.data = {};
        twiml.message(MAIN_MENU);
      }
    }
  } catch (err) {
    console.error("ERR:", err);
    s.step = "menu";
    s.data = {};
    twiml.message("😖 Ocurrió un error. Volvamos al menú:\n\n" + MAIN_MENU);
  }

  // Guardar sesión
  sessions.set(From, s);

  // Responder Twilio
  res.type("text/xml").status(200).send(twiml.toString());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[dotenv] OK • AutoCitaMX WhatsApp corriendo en puerto ${port}`);
});

});

// IMPORTANTE: una sola declaración y un solo listen
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AutoCitaMX WhatsApp corriendo en puerto ${port}`));
