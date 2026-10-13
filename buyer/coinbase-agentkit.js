import {
  assertApproval,
  assertMode,
  BuyerIntegrationError,
  consumeApproval,
  makePlan,
  PAYMENT,
  REQUEST_URL,
  safeFailure,
  validatePaymentQuote,
} from "./shared.js";

const defaultAgentKitImporter = () => import("@coinbase/agentkit");

/**
 * Uses the official AgentKit X402ActionProvider retry_http_request_with_x402
 * action. The SDK and wallet provider are both resolved lazily after approval.
 */
export async function callWithCoinbaseAgentKit({
  body,
  mode = "dry-run",
  approval,
  getWalletProvider,
  importer = defaultAgentKitImporter,
  quote,
}) {
  const plan = makePlan(body);
  assertMode(mode);
  if (mode !== "paid") return plan;
  assertApproval(approval);
  const approvedRequirement = validatePaymentQuote(quote);
  consumeApproval(approval);
  if (typeof getWalletProvider !== "function") {
    throw new BuyerIntegrationError("WALLET_PROVIDER_REQUIRED", "Provide a wallet-provider factory after approval.");
  }

  try {
    const sdk = await importer();
    if (typeof sdk.X402ActionProvider !== "function") {
      throw new BuyerIntegrationError(
        "AGENTKIT_API_UNAVAILABLE",
        "Installed Coinbase AgentKit does not export X402ActionProvider.",
      );
    }
    const provider = new sdk.X402ActionProvider({
      registeredServices: [REQUEST_URL],
      allowDynamicServiceRegistration: false,
      maxPaymentUsdc: 0.01,
    });
    const walletProvider = await getWalletProvider();
    const action = provider.getActions(walletProvider)
      .find((candidate) => candidate.name === "X402ActionProvider_retry_http_request_with_x402");
    if (!action) {
      throw new BuyerIntegrationError(
        "AGENTKIT_ACTION_UNAVAILABLE",
        "Installed Coinbase AgentKit has no X402ActionProvider_retry_http_request_with_x402 action.",
      );
    }
    const result = await action.invoke({
      url: REQUEST_URL,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      queryParams: null,
      body: plan.body,
      selectedPaymentOption: {
        scheme: PAYMENT.scheme,
        network: approvedRequirement.network,
        asset: approvedRequirement.asset,
        amount: approvedRequirement.amount,
        maxAmountRequired: null,
        price: null,
        payTo: approvedRequirement.payTo,
      },
    });
    const parsed = typeof result === "string"
      ? (() => {
        try {
          return JSON.parse(result);
        } catch {
          return null;
        }
      })()
      : result;
    if (parsed && typeof parsed === "object"
      && (parsed.error === true
        || (parsed.success === true && Number.isInteger(parsed.status) && parsed.status >= 400))) {
      return safeFailure(
        "COINBASE_AGENTKIT_CALL_FAILED",
        "Coinbase AgentKit returned an HTTP or payment error; response details were omitted.",
        parsed,
      );
    }
    return result;
  } catch (error) {
    if (error instanceof BuyerIntegrationError) {
      return safeFailure(error.code, error.message, error);
    }
    return safeFailure(
      "COINBASE_AGENTKIT_CALL_FAILED",
      "Coinbase AgentKit call failed; SDK diagnostics were omitted.",
      error,
    );
  }
}

export { validatePaymentQuote, BuyerIntegrationError };
