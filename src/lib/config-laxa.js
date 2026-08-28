const fs = require('fs')
const path = require('path')
const { RAIZ } = require('./config')

// Igual que config.cargar() pero sin exigir whitelist: al descubrir todavía no existe.
function cargarLaxa () {
  const ruta = path.join(RAIZ, 'config.json')
  const cfg = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {}
  return {
    ...cfg,
    rutas: {
      raiz: RAIZ,
      auth: path.join(RAIZ, 'auth'),
      media: path.join(RAIZ, cfg.carpetaMedia || 'media'),
      data: path.join(RAIZ, 'data'),
      logs: path.join(RAIZ, 'logs')
    }
  }
}

module.exports = { cargarLaxa }
