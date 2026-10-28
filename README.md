# Contratos EnergyShark (protocolo v3)

Transcripción legible por máquina de la **"Referencia de la API v3"** de la E2 de IIC2173
(2026-2): un schema JSON (2020-12) por cada mensaje AMQP, los cuerpos de la wallet y los claims
del token de swap, el catálogo de `reason`, y el OpenAPI 3.1 de la wallet. **En caso de
diferencia entre un texto y estos schemas, mandan los schemas.**

Cada schema trae ejemplos válidos y ejemplos que deben fallar, y el CI de este repositorio
verifica todos en cada commit. Además, cada ejemplo JSON y cada tabla de la Referencia
publicada están copiados en `reference/` y el CI comprueba que coinciden con los schemas.

## Instalación

Como dependencia git, fijada a un tag:

```bash
npm install --save-dev "github:iic2173/energyshark-contracts#v3.0.2"
```

El paquete no corre ningún script al instalarse. En otros lenguajes, clonen el repositorio en
el tag (`git clone --branch v3.0.2 https://github.com/iic2173/energyshark-contracts.git`) y
usen los archivos de `schemas/` y `wallet.openapi.yaml` con el validador de su lenguaje.

## Validar un mensaje

```js
import { createValidator, SCHEMA_BASE } from '@iic2173/energyshark-contracts/validator';

const ajv = createValidator();
const validate = ajv.getSchema(SCHEMA_BASE + 'amqp/distance-table.schema.json');
if (!validate(mensaje)) console.log(validate.errors);
```

`createValidator()` no habla con la central: valida con los archivos de este repositorio.
`SCHEMA_BASE` es sólo el prefijo de los `$id` (no se descarga nada desde ahí); el resto del id
es la ruta bajo `schemas/`.

Si prefieren armar su propio validador:

- Usen un validador **JSON Schema 2020-12** (en Ajv, `ajv/dist/2020`). Un validador draft-07
  ignora `unevaluatedProperties` sin avisar y aceptaría campos extra: los mensajes que emite la
  central quedarían más permisivos de lo que el contrato dice.
- Registren las anotaciones propias (`x-amqp`, `x-decimals`, `x-emitter`, `x-code`,
  `x-carriers`, `x-emitters`) o desactiven el modo estricto (`strict: false`): Ajv estricto
  rechaza cualquier palabra clave que no conozca.
- Agreguen los formatos `uuid` y `date-time` (en Ajv, `ajv-formats`).
- Otros validadores 2020-12 (por ejemplo, `jsonschema` en Python) deberían funcionar si ignoran
  las palabras `x-*`, pero este repositorio sólo prueba Ajv; no hay garantía probada aquí.

## Números

Los créditos (`CR`) viajan como `number` con dos decimales; los kWh (`KWH`) son enteros. JSON no
tiene un tipo decimal, así que no hagan aritmética de dinero con `number`:

- Conviertan cada monto en créditos a centavos enteros al parsear: `Math.round(x * 100)`.
  Sumen, resten y comparen en centavos, y vuelvan a dividir por 100 sólo al escribir el JSON.
- Apliquen `round2` (redondeo a dos decimales) como la central: primero al precio unitario y
  después al total. Por ejemplo, `transportPerEnergy = round2(distance_km × transportCost)` y
  luego `transportTotal = round2(quantity × transportPerEnergy)`; `amount = round2(quantity ×
  pricePerEnergy)`.
- Los kWh nunca tienen decimales: `sellable` se redondea hacia abajo y el déficit hacia arriba.

Los schemas no usan `multipleOf: 0.01` (el punto flotante haría que valores legítimos como
`0.07` no validen); `x-decimals` documenta cuántos decimales lleva cada `number`.

## Reglas que un schema no expresa

JSON Schema valida un mensaje a la vez. Estas reglas relacionan campos entre sí, mensajes entre
sí o el mensaje con el transporte, y las verifica quien recibe; son parte del contrato igual
que los schemas.

**`idpk` distinto de `msgId`.** Todo mensaje lleva los dos y deben ser distintos: las respuestas
referencian el `msgId` en `data.target`, y el `idpk` es la llave de idempotencia de la operación
(reintentar la misma operación reusa el mismo `idpk`). Si son iguales, el
receptor responde `nack` `IDPK_EQUALS_MSGID` (422). El `msgId` de una respuesta es siempre un
UUID nuevo, nunca el del mensaje que responde.

**Un `error` siempre va precedido de un `ack`; un `nack` nunca.** Un `nack` rechaza la
recepción (mensaje malformado, tipo desconocido, `idpk` igual a `msgId`, identidad que no
corresponde) y no lleva `ack` previo. Un `error` rechaza la operación de un mensaje que sí se
recibió y entendió, así que primero llega el `ack` y después el `error`. No se hace `ack` de un
`ack`, `nack` de un `nack` ni `ack` de un `error`. Un mensaje que no se puede parsear, o que no
trae `msgId`, se descarta y se registra en los logs: no hay a quién responder.

**Los mensajes del mercado no llevan `ack`.** `offer`, `offer-updated`, `offer-withdrawn` y
`market-closed` viajan por el exchange `market` y llegan a la cola `market.{CODE}` de todas las
ciudades: son difusión, no mensajes dirigidos, y nadie los responde.

**`bid-rejected` va después del `ack` del `bid`.** Es un `error` en el sentido de la E1: el
vendedor primero responde `ack` al `bid` y después, si lo rechaza, envía `bid-rejected` con
`data.target` igual al `msgId` del `bid`. Un `bid` malformado, o con un `user_id` que no
corresponde, es un `nack`, sin `ack` previo.

**Eco de `data.cycleId` en `nack` y `error`.** Cuando el mensaje rechazado traía un `cycleId` que
es un string de a lo sumo 64 caracteres, el rechazo lo devuelve tal cual en `data.cycleId`, para
que puedan aparear el rechazo con lo que lo causó. Si no traía uno, o no cumple eso, la clave
no viene.

**`user_id` en todo publish de una ciudad.** Toda ciudad publica con la propiedad AMQP
`user_id` igual a `city.{CODE}`, el usuario con que se autenticó; es una opción del `publish`,
no un campo del cuerpo (por eso aparece sólo en `x-amqp.userId`). El receptor, sea la central u
otra ciudad, compara `user_id` con el `cityId` del mensaje y responde `nack`
`IDENTITY_MISMATCH` (403) si no corresponde o si falta.

**`user_id` en los mensajes de la central.** Todo mensaje que la central publica en la cola
`city.{CODE}`, eventos de la wallet (`swap-*`) incluidos, llega con `user_id` `central`
(`x-amqp.userId` `central`). El broker rechaza un publish cuyo `user_id` no es el usuario
autenticado de esa conexión, así que ese valor sólo puede venir de la central. Verificarlo es
opcional; uno que llega a `city.{CODE}` sin `user_id`, o con otro valor, no lo publicó la central
y puede descartarse sin respuesta. `market-closed` llega sin `user_id` (`x-amqp.userId` `none`):
viaja por `market` con routing key `market.closed`, que ninguna ciudad tiene permiso de usar.

**Tipos retirados.** `negotiation-proposal`, `give`, `take`, `transfer` como pago y
`demand-statement` ya no existen en el protocolo v3. A un mensaje de ciudad con uno de esos
tipos, la central responde `ack` y luego `error` `TYPE_RETIRED` (410). El `transfer` de
financiamiento que emite la central sigue vigente.

**Destinatarios de los eventos de la wallet.** Llegan a `city.{CODE}` con `sender: "central"`.
`swap-proposed`, `swap-cancelled` y `swap-expired` van sólo al proponente; `swap-settled` a
ambas partes; `swap-rejected` a quien intentó la operación y, cuando falla un `accept`, también
al proponente. `data.balancesAfter` trae sólo los saldos de quien recibe el evento, y
`data.idpk` (salvo en `swap-expired`) es la `Idempotency-Key` de la operación que lo causó.

**`penalty` ausente sin multa.** `transfer.data.penalty` viene sólo cuando se descontó una multa,
como `{ amount, forCycleId }`; sin multa la clave no viene, ni en cero ni en `null`.

## La wallet

La API de la wallet está en [`wallet.openapi.yaml`](wallet.openapi.yaml) (OpenAPI 3.1): las
ocho operaciones (`POST /swaps`, `POST /swaps/{swapId}/accept`, `POST /swaps/{swapId}/cancel`,
`GET /swaps/{swapId}`, `GET /balance`, `GET /statement`, `GET /leaderboard` y
`GET /.well-known/jwks.json`), con sus cuerpos en `schemas/wallet/`. Toda llamada lleva
`X-Api-Key`, salvo el JWKS; toda escritura lleva `Idempotency-Key` (un UUID).

Idempotencia de las escrituras:

- `202` significa **aceptado, nunca hecho**. El resultado llega después como evento a
  `city.{CODE}`; los eventos, no el status HTTP, son la verdad.
- La misma `Idempotency-Key` otra vez devuelve `200` con el estado actual del swap (el cuerpo de
  `GET /swaps/{swapId}`), sin ejecutar nada.
- La misma llave con un cuerpo distinto es `422` `IDEMPOTENCY_MISMATCH`.
- Un `503` `WALLET_BUSY` no aceptó nada: reintentar con la misma llave es seguro.
- Una llave nueva es otra operación.

Los errores HTTP tienen la forma `{ "reason", "code", "data": { "message", ... } }`
([wallet/http-error.schema.json](schemas/wallet/http-error.schema.json)).

## Estructura

```
schemas/
  common/     fragmentos compartidos: envelope, emisor, ciclo, código de ciudad, montos
  reason/     catálogo de reason y sus pares (reason, code) por portador
  amqp/       un schema por mensaje AMQP
  wallet/     cuerpos de la API de la wallet
  token/      claims del token de swap que firma la wallet
  index.schema.json   raíz para generar tipos (AnyMessage y catálogos)
examples/<ruta del schema>/valid/*.json     ejemplos que deben validar
examples/<ruta del schema>/invalid/*.json   mutaciones de un ejemplo válido que deben fallar
reference/            ejemplos y tablas de la Referencia de la API v3 publicada (ver Mantención)
wallet.openapi.yaml   OpenAPI 3.1 de la wallet
lib/validator.mjs     createValidator() y SCHEMA_BASE
scripts/              tabla AMQP de este README, extracción de la referencia y utilidades
test/                 suites de node:test que corre el CI
vendor/               el schema oficial de OpenAPI 3.1, copiado sin cambios; sólo lo usan las pruebas
```

Un ejemplo inválido es una mutación de un ejemplo válido:

```json
{
  "base": "../valid/enabled-routes.json",
  "set": { "/data/extra": true },
  "expect": { "keyword": "additionalProperties", "instancePath": "/data" }
}
```

Debe fallar con esa palabra clave en esa ruta, no por cualquier otra razón.

## Convenciones

- **Mensajes cerrados y abiertos.** Lo que emite la central (o la wallet, a través de la
  central) es cerrado: un campo que no está en el schema lo invalida. Lo que emiten las
  ciudades es abierto: la central ignora campos extra.
- **Ciudades.** Todo campo que nombra una ciudad usa el patrón `^[A-Z0-9]{3}$`; no hay una
  lista de ciudades en los schemas.
- **Decimales.** `x-decimals` dice cuántos decimales lleva un `number` (2 para créditos, 4 para
  tarifas por kWh·km).

## Mensajes AMQP

Generada desde `x-amqp` por `npm run render:table`; el CI verifica que esté al día.

<!-- amqp-table:start -->
| `type` | exchange | routing key | emisor | receptores | `user_id` | cerrado/abierto | schema |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ack` | `energy.x` | `city.{CODE} \| central` | central, city | `city.{CODE}`, `central` | obligatorio | central cerrado, ciudad abierto | [amqp/ack.schema.json](schemas/amqp/ack.schema.json) |
| `bid` | `energy.x` | `city.{vendedor}` | city | `city.{vendedor}` | obligatorio | abierto | [amqp/bid.schema.json](schemas/amqp/bid.schema.json) |
| `bid-accepted` | `energy.x` | `city.{comprador}` | city | `city.{comprador}` | obligatorio | abierto | [amqp/bid-accepted.schema.json](schemas/amqp/bid-accepted.schema.json) |
| `bid-rejected` | `energy.x` | `city.{comprador}` | city | `city.{comprador}` | obligatorio | abierto | [amqp/bid-rejected.schema.json](schemas/amqp/bid-rejected.schema.json) |
| `distance-table` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | `central` (verificarlo es opcional) | cerrado | [amqp/distance-table.schema.json](schemas/amqp/distance-table.schema.json) |
| `error` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | `central` (verificarlo es opcional) | cerrado | [amqp/error.schema.json](schemas/amqp/error.schema.json) |
| `imbalance-settlement` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | `central` (verificarlo es opcional) | cerrado | [amqp/imbalance-settlement.schema.json](schemas/amqp/imbalance-settlement.schema.json) |
| `market-closed` | `market` | `market.closed` | central | `market.{CODE} (todas)` | no | cerrado | [amqp/market-closed.schema.json](schemas/amqp/market-closed.schema.json) |
| `nack` | `energy.x` | `city.{CODE} \| central` | central, city | `city.{CODE}`, `central` | obligatorio | central cerrado, ciudad abierto | [amqp/nack.schema.json](schemas/amqp/nack.schema.json) |
| `negotiation-report` | `energy.x` | `central` | city | `central` | obligatorio | abierto | [amqp/negotiation-report.schema.json](schemas/amqp/negotiation-report.schema.json) |
| `offer` | `market` | `market.offer.{CODE}` | city | `market.{CODE} (todas)` | obligatorio | abierto | [amqp/offer.schema.json](schemas/amqp/offer.schema.json) |
| `offer-updated` | `market` | `market.offer.{CODE}` | city | `market.{CODE} (todas)` | obligatorio | abierto | [amqp/offer-updated.schema.json](schemas/amqp/offer-updated.schema.json) |
| `offer-withdrawn` | `market` | `market.offer.{CODE}` | city | `market.{CODE} (todas)` | obligatorio | abierto | [amqp/offer-withdrawn.schema.json](schemas/amqp/offer-withdrawn.schema.json) |
| `request` | `energy.x` | `central` | city | `central` | obligatorio | abierto | [amqp/request.schema.json](schemas/amqp/request.schema.json) |
| `status-statement` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | `central` (verificarlo es opcional) | cerrado | [amqp/status-statement.schema.json](schemas/amqp/status-statement.schema.json) |
| `swap-cancelled` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}` | `central` (verificarlo es opcional) | cerrado | [amqp/swap-cancelled.schema.json](schemas/amqp/swap-cancelled.schema.json) |
| `swap-expired` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}` | `central` (verificarlo es opcional) | cerrado | [amqp/swap-expired.schema.json](schemas/amqp/swap-expired.schema.json) |
| `swap-proposed` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}` | `central` (verificarlo es opcional) | cerrado | [amqp/swap-proposed.schema.json](schemas/amqp/swap-proposed.schema.json) |
| `swap-rejected` | `energy.x` | `city.{CODE}` | wallet | `city.{quien intentó la operación}`, `city.{proponente} (accept fallido)` | `central` (verificarlo es opcional) | cerrado | [amqp/swap-rejected.schema.json](schemas/amqp/swap-rejected.schema.json) |
| `swap-settled` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}`, `city.{aceptante}` | `central` (verificarlo es opcional) | cerrado | [amqp/swap-settled.schema.json](schemas/amqp/swap-settled.schema.json) |
| `trade-recorded` | `energy.x` | `city.{CODE}` | central | `city.{comprador}`, `city.{vendedor}` | `central` (verificarlo es opcional) | cerrado | [amqp/trade-recorded.schema.json](schemas/amqp/trade-recorded.schema.json) |
| `transfer` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | `central` (verificarlo es opcional) | cerrado | [amqp/transfer.schema.json](schemas/amqp/transfer.schema.json) |
<!-- amqp-table:end -->

## El token

Cada `swap-proposed` trae en `data.token` un JWT (ES256) firmado por la wallet, y el vendedor
reenvía ese mismo token al comprador en `bid-accepted.data.swapToken`. Sus claims los describe
[token/swap-token-claims.schema.json](schemas/token/swap-token-claims.schema.json): `iss`,
`sub` (el `swapId`), `iat`, `exp` (enteros, segundos desde la época Unix), `proposer`,
`give`, `take` y `memo`, ni uno más. El swap es al portador: el token no nombra contraparte.

El schema valida la forma de los claims, no la firma. Antes de aceptar el swap, el comprador:

1. verifica la firma contra `/.well-known/jwks.json` (ES256, la llave del `kid` del encabezado);
2. comprueba que `sub` sea el `swapId` que recibió;
3. comprueba que `proposer` sea el vendedor al que le envió el bid;
4. comprueba que `give` y `take` sean, exactamente, lo que pidió al precio de la oferta;
5. comprueba que `memo` sea la oferta;
6. comprueba que `exp` esté en el futuro.

Un token válido prueba que la wallet ya retiene esos kWh, pero no garantiza el swap: si otro
acepta primero, la wallet responde `SWAP_NOT_PROPOSED`.

## Versionado

Los tags siguen semver desde `v3.0.0`; la versión mayor es la de la "Referencia de la API v3".
Cada corrección publicada del contrato recibe un tag nuevo, menor o de parche; un tag publicado
nunca se mueve ni se borra. Fijen su dependencia a un tag, y lean el
[CHANGELOG](CHANGELOG.md) antes de subirlo.

## Mantención

```bash
npm ci
npm test              # schemas, ejemplos, referencia, raíz de tipos y OpenAPI
npm run check:table   # la tabla de arriba coincide con los schemas
npm run render:table  # la reescribe después de cambiar un x-amqp
```

`reference/` se regenera a mano cada vez que cambia la Referencia publicada, a partir de una
copia textual de la página (lo que sigue a la primera línea `---` es el contenido):

```bash
node scripts/extract-reference.mjs <copia-de-la-pagina.md> reference/
```

El script extrae cada ejemplo JSON y las tablas de `reason`, endpoints y eventos, completa lo
que la página abrevia (envelope, `"uuid"`, ids truncados, instantes `"..."`) y deja el resto
byte a byte; `reference/MANIFEST.json` dice qué schema corresponde a cada ejemplo y qué se
completó. `test/reference.test.mjs` falla si un ejemplo publicado no valida o si una tabla no
coincide con los schemas.
