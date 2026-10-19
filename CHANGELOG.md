# Changelog

Una entrada por tag. Cada corrección del contrato publicado lleva su identificador `Cn` y su
fecha.

## Unreleased

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
