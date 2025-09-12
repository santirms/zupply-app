const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email:   { type: String, trim: true, lowercase: true, unique: false }, // no obligatoria para chofer
  username:{ type: String, trim: true, lowercase: true, unique: false }, // login por nombre para chofer
  phone:   { type: String, trim: true },                                  // útil para chofer
  password_hash: { type: String, required: true, select: false },
  role:    { type: String, enum: ['admin','coordinador','chofer'], required: true },
  driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chofer', default: null },
  is_active: { type: Boolean, default: true },
  must_change_password: { type: Boolean, default: false }, // para forzar cambio en primer login
  last_login: { type: Date }
}, { timestamps: true });

// índices
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $nin: [null, ''] } } }
);
UserSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $exists: true, $nin: [null, ''] } } }
);
UserSchema.index({ driver_id: 1 }, { unique: true, partialFilterExpression: { driver_id: { $exists: true, $ne: null } } });

module.exports = mongoose.model('User', UserSchema);

