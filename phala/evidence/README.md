# TDX attestation evidence — captured 2026-08-12T17:27:21Z

Live Phala dstack CVM, `tdx.small` on prod5, image
`ghcr.io/nickthelegend/dorr-enclave:6`.

    URL     https://59b7ffee2f565bdebf0ff4b076b0f1c0ba4152e4-8795.dstack-pha-prod5.phala.network
    app_id  59b7ffee2f565bdebf0ff4b076b0f1c0ba4152e4

| file | shows |
|---|---|
| `attestation.json` | `available: true`, 5010-byte Intel TDX quote |
| `attestation-legacy.json` | the same, from the endpoint `/verify` reads |
| `tenants.json` | three tenants, signers unchanged from Heroku |
| `quote-dorr-payload-bound.json` | `report_data` equals the requested payload hash |

The last one is the point. A quote proving "an enclave exists" is worth little;
this one's `report_data` is the batch payload hash, so the CPU signature covers
*that specific batch*. The competing entry reports a self-declared
`IMAGE_DIGEST` env var and never fetches a quote at all.

The CVM is billed hourly and gets destroyed. These files are the durable record.
