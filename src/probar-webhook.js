// Prueba el webhook contra un servidor HTTP local: valida el POST real, la firma
// HMAC y que un receptor caído no rompa nada.
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert')

const { crear: crearWebhook } = require('./lib/webhook')
const { crear: crearLog } = require('./lib/log')
const { crearStats } = require('./lib/procesar')

const RAIZ = path.resolve(__dirname, '..', '.prueba-webhook')
fs.rmSync(RAIZ, { recursive: true, force: true })
const rutas = { raiz: RAIZ, logs: path.join(RAIZ, 'logs') }

const SECRETO = 'un-secreto-cualquiera'
const REGISTRO = {
  alias: 'compras',
  chatJid: 'grupo@g.us',
  remitente: 'Juan Proveedor',
  tipo: 'document',
  archivo: 'media/compras/2026-08/factura.pdf',
  bytes: 1234,
  sha256: 'abc123'
}

async function main () {
  const recibidos = []
  const server = http.createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      recibidos.push({ cuerpo, cabeceras: req.headers, metodo: req.method, ruta: req.url })
      res.writeHead(200); res.end('ok')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const puerto = server.address().port

  const log = crearLog(rutas, 'prueba-webhook')

  console.log('\n1) sin url configurada: el webhook queda inactivo y no rompe')
  const apagado = crearWebhook({ cfg: { rutas, webhook: {} }, log, stats: crearStats() })
  assert.strictEqual(apagado.activo, false)
  await apagado.notificar(REGISTRO)

  console.log('\n2) con url: llega el POST con el payload completo')
  const stats = crearStats()
  const wh = crearWebhook({
    cfg: { rutas, webhook: { url: `http://127.0.0.1:${puerto}/hook`, secreto: SECRETO } },
    log,
    stats
  })
  await wh.notificar(REGISTRO)
  assert.strictEqual(recibidos.length, 1)
  assert.strictEqual(stats.webhooksEnviados, 1)

  const payload = JSON.parse(recibidos[0].cuerpo)
  assert.strictEqual(payload.evento, 'adjunto.guardado')
  assert.strictEqual(payload.archivo, REGISTRO.archivo)
  assert.strictEqual(payload.sha256, REGISTRO.sha256)
  console.log('   payload:', JSON.stringify(payload))

  console.log('\n3) la firma HMAC verifica contra el cuerpo recibido')
  const esperada = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(recibidos[0].cuerpo).digest('hex')
  assert.strictEqual(recibidos[0].cabeceras['x-wa-adjuntos-firma'], esperada)
  console.log('   firma ok:', esperada.slice(0, 24) + '...')

  console.log('\n4) firma con el secreto equivocado NO valida')
  const falsa = 'sha256=' + crypto.createHmac('sha256', 'otro').update(recibidos[0].cuerpo).digest('hex')
  assert.notStrictEqual(recibidos[0].cabeceras['x-wa-adjuntos-firma'], falsa)

  console.log('\n5) receptor caído: no lanza, cuenta el fallo y guarda el evento para reenviar')
  await new Promise((r) => server.close(r))
  await wh.notificar(REGISTRO)
  assert.strictEqual(stats.webhooksFallidos, 1)
  const fallidos = path.join(rutas.logs, 'webhook-fallidos.jsonl')
  assert.ok(fs.existsSync(fallidos), 'debería haber quedado el evento fallido')
  const linea = JSON.parse(fs.readFileSync(fallidos, 'utf8').trim().split('\n')[0])
  assert.strictEqual(linea.cuerpo.archivo, REGISTRO.archivo)
  console.log('   evento recuperable:', linea.cuerpo.archivo, '| motivo:', linea.motivo)

  fs.rmSync(RAIZ, { recursive: true, force: true })
  console.log('\nTODAS LAS PRUEBAS DEL WEBHOOK PASARON')
}

main().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1) })
