const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const { requireAuth, requireRole } = require('../middlewares/auth');
const identifyTenant = require('../middlewares/identifyTenant');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer para upload de logo (guardar en /public/uploads/logos/)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'logos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${req.tenantId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Formato no soportado. Usar PNG, JPG, SVG o WebP.'));
  }
});

router.use(requireAuth);
router.use(identifyTenant);

// GET /api/tenant/settings — Obtener configuración actual
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId)
      .select('companyName settings fiscal subdomain')
      .lean();
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    res.json(tenant);
  } catch (err) {
    console.error('[tenant-settings] GET error:', err);
    res.status(500).json({ error: 'Error obteniendo configuración' });
  }
});

// PUT /api/tenant/settings — Actualizar configuración
router.put('/', requireRole('admin'), async (req, res) => {
  try {
    const { companyName, settings, fiscal } = req.body;
    const update = {};

    if (companyName) update.companyName = companyName;

    // Settings: merge parcial (no pisar campos no enviados)
    if (settings) {
      if (settings.brandColor) update['settings.brandColor'] = settings.brandColor;
      if (settings.companyInfo) {
        if (settings.companyInfo.email) update['settings.companyInfo.email'] = settings.companyInfo.email;
        if (settings.companyInfo.phone) update['settings.companyInfo.phone'] = settings.companyInfo.phone;
        if (settings.companyInfo.address) update['settings.companyInfo.address'] = settings.companyInfo.address;
      }
    }

    // Fiscal: merge parcial
    if (fiscal) {
      if (fiscal.cuit !== undefined) update['fiscal.cuit'] = fiscal.cuit;
      if (fiscal.razon_social !== undefined) update['fiscal.razon_social'] = fiscal.razon_social;
      if (fiscal.domicilio_fiscal !== undefined) update['fiscal.domicilio_fiscal'] = fiscal.domicilio_fiscal;
      if (fiscal.condicion_iva !== undefined) update['fiscal.condicion_iva'] = fiscal.condicion_iva;
      if (fiscal.ingresos_brutos !== undefined) update['fiscal.ingresos_brutos'] = fiscal.ingresos_brutos;
      if (fiscal.inicio_actividades !== undefined) update['fiscal.inicio_actividades'] = fiscal.inicio_actividades;
    }

    const tenant = await Tenant.findByIdAndUpdate(
      req.tenantId,
      { $set: update },
      { new: true }
    ).select('companyName settings fiscal subdomain').lean();

    res.json(tenant);
  } catch (err) {
    console.error('[tenant-settings] PUT error:', err);
    res.status(500).json({ error: 'Error actualizando configuración' });
  }
});

// POST /api/tenant/settings/logo — Subir logo
router.post('/logo', requireRole('admin'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const logoUrl = `/uploads/logos/${req.file.filename}`;

    await Tenant.findByIdAndUpdate(req.tenantId, {
      $set: { 'settings.logo': logoUrl }
    });

    res.json({ logo: logoUrl, message: 'Logo actualizado correctamente' });
  } catch (err) {
    console.error('[tenant-settings] POST logo error:', err);
    res.status(500).json({ error: 'Error subiendo logo' });
  }
});

// DELETE /api/tenant/settings/logo — Eliminar logo
router.delete('/logo', requireRole('admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('settings.logo').lean();

    if (tenant?.settings?.logo) {
      // Intentar borrar archivo físico
      const filepath = path.join(__dirname, '..', 'public', tenant.settings.logo);
      try { fs.unlinkSync(filepath); } catch {}
    }

    await Tenant.findByIdAndUpdate(req.tenantId, {
      $unset: { 'settings.logo': '' }
    });

    res.json({ message: 'Logo eliminado' });
  } catch (err) {
    console.error('[tenant-settings] DELETE logo error:', err);
    res.status(500).json({ error: 'Error eliminando logo' });
  }
});

module.exports = router;
