// Resume logs/metricas.jsonl: es el dato que decide VPS vs. notebook.
const fs = require('fs')
const path = require('path')

const archivo = path.resolve(__dirname, '..', 'logs', 'metricas.jsonl')
if (!fs.existsSync(archivo)) {
  console.error('Todavía no hay métricas. Corré `npm run capturar` un rato primero.')
  process.exit(1)
}

const filas = fs.readFileSync(archivo, 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => JSON.parse(l))

if (filas.length === 0) {
  console.error('El archivo de métricas está vacío.')
  process.exit(1)
}

const rss = filas.map((f) => f.rssMB)
const ultima = filas[filas.length - 1]
const prom = (a) => a.reduce((s, v) => s + v, 0) / a.length

console.log('')
console.log(`muestras:        ${filas.length}  (${filas[0].t} → ${ultima.t})`)
console.log(`tiempo en pie:   ${ultima.uptimeMin} min`)
console.log(`reconexiones:    ${ultima.reconexiones ?? '?'}   <-- estabilidad de la conexión`)
console.log('')
console.log(`RSS mínimo:      ${Math.min(...rss).toFixed(1)} MB`)
console.log(`RSS promedio:    ${prom(rss).toFixed(1)} MB`)
console.log(`RSS MÁXIMO:      ${Math.max(...rss).toFixed(1)} MB   <-- el número que importa para el VPS`)
console.log('')
console.log(`mensajes vistos: ${ultima.mensajesVistos}  (fuera de whitelist: ${ultima.fueraDeWhitelist})`)
console.log(`guardados:       ${ultima.guardados}  (${(ultima.bytes / 1024 / 1024).toFixed(1)} MB)`)
console.log(`duplicados:      ${ultima.duplicados}`)
console.log(`indescifrables:  ${ultima.indescifrables ?? 0}${ultima.indescifrables > 0 ? '   <-- posibles adjuntos perdidos' : ''}`)
console.log(`errores:         ${ultima.errores}${ultima.errores > 0 ? '   <-- revisá logs/capturar.log' : ''}`)
console.log('')
