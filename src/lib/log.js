const fs = require('fs')
const path = require('path')

const dd = (n) => String(n).padStart(2, '0')

// Hora local, igual que los nombres de archivo: tener el log en UTC y los
// adjuntos en hora argentina obliga a hacer la cuenta mental cada vez.
function marca () {
  const f = new Date()
  return `${f.getFullYear()}-${dd(f.getMonth() + 1)}-${dd(f.getDate())} ` +
    `${dd(f.getHours())}:${dd(f.getMinutes())}:${dd(f.getSeconds())}`
}

function crear (rutas, nombre) {
  fs.mkdirSync(rutas.logs, { recursive: true })
  const archivo = path.join(rutas.logs, nombre + '.log')

  const escribir = (nivel, msg) => {
    const linea = `${marca()} [${nivel}] ${msg}`
    // process.stdout en vez de console.log: consola-signal.js desvía console.*
    // para que los volcados de libsignal no ensucien la salida.
    process.stdout.write(linea + '\n')
    try { fs.appendFileSync(archivo, linea + '\n') } catch { /* el log nunca tumba el daemon */ }
  }

  return {
    archivo,
    info: (m) => escribir('info', m),
    ok: (m) => escribir(' ok ', m),
    warn: (m) => escribir('WARN', m),
    error: (m) => escribir('ERR ', m)
  }
}

// Logger para Baileys. Una sola instancia: la usan tanto el socket como la
// descarga de media — downloadMediaMessage llama logger.info() sin guarda en la
// rama de reupload, así que pasarle undefined rompe justo cuando la media caducó.
let pinoCache = null
function crearPino (rutas) {
  if (pinoCache) return pinoCache
  const pino = require('pino')
  fs.mkdirSync(rutas.logs, { recursive: true })
  pinoCache = pino(
    { level: 'warn' },
    pino.destination({ dest: path.join(rutas.logs, 'baileys.log'), sync: false })
  )
  return pinoCache
}

module.exports = { crear, crearPino }
