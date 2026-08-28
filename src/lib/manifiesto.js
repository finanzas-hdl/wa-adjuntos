const fs = require('fs')
const path = require('path')

// Un registro por línea (JSONL). Es la fuente de verdad para la idempotencia:
// si el proceso se cae y reconecta, WhatsApp puede reentregar mensajes ya bajados.
function abrir (rutas) {
  fs.mkdirSync(rutas.data, { recursive: true })
  const archivo = path.join(rutas.data, 'manifiesto.jsonl')

  const vistos = new Set()
  const porHash = new Map()

  if (fs.existsSync(archivo)) {
    for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
      if (!linea.trim()) continue
      try {
        const r = JSON.parse(linea)
        // Solo lo GUARDADO bloquea un reintento. Un fallo transitorio (mensaje
        // indescifrable, descarga caída) no puede marcar el id como visto: WhatsApp
        // reentrega el mismo mensaje y esa segunda copia es la que hay que bajar.
        if (r.clave && r.estado === 'guardado') vistos.add(r.clave)
        if (r.sha256 && r.estado === 'guardado') porHash.set(r.sha256, r.archivo)
      } catch { /* línea corrupta: se ignora, no se pierde el resto */ }
    }
  }

  return {
    archivo,
    yaVisto: (clave) => vistos.has(clave),
    archivoConHash: (sha) => porHash.get(sha) || null,
    total: () => vistos.size,
    // appendFileSync a propósito: un stream con buffer puede perder la última
    // línea si el proceso muere, y ahí se rompe la idempotencia.
    registrar (r) {
      if (r.clave && r.estado === 'guardado') vistos.add(r.clave)
      if (r.sha256 && r.estado === 'guardado') porHash.set(r.sha256, r.archivo)
      fs.appendFileSync(archivo, JSON.stringify(r) + '\n')
    }
  }
}

module.exports = { abrir }
