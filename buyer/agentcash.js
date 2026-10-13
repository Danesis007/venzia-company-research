import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assertApproval,
  assertMode,
  BuyerIntegrationError,
  consumeApproval,
  makePlan,
  MAX_PAYMENT_USDC,
  PAYMENT,
  REQUEST_URL,
  safeFailure,
  validatePaymentQuote,
  validateRequestBody,
} from "./shared.js";

const execFileAsync = promisify(execFile);

export function buildAgentCashCommand(body) {
  const checkedBody = validateRequestBody(body);
  return {
    command: "agentcash",
    args: [
      "fetch",
      REQUEST_URL,
      "--method",
      "POST",
      "--body",
      JSON.stringify(checkedBody),
      "--header",
      "Content-Type: application/json",
      "--payment-protocol",
      "x402",
      "--payment-network",
      PAYMENT.network,
      "--max-amount",
      MAX_PAYMENT_USDC,
      "--format",
      "json",
    ],
  };
}

/**
 * Dry-run is the default. In paid mode, an installed AgentCash CLI is invoked
 * without a shell, and only after the matching approval object is checked.
 * CLI response metadata is opaque; it is not inspected for Bazaar forwarding.
 */
export async function callWithAgentCash({
  body,
  mode = "dry-run",
  approval,
  quote,
  runner = (command, args) => execFileAsync(command, args, { windowsHide: true }),
}) {
  const plan = makePlan(body);
  assertMode(mode);
  if (mode !== "paid") return plan;
  assertApproval(approval);
  validatePaymentQuote(quote);
  consumeApproval(approval);

  const command = buildAgentCashCommand(plan.body);
  try {
    const result = await runner(command.command, command.args);
    if (result && typeof result === "object" && typeof result.stdout === "string") {
      return { stdout: result.stdout };
    }
    return result;
  } catch (error) {
    return safeFailure(
      "AGENTCASH_CALL_FAILED",
      "AgentCash call failed; CLI output was omitted.",
      error,
    );
  }
}

export { validatePaymentQuote, BuyerIntegrationError };
