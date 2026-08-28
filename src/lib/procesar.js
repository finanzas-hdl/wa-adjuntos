const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { detectar, nombreArchivo, fechaDe, mesLocal } = require('./media')

// Toda la lógica de captura, con la descarga inyectada para poder probarla
// sin conectarse a WhatsApp.
function crearStats () {
  return {
    inicio: Date.now(),
    mensajesVistos: 0,
    fueraDeWhitelist: 0,
    sinAdjunto: 0,
    tipoIgnorado: 0,
    duplicados: 0,
    fueraDeRango: 0,
    indescifrables: 0,
    fallosDescifrado: 0,
    webhooksEnviados: 0,
    webhooksFallidos: 0,
    guardados: 0,
    bytes: 0,
    errores: 0
  }
}

function crearProcesador ({ cfg, log, manifiesto, descargar, webhook, rango, stats = crearStats() }) {

  async function procesar (msg, sock) {
    stats.mensajesVistos++

    const jid = msg.key?.remoteJid
    if (!jid) return

    // Filtro primero que nada: el socket recibe TODOS los chats de la cuenta y
    // acá se decide que del resto no se persiste absolutamente nada.
    const chat = cfg.enWhitelist(jid)
    if (!chat) { stats.fueraDeWhitelist++; return }

    if (!msg.message) {
      // STUB CIPHERTEXT (2): Baileys no pudo descifrarlo. Puede haber sido un
      // adjunto, y se perdería sin dejar rastro si lo contáramos como "sin adjunto".
      if (msg.messageStubType === 2) {
        stats.indescifrables++
        manifiesto.registrar({
          clave: `${jid}:${msg.key.id}`,
          chatJid: jid,
          alias: chat.alias,
          idMensaje: msg.key.id,
          estado: "indescifrable",
          motivo: "no se pudo descifrar (stub CIPHERTEXT); si traía adjunto, se perdió",
          timestampDescarga: new Date().toISOString()
        })
        log.error(`[${chat.alias}] mensaje INDESCIFRABLE ${msg.key.id.slice(-6)} — si traía adjunto, no se bajó`)
        return
      }
      stats.sinAdjunto++
      return
    }

    const media = detectar(msg.message)
    if (!media) { stats.sinAdjunto++; return }

    if (!cfg.tipos.includes(media.tipo)) {
      stats.tipoIgnorado++
      log.info(`[${chat.alias}] ignorado por tipo: ${media.tipo}`)
      return
    }

    const idMensaje = msg.key.id
    const clave = `${jid}:${idMensaje}`
    if (manifiesto.yaVisto(clave)) {
      stats.duplicados++
      log.info(`[${chat.alias}] ya bajado antes, se saltea: ${idMensaje.slice(-6)}`)
      return
    }

    const fecha = fechaDe(msg)

    // El rango es un FILTRO sobre lo que WhatsApp entrega, no una consulta: acá se
    // descarta lo que quedó fuera de la ventana pedida, sin descargarlo.
    if (rango && (fecha < rango.desde || (rango.hasta && fecha > rango.hasta))) {
      stats.fueraDeRango++
      return
    }

    const remitente = msg.pushName || (msg.key.participant || jid).split('@')[0]
    const base = {
      clave,
      chatJid: jid,
      alias: chat.alias,
      idMensaje,
      remitente,
      remitenteJid: msg.key.participant || jid,
      tipo: media.tipo,
      mimetype: media.contenido.mimetype || null,
      nombreOriginal: media.contenido.fileName || null,
      titulo: media.contenido.title || null,
      caption: media.contenido.caption || null,
      timestampMensaje: fecha.toISOString(),
      timestampDescarga: new Date().toISOString()
    }

    try {
      const buffer = await descargar({ key: msg.key, message: media.mensaje }, sock)

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
      const previo = manifiesto.archivoConHash(sha256)

      const carpeta = path.join(cfg.rutas.media, chat.alias, mesLocal(fecha))
      fs.mkdirSync(carpeta, { recursive: true })
      const nombre = nombreArchivo({ fecha, remitente, contenido: media.contenido, idMensaje })
      const destino = path.join(carpeta, nombre)
      fs.writeFileSync(destino, buffer)

      stats.guardados++
      stats.bytes += buffer.length
      manifiesto.registrar({
        ...base,
        estado: 'guardado',
        archivo: path.relative(cfg.rutas.raiz, destino),
        bytes: buffer.length,
        sha256,
        // El archivo se guarda igual aunque el contenido ya haya entrado antes:
        // el reenvío queda anotado, no se descarta por las dudas.
        mismoContenidoQue: previo || null
      })

      const kb = (buffer.length / 1024).toFixed(0)
      log.ok(`[${chat.alias}] ${nombre} (${kb} KB)${previo ? ' — mismo contenido que ' + previo : ''}`)

      // Recién ahora, con el archivo ya en disco y anotado: el aviso es lo último
      // y lo prescindible.
      // try propio: el aviso jamás puede degradar un adjunto ya guardado a error.
      try {
        if (webhook) {
          await webhook.notificar({
            ...base,
            archivo: path.relative(cfg.rutas.raiz, destino),
            archivoAbsoluto: destino,
            bytes: buffer.length,
            sha256
          })
        }
      } catch (e) {
        log.warn(`el webhook falló pero el archivo está guardado: ${e.message}`)
      }

      return destino
    } catch (e) {
      // Ruidoso a propósito: un adjunto perdido en silencio es peor que uno que falla.
      stats.errores++
      manifiesto.registrar({ ...base, estado: 'error', motivo: e.message })
      log.error(`[${chat.alias}] NO se pudo bajar ${base.nombreOriginal || media.tipo} (${idMensaje.slice(-6)}): ${e.message}`)
    }
  }

  return { procesar, stats }
}

module.exports = { crearProcesador, crearStats }
