const fs = require('fs')
const path = require('path')
const qrcode = require('qrcode-terminal')
const qrimg = require('qrcode')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('baileys')

const { crearPino } = require('./log')

// Se conecta como un dispositivo vinculado más y mantiene la conexión viva.
// SOLO LECTURA: en todo el proyecto no hay una sola llamada que envíe algo.
async function conectar ({ rutas, log, nombreDispositivo, onSocket }) {
  fs.mkdirSync(rutas.auth, { recursive: true })
  fs.mkdirSync(rutas.logs, { recursive: true })

  const loggerBaileys = crearPino(rutas)

  let intentos = 0
  let cerrandoAdrede = false
  // Acumulado que sobrevive a las reconexiones exitosas: es el dato de
  // estabilidad que el spike tiene que medir.
  const contadores = { reconexiones: 0 }

  const arrancar = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(rutas.auth)
    const { version } = await fetchLatestBaileysVersion()
    log.info(`protocolo WhatsApp Web v${version.join('.')}`)

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, loggerBaileys)
      },
      logger: loggerBaileys,
      // No marcar la cuenta como "en línea": si no, las notificaciones dejan de
      // llegar al teléfono de quien usa el número.
      markOnlineOnConnect: false,
      // No bajar el historial completo: menos RAM y menos huella.
      syncFullHistory: false,
      // Así se ve el spike en Ajustes > Dispositivos vinculados.
      browser: [nombreDispositivo, 'Chrome', '1.0.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (u) => {
      const { connection, lastDisconnect, qr } = u

      if (qr) {
        log.info('escaneá este QR desde WhatsApp > Ajustes > Dispositivos vinculados')
        qrcode.generate(qr, { small: true })
        // También como PNG: el ASCII no siempre se escanea bien según la terminal.
        const png = path.join(rutas.logs, 'qr.png')
        qrimg.toFile(png, qr, { width: 512, margin: 2 })
          .then(() => log.info('QR tambien en ' + png))
          .catch((e) => log.warn('no se pudo escribir el PNG del QR: ' + e.message))
      }

      if (connection === 'open') {
        intentos = 0
        const yo = sock.user?.id || '?'
        log.ok(`conectado como ${yo}`)
      }

      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode
        const motivo = Object.keys(DisconnectReason).find((k) => DisconnectReason[k] === codigo) || codigo

        if (cerrandoAdrede) return

        if (codigo === DisconnectReason.loggedOut) {
          log.error('la sesión fue cerrada desde el teléfono. Borrá la carpeta auth/ y volvé a vincular.')
          process.exit(1)
        }

        intentos++
        contadores.reconexiones++
        const espera = Math.min(2000 * 2 ** (intentos - 1), 60000)
        log.warn(`conexión caída (${motivo}). Reintento #${intentos} en ${espera / 1000}s`)
        setTimeout(() => { arrancar().catch((e) => log.error(`fallo al reconectar: ${e.message}`)) }, espera)
      }
    })

    onSocket(sock)
    return sock
  }

  const sock = await arrancar()
  return { sock, contadores, cerrar: () => { cerrandoAdrede = true } }
}

module.exports = { conectar }
