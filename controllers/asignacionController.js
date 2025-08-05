// backend/controllers/asignacionController.js
const Envio = require('../models/Envio');

exports.asignarViaQR = async (req, res) => {
  const { trackingId, choferId, zonaId } = req.body;
  const envio = await Envio.findOneAndUpdate(
    { tracking_id: trackingId },
    { chofer: choferId, zonaAsignada: zonaId, estado: 'asignado' },
    { new: true }
  );
  if (!envio) return res.status(404).json({ msg: 'No existe ese envío' });
  res.json(envio);
};

exports.asignarViaMapa = async (req, res) => {
  const { envios, choferId, zonaId } = req.body; // envios = [tracking_id1, ...]
  const resultados = await Promise.all(envios.map(tid =>
    Envio.findOneAndUpdate(
      { tracking_id: tid },
      { chofer: choferId, zonaAsignada: zonaId, estado: 'asignado' },
      { new: true }
    )
  ));
  res.json(resultados);
};
