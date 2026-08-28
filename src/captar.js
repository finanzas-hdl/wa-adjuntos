const fs = require('fs')
const path = require('path')
const { downloadMediaMessage } = require('baileys')

const { cargar } = require('./lib/config')
const { crear: crearLog, crearPino } = require('./lib/log')
const { abrir: abrirManifiesto } = require('./lib/manifiesto')
const { abrir: abrirEstado } = require('./lib/estado')
const { crearProcesador, crearStats } = require('./lib/procesar')
const { crear: crearWebhook } = require('./lib/webhook')
const { conectar } = require('./lib/sesion')
const { desviar } = require('./lib/consola-signal')
const { parsear, resolverRango, aTexto } = require('./lib/args')

const AYUDA = `
Captura los adjuntos que WhatsApp entregue para los chats de la whitelist y
termina sola. Pensada para correrla cuando se necesita, no para dejarla prendida.

  npm run captar                     desde la última corrida (uso diario)
  npm run captar -- --dias=3         los últimos 3 días
  npm run captar -- --desde=2026-08-24 --hasta=2026-08-26
  npm run captar -- --silencio=90    esperar 90s sin novedades antes de salir (default 60)
  npm run captar -- --max=20         cortar a los 20 minutos pase lo que pase (default 15)
  npm run captar -- --continuo       no salir nunca (modo daemon, para medir)

El rango es un FILTRO sobre lo que WhatsApp entrega al reconectar, no una
consulta al historial: los adjuntos viejos suelen estar caducados del lado del
servidor y no se pueden recuperar.
`

async function main () {
  const args = parsear(process.argv.slice(2))
  if (args.ayuda || args.help) { console.log(AYUDA); return }

  const cfg = cargar()
  const log = crearLog(cfg.rutas, 'captar')
  const manifiesto = abrirManifiesto(cfg.rutas)
  const estado = abrirEstado(cfg.rutas)

  const continuo = !!args.continuo
  const silencio = Number(args.silencio || 60) * 1000
  const maxMs = Number(args.max || 15) * 60 * 1000
  const rango = continuo ? null : resolverRango(args, estado.ultimaCorrida)

  const stats = crearStats()
  const webhook = crearWebhook({ cfg, log, stats })
  const loggerBaileys = crearPino(cfg.rutas)

  const descargar = (mensaje, sock) => downloadMediaMessage(
    mensaje, 'buffer', {},
    { logger: loggerBaileys, reuploadRequest: sock.updateMediaMessage }
  )

  const { procesar } = crearProcesador({ cfg, log, manifiesto, descargar, webhook, rango, stats })

  const signalLog = desviar(cfg.rutas, stats)

  log.info(`whitelist: ${cfg.whitelist.map((e) => e.alias).join(', ')}`)
  if (rango) {
    log.info(`ventana: ${aTexto(rango.desde)} → ${rango.hasta ? aTexto(rango.hasta) : 'lo que llegue'} (${rango.origen})`)
  } else {
    log.info('modo continuo: sin filtro de fechas, no termina solo')
  }
  log.info(`manifiesto: ${manifiesto.total()} adjuntos ya bajados antes`)
  log.info(webhook.activo ? `webhook: ${webhook.url}` : 'webhook: desactivado')
  log.info(`ruido de libsignal en ${signalLog}`)

  let ultimaNovedad = Date.now()
  let terminando = false

  const sesion = await conectar({
    rutas: cfg.rutas,
    log,
    nombreDispositivo: cfg.nombreDispositivo,
    onSocket: (sock) => {
      sock.ev.on('messages.upsert', async (upsert) => {
        ultimaNovedad = Date.now()
        for (const msg of upsert.messages || []) {
          try {
            await procesar(msg, sock)
          } catch (e) {
            stats.errores++
            log.error(`error procesando mensaje: ${e.stack || e.message}`)
          }
        }
      })
    }
  })

  const metricas = path.join(cfg.rutas.logs, 'metricas.jsonl')
  const anotarMetricas = () => {
    const mem = process.memoryUsage()
    const fila = {
      t: new Date().toISOString(),
      rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
      heapMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
      uptimeMin: +((Date.now() - stats.inicio) / 60000).toFixed(1),
      reconexiones: sesion.contadores.reconexiones,
      ...stats
    }
    delete fila.inicio
    fs.appendFileSync(metricas, JSON.stringify(fila) + '\n')
  }
  const timerMetricas = setInterval(anotarMetricas, (cfg.metricas.intervaloSegundos || 60) * 1000)

  const terminar = (motivo, codigo = 0) => {
    if (terminando) return
    terminando = true
    clearInterval(timerMetricas)
    clearInterval(timerSalida)
    anotarMetricas()
    sesion.cerrar()

    const min = ((Date.now() - stats.inicio) / 60000).toFixed(1)
    log.info(`--- ${motivo} ---`)
    log.info(`corrió ${min} min | RSS ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB | reconexiones: ${sesion.contadores.reconexiones}`)
    log.info(`vistos: ${stats.mensajesVistos} | fuera de whitelist: ${stats.fueraDeWhitelist} | fuera de la ventana: ${stats.fueraDeRango}`)
    if (webhook.activo) log.info(`webhooks: ${stats.webhooksEnviados} ok, ${stats.webhooksFallidos} fallidos`)
    log.info(`GUARDADOS: ${stats.guardados} (${(stats.bytes / 1024 / 1024).toFixed(1)} MB) | duplicados: ${stats.duplicados} | indescifrables: ${stats.indescifrables} | errores: ${stats.errores}`)

    // Solo se marca la corrida si terminó por su cuenta: si la cortaron a mano o
    // por el tope de tiempo, la próxima vuelve a cubrir la misma ventana.
    if (rango && motivo.startsWith('listo')) {
      // Con el tope abierto se marca el instante real de cierre, no el de arranque.
      const cubiertoHasta = rango.hasta || new Date()
      estado.marcarCorrida(cubiertoHasta)
      log.info(`próxima corrida arrancará desde ${cubiertoHasta.toISOString()}`)
    } else if (rango) {
      log.warn('la ventana NO se marca como cubierta: volvé a correrlo para asegurarte')
    }

    process.exit(codigo)
  }

  const timerSalida = setInterval(() => {
    if (continuo) return
    if (Date.now() - stats.inicio > maxMs) {
      terminar(`corte por el tope de ${maxMs / 60000} min`, 1)
    } else if (Date.now() - ultimaNovedad > silencio) {
      terminar(`listo: ${silencio / 1000}s sin novedades`)
    }
  }, 2000)

  process.on('SIGINT', () => terminar('cortado a mano', 1))
  process.on('SIGTERM', () => terminar('cortado a mano', 1))
}

main().catch((e) => {
  console.error('\n' + (e.message || e))
  process.exit(1)
})
