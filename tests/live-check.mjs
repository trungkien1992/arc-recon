// Optional read-only live check. It queries a bounded 128-block range and one transaction.
import { writeFile } from 'node:fs/promises';
import { createRpc, recentExample, parseCsv, reconcile, reportCsv, NETWORKS } from '../dist/core.mjs';
const rpc = createRpc('mainnet');
const csv = await recentExample('mainnet', rpc);
const report = await reconcile(parseCsv(csv), 'mainnet', { rpc });
if (report.results[0]?.status !== 'matched') throw new Error(JSON.stringify(report.results));
report.rpcEndpoint = NETWORKS.mainnet.rpc;
report.exampleOwnership = 'Public third-party transfer; no claim of builder or customer activity.';
await writeFile(new URL('../evidence/mainnet-example-input.csv', import.meta.url), csv);
await writeFile(new URL('../evidence/mainnet-example-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
await writeFile(new URL('../evidence/mainnet-example-report.csv', import.meta.url), reportCsv(report));
console.log(JSON.stringify({ source: report.source, chainId: report.chainId, transaction: report.results[0].hash, status: report.results[0].status, recipient: report.results[0].recipient, sender: report.results[0].actualSender, amountUsdc: report.results[0].actualAmount, feeUsdc: report.results[0].fee, block: report.results[0].block, time: report.results[0].time, publicThirdPartyExample: true }));
