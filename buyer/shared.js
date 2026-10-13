import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";

export const REQUEST_URL = "https://venzia-complet-ezip.replit.app/api/services/company-research";
export const PAYMENT = Object.freeze({
  x402Version: 2,
  scheme: "exact",
  amount: "10000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  payTo: "0x12cF81eec47E5B6437FeB4b10e071317F7012437",
  extra: Object.freeze({ name: "USD Coin", version: "2" }),
  maxTimeoutSeconds: 120,
});
export const MAX_PAYMENT_USDC = "0.01";
export const MAX_PAYMENT_ATOMIC = 10000n;

const inputProperties = new Set([
  "company",
  "domain",
  "includeFilings",
  "maxSources",
  "request",
]);
const reportFields = [
  "company",
  "requestInterpreted",
  "generatedAt",
  "overview",
  "keyFacts",
  "financials",
  "risks",
  "opportunities",
  "sources",
  "confidence",
  "limitations",
  "disclaimer",
];
const consumedApprovals = new WeakSet();

function readCanonicalDiscovery() {
  const canonicalPath = new URL("../metadata/canonical-discovery.json", import.meta.url);
  return JSON.parse(readFileSync(canonicalPath, "utf8"));
}

export class BuyerIntegrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BuyerIntegrationError";
    this.code = code;
  }
}

export function validateRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new BuyerIntegrationError("INVALID_INPUT", "Request body must be a JSON object.");
  }
  for (const key of Object.keys(body)) {
    if (!inputProperties.has(key)) {
      throw new BuyerIntegrationError("INVALID_INPUT", `Unsupported request field: ${key}.`);
    }
  }
  if (typeof body.company !== "string"
    || body.company.trim().length < 2 || body.company.length > 120) {
    throw new BuyerIntegrationError("INVALID_INPUT", "company must be a string of 2 to 120 characters.");
  }
  if (body.domain !== undefined && (typeof body.domain !== "string" || body.domain.length > 200)) {
    throw new BuyerIntegrationError("INVALID_INPUT", "domain must be a string of at most 200 characters.");
  }
  if (body.includeFilings !== undefined && typeof body.includeFilings !== "boolean") {
    throw new BuyerIntegrationError("INVALID_INPUT", "includeFilings must be a boolean.");
  }
  if (body.maxSources !== undefined
    && (!Number.isInteger(body.maxSources) || body.maxSources < 1 || body.maxSources > 10)) {
    throw new BuyerIntegrationError("INVALID_INPUT", "maxSources must be an integer from 1 through 10.");
  }
  if (body.request !== undefined
    && (typeof body.request !== "string" || body.request.length < 3 || body.request.length > 600)) {
    throw new BuyerIntegrationError("INVALID_INPUT", "request must be a string of 3 to 600 characters.");
  }
  return JSON.parse(JSON.stringify(body));
}

export function validatePaymentQuote(quote) {
  const envelope = createOfflineEnvelope();
  const requirement = quote?.accepts?.length === 1 ? quote.accepts[0] : undefined;
  const allowedQuoteKeys = new Set(["x402Version", "resource", "accepts", "extensions", "error"]);
  const allowedRequirementKeys = new Set([
    "scheme",
    "network",
    "asset",
    "amount",
    "payTo",
    "extra",
    "maxTimeoutSeconds",
  ]);
  const matches = quote?.x402Version === PAYMENT.x402Version
    && Object.keys(quote).every((key) => allowedQuoteKeys.has(key))
    && (quote.error === undefined || typeof quote.error === "string")
    && isDeepStrictEqual(quote.resource, envelope.resource)
    && isDeepStrictEqual(quote.extensions, envelope.extensions)
    && Array.isArray(quote.accepts)
    && quote.accepts.length === 1
    && Object.keys(requirement ?? {}).every((key) => allowedRequirementKeys.has(key))
    && requirement?.scheme === PAYMENT.scheme
    && requirement?.amount === PAYMENT.amount
    && typeof requirement?.asset === "string"
    && requirement.asset.toLowerCase() === PAYMENT.asset.toLowerCase()
    && requirement?.network === PAYMENT.network
    && typeof requirement?.payTo === "string"
    && requirement.payTo.toLowerCase() === PAYMENT.payTo.toLowerCase()
    && isDeepStrictEqual(requirement?.extra, PAYMENT.extra)
    && requirement?.maxTimeoutSeconds === PAYMENT.maxTimeoutSeconds;
  if (!matches) {
    throw new BuyerIntegrationError(
      "QUOTE_MISMATCH",
      "Unsigned payment quote does not match the canonical v2 exact Base USDC requirement and discovery metadata.",
    );
  }
  return structuredClone(requirement);
}

export function assertApproval(approval) {
  if (!approval || approval.approved !== true
    || approval.amount !== MAX_PAYMENT_USDC
    || approval.currency !== "USDC"
    || approval.network !== PAYMENT.network
    || approval.scheme !== PAYMENT.scheme
    || approval.x402Version !== PAYMENT.x402Version
    || typeof approval.payTo !== "string"
    || approval.payTo.toLowerCase() !== PAYMENT.payTo.toLowerCase()) {
    throw new BuyerIntegrationError(
      "EXPLICIT_APPROVAL_REQUIRED",
      "Paid execution requires explicit approval for exactly 0.01 USDC, v2 exact on Base to the listed recipient.",
    );
  }
  return true;
}

export function consumeApproval(approval) {
  assertApproval(approval);
  if (typeof approval !== "object" || consumedApprovals.has(approval)) {
    throw new BuyerIntegrationError(
      "APPROVAL_ALREADY_USED",
      "This approval has already been used. Obtain a fresh, explicit approval for a new call.",
    );
  }
  consumedApprovals.add(approval);
}

export function assertMode(mode) {
  if (mode !== "dry-run" && mode !== "paid") {
    throw new BuyerIntegrationError("INVALID_MODE", "mode must be exactly 'dry-run' or 'paid'.");
  }
}

export function createOfflineEnvelope() {
  const canonicalDiscovery = readCanonicalDiscovery();
  const envelope = {
    resource: structuredClone(canonicalDiscovery.resource),
    extensions: structuredClone(canonicalDiscovery.extensions),
  };
  assertDiscoveryMetadata(envelope);
  return envelope;
}

export function serializePaymentEnvelope(payload) {
  assertDiscoveryMetadata(payload);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function deserializePaymentEnvelope(serialized) {
  try {
    const payload = JSON.parse(Buffer.from(serialized, "base64").toString("utf8"));
    assertDiscoveryMetadata(payload);
    return payload;
  } catch {
    throw new BuyerIntegrationError(
      "INVALID_ENVELOPE",
      "Serialized discovery envelope is invalid or incomplete.",
    );
  }
}

export function assertDiscoveryMetadata(document) {
  const resource = document?.resource;
  const bazaar = document?.extensions?.bazaar;
  const bodySchema = bazaar?.schema?.properties?.input?.properties?.body;
  const outputSchema = bazaar?.schema?.properties?.output?.properties?.example;
  const reportSchema = outputSchema?.properties?.result;
  const example = bazaar?.info?.output?.example?.result;
  const tags = [
    "company research",
    "due diligence",
    "company financials",
    "risk analysis",
    "competitor research",
  ];
  if (resource?.serviceName !== "VENZIA LAB Company Research"
    || resource?.url !== REQUEST_URL
    || JSON.stringify(resource?.tags) !== JSON.stringify(tags)
    || typeof resource?.description !== "string" || !resource.description.trim()
    || bazaar?.info?.input?.type !== "http"
    || bazaar.info.input.method !== "POST"
    || bazaar.info.input.bodyType !== "json"
    || !bazaar.info.input.body?.company
    || bodySchema?.properties?.company?.type !== "string"
    || !bodySchema.required?.includes("company")
    || bazaar.info.output.type !== "json"
    || !outputSchema.required?.includes("result")
    || reportFields.some((field) => !reportSchema?.properties?.[field]
      || !Object.hasOwn(example ?? {}, field))) {
    throw new BuyerIntegrationError(
      "DISCOVERY_METADATA_INCOMPLETE",
      "Complete Company Research Bazaar discovery metadata is required.",
    );
  }
}

export function safeFailure(code, message, error) {
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  return {
    error: true,
    code,
    message,
    ...(status === undefined ? {} : { status }),
  };
}

export function makePlan(body) {
  return {
    mode: "dry-run",
    url: REQUEST_URL,
    method: "POST",
    body: validateRequestBody(body),
    discovery: createOfflineEnvelope(),
    payment: {
      x402Version: PAYMENT.x402Version,
      scheme: PAYMENT.scheme,
      amount: MAX_PAYMENT_USDC,
      currency: "USDC",
      asset: PAYMENT.asset,
      network: PAYMENT.network,
      payTo: PAYMENT.payTo,
    },
  };
}
