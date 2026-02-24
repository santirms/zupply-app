const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const { requireAuth, requireRole } = require('../middlewares/auth');
const identifyTenant = require('../middlewares/identifyTenant');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { presignGet } = require('../utils/s3');

// Multer en memoria (no guarda a disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato no soportado. Usar PNG, JPG, SVG o WebP.'));
  }
});

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});
const BUCKET = process.env.S3_BUCKET;

router.use(requireAuth);
router.use(identifyTenant);

// GET /api/tenant/settings — Obtener configuración actual
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId)
      .select('companyName settings fiscal subdomain')
      .lean();
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    // Si hay logo, generar URL presignada
    if (tenant.settings?.logo) {
      tenant.settings.logoUrl = await presignGet(tenant.settings.logo, 3600);
    }

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

// POST /api/tenant/settings/logo — Subir logo a S3
router.post('/logo', requireRole('admin'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    // Intentar redimensionar con sharp si está disponible
    try {
      const sharp = require('sharp');
      const metadata = await sharp(req.file.buffer).metadata();

      if (metadata.width > 400 || metadata.height > 200) {
        const resized = await sharp(req.file.buffer)
          .resize(400, 200, { fit: 'inside', withoutEnlargement: true })
          .toBuffer();
        req.file.buffer = resized;
      }
    } catch (e) {
      console.warn('sharp no disponible, subiendo logo sin redimensionar');
    }

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const key = `tenants/${req.tenantId}/logo.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: {
        'tenant-id': String(req.tenantId),
        'tipo': 'logo',
        'fecha-subida': new Date().toISOString()
      }
    }));

    // Guardar la key de S3 en el tenant (no la URL, porque es presignada y expira)
    await Tenant.findByIdAndUpdate(req.tenantId, {
      $set: { 'settings.logo': key }
    });

    // Devolver URL presignada para preview inmediato
    const url = await presignGet(key, 3600);

    res.json({ logo: key, logoUrl: url, message: 'Logo actualizado correctamente' });
  } catch (err) {
    console.error('[tenant-settings] POST logo error:', err);
    res.status(500).json({ error: 'Error subiendo logo' });
  }
});

// DELETE /api/tenant/settings/logo — Eliminar logo de S3
router.delete('/logo', requireRole('admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('settings.logo').lean();

    if (tenant?.settings?.logo) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: tenant.settings.logo
        }));
      } catch (e) {
        console.warn('No se pudo borrar logo de S3:', e.message);
      }
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
