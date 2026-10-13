/** Payment-free example CLI. No paid mode, transport, SDK or wallet access. */
import { parseArgs } from 'node:util';
import { callWithAgentCash } from './agentcash.js';
import { callWithCoinbaseAgentKit } from './coinbase-agentkit.js';
import { callWithThirdweb } from './thirdweb.js';

const { values } = parseArgs({
  options: {
    client: { type: 'string', default: 'agentcash' },
    company: { type: 'string' },
    request: { type: 'string' },
    domain: { type: 'string' },
    'include-filings': { type: 'boolean' },
    'max-sources': { type: 'string' },
  },
  strict: true, allowPositionals: false,
});
const clients = {
  agentcash: callWithAgentCash, agentkit: callWithCoinbaseAgentKit, thirdweb: callWithThirdweb,
};
if (!Object.hasOwn(clients, values.client)) throw new Error('Client must be agentcash, agentkit or thirdweb.');
const body = Object.fromEntries([
  ['company', values.company], ['request', values.request], ['domain', values.domain],
  ['includeFilings', values['include-filings']],
  ['maxSources', values['max-sources'] === undefined ? undefined : Number(values['max-sources'])],
].filter(([, value]) => value !== undefined));
const plan = await clients[values.client]({ body });
console.log(JSON.stringify({ ...plan, notice: 'DRY RUN ONLY: no request, wallet or payment accessed.' }, null, 2));
