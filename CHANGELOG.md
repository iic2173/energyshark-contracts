# Changelog

Una entrada por tag. Cada corrección del contrato publicado lleva su identificador `Cn` y su
fecha.

## v3.0.0 (2026-10-19)

Primera versión: transcripción de la "Referencia de la API v3" con las correcciones C1-C12 ya
publicadas en ella.

Correcciones incorporadas:

- C1 (2026-10-18): `swap-rejected` va a quien intentó la operación y, cuando falla un `accept`,
  también al proponente del swap.
- C2 (2026-10-18): `swap-expired` va sólo al proponente.
- C3 (2026-10-18): una ciudad acepta un swap al portador cuyo `swapId` tenga, nunca uno propio.
- C4 (2026-10-18): `market-closed` lleva `cycleId` en el nivel superior del envelope.
- C5 (2026-10-18): `market-closed` se publica al exchange `market` con routing key
  `market.closed`.
- C6 (2026-10-18): `sellable` se redondea hacia abajo (`floor`) y el déficit hacia arriba
  (`ceil`); ambos son kWh enteros.
- C7 (2026-10-18): `data.idpk` en `swap-proposed`, `swap-settled`, `swap-cancelled` y
  `swap-rejected`; no en `swap-expired`.
- C8 (2026-10-18): `status-statement.data.market.limits` trae exactamente
  `marketOpsPerMinute`, `walletWritesPerMinute` y `walletReadsPerMinute`; el límite de
  `request/ask` (10 por minuto) es fijo y no viaja.
- C9 (2026-10-18): se publican los cuerpos del `200` de una `Idempotency-Key` repetida y de
  `GET /swaps/{swapId}` (`swapId`, `status`, `lastEvent`), la página de `GET /statement`
  (`entries`, `nextCursor`), la fila de `GET /leaderboard` (`cityId`, `score`,
  `cyclesComputed`, `position`) y el cuerpo de los errores HTTP.
- C10 (2026-10-18): el ejemplo del token usa instantes de 2026 (`iat` 1792505172, `exp`
  1792505202).
- C11 (2026-10-18): `transfer.data.penalty` es el objeto `{ amount, forCycleId }` y no viene
  cuando no hay multa (ni en cero ni en `null`).
- C12 (2026-10-19): en un `nack` o un `error`, `data.cycleId` devuelve el `cycleId` del mensaje
  rechazado tal cual cuando es un string de a lo sumo 64 caracteres; si no lo traía, o no
  cumple eso, la clave no viene.

Contenido:

- `wallet.openapi.yaml` con sus ocho operaciones: `POST /swaps`, `POST /swaps/{swapId}/accept`,
  `POST /swaps/{swapId}/cancel`, `GET /swaps/{swapId}`, `GET /balance`, `GET /statement`,
  `GET /leaderboard` y `GET /.well-known/jwks.json`; `Idempotency-Key` en cada escritura,
  `Retry-After` en cada `429` y `503`, y un ejemplo validado en cada respuesta.
- Los siete cuerpos de la wallet: `wallet/propose-swap-request`, `wallet/write-accepted` (el
  `202`), `wallet/swap-state` (el `200` repetido y `GET /swaps/{swapId}`, con `status` y
  `lastEvent`), `wallet/http-error` (`reason`, `code`, `data.message`), `wallet/balance`,
  `wallet/statement-page` (con `StatementEntry`) y `wallet/leaderboard`.
- `reference/`: cada ejemplo JSON y las tablas de `reason`, endpoints y eventos de la
  Referencia publicada, extraídos por `scripts/extract-reference.mjs` y verificados contra los
  schemas por `test/reference.test.mjs`.
- `amqp/distance-table`: la tabla de rutas de la E1, con `disabledRouteTransportCost`.
- Fragmentos comunes: `common/envelope`, `common/central-sender`, `common/cycle-bound`,
  `common/city-code`, `common/rate4`.
- `wallet/jwks` y `wallet.openapi.yaml` con `GET /.well-known/jwks.json`.
- `index.schema.json` (`ContractRoot`), `lib/validator.mjs` (`createValidator`, `SCHEMA_BASE`)
  y las suites de CI.
- `reason/reason`: los 25 `reason` vigentes, con `code`, portadores y emisores;
  `reason/refusals`: los pares (`reason`, `code`) por portador (`nack`, `error`,
  `bid-rejected`, `swap-rejected`, `http`).
- `amqp/ack` y `amqp/nack` (variante de la central, cerrada, y de una ciudad, abierta) y
  `amqp/error` (sólo la central; `data.opensAt` obligatorio en `REPORT_TOO_EARLY`).
  `data.cycleId` de `nack` y `error` es opcional, de a lo sumo 64 caracteres.
- `common/city-sender`.
- `amqp/request` (`ask` es `status-statement` o `distance-table`; `cycleId` opcional e
  ignorado; a lo sumo 10 por minuto) y `amqp/negotiation-report` (balances que pueden ser
  negativos).
- `common/retired-type`: `negotiation-proposal`, `give`, `take`, `demand-statement`
  (`transfer` sigue vigente para el financiamiento).
- `amqp/status-statement`: el de la E1 con `data.energy.sellable` (kWh enteros,
  `floor(max(0, generationCapacity - consumption))`) y el bloque `data.market` (`buybackPrice`,
  `imbalancePrice`, `minBid`, los cinco instantes del ciclo y `limits` con exactamente
  `marketOpsPerMinute`, `walletWritesPerMinute` y `walletReadsPerMinute`).
- Fragmentos comunes: `common/cr` (créditos, `number` con `x-decimals: 2`), `common/kwh`
  (entero) y `common/instant` (ISO 8601 UTC).
- `amqp/transfer`: el financiamiento del ciclo, con `data.balanceAfter` y `data.creditLine`;
  `data.penalty` sólo como el objeto de la E1 `{ amount, forCycleId }` y ausente sin multa
  (`"penalty": 0` y `"penalty": null` no validan, C11). El `transfer` como pago
  (`data.becauseOf`) no valida.
- `amqp/market-closed`: al exchange `market` con routing key `market.closed` (C5), `cycleId` en
  el nivel superior y `data` siempre `{}` (C4).
- `amqp/trade-recorded` y `amqp/imbalance-settlement`: kWh enteros (`quantity`, `kwhHeld`,
  `deficit`, `coverage`) y créditos con dos decimales; `deficit` redondeado hacia arriba (C6).
- Eventos de la wallet que la central reenvía (`sender: "central"`, sin `cycleId`):
  `amqp/swap-proposed`, `amqp/swap-settled`, `amqp/swap-cancelled`, `amqp/swap-expired` y
  `amqp/swap-rejected`. Todos llevan `data.idpk` salvo `swap-expired` (C7); `swap-rejected` lleva
  `reason` y `code` del portador `swap-rejected` y `data.operation`; los receptores de cada uno
  van en `x-amqp` (C1, C2).
- Fragmentos comunes: `common/asset-amount` (una pata de swap: `CR` con dos decimales o `KWH`
  entero, siempre positiva) y `common/balances-after` (`CR` y `KWH`, cada uno con `available` y
  `held`; los kWh enteros).
- Mensajes del mercado, al exchange `market` con routing key `market.offer.{CODE}` y sin
  `ack`: `amqp/offer` (`offerId`, `quantity` en kWh enteros, `pricePerEnergy`),
  `amqp/offer-updated` (`remaining`) y `amqp/offer-withdrawn`.
- Mensajes entre ciudades, a `city.{vendedor}` o `city.{comprador}` con `user_id`:
  `amqp/bid` (sin precio; `quantity` en kWh enteros), `amqp/bid-accepted` (`amount`,
  `swapId`, `swapToken`, `expiresAt`) y `amqp/bid-rejected` (`reason` y `code` del
  portador `bid-rejected`; `data.available` obligatorio en `QUANTITY_UNAVAILABLE`).
- `token/swap-token-claims`: los claims del token de swap, cerrados y sin contraparte (`iss`,
  `sub`, `iat`, `exp`, `proposer`, `give`, `take`, `memo`); el ejemplo usa los
  instantes de la Referencia de la API v3 (C10). `index.schema.json` lo alcanza en
  `properties.swapTokenClaims`.
