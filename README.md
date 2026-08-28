# wa-adjuntos — captura puntual de adjuntos de WhatsApp

Baja los adjuntos que llegan a **ciertos chats** de una cuenta de WhatsApp y los
deja ordenados en una carpeta. Sin LLM: la lógica entera es
`si (chat ∈ whitelist) y (trae adjunto) y (entra en la ventana) → guardar`.

Se corre **cuando se necesita** y termina sola. No es un servicio prendido 24/7.

## Lo que hay que entender antes de usarlo

**La ventana de fechas es un filtro, no una consulta.** El proceso captura lo que
WhatsApp le entrega al reconectar y descarta lo que caiga fuera del rango pedido.
No puede pedirle a WhatsApp "los mensajes de marzo": los adjuntos viejos suelen
estar **caducados del lado del servidor**, y recuperarlos depende de que el
teléfono todavía tenga el archivo y esté online. Para material viejo, la vía es
exportar el chat o que lo reenvíen.

Corolario práctico: **lo que se corre seguido, se captura bien.** Cuanto más
tiempo pase entre corridas, más se depende de cuánto tiempo WhatsApp le guarde
los mensajes a un dispositivo enlazado que estuvo desconectado — que no está
documentado y se mide con el uso: si un lunes aparecen adjuntos del sábado, los
guardó.

## Reglas que respeta el código

- **Solo lectura.** No hay una sola llamada que envíe mensajes, marque leído ni
  cambie nada en la cuenta.
- **No se marca en línea** (`markOnlineOnConnect: false`), así el teléfono sigue
  recibiendo las notificaciones normalmente.
- **Del chat que no está en la whitelist no se persiste nada.** El socket recibe
  todos los chats de la cuenta — el filtro es nuestro y corre antes de tocar disco.
- **Nada se pierde en silencio**: los mensajes que no se pueden descifrar y las
  descargas fallidas quedan en el log como error y en el manifiesto.

## Uso

Las pruebas, que no se conectan a nada:

```bash
npm run probar
```

**1. Descubrir los JID de los chats.** Lista los grupos donde participa la cuenta
y escucha 2 minutos mostrando de qué chat viene cada mensaje. No guarda contenido:

```bash
npm run descubrir
```

La primera vez imprime un QR (también en `logs/qr.png`): WhatsApp → Ajustes →
Dispositivos vinculados. Aparece como **wa-adjuntos**. Al terminar imprime un
bloque JSON listo para pegar.

**2. Configurar.** Copiá `config.example.json` a `config.json` y dejá en
`whitelist` solo los chats que querés capturar, con un `alias` que sirva de
nombre de carpeta.

Tres cosas que salieron en la primera corrida real (27/08/2026):

- **Los JID no siempre terminan en `@s.whatsapp.net`.** WhatsApp está migrando a
  LID: el chat propio apareció como `182145318412455@lid`. Copiá el JID tal cual
  lo imprime `descubrir` — no lo reconstruyas a partir del número.
- **Ojo con que un mismo interlocutor llegue con los dos formatos** (`@lid` y
  `@s.whatsapp.net`) según el contexto: la whitelist compara texto exacto, así que
  el que falte se descarta en silencio. Si un chat esperado no captura nada,
  volvé a correr `descubrir` y mirá con qué JID está llegando.
- **Los canales aparecen como `@newsletter`** y también traen media. Salvo que los
  quieras, no los pongas en la whitelist.

**3. Captar.**

```bash
npm run captar
```

Sin argumentos arranca desde donde terminó la corrida anterior — que es el uso
diario. Espera hasta que pasen 60 segundos sin novedades y termina sola.

```bash
npm run captar -- --dias=3
npm run captar -- --desde=2026-08-24 --hasta=2026-08-26
npm run captar -- --silencio=90 --max=20
npm run captar -- --ayuda
```

Los adjuntos van a `media/<alias>/<AAAA-MM>/`. La ventana solo se marca como
cubierta si la corrida terminó por su cuenta: si la cortaste con Ctrl+C o saltó
el tope de tiempo, la próxima vuelve a cubrirla en vez de saltearla.

`npm run continuo` deja el proceso prendido sin filtro de fechas. Sirve para
medir consumo en sesiones largas, no para el uso normal.

## Avisar a otro sistema cuando llega un adjunto (opcional)

Puede hacer un POST cada vez que guarda un archivo, para que n8n o una skill
reaccione. Se activa poniendo `webhook.url` en `config.json`; sin eso no avisa:

```json
"webhook": {
  "url": "http://127.0.0.1:5678/webhook/adjuntos",
  "secreto": "algo-largo-y-random",
  "timeoutMs": 5000
}
```

El POST lleva el registro del manifiesto más `archivoAbsoluto`:

```json
{ "evento": "adjunto.guardado", "alias": "compras", "chatJid": "...@g.us",
  "remitente": "Juan Proveedor", "tipo": "document",
  "archivo": "media/compras/2026-08/...", "bytes": 63012, "sha256": "..." }
```

Con `secreto`, va firmado en el header `X-Wa-Adjuntos-Firma` como
`sha256=<hmac del cuerpo>`. Quien reciba recalcula ese HMAC y compara — así sabe
que salió de acá y que nadie lo tocó.

**El aviso es best-effort y va después de guardar.** Si el receptor está caído, el
archivo ya está en disco y anotado; el evento queda en
`logs/webhook-fallidos.jsonl` para reenviarlo a mano.

## Estructura

```
src/captar.js          corrida puntual (el entrypoint normal)
src/descubrir.js       lista chats y sus JID
src/probar-offline.js  17 pruebas del pipeline, sin conectarse
src/probar-webhook.js  5 pruebas del webhook contra un HTTP local
src/metricas.js        resumen de RAM y contadores
src/lib/               config, sesión, media, manifiesto, webhook, log
auth/                  credenciales del dispositivo vinculado — NO COPIAR
media/                 adjuntos descargados
data/manifiesto.jsonl  un registro por adjunto (idempotencia y trazabilidad)
data/estado.json       hasta dónde llegó la última corrida
logs/                  captar.log, signal.log, baileys.log, metricas.jsonl
```

`auth/` es la sesión: quien la tiene, entra a la cuenta. No se versiona ni se
copia a ningún lado. `logs/signal.log` recibe los volcados de libsignal, que
incluyen material de sesión — por eso van redactados y a un archivo aparte.

## Riesgos abiertos

1. El proceso ve todos los chats de la cuenta; el filtro lo hacemos nosotros.
2. Va contra los ToS de WhatsApp — hay riesgo de baneo. Solo lectura lo baja
   mucho, no lo elimina.
3. La media vieja puede caducar; el código pide re-subida al teléfono
   (`reuploadRequest`) y si aun así falla, lo loguea y lo registra. Esa rama solo
   se ejerce en vivo: la prueba offline inyecta la descarga.
4. Baileys sigue un protocolo no documentado: se rompe cuando WhatsApp cambia y
   hay que actualizar la librería.
