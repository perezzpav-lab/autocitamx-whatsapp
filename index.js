// ====== index.js (PATCH mínimo para Supabase 'citas') ======
import express from "express";
import bodyParser from "body-parser";

// Usa Node 18+ con fetch nativo, si no: import fetch from "node-fetch";

const app = express();
app.use(bodyParser.urlencoded({ extended: true })); // Twilio manda x-www-form-urlencoded
app.use(bodyParser.json());

// === ENV requeridas en Render ===
// SUPABASE_URL=https://qffstwhizihtexfompwe.supabase.co
// SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
// BUSINESS_API_SECRET=959f67a7554dcc6e05f5c1a20d867d244c9387875c74059b
// ENABLE_OUTBOUND=true   (si quieres que Twilio responda al cliente)

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  BUSINESS_API_SECRET,
  ENABLE_OUTBOUND = "true",
} = process.env;

function twiml(msg) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`;
}
function genId() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const ts =
    d.getFullYear() +
    "" +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ACMX-${ts}-${rnd}`;
}

async function rpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`RPC ${fn} ${res.status}: ${txt}`);
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

// Health
app.get("/", (_, res) => res.status(200).send("OK AutoCitaMX"));

// Webhook Twilio
app.post("/whatsapp", async (req, res) => {
  try {
    const body = (req.body.Body || "").trim();
    const waid = (req.body.WaId || "").trim(); // solo números
    const profile = (req.body.ProfileName || "").trim();

    if (!body) return res.type("text/xml").send(twiml(""));

    // negocio por hashtag (#spa_roma) o por env
    let bizSecret = BUSINESS_API_SECRET;
    const m = body.match(/#([a-z0-9_\-]+)/i);
    let negocioName = null;
    if (m) {
      // Si quieres resolver secret por nombre, crea un endpoint o usa Apps Script.
      // Aquí asumimos que tu BUSINESS_API_SECRET ya es del negocio en uso.
      negocioName = m[1].toLowerCase(); // para validar en upsert
    }

    const lower = body.toLowerCase();

    // AYUDA
    if (/^(ayuda|help|\?)$/.test(lower)) {
      const help =
        "📲 AutoCitaMX:\n" +
        "• reservar YYYY-MM-DD HH:MM Nombre - Servicio\n" +
        "   ej: reservar 2025-11-05 10:00 Juan - Corte\n" +
        "• cancelar ID\n" +
        "   ej: cancelar ACMX-202511051000-ABCD\n" +
        "• negocio opcional: #spa_roma";
      return res.type("text/xml").send(twiml(help));
    }

    // CANCELAR
    if (lower.startsWith("cancelar ")) {
      const id = body.split(/\s+/)[1] || "";
      if (!id) return res.type("text/xml").send(twiml("Falta ID. Ej: cancelar ACMX-..."));
      try {
        await rpc("rpc_patch_cita", {
          p_secret: bizSecret,
          p_id: id,
          p_fields: { estado: "cancelada" },
        });
        return res.type("text/xml").send(twiml(`❌ Cita ${id} cancelada.`));
      } catch (e) {
        return res.type("text/xml").send(twiml(`⚠️ No se pudo cancelar: ${String(e).slice(0, 180)}`));
      }
    }

    // RESERVAR
    if (lower.startsWith("reservar ")) {
      const tokens = body.split(/\s+/);
      const fecha = tokens[1];
      const hora = tokens[2];
      const rest = body.replace(/^reservar\s+\S+\s+\S+\s+/i, "");
      let cliente = "",
        servicio = "";
      if (/\s-\s/.test(rest)) {
        const parts = rest.split(/\s-\s/);
        cliente = (parts[0] || profile || `WA:${waid}`).trim();
        servicio = parts.slice(1).join(" - ").trim() || "Servicio";
      } else {
        const rtk = rest.split(/\s+/);
        cliente = (rtk[0] || profile || `WA:${waid}`).trim();
        servicio = rtk.slice(1).join(" ").trim() || "Servicio";
      }
      if (!fecha || !hora || !cliente) {
        return res
          .type("text/xml")
          .send(twiml('Formato: reservar YYYY-MM-DD HH:MM Nombre - Servicio'));
      }

      const id = genId();
      // OJO: tu rpc_upsert_cita espera p_negocio_id = NOMBRE del negocio (ej. "spa_roma")
      const p_negocio_id = negocioName || "spa_roma"; // <-- PON aquí el nombre real de tu negocio si no usas hashtag

      try {
        await rpc("rpc_upsert_cita", {
          p_secret: bizSecret,
          p_id: id,
          p_negocio_id, // name, no uuid
          p_fecha: fecha,
          p_hora: hora,
          p_cliente: cliente,
          p_telefono: waid ? `+52${waid}` : "",
          p_servicio: servicio,
          p_estado: "confirmada",
          p_monto: 0,
          p_forma_pago: "",
          p_calendar_event_id: "",
        });

        const msg =
          `✅ Cita creada\n` +
          `ID: ${id}\n` +
          `Fecha: ${fecha} ${hora}\n` +
          `Cliente: ${cliente}\n` +
          `Servicio: ${servicio}`;
        return res.type("text/xml").send(twiml(msg));
      } catch (e) {
        return res
          .type("text/xml")
          .send(twiml(`⚠️ No se pudo reservar: ${String(e).slice(0, 180)}`));
      }
    }

    return res
      .type("text/xml")
      .send(twiml('No entendí. Escribe "ayuda" o usa "reservar ..." / "cancelar ..."'));
  } catch (err) {
    return res.type("text/xml").send(twiml(`Error: ${String(err).slice(0, 180)}`));
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("AutoCitaMX listening on " + port));
