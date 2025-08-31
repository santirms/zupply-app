const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, trim: true, lowercase: true, required: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['admin','coordinador','chofer'], required: true },
  driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null }, // para chofer
  is_active: { type: Boolean, default: true },
  last_login: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
