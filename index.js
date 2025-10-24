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

// === SUPABASE (tus datos) ===
const SUPABASE_URL = "https://qffstwhizihtexfompwe.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnN0d2hpemlodGV4Zm9tcHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNDE1NzcsImV4cCI6MjA3NjgxNzU3N30.RyY1ZLHxOfXoO_oVzNai4CMZuvMQUSKRGKT4YcCpesA";

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// === ESTADO EN MEMORIA (prototipo) ===
const sessions = new Map(); // key: phone

// === HELPERS ===
const pad2 = (n) => n.toString().padStart(2, "0");
const genRef = () => `ACT-${Math.floor(1000 + Math.random() * 9000)}`;

function normalizarFecha(token) {
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/; // 2025-10-31
  const dm = /^(\d{1,2})[\/-](\d{1,2})$/; // 31/10
  if (ymd.test(token)) {
    const [, y, m, d] = token.match(ymd);
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  if (dm.test(token)) {
    const now = new Date();
    const y = now.getFullYear();
    const [, d, m] = token.match(dm);
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  return null;
}

function parsear(texto) {
  let rest = (texto || "").trim();

  // hora HH:MM
  let hora = null;
  const reHora = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
  const mh = rest.match(reHora);
  if (mh) {
    hora = `${pad2(mh[1])}:${mh[2]}`;
    rest = rest.replace(mh[0], " ").trim();
  }

  // fecha
  let fecha = null;
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const f = normalizarFecha(t);
    if (f) {
      fecha = f;
      rest = rest.replace(t, " ").trim();
      break;
    }
  }

  // precio (último número)
  let precio = null;
  const rePrecio = /(?:\$?\s*)(\d+(?:[.,]\d{1,2})?)(?!\S)/g;
  let m;
  let last = null;
  while ((m = rePrecio.exec(rest)) !== null) last = m[1];
  if (last) {
    precio = parseFloat(last.replace(",", "."));
    rest = rest.replace(new RegExp(`${last}\\b`), " ").trim();
  }

  // servicio = lo que quede
  let servicio = rest.replace(/\s{2,}/g, " ").trim();
  if (!servicio) servicio = "Pendiente";

  // defaults
  if (!fecha) {
    const now = new Date();
    fecha = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
      now.getDate()
    )}`;
  }
  if (!hora) hora = "12:00";
  if (precio == null || Number.isNaN(precio)) precio = 0;

  return { servicio, fecha, hora, precio };
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

const firstName = (n) =>
  n ? n.toString().trim().split(/\s+/)[0] : "Cliente";

const menuTexto = (nombre = "Cliente") =>
  `Hola ${nombre} 👋
Elige tu servicio:
1) Corte
2) Barba
3) Facial

O mándame en una línea: Ej.
Barba 31/10 12:30 90`;

const resumen = (row) =>
  `Ref ${row.ref}
Servicio: ${row.service}
Fecha: ${row.date} ${row.time}
Precio: $${row.price}`;

// === HEALTH ===
app.get("/", (_req, res) => res.send("AutoCitaMX up ✅"));
app.get("/whatsapp", (_req, res) => res.send("WhatsApp webhook up ✅"));

// === WEBHOOK WHATSAPP ===
app.post("/whatsapp", async (req, res) => {
  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = (req.body.Body || "").trim();
  const nombre = firstName(req.body.ProfileName);

  try {
    const lower = body.toLowerCase();

    // Comandos cortos
    if (["hola", "menu", "menú", "inicio", "start"].includes(lower)) {
      if (twilioClient) {
        await twilioClient.messages.create({
          from: to,
          to: from,
          body: menuTexto(nombre),
        });
      }
      return res.status(200).send("OK");
    }

    // Confirmación SI/NO con sesión
    if (sessions.has(from)) {
      if (["si", "sí", "si.", "sí.", "confirmo"].includes(lower)) {
        const s = sessions.get(from);
        const row = {
          ref: s.ref,
          phone: from,
          service: s.service,
          date: s.date,
          time: s.time,
          price: s.price,
          status: "confirmada",
        };
        await sbInsert(row);
        sessions.delete(from);

        if (twilioClient) {
          await twilioClient.messages.create({
            from: to,
            to: from,
            body: `✅ Confirmado.\n${resumen(row)}`,
          });
        }
        return res.status(200).send("OK");
      }

      if (["no", "no.", "cancelar", "cambiar"].includes(lower)) {
        sessions.delete(from);
        if (twilioClient) {
          await twilioClient.messages.create({
            from: to,
            to: from,
            body: `Sin problema, ${nombre}. ${menuTexto(nombre)}`,
          });
        }
        return res.status(200).send("OK");
      }

      // Cualquier otra cosa: re-enviar resumen
      const s = sessions.get(from);
      if (twilioClient) {
        await twilioClient.messages.create({
          from: to,
          to: from,
          body: `¿Confirmas esta cita? Responde SI o NO.\n${resumen(s)}`,
        });
      }
      return res.status(200).send("OK");
    }

    // Menú numérico
    if (["1", "2", "3"].includes(lower)) {
      const servicios = { "1": "Corte", "2": "Barba", "3": "Facial" };
      const ref = genRef();
      const p = parsear(""); // defaults
      const s = {
        ref,
        service: servicios[lower],
        date: p.fecha,
        time: p.hora,
        price: 0,
      };
      sessions.set(from, s);

      if (twilioClient) {
        await twilioClient.messages.create({
          from: to,
          to: from,
          body:
            `Perfecto: ${s.service}\n` +
            `Propuesta: ${s.date} ${s.time} $${s.price}\n` +
            `¿Confirmas? Responde SI o NO.\n` +
            `También puedes mandar: "Barba 31/10 12:30 90"`,
        });
      }
      return res.status(200).send("OK");
    }

    // Parseo libre
    const p = parsear(body);
    const ref = genRef();
    const s = {
      ref,
      service: p.servicio,
      date: p.fecha,
      time: p.hora,
      price: p.precio,
    };
    sessions.set(from, s);

    if (twilioClient) {
      await twilioClient.messages.create({
        from: to,
        to: from,
        body: `¿Confirmas esta cita, ${nombre}? Responde SI o NO.\n${resumen(s)}`,
      });
    }

    return res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Webhook error:", e.message);
    return res.status(500).send("ERROR");
  }
});

// === TESTS ===
app.get("/parse-test", (req, res) => {
  const text = (req.query.text || "").toString();
  if (!text) return res.json({ ok: false, error: "text vacío" });
  const p = parsear(text);
  return res.json({
    ok: true,
    parsed: {
      servicio: p.servicio,
      fecha: p.fecha,
      hora: p.hora,
      precio: p.precio,
    },
  });
});

app.get("/test/insert", async (_req, res) => {
  try {
    const ref = genRef();
    const p = parsear("Test 12:00 0");
    const row = {
      ref,
      phone: "whatsapp:+5210000000000",
      service: p.servicio,
      date: p.fecha,
      time: p.hora,
      price: p.precio,
      status: "confirmada",
    };
    const inserted = await sbInsert(row);
    return res.json({ ok: true, inserted });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/appointments", async (_req, res) => {
  try {
    const rows = await sbSelect(10);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// === START ===
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
