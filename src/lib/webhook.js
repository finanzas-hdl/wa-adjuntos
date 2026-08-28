const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Aviso opcional a un sistema de aguas abajo (n8n, una skill, lo que sea) cada
// vez que aterriza un adjunto.
//
// Es best-effort a propósito: el archivo en disco y el manifiesto son la fuente
// de verdad. Si el receptor está caído, la captura sigue igual y el evento queda
// en logs/webhook-fallidos.jsonl para reenviarlo a mano. El daemon nunca depende
// de que alguien conteste.
function crear ({ cfg, log, stats, enviar }) {
  const conf = cfg.webhook || {}

  if (!conf.url) {
    return { activo: false, notificar: async () => {} }
  }

  const timeout = conf.timeoutMs || 5000
  const fallidos = path.join(cfg.rutas.logs, 'webhook-fallidos.jsonl')

  const enviarHttp = enviar || (async (url, cuerpo, cabeceras) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: cabeceras,
      body: cuerpo,
      signal: AbortSignal.timeout(timeout)
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r
  })

  async function notificar (registro) {
    const cuerpo = JSON.stringify({ evento: 'adjunto.guardado', ...registro })

    const cabeceras = { 'Content-Type': 'application/json' }
    if (conf.secreto) {
      // HMAC del cuerpo en vez del secreto en claro: quien reciba puede verificar
      // que el POST salió de acá y que nadie lo tocó en el camino.
      cabeceras['X-Wa-Adjuntos-Firma'] =
        'sha256=' + crypto.createHmac('sha256', conf.secreto).update(cuerpo).digest('hex')
    }

    try {
      await enviarHttp(conf.url, cuerpo, cabeceras)
      stats.webhooksEnviados++
    } catch (e) {
      stats.webhooksFallidos++
      log.warn(`webhook falló (${e.message}) — el archivo ya está guardado; evento en ${fallidos}`)
      try {
        fs.appendFileSync(fallidos, JSON.stringify({ t: new Date().toISOString(), motivo: e.message, cuerpo: JSON.parse(cuerpo) }) + '\n')
      } catch { /* ni el registro del fallo puede tumbar la captura */ }
    }
  }

  return { activo: true, url: conf.url, notificar }
}

module.exports = { crear }
