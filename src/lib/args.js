// Parseo mínimo de --clave=valor y --bandera.
function parsear (argv) {
  const args = {}
  for (const a of argv) {
    if (!a.startsWith('--')) continue
    const [clave, valor] = a.slice(2).split('=')
    args[clave] = valor === undefined ? true : valor
  }
  return args
}

const dd = (n) => String(n).padStart(2, '0')
const aTexto = (f) => `${f.getFullYear()}-${dd(f.getMonth() + 1)}-${dd(f.getDate())}`

// Fechas en hora local: "--desde=2026-08-25" es desde las 00:00 de acá, no UTC.
function inicioDelDia (texto) {
  const [a, m, d] = texto.split('-').map(Number)
  if (!a || !m || !d) throw new Error(`fecha inválida: ${texto} (se espera AAAA-MM-DD)`)
  return new Date(a, m - 1, d, 0, 0, 0, 0)
}

function finDelDia (texto) {
  const f = inicioDelDia(texto)
  f.setHours(23, 59, 59, 999)
  return f
}

// Resuelve el rango a capturar, en este orden: --desde/--hasta explícitos,
// --dias=N hacia atrás, o desde la última corrida (para el uso diario).
function resolverRango (args, ultimaCorrida) {
  const ahora = new Date()
  let desde, hasta, origen

  if (args.desde) {
    desde = inicioDelDia(args.desde)
    origen = 'fechas explícitas'
  } else if (args.dias) {
    const n = Number(args.dias)
    if (!Number.isFinite(n) || n < 0) throw new Error(`--dias inválido: ${args.dias}`)
    desde = new Date(ahora)
    desde.setDate(desde.getDate() - n)
    desde.setHours(0, 0, 0, 0)
    origen = `últimos ${n} días`
  } else if (ultimaCorrida) {
    desde = new Date(ultimaCorrida)
    origen = 'desde la última corrida'
  } else {
    desde = new Date(ahora)
    desde.setDate(desde.getDate() - 7)
    desde.setHours(0, 0, 0, 0)
    origen = 'últimos 7 días (primera corrida)'
  }

  // Sin --hasta el límite queda ABIERTO: si lo cerráramos en el instante de arranque,
  // un adjunto que llega durante la propia corrida caería "fuera de la ventana".
  hasta = args.hasta ? finDelDia(args.hasta) : null

  if (hasta && desde > hasta) throw new Error(`el rango está al revés: ${aTexto(desde)} > ${aTexto(hasta)}`)

  return { desde, hasta, origen }
}

module.exports = { parsear, resolverRango, inicioDelDia, finDelDia, aTexto }
