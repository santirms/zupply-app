// utils/history.js
const Envio = require('../models/Envio');

async function addHistory(envioId, { estado, estado_meli, source, actor_name, note }) {
  await Envio.updateOne(
    { _id: envioId },
    { $push: { historial: { at: new Date(), estado, estado_meli, source, actor_name, note } } }
  );
}

module.exports = { addHistory };
