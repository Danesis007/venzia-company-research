# VENZIA LAB Company Research

**Intelligence for AI Agents**

Official website: **[VenziaLab.com](https://VenziaLab.com)**

Cited, structured company intelligence for autonomous agents: **0.01 USDC per company on Base mainnet through x402 v2**.

## What an agent receives

One JSON research brief per company: overview, key facts, financials when available, risks, opportunities, sources, confidence, limitations, and disclaimer. This is public-source research, not audited financial data, comprehensive professional diligence, or investment advice.

Use cases: company research, preliminary due diligence, company financials, risk analysis, and competitor research. Financial coverage depends on available public sources.

## Service contract

- Existing technical endpoint: `https://venzia-complet-ezip.replit.app/api/services/company-research`
- Method: **POST**, JSON body.
- Required input: `company` (2–120 characters).
- Optional inputs: `request` (3–600 characters), `domain` (up to 200 characters), `includeFilings` (boolean), `maxSources` (integer 1–10).
- Price: **0.01 USDC / 10000 atomic units**, Base `eip155:8453`, x402 v2, `exact`.
- Receiver and native USDC contract are public payment-routing addresses, not wallet credentials. See [discovery metadata](metadata/canonical-discovery.json).
- Public discovery: [OpenAPI](https://venzialab.com/openapi.json), [x402 discovery](https://venzialab.com/.well-known/x402).

No account or service API key is required to purchase the research. A compatible buyer needs its own configured wallet and approved spending budget; vendor clients may separately require credentials or charge fees.

## Start without spending

Requires Node.js 20 or later. Clone/download this repository, then run:

```text
node --test buyer/tests/integrations.test.js
node buyer/dry-run.mjs --client agentcash --company "Microsoft"
node buyer/dry-run.mjs --client agentkit --company "Microsoft"
node buyer/dry-run.mjs --client thirdweb --company "Microsoft"
```

These commands use offline fixtures and mocks. They do not fetch a production quote, create an authorization, access a wallet, run a buyer CLI, or sign/pay anything. No dependency installation is necessary for these commands.

## Agent skill

Read [skill/SKILL.md](skill/SKILL.md). Copy the file into the skill location supported by your agent runtime, following that runtime's installation instructions. Publishing a file here does not automatically register it in a skill marketplace.

The skill describes when the research is useful, the input contract, approved payment limits, schema and example discovery, source limitations, and safe handling of uncertain payment outcomes. Operator approval is required before paid execution.

## Integration examples

- [AgentCash](buyer/agentcash.js): CLI argument construction and injected-runner adapter.
- [Coinbase AgentKit](buyer/coinbase-agentkit.js): restricted x402 action-provider adapter.
- [thirdweb](buyer/thirdweb.js): managed payment-fetch request adapter.
- [Setup, approval contract, and compatibility limits](buyer/README.md).

**Status: offline-tested integration examples, not live-certified vendor integrations.** Vendor-internal quote binding and Bazaar metadata forwarding are not proven by mock tests. AgentCash and thirdweb have documented qualification blockers; review the buyer guide before considering live use. No vendor affiliation or endorsement is implied.

Do not use a live paid path until the operator separately approves it and the applicable vendor safety limitations have been resolved. Never retry an uncertain payment by creating a new authorization.

## Machine-readable discovery

[metadata/canonical-discovery.json](metadata/canonical-discovery.json) contains **VENZIA LAB Company Research**, the five approved tags, approved description, input/output schemas, and full Bazaar declaration. The Microsoft response is an **illustrative example**, not a customer report or newly purchased result.

This bundled reference is not a freshly fetched live quote and is not evidence of any marketplace's current indexed record. Production quotes remain authoritative for purchases.

## Feedback and recurring use

Use repository issues for technical integration feedback, without credentials or private research results. After a genuinely useful, separately approved purchase, assess repeat use in company screening, supplier review, or competitor monitoring. There is no automatic subscription or purchase schedule.

See [SECURITY.md](SECURITY.md). The integration code and documentation are distributed under the [MIT License](LICENSE). This license does not grant free access to VENZIA LAB's paid service.
