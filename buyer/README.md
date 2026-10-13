# VENZIA LAB Company Research buyer adapters

This folder contains import-safe standalone ESM buyer adapters and offline-only tests. Nothing in a module runs a request on import. All adapters default to a dry-run plan; actual CLI, wallet or server-key access requires `mode: "paid"` and an explicit approval object for one 0.01 USDC call.

The request is the canonical service contract: `POST https://venzia-complet-ezip.replit.app/api/services/company-research` with a JSON object using `company` (required), optional `domain`, `includeFilings`, `maxSources`, and `request`. Validation rejects unknown fields and schema violations before the adapter accesses a CLI, SDK, wallet, key getter or transport.

## Offline tests

From this directory, run the explicitly named offline suite:

```text
node --test tests/integrations.test.js
```

Or use the named npm script:

```text
npm run test:offline
```

The command paths work in Windows PowerShell and CMD. No dependencies are installed. Tests inject mock CLI runners, AgentKit providers/wallets and HTTP transports; they do not make network calls, execute the AgentCash CLI, read secrets or sign.

## Approval contract

Pass this exact per-call approval only after obtaining the user's explicit consent to the quoted amount, network, scheme and payee:

```js
const approval = {
  approved: true,
  amount: "0.01",
  currency: "USDC",
  network: "eip155:8453",
  scheme: "exact",
  x402Version: 2,
  payTo: "0x12cF81eec47E5B6437FeB4b10e071317F7012437",
};
```

Every paid invocation must also receive an unsigned v2 challenge object as `quote`. The validator requires the complete canonical resource and Bazaar extension, one accepted payment, and the exact amount/asset/network/payee/version/scheme. This kit never fetches or creates production quotes. Obtain the quote and the explicit approval through a separately authorized workflow.

The approval is single-use by object identity within this Node process: once a paid invocation begins, reusing that same object is rejected even if the vendor call fails. Create a new approval object only after new, explicit user consent. This in-process guard is not persistent across process restarts; callers must prevent replay across processes and must not blindly retry after timeouts or uncertain settlement.

## AgentCash CLI

`agentcash.js` uses the documented `agentcash fetch <url>` CLI command, with the official documented `--method`, `--body`, repeatable `--header`, `--payment-protocol`, `--payment-network`, `--max-amount`, and global `--format` flags. It invokes the installed `agentcash` binary directly without a shell (it never runs `npx`, installs packages, performs onboarding, or funds a wallet). Caller must have deliberately installed/configured AgentCash separately.

```js
import { callWithAgentCash } from "./agentcash.js";

const result = await callWithAgentCash({
  body: { company: "Example Corporation" },
  mode: "paid",
  approval,
  quote: unsignedV2Challenge,
});
```

The CLI manages its own challenge/auth/payment roundtrip. `--payment-network` selects the preferred network and `--max-amount` is a cap. The caller-supplied unsigned quote is strictly validated before the CLI runs, but AgentCash provides no caller callback to bind that validated quote to the CLI's separate internal quote before its signing flow. This is an unresolved payment-safety limitation; do not live-qualify until a supported quote-binding check exists. The CLI wire request also cannot carry the offline discovery declaration.

## Coinbase AgentKit

`coinbase-agentkit.js` validates the supplied unsigned challenge before dynamically importing Coinbase's official `X402ActionProvider` or resolving the wallet provider. It calls the actual prefixed action name `X402ActionProvider_retry_http_request_with_x402`. The provider is restricted to the canonical service URL, dynamic registration is disabled, and its per-payment cap is set to 0.01 USDC.

```js
import { callWithCoinbaseAgentKit } from "./coinbase-agentkit.js";

const result = await callWithCoinbaseAgentKit({
  body: { company: "Example Corporation" },
  mode: "paid",
  approval,
  quote: unsignedV2Challenge,
  getWalletProvider: async () => walletProvider,
});
```

Install and pin Coinbase AgentKit plus its peer dependencies in the consumer's own environment; this buyer folder does not install packages. Official sources inspected for this adapter:

- [AgentKit X402 action-provider source](https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/src/action-providers/x402/x402ActionProvider.ts)
- [AgentKit X402 action schemas/source](https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/src/action-providers/x402/schemas.ts)
- [AgentKit action decorator (prefixes names with provider class)](https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/src/action-providers/actionDecorator.ts)
- [Coinbase AgentKit action-provider exports](https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/src/action-providers/index.ts)

The official `typescript/agentkit/package.json` source reports AgentKit `0.11.0` and `@x402/fetch` `^2.7.0`; those are source-inspected versions, not a claim of local SDK runtime qualification. Pin the AgentKit version used by the host application and re-run the offline adapter tests after upgrading.

The action's x402 wrapper performs its own payment retry after a 402. This adapter does not retry the action or automatically retry 401/other failures. The SDK is opaque to the adapter once invoked: the supplied quote is checked before wallet access, but the adapter cannot guarantee the SDK's internal retry uses that same quote or forwards the discovery declaration. Local tests verify the action name, argument mapping and configured spending cap, not internal quote enforcement, wire metadata forwarding or payment settlement. Validate the installed AgentKit version and a real, user-reviewed challenge before any live call.

## thirdweb fetchWithPayment

`thirdweb.js` uses thirdweb's documented server-side x402 `fetchWithPayment` endpoint rather than a React-only hook. It requests the canonical target URL and POST method with the JSON body and pins the documented selector values `maxValue=10000`, the Base USDC asset and `chainId=eip155:8453`. A thirdweb server secret is obtained only from the supplied getter after approval, and sent only as the `x-secret-key` header to the official thirdweb endpoint.

```js
import { callWithThirdweb } from "./thirdweb.js";

const result = await callWithThirdweb({
  body: { company: "Example Corporation" },
  mode: "paid",
  approval,
  quote: unsignedV2Challenge,
  getSecretKey: async () => loadThirdwebServerKey(),
});
```

See [thirdweb x402 agents / `fetchWithPayment` API](https://portal.thirdweb.com/x402/agents). The supplied quote is validated before the server-key getter and request. The documented server API accepts amount, asset and chain selectors but does not accept an exact payee or x402-version/scheme selector; it does not expose its internal accepted requirements for independent inspection. Therefore this adapter cannot itself guarantee that the server-side managed client pays the required receiver/version or binds its internal payment to the supplied quote. Do not live-qualify until thirdweb's API supports such binding or another independently verified safeguard is established.

## Bazaar envelope and metadata limits

`shared.js` reads the sibling `../metadata/canonical-discovery.json` fixture (no network); distribute that metadata directory alongside `buyer` as part of this kit. It provides `createOfflineEnvelope`, `serializePaymentEnvelope`, and validation helpers. Each dry-run plan includes the complete `resource` and `extensions.bazaar` declaration for the caller's hand-off. The offline serializer is tested byte-for-byte against the UTF-8/base64 algorithm in the unchanged production discovery helper. The vendor request schemas do not provide a compatible field to guarantee the declaration is forwarded on each vendor's payment wire flow. No such forwarding is claimed.

## Live qualification still pending

These integrations have only been tested with offline injected mocks. No paid purchase, signature, live authorization, contact, public listing/submission or deployment has occurred or is implied by these files. Before qualification, obtain separate explicit user approval and test a controlled wallet/account with the real SDK/CLI versions, v2 challenge validation, exact receiver and final response behavior. Do not infer live compatibility from mock tests.
