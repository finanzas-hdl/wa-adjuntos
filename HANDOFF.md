# Handoff para la sesión de Claude Code que monta esto

Leé este archivo entero antes de ejecutar nada. Está escrito para vos, el agente
que va a dejar esto andando en la PC de Patricia.

## Contexto

Patricia trabaja en LFR (empresa de HDL) y recibe por WhatsApp adjuntos —
comprobantes, remitos, facturas de proveedores — que hoy baja a mano. Este
proyecto los baja solos a una carpeta.

**Patricia no es técnica.** No le pidas que interprete un stack trace, que edite
JSON a mano ni que decida entre dos opciones técnicas. Diego, que sí lo es, la
está acompañando: cuando algo requiera criterio técnico, resolvelo vos o pedile
a él. A Patricia pedile solamente lo que solo ella puede dar: qué grupos le
interesan y el momento de escanear el QR.

El uso diario no te necesita: es `npm run captar` en una terminal. Vos estás acá
para el montaje y para cuando algo falle.

## Lo que NO tenés que hacer

- **Nunca enviar mensajes, marcar leído ni cambiar nada en la cuenta de WhatsApp.**
  El proyecto es solo lectura y tiene que seguir siéndolo. No agregues
  `sendMessage` ni `readMessages` por ninguna razón.
- **No commitear `config.json`, `auth/`, `media/`, `data/` ni `logs/`.** Ya están
  en `.gitignore`. `auth/` es la sesión de WhatsApp: quien la tenga entra a la
  cuenta de la empresa.
- **No mostrar ni copiar el contenido de `auth/`** a ningún lado, ni siquiera para
  diagnosticar.
- **No poner en la whitelist grupos que Patricia no haya elegido explícitamente.**

## Estado al momento del handoff

Funciona y está probado en vivo contra una cuenta de prueba (27/08/2026): vinculó,
listó 51 grupos, bajó jpg / ogg / xlsx / pdf, midió 82–89 MB de RAM y 0
reconexiones. Lo que falta es el estreno contra la cuenta de LFR.

`npm run probar` corre 17 pruebas del pipeline más 5 del webhook, sin conectarse
a nada. Si algo de eso falla, no sigas: es un problema del entorno.

## Montaje, paso a paso

### 1. Entorno

Verificá que haya **Node.js 20 o superior** (`node -v`). Si falta o es viejo,
instalá la LTS desde nodejs.org. Después:

```
npm install
npm run probar
```

Tiene que terminar con `TODAS LAS PRUEBAS PASARON` dos veces.

### 2. Vincular el dispositivo — acá pará y pedí intervención humana

`npm run descubrir` imprime un QR en la terminal y lo guarda en `logs/qr.png`.

**El QR lo tiene que escanear el celular que aloja la cuenta, que está en poder
del jefe de Patricia, en la misma oficina.** No es un trámite: lo que se vincula
es un dispositivo que recibe todos los chats de esa cuenta, y hacerlo va contra
los términos de uso de WhatsApp (riesgo bajo de suspensión, pero no cero, sobre
la línea operativa de la empresa). Diego se ocupa de que eso esté hablado. Si no
está claro que hay acuerdo, frená y preguntá antes de generar el QR.

En el teléfono va a figurar como **LFR-adjuntos-Patri**. Avisá que no hay que
cerrar esa sesión desde el teléfono: si la cierran, hay que escanear de nuevo.

Que Patricia siga usando WhatsApp Web no interfiere: se admiten varios
dispositivos vinculados a la vez.

### 3. Descubrir los identificadores de los grupos

Después de vincular, el mismo comando lista los grupos y escucha 2 minutos
mostrando de qué chat viene cada mensaje. Pedile a Patricia que mande algo a cada
grupo que le interese, para verlos aparecer. Al final imprime un JSON con los
candidatos.

**Copiá el identificador tal cual sale.** No lo reconstruyas a partir de un número
de teléfono: WhatsApp está migrando a identificadores `@lid`, y en las pruebas un
chat apareció como `182145318412455@lid` en vez de `@s.whatsapp.net`. Si el
identificador no coincide exacto, ese grupo no captura nada y no avisa — es la
falla silenciosa más probable de todo el montaje.

Los canales aparecen como `@newsletter`. No los pongas salvo pedido expreso.

### 4. Configurar

Copiá `config.example.json` a `config.json` y dejá en `whitelist` solo los grupos
que Patricia eligió, con un `alias` legible que va a nombrar la carpeta de cada
uno. Dejá `nombreDispositivo` en `LFR-adjuntos-Patri`.

### 5. Primera captura

```
npm run captar -- --dias=1
```

Verificá con Patricia que los archivos que bajaron son los que ella esperaba, y
abrí un par para confirmar que están completos.

## Lo que vas a ver y no son fallas

| Síntoma | Qué es |
|---|---|
| Archivos llamados `adjunto` | Al reenviar, WhatsApp no manda el nombre original. Si el mensaje trae epígrafe se usa como nombre; si no, queda `adjunto` y se identifica por fecha, remitente y manifiesto. |
| `ya bajado antes, se saltea` | La idempotencia funcionando. Correrlo dos veces no duplica. |
| `mensaje INDESCIFRABLE` | WhatsApp entregó algo que no se pudo descifrar. Suele resolverse solo porque reentrega el mismo mensaje enseguida, y esa copia sí se baja. Si se repite y falta un adjunto conocido, escalá a Diego. |
| Volcados raros en `logs/signal.log` | Es libsignal. Escribe por `console.log` esquivando el logger, y entre eso manda claves de sesión, por lo que su consola va redactada a ese archivo aparte. No lo compartas. |

## Detalles que costaron una sesión de pruebas — no los deshagas

1. **`downloadMediaMessage` necesita un logger real.** Baileys hace
   `ctx.logger.info()` sin guarda en la rama de re-subida de media caducada: con
   `logger: undefined` explota justo cuando esa rama importa.
2. **Un fallo transitorio no marca el mensaje como visto.** Solo los registros con
   estado `guardado` entran al set de vistos del manifiesto. Si un mensaje
   indescifrable bloqueara su id, la reentrega buena se descartaría como
   duplicado — pasó, y costó un PDF.
3. **Fechas en hora local, no UTC.** Un adjunto de las 22:00 del día 31 se
   archivaba en el mes siguiente.
4. **Sin `--hasta`, el límite superior queda abierto**, para que un adjunto que
   llega durante la corrida no caiga "fuera de la ventana".
5. **La ventana solo se marca cubierta si la corrida terminó sola.** Cortada a
   mano o por el tope de tiempo, la próxima la vuelve a cubrir.

## Límites reales, para que no prometas de más

- **El rango de fechas es un filtro, no una consulta.** No se le puede pedir a
  WhatsApp "los adjuntos de marzo": `fetchMessageHistory` topea en 50 mensajes,
  el servidor a veces ignora el pedido, y sobre todo la media vieja ya caducó del
  lado del servidor. Para material viejo, exportar el chat o pedir reenvío.
- **Cuánto encola WhatsApp para un dispositivo desconectado no está documentado.**
  Importa para el lunes, después de un fin de semana sin correrlo. Se mide con el
  uso: si aparecen adjuntos del sábado, los guardó.
- La regla de los 14 días de WhatsApp es sobre el **teléfono principal** sin
  conectarse, no sobre este proceso.

## Si algo falla

`logs/captar.log` tiene la corrida; `data/manifiesto.jsonl`, una línea por
adjunto. Para escalar a Diego, mandá las últimas líneas del log y qué se esperaba
que pasara.

Un grupo que no captura nada es, casi siempre, el identificador: volvé a correr
`npm run descubrir` y compará carácter por carácter con `config.json`.
