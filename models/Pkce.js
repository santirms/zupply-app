const mongoose = require('mongoose');

const pkceSchema = new mongoose.Schema({
  state: { type: String, required: true, index: true },
  code_verifier: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 600 } // TTL 10 minutos
});

module.exports = mongoose.model('Pkce', pkceSchema);
