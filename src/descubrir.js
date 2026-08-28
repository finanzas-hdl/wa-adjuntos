const { cargarLaxa } = require('./lib/config-laxa')
const { crear: crearLog } = require('./lib/log')
const { detectar } = require('./lib/media')
const { conectar } = require('./lib/sesion')

// Ayuda a armar la whitelist: lista los grupos donde participa la cuenta y
// escucha un rato mostrando de qué chat viene cada mensaje.
// NO guarda contenido de ningún mensaje: solo metadata, y solo en pantalla.
async function main () {
  const cfg = cargarLaxa()
  const log = crearLog(cfg.rutas, 'descubrir')
  const segundos = cfg.descubrir?.escucharSegundos || 120

  const vistos = new Map()
  let temporizador = null
  let sesion = null

  const cerrarYResumir = () => {
    sesion.cerrar()
    log.info('--- candidatos para la whitelist de config.json ---')
    const whitelist = [...vistos.entries()].map(([jid, alias]) => ({ jid, alias }))
    console.log(JSON.stringify({ whitelist }, null, 2))
    log.info('copiá solo las entradas que querés capturar; el resto se descarta.')
    process.exit(0)
  }

  sesion = await conectar({
    rutas: cfg.rutas,
    log,
    nombreDispositivo: cfg.nombreDispositivo || 'wa-adjuntos',
    onSocket: (sock) => {
      sock.ev.on('connection.update', async (u) => {
        if (u.connection !== 'open') return

        try {
          const grupos = await sock.groupFetchAllParticipating()
          const lista = Object.values(grupos)
          log.info(`--- ${lista.length} grupos donde participa esta cuenta ---`)
          for (const g of lista) {
            log.info(`  ${g.id}  ${g.subject}`)
            vistos.set(g.id, g.subject)
          }
        } catch (e) {
          log.warn(`no se pudieron listar los grupos: ${e.message}`)
        }

        log.info(`--- escuchando ${segundos}s: mandá algo a los chats que te interesan ---`)

        // Recién acá: si arrancara al iniciar, el tiempo del escaneo se comería el
        // presupuesto de escucha, y un escaneo lento mataría el proceso antes de conectar.
        if (!temporizador) temporizador = setTimeout(cerrarYResumir, segundos * 1000)
      })

      sock.ev.on('messages.upsert', (upsert) => {
        for (const msg of upsert.messages || []) {
          const jid = msg.key?.remoteJid
          if (!jid) continue
          const media = msg.message ? detectar(msg.message) : null
          const nombre = msg.pushName || jid.split('@')[0]
          if (!vistos.has(jid)) vistos.set(jid, nombre)
          log.info(`  ${jid}  de: ${nombre}  ${media ? '[adjunto: ' + media.tipo + ']' : '(sin adjunto)'}`)
        }
      })
    }
  })


  process.on('SIGINT', () => { sesion.cerrar(); process.exit(0) })
}

main().catch((e) => {
  console.error('\n' + (e.message || e))
  process.exit(1)
})
