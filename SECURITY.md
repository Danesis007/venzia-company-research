# Public package safety

This package contains buyer-side examples, an agent skill, public discovery metadata, a pure metadata serializer, and synthetic offline tests. It does not include Venzia's server application, database, deployment settings, production customer records, reports, transaction history, outreach contacts, or the sales dashboard.

The receiving address and USDC contract address are intentionally public routing identifiers. They are not signing keys and do not permit spending.

Tests use clearly synthetic placeholder values such as `never-print-this-secret`; these are not real secrets. Do not replace them with real credentials.

No `.env` file, key file, seed phrase, wallet export, API credential, real authorization, or confidential recovery token should be committed. The ignore file helps prevent accidental additions but is not a substitute for reviewing the staged files.

Before each release:

1. Review every staged file and the complete Git history that will be published.
2. Run only the named offline tests in the README.
3. Check for credential literals, customer data, private reports, and sensitive configuration.
4. Do not publish source-project history: create this as a new repository from the reviewed public package.
5. Never paste secrets into public issues. If a credential is exposed, revoke/rotate it through the owning provider's secure process.

All examples default to dry-run. Live calls require separately approved operator spending and resolution of the documented vendor compatibility/safety limits. No payment approval is granted by downloading or publishing these files.
