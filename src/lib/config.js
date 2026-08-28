const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..', '..')

const DEFAULTS = {
  tipos: ['document', 'image', 'video', 'audio'],
  carpetaMedia: 'media',
  descubrir: { escucharSegundos: 120 },
  metricas: { intervaloSegundos: 60 }
}

function cargar () {
  const ruta = path.join(RAIZ, 'config.json')
  if (!fs.existsSync(ruta)) {
    throw new Error(
      'Falta config.json.\n' +
      '  Copiá config.example.json a config.json y completá la whitelist.\n' +
      '  Los JID se descubren con: npm run descubrir'
    )
  }

  const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(ruta, 'utf8')) }

  // La whitelist acepta strings sueltos o { jid, alias }. Normalizamos a lo segundo:
  // el alias es lo que nombra la carpeta, así que tiene que ser apto para nombre de archivo.
  const whitelist = (cfg.whitelist || []).map((e) => {
    const jid = typeof e === 'string' ? e : e.jid
    if (!jid || !jid.includes('@')) {
      throw new Error(`JID inválido en la whitelist: ${JSON.stringify(e)}`)
    }
    const alias = (typeof e === 'object' && e.alias) || jid.split('@')[0]
    return { jid, alias: sanear(alias) }
  })

  if (whitelist.length === 0) {
    throw new Error('La whitelist de config.json está vacía: el daemon no guardaría nada.')
  }

  // El webhook es opcional: sin url, el daemon no avisa a nadie y funciona igual.
  const urlWebhook = cfg.webhook && cfg.webhook.url
  if (urlWebhook && !urlWebhook.startsWith('http://') && !urlWebhook.startsWith('https://')) {
    throw new Error(`webhook.url tiene que ser http(s): ${cfg.webhook.url}`)
  }

  const porJid = new Map(whitelist.map((e) => [e.jid, e]))

  return {
    ...cfg,
    whitelist,
    // El filtro es del lado del cliente: el socket recibe todos los chats de la cuenta,
    // así que esto es lo único que decide qué se persiste.
    enWhitelist: (jid) => porJid.get(jid) || null,
    rutas: {
      raiz: RAIZ,
      auth: path.join(RAIZ, 'auth'),
      media: path.join(RAIZ, cfg.carpetaMedia),
      data: path.join(RAIZ, 'data'),
      logs: path.join(RAIZ, 'logs')
    }
  }
}

function sanear (texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sin-nombre'
}

module.exports = { cargar, sanear, RAIZ }
