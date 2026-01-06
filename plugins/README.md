# Tenant Plugin

Plugin de Mongoose para implementar multi-tenancy en la aplicación.

## Uso Básico

### 1. Aplicar el plugin a un schema

```javascript
const mongoose = require('mongoose');
const tenantPlugin = require('./plugins/tenantPlugin');

const productoSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  precio: { type: Number, required: true }
});

// Aplicar el plugin
productoSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Producto', productoSchema);
```

### 2. Crear documentos con tenantId

```javascript
const Producto = require('./models/Producto');

// El tenantId es obligatorio
const producto = new Producto({
  nombre: 'Producto 1',
  precio: 100,
  tenantId: '507f1f77bcf86cd799439011' // ObjectId del tenant
});

await producto.save(); // Validará que tenantId existe
```

### 3. Consultar con filtrado automático por tenant

```javascript
// Opción 1: Usar el método forTenant (recomendado)
const productos = await Producto
  .forTenant('507f1f77bcf86cd799439011')
  .find();

// Opción 2: Especificar tenantId manualmente en el query
const productos = await Producto.find({
  tenantId: '507f1f77bcf86cd799439011'
});
```

## Características

✅ **Campo tenantId automático**: Se agrega a todos los schemas que usen el plugin
- Tipo: ObjectId
- Required: true
- Indexed: true

✅ **Validación en save**: Verifica que tenantId existe antes de guardar

✅ **Filtrado automático**: Los siguientes métodos filtran por tenantId si se usa `forTenant()`:
- `find()`
- `findOne()`
- `findOneAndUpdate()`
- `findOneAndDelete()`
- `updateOne()`
- `updateMany()`
- `deleteOne()`
- `deleteMany()`

## Integración con Middleware

Para usar el plugin con middleware de autenticación:

```javascript
// middleware/tenantMiddleware.js
function tenantMiddleware(req, res, next) {
  // Asume que el tenantId viene del usuario autenticado
  req.tenantId = req.user.tenantId;
  next();
}

// En las rutas
router.get('/productos', tenantMiddleware, async (req, res) => {
  const productos = await Producto
    .forTenant(req.tenantId)
    .find();
  res.json(productos);
});
```

## Notas Importantes

- El plugin NO crea el modelo `Tenant`. Debe crearse por separado si se necesita
- Todos los modelos que usen este plugin deben tener un tenantId válido
- El filtrado automático solo funciona cuando se usa el método `forTenant()`
