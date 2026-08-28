const fs = require('fs')
const path = require('path')

// Recuerda hasta dónde llegó la última corrida, para que el uso diario sea
// simplemente "npm run captar" sin pensar fechas.
function abrir (rutas) {
  fs.mkdirSync(rutas.data, { recursive: true })
  const archivo = path.join(rutas.data, 'estado.json')

  let datos = {}
  if (fs.existsSync(archivo)) {
    try { datos = JSON.parse(fs.readFileSync(archivo, 'utf8')) } catch { datos = {} }
  }

  return {
    archivo,
    ultimaCorrida: datos.ultimaCorrida || null,
    // Se guarda al terminar bien, nunca al empezar: si la corrida se corta a la
    // mitad, la próxima vuelve a cubrir la misma ventana en vez de saltearla.
    marcarCorrida (hasta) {
      datos.ultimaCorrida = hasta.toISOString()
      datos.corridas = (datos.corridas || 0) + 1
      fs.writeFileSync(archivo, JSON.stringify(datos, null, 2) + '\n')
    }
  }
}

module.exports = { abrir }
