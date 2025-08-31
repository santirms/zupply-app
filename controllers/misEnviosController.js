const Envio = require('../models/Envio');

exports.misDelDia = async (req, res, next) => {
  try {
    const { driver_id } = req.session.user;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const mañana = new Date(hoy); mañana.setDate(hoy.getDate() + 1);

    const envios = await Envio.find({
      chofer_id: driver_id,
      createdAt: { $gte: hoy, $lt: mañana } // ajustá al campo fecha que uses
    }).lean();

    res.json({ envios });
  } catch (e) { next(e); }
};

exports.marcarEntregado = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Envio.findByIdAndUpdate(id, {
      estado: 'entregado',
      $push: { historial: { at: new Date(), estado: 'entregado', source: 'panel', actor_name: 'chofer' } }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
};
