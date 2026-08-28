const path = require('path')
const { sanear } = require('./config')

const TIPOS = {
  documentMessage: 'document',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker'
}

const EXT_POR_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'application/zip': '.zip'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Los adjuntos vienen envueltos según cómo se mandaron (efímero, ver una vez,
// documento con epígrafe). Hay que pelar esas capas antes de encontrar la media.
function desenvolver (message) {
  let m = message
  for (let i = 0; i < 5 && m; i++) {
    const envoltura = m.ephemeralMessage || m.viewOnceMessage ||
      m.viewOnceMessageV2 || m.viewOnceMessageV2Extension ||
      m.documentWithCaptionMessage
    if (!envoltura || !envoltura.message) break
    m = envoltura.message
  }
  return m
}

function detectar (message) {
  const m = desenvolver(message)
  if (!m) return null
  for (const [clave, tipo] of Object.entries(TIPOS)) {
    if (m[clave]) return { tipo, clave, contenido: m[clave], mensaje: m }
  }
  return null
}

function extension (contenido) {
  const nombre = contenido.fileName || contenido.title
  if (nombre && path.extname(nombre)) return path.extname(nombre).toLowerCase()
  const mime = (contenido.mimetype || '').split(';')[0].trim()
  return EXT_POR_MIME[mime] || '.bin'
}

const dosDigitos = (n) => String(n).padStart(2, '0')

// Hora local, no UTC: con UTC un adjunto de las 22:00 del 31 se archiva en el
// mes siguiente (Argentina es UTC-3).
function mesLocal (fecha) {
  return fecha.getFullYear() + '-' + dosDigitos(fecha.getMonth() + 1)
}

function marcaLocal (fecha) {
  return mesLocal(fecha) + '-' + dosDigitos(fecha.getDate()) +
    'T' + dosDigitos(fecha.getHours()) + '-' + dosDigitos(fecha.getMinutes()) +
    '-' + dosDigitos(fecha.getSeconds())
}

// WhatsApp no siempre manda el nombre real: según desde dónde se comparta el
// archivo, fileName llega como un UUID. En ese caso el epígrafe suele ser lo
// único legible, así que se usa como nombre antes de caer en "adjunto".
function baseDelNombre (contenido) {
  const candidatos = [contenido.fileName, contenido.title]
  for (const c of candidatos) {
    if (!c) continue
    const sinExt = path.basename(c, path.extname(c))
    if (sinExt && !UUID.test(sinExt)) return sanear(sinExt)
  }
  if (contenido.caption) {
    const primeraLinea = contenido.caption.split('\n')[0].trim().slice(0, 50)
    if (primeraLinea) return sanear(primeraLinea)
  }
  return 'adjunto'
}

// Nombre estable y ordenable. El id corto del mensaje va al final para que dos
// adjuntos con el mismo nombre en el mismo segundo no se pisen.
function nombreArchivo ({ fecha, remitente, contenido, idMensaje }) {
  return `${marcaLocal(fecha)}__${sanear(remitente)}__${baseDelNombre(contenido)}__${idMensaje.slice(-6)}${extension(contenido)}`
}

function fechaDe (msg) {
  const seg = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0)
  return seg > 0 ? new Date(seg * 1000) : new Date()
}

module.exports = { detectar, desenvolver, extension, nombreArchivo, baseDelNombre, fechaDe, mesLocal, marcaLocal, TIPOS }
