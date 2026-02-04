// routes/kpis.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar middleware a todas las rutas
router.use(identifyTenant);

// ==== Helpers de fechas (AR -03:00) ====
function atLocal(dayISO, hhmm = '00:00') {
  const [H='00', m='00'] = String(hhmm).split(':');
  // Fijamos zona -03:00 (Argentina) componiendo el ISO con offset
  return new Date(`${dayISO}T${H.padStart(2,'0')}:${m.padStart(2,'0')}:00-03:00`);
}

function todayISO() {
  // Obtener fecha actual en Argentina (UTC-3)
  const now = new Date();
  const arTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  
  // Formatear como YYYY-MM-DD
  const year = arTime.getFullYear();
  const month = String(arTime.getMonth() + 1).padStart(2, '0');
  const day = String(arTime.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

function yesterdayISO() {
  const now = new Date();
  const arTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  
  // Restar 1 día
  arTime.setDate(arTime.getDate() - 1);
  
  const year = arTime.getFullYear();
  const month = String(arTime.getMonth() + 1).padStart(2, '0');
  const day = String(arTime.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Ventana desde el último reset HH:mm (p.ej. 23:30) hasta "ahora".
 * Si "ahora" es antes del reset de hoy, arranca en el reset de ayer.
 */
function windowFromReset(hhmm = '23:30') {
  const now = new Date();
  const tISO = todayISO();
  const yISO = yesterdayISO();
  const resetToday  = atLocal(tISO, hhmm);
  const start = (now >= resetToday) ? resetToday : atLocal(yISO, hhmm);
  return { start, end: now };
}

// ==== Handler principal ====
router.get('/home', async (req, res) => {
  try {
    const now = new Date();
    // 7 días atrás (para pendientes/incidencias)
    const start7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Entregados de "hoy calendario" (00:00 → 24:00)
    const tISO = todayISO();
    const startDia = atLocal(tISO, '00:00');
    const endDia   = atLocal(tISO, '23:59');
    
    // 7 días atrás (para EN RUTA)
    const start7d_ruta = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // === Consultas (countDocuments) con tenantId ===
    const [pendientes, en_ruta, entregados, incidencias] = await Promise.all([
      // pendientes: estado=pendiente, últimas 48h
      Envio.countDocuments({
        estado: 'pendiente',
        fecha: { $gte: start7d },
        tenantId: req.tenantId
      }),
      
      // en ruta: estado=en_camino, últimas 36h
      Envio.countDocuments({
        estado: 'en_camino',
        fecha: { $gte: start7d_ruta },
        tenantId: req.tenantId
      }),
      
      // entregados: hoy (00:00 → 23:59)
      Envio.countDocuments({
        estado: 'entregado',
        historial: {
          $elemMatch: {
            'estado_meli.status': 'delivered',
            at: { $gte: startDia, $lte: endDia }
          }
        },
        tenantId: req.tenantId
      }),
      
      // incidencias: 48h con estados específicos
      Envio.countDocuments({
        estado: { $in: ['reprogramado', 'comprador_ausente', 'demorado'] },
        fecha: { $gte: start7d },
        tenantId: req.tenantId
      })
    ]);
    
    return res.json({ pendientes, en_ruta, entregados, incidencias });
  } catch (e) {
    console.error('KPIs /home error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// (Opcional) ping rápido para verificar disponibilidad
router.get('/ping', (_req, res) => res.json({ ok: true }));

module.exports = router;
