// models/Chofer.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ChoferSchema = new Schema({
  nombre:   { type: String, required: true },
  telefono: { type: String, required: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('Chofer', ChoferSchema);
