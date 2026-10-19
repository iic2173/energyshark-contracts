# Contratos EnergyShark (protocolo v3)

Transcripción legible por máquina de la **"Referencia de la API v3"** de la E2 de IIC2173
(2026-2): un schema JSON (2020-12) por cada mensaje AMQP, el catálogo de `reason`, y el
OpenAPI 3.1 de la wallet. **En caso de diferencia entre un texto y estos schemas, mandan los
schemas.**

Cada schema trae ejemplos válidos y ejemplos que deben fallar, y el CI de este repositorio
verifica todos en cada commit.

## Instalación

Como dependencia git, fijada a un tag:

```bash
npm install --save-dev "github:iic2173/energyshark-contracts#v3.0.0"
```

El paquete no corre ningún script al instalarse.

## Validar un mensaje

```js
import { createValidator, SCHEMA_BASE } from '@iic2173/energyshark-contracts/validator';

const ajv = createValidator();
const validate = ajv.getSchema(SCHEMA_BASE + 'amqp/distance-table.schema.json');
if (!validate(mensaje)) console.log(validate.errors);
```

`createValidator()` no habla con la central: valida con los archivos de este repositorio.

Si prefieren armar su propio validador:

- Usen un validador **JSON Schema 2020-12** (en Ajv, `ajv/dist/2020`). Un validador draft-07
  ignora `unevaluatedProperties` sin avisar, y los mensajes que emite la central quedan más
  permisivos de lo que el contrato dice.
- Registren las anotaciones propias (`x-amqp`, `x-decimals`, `x-emitter`, `x-code`,
  `x-carriers`, `x-emitters`) o desactiven el modo estricto: Ajv estricto rechaza cualquier
  palabra clave que no conozca.
- Agreguen los formatos `uuid` y `date-time` (en Ajv, `ajv-formats`).

## Convenciones

- **Mensajes cerrados y abiertos.** Lo que emite la central (o la wallet, a través de la
  central) es cerrado: un campo que no está en el schema lo invalida. Lo que emiten las
  ciudades es abierto: la central ignora campos extra.
- **Ciudades.** Todo campo que nombra una ciudad usa el patrón `^[A-Z0-9]{3}$`; no hay una
  lista de ciudades en los schemas.
- **`user_id`** es una propiedad AMQP del publish, no un campo del cuerpo: aparece sólo en
  `x-amqp.userId`.
- **Decimales.** `x-decimals` dice cuántos decimales lleva un `number` (2 para créditos, 4 para
  tarifas por kWh·km).
- **`idpk` distinto de `msgId`.** JSON Schema no puede comparar dos campos; esa regla la
  verifica el receptor, que responde `nack` `IDPK_EQUALS_MSGID`.

## Estructura

```
schemas/
  common/     fragmentos compartidos: envelope, emisor, ciclo, código de ciudad, tarifas
  reason/     catálogo de reason y sus pares (reason, code) por portador
  amqp/       un schema por mensaje AMQP
  wallet/     cuerpos de la API de la wallet
  index.schema.json   raíz para generar tipos (AnyMessage y catálogos)
examples/<ruta del schema>/valid/*.json     ejemplos que deben validar
examples/<ruta del schema>/invalid/*.json   mutaciones de un ejemplo válido que deben fallar
wallet.openapi.yaml   OpenAPI 3.1 de la wallet
lib/validator.mjs     createValidator() y SCHEMA_BASE
scripts/              tabla AMQP de este README y utilidades de las pruebas
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

## Mensajes AMQP

Generada desde `x-amqp` por `npm run render:table`; el CI verifica que esté al día.

<!-- amqp-table:start -->
| `type` | exchange | routing key | emisor | receptores | `user_id` | cerrado/abierto | schema |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ack` | `energy.x` | `city.{CODE} \| central` | central, city | `city.{CODE}`, `central` | obligatorio | central cerrado, ciudad abierto | [amqp/ack.schema.json](schemas/amqp/ack.schema.json) |
| `bid` | `energy.x` | `city.{vendedor}` | city | `city.{vendedor}` | obligatorio | abierto | [amqp/bid.schema.json](schemas/amqp/bid.schema.json) |
| `bid-accepted` | `energy.x` | `city.{comprador}` | city | `city.{comprador}` | obligatorio | abierto | [amqp/bid-accepted.schema.json](schemas/amqp/bid-accepted.schema.json) |
| `bid-rejected` | `energy.x` | `city.{comprador}` | city | `city.{comprador}` | obligatorio | abierto | [amqp/bid-rejected.schema.json](schemas/amqp/bid-rejected.schema.json) |
| `distance-table` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | no | cerrado | [amqp/distance-table.schema.json](schemas/amqp/distance-table.schema.json) |
| `error` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | no | cerrado | [amqp/error.schema.json](schemas/amqp/error.schema.json) |
| `imbalance-settlement` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | no | cerrado | [amqp/imbalance-settlement.schema.json](schemas/amqp/imbalance-settlement.schema.json) |
| `market-closed` | `market` | `market.closed` | central | `market.{CODE} (todas)` | no | cerrado | [amqp/market-closed.schema.json](schemas/amqp/market-closed.schema.json) |
| `nack` | `energy.x` | `city.{CODE} \| central` | central, city | `city.{CODE}`, `central` | obligatorio | central cerrado, ciudad abierto | [amqp/nack.schema.json](schemas/amqp/nack.schema.json) |
| `negotiation-report` | `energy.x` | `central` | city | `central` | obligatorio | abierto | [amqp/negotiation-report.schema.json](schemas/amqp/negotiation-report.schema.json) |
| `offer` | `market` | `market.offer.{CODE}` | city | `market.{CODE} (todas)` | obligatorio | abierto | [amqp/offer.schema.json](schemas/amqp/offer.schema.json) |
| `offer-updated` | `market` | `market.offer.{CODE}` | city | `market.{CODE} (todas)` | obligatorio | abierto | [amqp/offer-updated.schema.json](schemas/amqp/offer-updated.schema.json) |
| `offer-withdrawn` | `market` | `market.offer.{CODE}` | city | `market.{CODE} (todas)` | obligatorio | abierto | [amqp/offer-withdrawn.schema.json](schemas/amqp/offer-withdrawn.schema.json) |
| `request` | `energy.x` | `central` | city | `central` | obligatorio | abierto | [amqp/request.schema.json](schemas/amqp/request.schema.json) |
| `status-statement` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | no | cerrado | [amqp/status-statement.schema.json](schemas/amqp/status-statement.schema.json) |
| `swap-cancelled` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}` | no | cerrado | [amqp/swap-cancelled.schema.json](schemas/amqp/swap-cancelled.schema.json) |
| `swap-expired` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}` | no | cerrado | [amqp/swap-expired.schema.json](schemas/amqp/swap-expired.schema.json) |
| `swap-proposed` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}` | no | cerrado | [amqp/swap-proposed.schema.json](schemas/amqp/swap-proposed.schema.json) |
| `swap-rejected` | `energy.x` | `city.{CODE}` | wallet | `city.{quien intentó la operación}`, `city.{proponente} (accept fallido)` | no | cerrado | [amqp/swap-rejected.schema.json](schemas/amqp/swap-rejected.schema.json) |
| `swap-settled` | `energy.x` | `city.{CODE}` | wallet | `city.{proponente}`, `city.{aceptante}` | no | cerrado | [amqp/swap-settled.schema.json](schemas/amqp/swap-settled.schema.json) |
| `trade-recorded` | `energy.x` | `city.{CODE}` | central | `city.{comprador}`, `city.{vendedor}` | no | cerrado | [amqp/trade-recorded.schema.json](schemas/amqp/trade-recorded.schema.json) |
| `transfer` | `energy.x` | `city.{CODE}` | central | `city.{CODE}` | no | cerrado | [amqp/transfer.schema.json](schemas/amqp/transfer.schema.json) |
<!-- amqp-table:end -->

## Desarrollo

```bash
npm ci
npm test              # schemas, ejemplos, raíz de tipos y OpenAPI
npm run check:table   # la tabla de arriba coincide con los schemas
```
