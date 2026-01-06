const mongoose = require('mongoose');
const tenantPlugin = require('../middlewares/tenantPlugin');

const UserSchema = new mongoose.Schema({
  email:   { type: String, trim: true, lowercase: true, unique: false }, // no obligatoria para chofer
  username:{ type: String, trim: true, lowercase: true, unique: false }, // login por nombre para chofer
  phone:   { type: String, trim: true },                                  // útil para chofer
  password_hash: { type: String, required: true, select: false },
  role:    { type: String, enum: ['admin','coordinador','chofer','cliente'], required: true },
  driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chofer', default: null },
  sender_ids: { type: [String], 'default': () => [], index: true },
  cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', default: null },
  is_active: { type: Boolean, default: true },
  must_change_password: { type: Boolean, default: false }, // para forzar cambio en primer login
  last_login: { type: Date },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true }
}, { timestamps: true });
 
// índices (parciales, sin $nin/$ne) - únicos por tenant

// Aplicar plugin de multi-tenant
UserSchema.plugin(tenantPlugin);

// índices (parciales, sin $nin/$ne)
UserSchema.index(
  { email: 1, tenantId: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true } } }
);
UserSchema.index(
  { username: 1, tenantId: 1 },
  { unique: true, partialFilterExpression: { username: { $exists: true } } }
);
// opcional: 1 usuario por chofer por tenant
UserSchema.index(
  { driver_id: 1, tenantId: 1 },
  { unique: true, partialFilterExpression: { driver_id: { $exists: true } } }
);

// Índice compuesto único para tenantId + email (multi-tenant)
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

UserSchema.pre('validate', function(next) {
  if (this.email === ''  || this.email == null)   this.email = undefined;
  if (this.username === '' || this.username == null) this.username = undefined;
  if (this.driver_id === null) this.driver_id = undefined;
  next();
});

module.exports = mongoose.model('User', UserSchema);

