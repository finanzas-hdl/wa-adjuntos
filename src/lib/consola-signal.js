const fs = require('fs')
const path = require('path')
const util = require('util')

// libsignal escribe directo con console.log/error, sin pasar por el logger de
// Baileys. Entre esos volcados manda objetos SessionEntry completos, que
// incluyen claves privadas del ratchet. Eso no puede quedar en un log (menos en
// el journal de un VPS), así que le desviamos la consola a un archivo aparte y
// le sacamos los buffers.
function desviar (rutas, contadores) {
  fs.mkdirSync(rutas.logs, { recursive: true })
  const archivo = path.join(rutas.logs, 'signal.log')

  const redactar = (t) => t
    .replace(/<Buffer[^>]*>/g, '<Buffer [redactado]>')
    .replace(/'[A-Za-z0-9+/]{40,}='?/g, "'[clave redactada]'")

  const escribir = (...args) => {
    const texto = args
      .map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 2, breakLength: 120 })))
      .join(' ')

    if (/Failed to decrypt|Bad MAC|No session found/i.test(texto)) {
      contadores.fallosDescifrado++
    }

    try {
      fs.appendFileSync(archivo, new Date().toISOString() + ' ' + redactar(texto) + '\n')
    } catch { /* nunca tumbar el daemon por un log */ }
  }

  for (const nivel of ['log', 'error', 'warn', 'info', 'debug', 'trace']) {
    console[nivel] = escribir
  }

  return archivo
}

module.exports = { desviar }
