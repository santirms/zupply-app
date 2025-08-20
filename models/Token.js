const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  access_token: String,
  refresh_token: String,
  expires_in: Number,
  fecha_creacion: { type: Date, default: Date.now }
  expires_at: { type: Date, default: null }
});

module.exports = mongoose.model('Token', tokenSchema);
