# @lixpi/usage-reporter

Dependency versions in `package.json` are generated from [the version registry](../../../versions-registry/README.md). Edit the central entry and synchronize before rebuilding a consuming service.

Provider request authorization, upper-bound usage estimates, measured provider usage, and helpers for inference-provider tariff metadata.

The API calls `ProviderUsageClient.authorizeRequest()` before provider transport and `recordUsage()` after completion. Disabled integration authorizes requests and discards records without network calls. Enabled integration uses the paired NATS responder's neutral authorization and acknowledgement contracts.

`UsageReporter` produces `TextProviderUsage`, `ImageProviderUsage`, and `VideoProviderUsage`. It preserves provider request identity and measured dimensions. It performs no monetary arithmetic.

| Page | Contract |
|------|----------|
| [Request authorization](documentation/REQUEST-AUTHORIZATION.md) | Upper-bound estimation, modality selection, and denial behavior |
| [Recorded provider usage](documentation/RECORDED-PROVIDER-USAGE.md) | Measurement, identity, dimensions, and acknowledgements |
| [Provider usage port](documentation/METERING-PORT.md) | NATS subjects, options, and paired release requirements |
| [Provider tariffs](documentation/PRICING-PER-ENDPOINT.md) | Catalog endpoint selection and browser-safe model projection |
| [Video token accounting](documentation/SEEDANCE-VIDEO-TOKENS.md) | Vendor token estimation and provisional frame dimensions |

The API's graph adapter is `services/api/src/llm/usage/provider-usage-estimate.ts`. The shared estimator accepts `ProviderUsageEstimateInput`, so callers supply measured prompt tokens without importing graph state.

Tests, when explicitly requested, use the shared TypeScript runner's `usage-reporter` target.
