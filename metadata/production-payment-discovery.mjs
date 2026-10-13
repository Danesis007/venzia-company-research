/**
 * Copy public, unsigned discovery metadata from the reviewed checkout quote.
 * Never create authorizations or alter payment requirements here.
 * Missing Company Research discovery data must never silently become {}.
 * Other services retain their existing empty extensions.
 */
export function forwardPaymentMetadata(quote) {
  assertDiscoveryMetadata(quote);
  return {
    resource: structuredClone(quote.resource),
    extensions: structuredClone(quote.extensions ?? {}),
  };
}

function assertDiscoveryMetadata(document) {
  const resource = document.resource;
  const companyResearch = document.service?.id === 'company-research'
    || resource?.url?.endsWith('/api/services/company-research');
  if (!companyResearch) return;

  const tags = ['company research', 'due diligence', 'company financials',
    'risk analysis', 'competitor research'];
  const bazaar = document.extensions?.bazaar;
  const inputSchema = bazaar?.schema?.properties?.input?.properties?.body;
  const outputSchema = bazaar?.schema?.properties?.output?.properties?.example;
  const reportSchema = outputSchema?.properties?.result;
  const example = bazaar?.info?.output?.example?.result;
  const reportFields = ['company', 'requestInterpreted', 'generatedAt', 'overview',
    'keyFacts', 'financials', 'risks', 'opportunities', 'sources', 'confidence',
    'limitations', 'disclaimer'];
  if (resource?.serviceName !== 'VENZIA LAB Company Research'
    || JSON.stringify(resource?.tags) !== JSON.stringify(tags)
    || typeof resource?.description !== 'string' || !resource.description.trim()
    || bazaar?.info?.input?.type !== 'http'
    || bazaar?.info?.input?.method !== 'POST'
    || bazaar?.info?.input?.bodyType !== 'json'
    || !bazaar?.info?.input?.body?.company
    || !inputSchema?.properties?.company || !inputSchema?.required?.includes('company')
    || bazaar?.info?.output?.type !== 'json'
    || !outputSchema?.required?.includes('result')
    || reportFields.some((field) => !reportSchema?.properties?.[field]
      || !Object.hasOwn(example ?? {}, field))) {
    throw new Error('Company Research discovery metadata is missing or incomplete. '
      + 'No discovery-aware payment can be submitted. Close this checkout and reload '
      + 'the website to obtain a fresh quote; do not retry an existing authorization.');
  }
}

/** The production PAYMENT-SIGNATURE serialization; no signing or transport. */
export function serializePaymentEnvelope(payload) {
  assertDiscoveryMetadata(payload);
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));
}
