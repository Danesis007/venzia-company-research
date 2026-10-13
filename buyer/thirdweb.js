import {
  assertApproval,
  assertMode,
  BuyerIntegrationError,
  consumeApproval,
  makePlan,
  MAX_PAYMENT_ATOMIC,
  PAYMENT,
  REQUEST_URL,
  safeFailure,
  validatePaymentQuote,
} from "./shared.js";

export const THIRDWEB_FETCH_WITH_PAYMENT_URL =
  "https://api.thirdweb.com/v1/payments/x402/fetch";

export function buildThirdwebFetchWithPaymentRequest(body) {
  const plan = makePlan(body);
  const url = new URL(THIRDWEB_FETCH_WITH_PAYMENT_URL);
  url.searchParams.set("url", REQUEST_URL);
  url.searchParams.set("method", "POST");
  url.searchParams.set("maxValue", MAX_PAYMENT_ATOMIC.toString());
  url.searchParams.set("asset", PAYMENT.asset);
  url.searchParams.set("chainId", PAYMENT.network);
  return {
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan.body),
    },
    discovery: plan.discovery,
  };
}

/**
 * Calls thirdweb's documented x402 fetchWithPayment HTTP API. The secret-key
 * getter and fetch transport run only after an exact per-call approval.
 */
export async function callWithThirdweb({
  body,
  mode = "dry-run",
  approval,
  quote,
  getSecretKey,
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  const plan = makePlan(body);
  assertMode(mode);
  if (mode !== "paid") return plan;
  assertApproval(approval);
  validatePaymentQuote(quote);
  consumeApproval(approval);
  if (typeof getSecretKey !== "function") {
    throw new BuyerIntegrationError("THIRDWEB_KEY_REQUIRED", "Provide a thirdweb server-key getter after approval.");
  }

  let key;
  try {
    key = await getSecretKey();
  } catch {
    return safeFailure(
      "THIRDWEB_KEY_UNAVAILABLE",
      "thirdweb server key could not be obtained; diagnostics were omitted.",
    );
  }
  if (typeof key !== "string" || !key.trim()) {
    throw new BuyerIntegrationError("THIRDWEB_KEY_REQUIRED", "thirdweb server key is unavailable.");
  }
  const request = buildThirdwebFetchWithPaymentRequest(plan.body);
  try {
    const response = await fetchImpl(request.url, {
      ...request.init,
      headers: { ...request.init.headers, "x-secret-key": key },
    });
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = text;
    }
    if (!response.ok) {
      return {
        error: true,
        code: "THIRDWEB_CALL_FAILED",
        status: response.status,
        message: "thirdweb fetchWithPayment returned an HTTP error; response details omitted.",
      };
    }
    return result;
  } catch (error) {
    return safeFailure(
      "THIRDWEB_CALL_FAILED",
      "thirdweb fetchWithPayment call failed; SDK diagnostics were omitted.",
      error,
    );
  }
}

export { validatePaymentQuote, BuyerIntegrationError };
