// utils/s3.js
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT, // opcional: R2/B2/etc
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.S3_BUCKET;

async function ensureObject(key, body, contentType='image/png') {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return; }
  catch(_) {}
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

async function presignGet(key, expiresSec=3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresSec });
}

/**
 * Sube una firma digital de entrega a S3
 * @param {string} firmaBase64 - Firma en formato base64 (puede incluir prefijo data:image/png;base64,)
 * @param {string} envioId - ID del envío
 * @returns {Promise<{url: string, key: string, bucket: string}>} - URL presignada, key y bucket
 */
async function subirFirmaEntrega(firmaBase64, envioId) {
  // Remover prefijo data:image/png;base64, si existe
  let base64Data = firmaBase64;
  if (firmaBase64.includes('base64,')) {
    base64Data = firmaBase64.split('base64,')[1];
  }

  // Convertir base64 a Buffer
  const buffer = Buffer.from(base64Data, 'base64');

  // Generar path: envios/firmas-entrega/YYYY/MM/firma-{envioId}-{timestamp}.png
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = now.getTime();
  const key = `envios/firmas-entrega/${year}/${month}/firma-${envioId}-${timestamp}.png`;

  // Metadata
  const metadata = {
    'envio-id': String(envioId),
    'tipo': 'firma-entrega',
    'fecha-subida': now.toISOString()
  };

  // Subir a S3 con ACL private
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
    ACL: 'private',
    Metadata: metadata
  }));

  // Generar URL firmada (válida por 1 hora por defecto)
  const url = await presignGet(key, 3600);

  return { url, key, bucket: BUCKET };
}

/**
 * Genera una URL firmada temporal para acceder a una firma de entrega
 * @param {string} key - Key de S3 de la firma
 * @param {number} expiracion - Tiempo de expiración en segundos (default: 3600 = 1 hora)
 * @returns {Promise<string>} - URL firmada temporal
 */
async function obtenerUrlFirmadaFirma(key, expiracion = 3600) {
  return presignGet(key, expiracion);
}

/**
 * Elimina una firma de S3
 * @param {string} key - Key de S3 de la firma a eliminar
 * @returns {Promise<void>}
 */
async function eliminarFirma(key) {
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key
  }));
}

/**
 * Sube una foto de evidencia de intento fallido a S3
 * @param {string} fotoBase64 - Foto en formato base64 (puede incluir prefijo data:image/jpeg;base64,)
 * @param {string} envioId - ID del envío
 * @param {string} motivo - Motivo del intento fallido
 * @returns {Promise<{url: string, key: string, bucket: string}>} - URL presignada, key y bucket
 */
async function subirFotoEvidencia(fotoBase64, envioId, motivo) {
  // Remover prefijo data:image/...;base64, si existe
  let base64Data = fotoBase64;
  let contentType = 'image/jpeg';

  if (fotoBase64.includes('base64,')) {
    const parts = fotoBase64.split('base64,');
    base64Data = parts[1];

    // Detectar content type del prefijo
    if (parts[0].includes('image/png')) contentType = 'image/png';
    else if (parts[0].includes('image/webp')) contentType = 'image/webp';
  }

  // Convertir base64 a Buffer
  const buffer = Buffer.from(base64Data, 'base64');

  // Generar path: envios/evidencia-intentos-fallidos/YYYY/MM/intento-{envioId}-{motivo}-{timestamp}.jpg
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = now.getTime();
  const extension = contentType.split('/')[1];
  const key = `envios/evidencia-intentos-fallidos/${year}/${month}/intento-${envioId}-${motivo}-${timestamp}.${extension}`;

  // Metadata
  const metadata = {
    'envio-id': String(envioId),
    'tipo': 'evidencia-intento-fallido',
    'motivo': motivo,
    'fecha-subida': now.toISOString()
  };

  // Subir a S3 con ACL private
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: 'private',
    Metadata: metadata
  }));

  // Generar URL firmada (válida por 7 días para evidencia)
  const url = await presignGet(key, 7 * 24 * 3600);

  return { url, key, bucket: BUCKET };
}

/**
 * Genera una URL firmada temporal para acceder a cualquier objeto en S3
 * @param {string} key - Key de S3 del objeto
 * @param {number} expiracion - Tiempo de expiración en segundos (default: 3600 = 1 hora)
 * @returns {Promise<string>} - URL firmada temporal
 */
async function obtenerUrlFirmada(key, expiracion = 3600) {
  return presignGet(key, expiracion);
}

module.exports = {
  ensureObject,
  presignGet,
  subirFirmaEntrega,
  obtenerUrlFirmadaFirma,
  eliminarFirma,
  subirFotoEvidencia,
  obtenerUrlFirmada
};
