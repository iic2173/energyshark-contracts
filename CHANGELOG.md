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
