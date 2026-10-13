import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serializePaymentEnvelope as productionDiscoverySerializer } from "../../metadata/production-payment-discovery.mjs";
import {
  createOfflineEnvelope,
  deserializePaymentEnvelope,
  PAYMENT,
  REQUEST_URL,
  serializePaymentEnvelope,
  validatePaymentQuote,
} from "../shared.js";
import { buildAgentCashCommand, callWithAgentCash } from "../agentcash.js";
import { callWithCoinbaseAgentKit } from "../coinbase-agentkit.js";
import { buildThirdwebFetchWithPaymentRequest, callWithThirdweb } from "../thirdweb.js";

const body = {
  company: "Example Corporation",
  domain: "https://example.com",
  includeFilings: true,
  maxSources: 5,
  request: "Summarize the business, risks and financials with source citations.",
};
const approvalTemplate = {
  approved: true,
  amount: "0.01",
  currency: "USDC",
  network: "eip155:8453",
  scheme: "exact",
  x402Version: 2,
  payTo: "0x12cF81eec47E5B6437FeB4b10e071317F7012437",
};
const forbiddenToken = "never-print-this-secret";

function freshApproval() {
  return { ...approvalTemplate };
}

function unsignedQuote(overrides = {}) {
  const envelope = createOfflineEnvelope();
  const requirement = {
    scheme: PAYMENT.scheme,
    network: PAYMENT.network,
    asset: PAYMENT.asset,
    amount: PAYMENT.amount,
    payTo: PAYMENT.payTo,
    extra: structuredClone(PAYMENT.extra),
    maxTimeoutSeconds: PAYMENT.maxTimeoutSeconds,
  };
  return {
    x402Version: PAYMENT.x402Version,
    resource: envelope.resource,
    accepts: [requirement],
    extensions: envelope.extensions,
    ...overrides,
  };
}

test("portable full metadata fixture and payment envelope match canonical data and production serialization bytes", () => {
  const canonical = JSON.parse(readFileSync(
    new URL("../../metadata/canonical-discovery.json", import.meta.url),
    "utf8",
  ));
  const envelope = createOfflineEnvelope();
  assert.deepEqual(envelope.resource, canonical.resource);
  assert.deepEqual(envelope.extensions, canonical.extensions);
  const serializationPayload = structuredClone(envelope);
  serializationPayload.resource.description += " — café";
  const serialized = serializePaymentEnvelope(serializationPayload);
  assert.equal(serialized, productionDiscoverySerializer(serializationPayload));
  const restored = deserializePaymentEnvelope(serialized);
  assert.deepEqual(restored, serializationPayload);
  assert.match(restored.resource.description, /— café/);
  assert.equal(restored.extensions.bazaar.schema.properties.input.properties.body.properties.company.type, "string");
  assert.equal(restored.extensions.bazaar.info.output.example.result.sources[0].url,
    canonical.extensions.bazaar.info.output.example.result.sources[0].url);
});

test("shared envelope serialization rejects incomplete discovery data", () => {
  const envelope = createOfflineEnvelope();
  delete envelope.extensions.bazaar.info.input.body.company;
  assert.throws(() => serializePaymentEnvelope(envelope), /metadata/i);
});

test("quote validation accepts complete unsigned v2 challenge and rejects malformed requirement or metadata", () => {
  assert.deepEqual(validatePaymentQuote(unsignedQuote()), unsignedQuote().accepts[0]);
  const malformed = [
    { accepts: [{ ...unsignedQuote().accepts[0], amount: "10001" }] },
    { accepts: [{ ...unsignedQuote().accepts[0], payTo: "0x0000000000000000000000000000000000000001" }] },
    { accepts: [{ ...unsignedQuote().accepts[0], network: "eip155:84532" }] },
    { accepts: [{ ...unsignedQuote().accepts[0], asset: "0x0000000000000000000000000000000000000001" }] },
    { accepts: [{ ...unsignedQuote().accepts[0], scheme: "upto" }] },
    { x402Version: 1 },
    { accepts: [unsignedQuote().accepts[0], unsignedQuote().accepts[0]] },
    { extensions: {} },
    { resource: {} },
  ];
  for (const patch of malformed) {
    assert.throws(() => validatePaymentQuote(unsignedQuote(patch)), { code: "QUOTE_MISMATCH" });
  }
});

test("AgentCash maps the documented CLI fetch command to the exact POST, Base preference and cap", () => {
  const invocation = buildAgentCashCommand(body);
  assert.equal(invocation.command, "agentcash");
  assert.equal(invocation.args[0], "fetch");
  assert.equal(invocation.args[1], REQUEST_URL);
  assert.equal(invocation.args[invocation.args.indexOf("--method") + 1], "POST");
  assert.deepEqual(
    JSON.parse(invocation.args[invocation.args.indexOf("--body") + 1]),
    body,
  );
  assert.equal(invocation.args[invocation.args.indexOf("--payment-protocol") + 1], "x402");
  assert.equal(invocation.args[invocation.args.indexOf("--payment-network") + 1], PAYMENT.network);
  assert.equal(invocation.args[invocation.args.indexOf("--max-amount") + 1], "0.01");
  assert.equal(invocation.args[invocation.args.indexOf("--header") + 1], "Content-Type: application/json");
});

test("AgentCash is dry-run by default and approval is checked before CLI invocation", async () => {
  let invoked = false;
  const preview = await callWithAgentCash({ body, runner: () => { invoked = true; } });
  assert.equal(preview.mode, "dry-run");
  assert.deepEqual(preview.discovery, createOfflineEnvelope());
  assert.equal(invoked, false);
  await assert.rejects(
    () => callWithAgentCash({ body, mode: "paid", runner: () => { invoked = true; } }),
    { code: "EXPLICIT_APPROVAL_REQUIRED" },
  );
  assert.equal(invoked, false);
});

test("AgentCash validates POST body before invoking runner and returns result without retry", async () => {
  let callCount = 0;
  const response = { status: 401, body: "unauthorized" };
  const result = await callWithAgentCash({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    runner: async () => { callCount += 1; return response; },
  });
  assert.equal(result, response);
  assert.equal(callCount, 1);
  callCount = 0;
  await assert.rejects(
    () => callWithAgentCash({
      body: { ...body, unexpected: true },
      mode: "paid",
      approval: freshApproval(),
      quote: unsignedQuote(),
      runner: async () => { callCount += 1; },
    }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(callCount, 0);
});

test("AgentCash does not leak runner errors or stderr/secrets", async () => {
  const successfulCli = await callWithAgentCash({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    runner: async () => ({ stdout: "paid result", stderr: forbiddenToken }),
  });
  assert.deepEqual(successfulCli, { stdout: "paid result" });
  const result = await callWithAgentCash({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    runner: async () => { throw new Error(`bad ${forbiddenToken}`); },
  });
  assert.equal(result.error, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(forbiddenToken));
});

test("AgentCash consumes an approval once and rejects unsupported modes", async () => {
  let calls = 0;
  const oneUseApproval = freshApproval();
  const options = {
    body,
    mode: "paid",
    approval: oneUseApproval,
    quote: unsignedQuote(),
    runner: async () => { calls += 1; return { stdout: "one call" }; },
  };
  await callWithAgentCash(options);
  await assert.rejects(() => callWithAgentCash(options), { code: "APPROVAL_ALREADY_USED" });
  await assert.rejects(() => callWithAgentCash({ body, mode: "live" }), { code: "INVALID_MODE" });
  assert.equal(calls, 1);
});

test("AgentCash rejects a malformed actual quote before invoking CLI", async () => {
  let calls = 0;
  await assert.rejects(
    () => callWithAgentCash({
      body,
      mode: "paid",
      approval: freshApproval(),
      quote: unsignedQuote({ accepts: [] }),
      runner: async () => { calls += 1; },
    }),
    { code: "QUOTE_MISMATCH" },
  );
  assert.equal(calls, 0);
});

test("Coinbase AgentKit approval guard runs before SDK import and wallet access", async () => {
  let imports = 0;
  let wallets = 0;
  const preview = await callWithCoinbaseAgentKit({ body, importer: () => { imports += 1; } });
  assert.equal(preview.mode, "dry-run");
  assert.deepEqual(preview.discovery, createOfflineEnvelope());
  await assert.rejects(
    () => callWithCoinbaseAgentKit({
      body,
      mode: "paid",
      importer: () => { imports += 1; },
      getWalletProvider: () => { wallets += 1; },
    }),
    { code: "EXPLICIT_APPROVAL_REQUIRED" },
  );
  assert.equal(imports, 0);
  assert.equal(wallets, 0);
});

test("Coinbase AgentKit rejects malformed quote and unknown mode before SDK or wallet access", async () => {
  let imports = 0;
  let wallets = 0;
  const shared = {
    body,
    approval: freshApproval(),
    importer: async () => { imports += 1; },
    getWalletProvider: async () => { wallets += 1; },
  };
  await assert.rejects(
    () => callWithCoinbaseAgentKit({ ...shared, mode: "paid", quote: unsignedQuote({ resource: {} }) }),
    { code: "QUOTE_MISMATCH" },
  );
  await assert.rejects(
    () => callWithCoinbaseAgentKit({ ...shared, mode: "publish" }),
    { code: "INVALID_MODE" },
  );
  assert.equal(imports, 0);
  assert.equal(wallets, 0);
});

test("Coinbase AgentKit uses official X402ActionProvider action, exact payment mapping and one invoke", async () => {
  const events = [];
  const action = {
    name: "X402ActionProvider_retry_http_request_with_x402",
    invoke: async (args) => {
      events.push(["invoke", args]);
      return { ok: true, status: 200 };
    },
  };
  class MockX402ActionProvider {
    constructor(config) {
      events.push(["config", config]);
    }
    getActions(wallet) {
      events.push(["actions", wallet]);
      return [action];
    }
  }
  const result = await callWithCoinbaseAgentKit({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    importer: async () => { events.push(["import"]); return { X402ActionProvider: MockX402ActionProvider }; },
    getWalletProvider: async () => { events.push(["wallet"]); return { id: "mock-wallet" }; },
  });
  assert.deepEqual(result, { ok: true, status: 200 });
  assert.deepEqual(events.map(([name]) => name), ["import", "config", "wallet", "actions", "invoke"]);
  const config = events.find(([name]) => name === "config")[1];
  assert.equal(config.maxPaymentUsdc, 0.01);
  assert.equal(config.allowDynamicServiceRegistration, false);
  assert.deepEqual(config.registeredServices, [REQUEST_URL]);
  const args = events.find(([name]) => name === "invoke")[1];
  assert.equal(args.url, REQUEST_URL);
  assert.equal(args.method, "POST");
  assert.deepEqual(args.body, body);
  assert.deepEqual(args.selectedPaymentOption, {
    scheme: "exact",
    network: "eip155:8453",
    asset: PAYMENT.asset,
    amount: "10000",
    maxAmountRequired: null,
    price: null,
    payTo: PAYMENT.payTo,
  });
});

test("Coinbase AgentKit rejects invalid body before wallet access and masks vendor errors without retry", async () => {
  let walletCalls = 0;
  await assert.rejects(
    () => callWithCoinbaseAgentKit({
      body: { company: "X", extra: 1 },
      mode: "paid",
      approval: freshApproval(),
      quote: unsignedQuote(),
      importer: async () => ({ X402ActionProvider: class {} }),
      getWalletProvider: () => { walletCalls += 1; },
    }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(walletCalls, 0);
  let calls = 0;
  const result = await callWithCoinbaseAgentKit({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    importer: async () => ({
      X402ActionProvider: class {
        getActions() {
          return [{ name: "X402ActionProvider_retry_http_request_with_x402", invoke: async () => {
            calls += 1;
            const error = new Error(`provider ${forbiddenToken}`);
            error.status = 401;
            throw error;
          } }];
        }
      },
    }),
    getWalletProvider: async () => ({}),
  });
  assert.equal(calls, 1);
  assert.equal(result.error, true);
  assert.equal(result.status, 401);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(forbiddenToken));

  const returnedError = await callWithCoinbaseAgentKit({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    importer: async () => ({
      X402ActionProvider: class {
        getActions() {
          return [{
            name: "X402ActionProvider_retry_http_request_with_x402",
            invoke: async () => JSON.stringify({ error: true, message: forbiddenToken }),
          }];
        }
      },
    }),
    getWalletProvider: async () => ({}),
  });
  assert.equal(returnedError.error, true);
  assert.doesNotMatch(JSON.stringify(returnedError), new RegExp(forbiddenToken));
});

test("thirdweb request maps documented fetchWithPayment endpoint body, USDC, Base and amount cap", () => {
  const { url, init, discovery } = buildThirdwebFetchWithPaymentRequest(body);
  assert.equal(url.searchParams.get("url"), REQUEST_URL);
  assert.equal(url.searchParams.get("method"), "POST");
  assert.equal(url.searchParams.get("maxValue"), "10000");
  assert.equal(url.searchParams.get("asset"), PAYMENT.asset);
  assert.equal(url.searchParams.get("chainId"), PAYMENT.network);
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), body);
  assert.deepEqual(discovery, createOfflineEnvelope());
});

test("thirdweb approval guard runs before key getter and transport; paid path performs one call", async () => {
  let keyReads = 0;
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return new Response("{\"ok\":true}", { status: 200 }); };
  const preview = await callWithThirdweb({ body, fetchImpl, getSecretKey: () => { keyReads += 1; } });
  assert.equal(preview.mode, "dry-run");
  await assert.rejects(
    () => callWithThirdweb({
      body,
      mode: "paid",
      fetchImpl,
      getSecretKey: () => { keyReads += 1; return forbiddenToken; },
    }),
    { code: "EXPLICIT_APPROVAL_REQUIRED" },
  );
  assert.equal(keyReads, 0);
  assert.equal(requests, 0);

  const result = await callWithThirdweb({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    getSecretKey: async () => { keyReads += 1; return forbiddenToken; },
    fetchImpl: async (url, init) => {
      requests += 1;
      assert.equal(new URL(url).searchParams.get("maxValue"), "10000");
      assert.equal(init.headers["x-secret-key"], forbiddenToken);
      assert.deepEqual(JSON.parse(init.body), body);
      return new Response("{\"ok\":true}", { status: 200 });
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(keyReads, 1);
  assert.equal(requests, 1);
});

test("thirdweb rejects malformed quote and unknown mode before key access or transport", async () => {
  let keyReads = 0;
  let requests = 0;
  const shared = {
    body,
    approval: freshApproval(),
    getSecretKey: async () => { keyReads += 1; return forbiddenToken; },
    fetchImpl: async () => { requests += 1; },
  };
  await assert.rejects(
    () => callWithThirdweb({ ...shared, mode: "paid", quote: unsignedQuote({ extensions: {} }) }),
    { code: "QUOTE_MISMATCH" },
  );
  await assert.rejects(
    () => callWithThirdweb({ ...shared, mode: "execute" }),
    { code: "INVALID_MODE" },
  );
  assert.equal(keyReads, 0);
  assert.equal(requests, 0);
});

test("thirdweb validates POST input and masks errors and response diagnostics", async () => {
  let requests = 0;
  await assert.rejects(
    () => callWithThirdweb({
      body: { company: "Valid", extra: forbiddenToken },
      mode: "paid",
      approval: freshApproval(),
      quote: unsignedQuote(),
      getSecretKey: async () => forbiddenToken,
      fetchImpl: async () => { requests += 1; },
    }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(requests, 0);
  const responseFailure = await callWithThirdweb({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    getSecretKey: async () => forbiddenToken,
    fetchImpl: async () => { requests += 1; return new Response(forbiddenToken, { status: 401 }); },
  });
  assert.equal(responseFailure.status, 401);
  assert.equal(requests, 1);
  assert.doesNotMatch(JSON.stringify(responseFailure), new RegExp(forbiddenToken));
  const thrownFailure = await callWithThirdweb({
    body,
    mode: "paid",
    approval: freshApproval(),
    quote: unsignedQuote(),
    getSecretKey: async () => forbiddenToken,
    fetchImpl: async () => { throw new Error(forbiddenToken); },
  });
  assert.doesNotMatch(JSON.stringify(thrownFailure), new RegExp(forbiddenToken));
});
