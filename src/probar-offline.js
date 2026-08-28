// Prueba del pipeline de captura SIN conectarse a WhatsApp: la descarga está
// inyectada. Sirve para validar filtrado, idempotencia, nombres y errores.
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const { crearProcesador } = require('./lib/procesar')
const { abrir: abrirManifiesto } = require('./lib/manifiesto')
const { crear: crearLog } = require('./lib/log')

const RAIZ = path.resolve(__dirname, '..', '.prueba')
fs.rmSync(RAIZ, { recursive: true, force: true })

const rutas = {
  raiz: RAIZ,
  auth: path.join(RAIZ, 'auth'),
  media: path.join(RAIZ, 'media'),
  data: path.join(RAIZ, 'data'),
  logs: path.join(RAIZ, 'logs')
}

const WL = { 'grupo@g.us': { jid: 'grupo@g.us', alias: 'compras' } }
const cfg = {
  rutas,
  tipos: ['document', 'image'],
  whitelist: Object.values(WL),
  enWhitelist: (jid) => WL[jid] || null
}

const mensaje = ({ jid = 'grupo@g.us', id = 'MSG0001', tipo = 'documentMessage', extra = {} }) => ({
  key: { remoteJid: jid, id, participant: '5491133334444@s.whatsapp.net' },
  pushName: 'Juan Proveedor',
  messageTimestamp: 1787000000,
  message: { [tipo]: { fileName: 'Factura A 0001-00012345.pdf', mimetype: 'application/pdf', ...extra } }
})

async function main () {
  const log = crearLog(rutas, 'prueba')
  const manifiesto = abrirManifiesto(rutas)

  let fallarDescarga = false
  const descargar = async () => {
    if (fallarDescarga) throw new Error('media expirada en el servidor')
    return Buffer.from('%PDF-1.4 contenido de prueba')
  }

  const { procesar, stats } = crearProcesador({ cfg, log, manifiesto, descargar })
  const sock = {}

  console.log('\n1) adjunto de un chat en la whitelist')
  const destino = await procesar(mensaje({}), sock)
  assert.ok(destino && fs.existsSync(destino), 'debería haber guardado el archivo')
  assert.strictEqual(stats.guardados, 1)

  console.log('\n2) el MISMO mensaje otra vez (reconexión) — no debe duplicar')
  await procesar(mensaje({}), sock)
  assert.strictEqual(stats.guardados, 1, 'no debería guardar de nuevo')
  assert.strictEqual(stats.duplicados, 1)

  console.log('\n3) el mismo archivo reenviado con otro id — se guarda y se anota el reenvío')
  await procesar(mensaje({ id: 'MSG0002' }), sock)
  assert.strictEqual(stats.guardados, 2)

  console.log('\n4) chat FUERA de la whitelist — no debe tocar el disco')
  const antes = contarArchivos(rutas.media)
  await procesar(mensaje({ jid: 'otro@s.whatsapp.net', id: 'MSG0003' }), sock)
  assert.strictEqual(contarArchivos(rutas.media), antes, 'no debía escribir nada')
  assert.strictEqual(stats.fueraDeWhitelist, 1)

  console.log('\n5) tipo no configurado (sticker) — se ignora')
  await procesar(mensaje({ id: 'MSG0004', tipo: 'stickerMessage' }), sock)
  assert.strictEqual(stats.tipoIgnorado, 1)

  console.log('\n6) mensaje de texto sin adjunto')
  await procesar({ key: { remoteJid: 'grupo@g.us', id: 'MSG0005' }, message: { conversation: 'hola' } }, sock)
  assert.strictEqual(stats.sinAdjunto, 1)

  console.log('\n7) falla la descarga — debe quedar registrada, no silenciada')
  fallarDescarga = true
  await procesar(mensaje({ id: 'MSG0006' }), sock)
  assert.strictEqual(stats.errores, 1)

  console.log('\n8) el manifiesto sobrevive a un reinicio del proceso')
  const manifiesto2 = abrirManifiesto(rutas)
  assert.ok(manifiesto2.yaVisto('grupo@g.us:MSG0001'), 'debería recordar lo ya bajado')

  console.log('')
  console.log('9) adjunto de las 22:30 del ultimo dia del mes: va al mes LOCAL, no al UTC')
  fallarDescarga = false
  const finDeMes = Math.floor(new Date(2026, 6, 31, 22, 30, 0).getTime() / 1000)
  const dest9 = await procesar({ ...mensaje({ id: 'MSG0009' }), messageTimestamp: finDeMes }, sock)
  assert.ok(dest9 && dest9.includes(path.join('compras', '2026-07')), 'debia archivarse en 2026-07, quedo en: ' + dest9)

  console.log('')
  console.log('10) mensaje que no se pudo descifrar: se avisa, no se cuenta como sin adjunto')
  await procesar({ key: { remoteJid: 'grupo@g.us', id: 'MSG0010' }, messageStubType: 2 }, sock)
  assert.strictEqual(stats.indescifrables, 1)

  console.log('')
  console.log('11) fileName UUID: el nombre sale del epigrafe')
  const conCaption = mensaje({ id: 'MSG0011', extra: { fileName: '024c0607-010b-4a11-a1b0-5b5ec9e5b7ec.pdf', caption: 'Remito 4471 Cementos' } })
  const dest11 = await procesar(conCaption, sock)
  assert.ok(dest11.includes('Remito-4471-Cementos'), 'debia usar el epigrafe, quedo: ' + dest11)

  console.log('')
  console.log('12) un fallo NO bloquea el reintento: WhatsApp reentrega y esa copia debe bajarse')
  fallarDescarga = true
  await procesar(mensaje({ id: 'MSG0012' }), sock)   // primer intento: falla
  fallarDescarga = false
  const dest12 = await procesar(mensaje({ id: 'MSG0012' }), sock)  // reentrega: debe guardar
  assert.ok(dest12, 'el reintento del mismo id tenia que bajarse, no saltearse como duplicado')

  console.log('')
  console.log('13) un mensaje indescifrable tampoco bloquea su reentrega descifrada')
  await procesar({ key: { remoteJid: 'grupo@g.us', id: 'MSG0013' }, messageStubType: 2 }, sock)
  const dest13 = await procesar(mensaje({ id: 'MSG0013' }), sock)
  assert.ok(dest13, 'la copia descifrada tenia que bajarse')

  console.log('')
  console.log('14) el webhook recibe el aviso con la ruta y el hash del archivo guardado')
  const avisos = []
  const conWebhook = crearProcesador({ cfg, log, manifiesto, descargar, webhook: { notificar: async (r) => { avisos.push(r) } } })
  const dest14 = await conWebhook.procesar(mensaje({ id: 'MSG0014' }), sock)
  assert.strictEqual(avisos.length, 1, 'tenia que avisar una vez')
  assert.strictEqual(avisos[0].archivo, path.relative(RAIZ, dest14))
  assert.ok(avisos[0].sha256 && avisos[0].alias === 'compras')

  console.log('')
  console.log('15) si el webhook explota, el archivo sigue guardado y no se marca error')
  const roto = crearProcesador({ cfg, log, manifiesto, descargar, webhook: { notificar: async () => { throw new Error('n8n caido') } } })
  const dest15 = await roto.procesar(mensaje({ id: 'MSG0015' }), sock)
  assert.ok(dest15 && fs.existsSync(dest15), 'el archivo tenia que quedar igual')
  assert.strictEqual(roto.stats.errores, 0, 'un webhook roto no es un error de captura')
  assert.strictEqual(roto.stats.guardados, 1)

  console.log('')
  console.log('16) fuera de la ventana de fechas: se descarta sin descargar')
  const rango = { desde: new Date(2026, 7, 20), hasta: new Date(2026, 7, 25, 23, 59, 59) }
  const conRango = crearProcesador({ cfg, log, manifiesto, descargar, rango })
  const viejo = { ...mensaje({ id: 'MSG0016' }), messageTimestamp: Math.floor(new Date(2026, 7, 10, 12, 0).getTime() / 1000) }
  assert.strictEqual(await conRango.procesar(viejo, sock), undefined, 'no debia bajar nada de antes de la ventana')
  assert.strictEqual(conRango.stats.fueraDeRango, 1)
  assert.strictEqual(conRango.stats.guardados, 0)

  console.log('')
  console.log('17) dentro de la ventana: se baja')
  const dentro = { ...mensaje({ id: 'MSG0017' }), messageTimestamp: Math.floor(new Date(2026, 7, 22, 12, 0).getTime() / 1000) }
  const dest17 = await conRango.procesar(dentro, sock)
  assert.ok(dest17, 'un mensaje dentro de la ventana tenia que bajarse')
  assert.strictEqual(conRango.stats.guardados, 1)

  console.log('\n--- manifiesto ---')
  for (const l of fs.readFileSync(path.join(rutas.data, 'manifiesto.jsonl'), 'utf8').trim().split('\n')) {
    const r = JSON.parse(l)
    console.log(`  ${r.estado.padEnd(8)} ${r.idMensaje}  ${r.archivo || r.motivo}`)
  }

  console.log('\n--- archivos en disco ---')
  listar(rutas.media).forEach((f) => console.log('  ' + path.relative(RAIZ, f)))

  console.log('\nTODAS LAS PRUEBAS PASARON')
}

function listar (dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? listar(p) : [p]
  })
}
const contarArchivos = (dir) => listar(dir).length

main().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1) })
