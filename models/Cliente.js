// models/Cliente.js
const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  nombre:          { type: String, required: true },
  codigo_cliente:  { type: String, unique: true },
  sender_id:       { type: [String], default: [] },
  user_id:         { type: String },              // user_id de ML
  auto_ingesta:    { type: Boolean, default: false },
  lista_precios:   {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ListaDePrecios',
    required: true
  },
  cuit:            { type: String },
  razon_social:    { type: String },
  condicion_iva:   {
    type: String,
    enum: ['Responsable Inscripto', 'Monotributo', 'Exento'],
    required: true
  },
  horario_de_corte:{ type: String, required: true },
  link_vinculacion:{ type: String },

  // ===== CONFIGURACIÓN DE FACTURACIÓN =====
  facturacion: {
    // Horarios de corte
    horario_corte_lunes_viernes: {
      type: String,
      default: '13:00'
    },
    horario_corte_sabado: {
      type: String,
      default: '12:00'
    },
    horario_corte_domingo: {
      type: String,
      default: null  // null = no trabaja domingos
    },

    // Tipo de período
    tipo_periodo: {
      type: String,
      enum: ['semanal', 'quincenal', 'mensual'],
      default: 'semanal'
    },

    // Zona horaria
    zona_horaria: {
      type: String,
      default: 'America/Argentina/Buenos_Aires'
    },

    // Notas (límites diarios, excepciones ML, etc.)
    notas_facturacion: String
  },

  permisos: {
    puedeRequerirFirma: {
      type: Boolean,
      default: false
    }
    // Otros permisos futuros...
  }
}, { timestamps: true });

clienteSchema.pre('validate', async function(next) {
  if (!this.codigo_cliente) {
    const parts = this.nombre.trim().split(/\s+/);
    let base;

    if (parts.length > 1) {
      // iniciales de hasta 4 palabras
      base = parts.slice(0,4).map(w => w[0]).join('').toUpperCase();
    } else {
      // primeras 4 letras de la palabra
      base = parts[0].substr(0,4).toUpperCase();
    }
    // si quedó muy corto, rellenamos con random
    while (base.length < 4) {
      base += Math.random().toString(36).substr(2,1).toUpperCase();
    }

    // asegurar unicidad
    let suffix = 0, codigo = base;
    const Cliente = mongoose.model('Cliente');
    while (await Cliente.findOne({ codigo_cliente: codigo })) {
      suffix++;
      codigo = `${base}${suffix}`;
    }
    this.codigo_cliente = codigo;
  }
  next();
});

module.exports = mongoose.models.Cliente ||
  mongoose.model('Cliente', clienteSchema);


