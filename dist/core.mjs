export const NETWORKS = Object.freeze({
  mainnet: { name: 'Arc mainnet', chainId: 5042, rpc: 'https://rpc.blockdaemon.mainnet.arc.io', explorer: 'https://explorer.arc.io' },
  testnet: { name: 'Arc testnet', chainId: 5042002, rpc: 'https://rpc.testnet.arc.io', explorer: 'https://explorer.testnet.arc.io' },
});
export const NATIVE_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';
export const ERC20_USDC = '0x3600000000000000000000000000000000000000';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const HEX = /^0x[0-9a-f]+$/i;

export function normalizeAddress(value) {
  const address = String(value || '').trim();
  if (!ADDRESS.test(address) || address.toLowerCase() === ZERO_ADDRESS) throw new Error('Enter a non-zero 0x wallet address with 40 hexadecimal characters.');
  return address.toLowerCase();
}
export function normalizeHash(value) {
  const hash = String(value || '').trim();
  if (!HASH.test(hash)) throw new Error('A transaction hash needs 0x followed by 64 hexadecimal characters.');
  return hash.toLowerCase();
}
export function parseAmount(value) {
  const amount = String(value || '').trim();
  if (!/^(0|[1-9]\d{0,59})(\.\d{1,18})?$/.test(amount)) throw new Error('Use a positive decimal USDC amount with up to 18 decimal places.');
  const [whole, fraction = ''] = amount.split('.');
  const units = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (units <= 0n || units >= 2n ** 256n) throw new Error('USDC amount is outside the supported range.');
  return units;
}
export function formatUnits(units, decimals = 18) {
  const value = BigInt(units);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '');
}
function hexInteger(value, label) {
  if (typeof value !== 'string' || !HEX.test(value)) throw new Error(`Missing or invalid ${label} in RPC evidence.`);
  return BigInt(value);
}
export function parseCsv(text) {
  if (typeof text !== 'string' || text.length > 16000) throw new Error('Keep the payment batch below 16,000 characters.');
  const cells = [], row = [];
  let current = '', quoted = false, afterQuote = false;
  const pushCell = () => { row.push(current); current = ''; afterQuote = false; };
  const pushRow = () => { pushCell(); if (row.some(cell => cell.trim())) cells.push([...row]); row.length = 0; };
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else current += c;
    } else if (c === '"') {
      if (current.length || afterQuote) throw new Error('A CSV quote must start a field.');
      quoted = true;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else {
      if (afterQuote && !/\s/.test(c)) throw new Error('Unexpected text after a quoted CSV field.');
      if (!afterQuote) current += c;
    }
  }
  if (quoted) throw new Error('Close the quoted CSV field before checking the batch.');
  pushRow();
  if (cells.length < 2) throw new Error('Add a header and at least one payment row.');
  const header = cells.shift().map(cell => cell.trim().toLowerCase());
  if (new Set(header).size !== header.length) throw new Error('CSV headers must be unique.');
  for (const key of ['reference', 'transaction_hash', 'recipient', 'amount_usdc']) {
    if (!header.includes(key)) throw new Error(`Missing CSV column: ${key}.`);
  }
  if (header.some(key => !['reference', 'transaction_hash', 'recipient', 'amount_usdc', 'sender'].includes(key))) throw new Error('Use the template columns; sender is the only optional extra column.');
  if (cells.length > 25) throw new Error('Check up to 25 payment rows in one batch.');
  return cells.map((values, index) => {
    try {
      if (values.length !== header.length) throw new Error('CSV row has a different number of columns from the header.');
      const item = Object.fromEntries(header.map((key, j) => [key, values[j].trim()]));
      if (!item.reference || item.reference.length > 120) throw new Error('Use a reference of 1–120 characters.');
      return {
        reference: item.reference, hash: normalizeHash(item.transaction_hash), recipient: normalizeAddress(item.recipient),
        sender: item.sender ? normalizeAddress(item.sender) : '', amount: formatUnits(parseAmount(item.amount_usdc)),
      };
    } catch (error) { throw new Error(`Row ${index + 2}: ${error.message}`); }
  });
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function serializeCsv(rows) { return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

export function createRpc(networkKey, fetchImpl = globalThis.fetch) {
  const network = NETWORKS[networkKey];
  if (!network) throw new Error('Select Arc mainnet or testnet.');
  let id = 0;
  return async (method, params = []) => {
    const requestId = ++id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(network.rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      });
      if (!response.ok) throw new Error(`Arc RPC returned HTTP ${response.status}. Try again later.`);
      const data = await response.json();
      if (data.id !== requestId || data.jsonrpc !== '2.0') throw new Error('Unexpected response from Arc RPC.');
      if (data.error) throw new Error(String(data.error.message || 'Arc RPC rejected the request.').slice(0, 250));
      if (!Object.hasOwn(data, 'result')) throw new Error('Arc RPC response has no result.');
      return data.result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Arc RPC timed out. The payment remains unverified.');
      if (error instanceof TypeError) throw new Error('Could not reach Arc RPC. Check your connection; browser access may be restricted.');
      throw error;
    } finally { clearTimeout(timeout); }
  };
}

export function nativeMovements(receipt) {
  if (!Array.isArray(receipt.logs)) throw new Error('RPC returned an invalid receipt log list.');
  const unique = new Map();
  for (const log of receipt.logs || []) {
    if (String(log.address).toLowerCase() !== NATIVE_EMITTER || log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.removed) throw new Error('RPC returned a removed transfer log.');
    if (log.topics.length !== 3 || !log.topics.slice(1).every(topic => /^0x0{24}[0-9a-f]{40}$/i.test(topic)) || !/^0x[0-9a-f]{64}$/i.test(log.data)) throw new Error('RPC returned an invalid native USDC transfer log.');
    if (log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() || hexInteger(log.blockNumber, 'log block number') !== hexInteger(receipt.blockNumber, 'receipt block number')) throw new Error('Transfer log does not agree with its transaction receipt.');
    const logIndex = hexInteger(log.logIndex, 'log index').toString();
    const movement = { sender: '0x' + log.topics[1].slice(-40).toLowerCase(), recipient: '0x' + log.topics[2].slice(-40).toLowerCase(), units: BigInt(log.data).toString(), logIndex };
    const existing = unique.get(logIndex);
    if (existing && JSON.stringify(existing) !== JSON.stringify(movement)) throw new Error('Conflicting transfer logs use the same log index.');
    unique.set(logIndex, movement);
  }
  return [...unique.values()].sort((a, b) => BigInt(a.logIndex) < BigInt(b.logIndex) ? -1 : 1);
}
export async function fetchEvidence(hash, rpc) {
  const [receipt, transaction] = await Promise.all([rpc('eth_getTransactionReceipt', [hash]), rpc('eth_getTransactionByHash', [hash])]);
  if (!receipt) return { state: transaction ? 'pending' : 'not_found', fee: '', movements: [], detail: transaction ? 'No included transaction receipt is available yet.' : 'Transaction is not available on the selected Arc network.' };
  if (!transaction) throw new Error('RPC returned a receipt without its transaction.');
  if (!HASH.test(receipt.blockHash || '') || !HASH.test(transaction.blockHash || '')) throw new Error('RPC evidence has a missing or invalid block hash.');
  if (receipt.transactionHash?.toLowerCase() !== hash || transaction.hash?.toLowerCase() !== hash || receipt.blockHash?.toLowerCase() !== transaction.blockHash?.toLowerCase() || hexInteger(receipt.blockNumber, 'receipt block number') !== hexInteger(transaction.blockNumber, 'transaction block number')) throw new Error('Transaction and receipt evidence disagree.');
  if (normalizeAddress(receipt.from) !== normalizeAddress(transaction.from)) throw new Error('Transaction and receipt fee-payer addresses disagree.');
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block || !HASH.test(block.hash || '') || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase() || hexInteger(block.number, 'block number') !== hexInteger(receipt.blockNumber, 'receipt block number')) throw new Error('Receipt is not consistent with the block returned by Arc RPC.');
  const status = hexInteger(receipt.status, 'receipt status');
  if (status !== 0n && status !== 1n) throw new Error('RPC returned an unsupported receipt status.');
  const fee = (hexInteger(receipt.gasUsed, 'gas used') * hexInteger(receipt.effectiveGasPrice, 'effective gas price')).toString();
  const timestamp = hexInteger(block.timestamp, 'block timestamp');
  if (timestamp > 8640000000000n) throw new Error('Unsupported block timestamp.');
  return {
    state: status === 1n ? 'included' : 'failed', fee, feePayer: normalizeAddress(transaction.from), block: hexInteger(receipt.blockNumber, 'receipt block number').toString(), blockHash: receipt.blockHash,
    time: new Date(Number(timestamp) * 1000).toISOString(), movements: status === 1n ? nativeMovements(receipt) : [],
    detail: status === 0n ? 'The transaction failed; it did not complete this payment.' : '',
  };
}
export function matchRows(rows, evidenceMap, networkKey, source = 'live_rpc') {
  const used = new Set();
  const results = rows.map(row => {
    const evidence = evidenceMap.get(row.hash);
    const result = { ...row, status: 'unverified', detail: '', actualAmount: '', actualSender: '', logIndex: '', fee: evidence?.fee ? formatUnits(evidence.fee) : '', feePayer: evidence?.feePayer || '', block: evidence?.block || '', time: evidence?.time || '' };
    if (!evidence || evidence.error) { result.detail = evidence?.error || 'Evidence was not fetched.'; return result; }
    if (evidence.state !== 'included') { result.status = evidence.state; result.detail = evidence.detail; return result; }
    const recipientMovements = evidence.movements.filter(movement => movement.recipient === row.recipient && (!row.sender || movement.sender === row.sender) && movement.sender !== ZERO_ADDRESS && movement.recipient !== ZERO_ADDRESS);
    const matching = recipientMovements.filter(movement => BigInt(movement.units) === parseAmount(row.amount));
    if (matching.length > 1) { result.status = 'ambiguous'; result.detail = 'Multiple transfers match these details. This row needs a specific log index before it can be reconciled.'; return result; }
    if (!matching.length) {
      result.status = evidence.movements.length ? 'mismatch' : 'unverified';
      result.detail = evidence.movements.length ? 'No native USDC movement matches the expected recipient, amount and optional sender.' : 'No supported native USDC movement log was found. ERC-20-only or historical logs are not accepted.';
      return result;
    }
    const movement = matching[0];
    result.actualAmount = formatUnits(movement.units); result.actualSender = movement.sender; result.logIndex = movement.logIndex;
    const key = row.hash + ':' + movement.logIndex;
    if (used.has(key)) { result.status = 'duplicate'; result.detail = 'This same transfer is already assigned to an earlier row in this batch.'; }
    else { used.add(key); result.status = 'matched'; result.detail = 'Included native USDC movement matches the expected transfer details.'; }
    return result;
  });
  let matchedUnits = 0n, feeUnits = 0n;
  for (const result of results) if (result.status === 'matched') matchedUnits += parseAmount(result.actualAmount);
  for (const evidence of evidenceMap.values()) if (evidence.fee) feeUnits += BigInt(evidence.fee);
  return { networkKey, chainId: NETWORKS[networkKey]?.chainId || 5042, source, rpcEndpoint: source === 'live_rpc' ? NETWORKS[networkKey]?.rpc || '' : '', checkedAt: new Date().toISOString(), results, summary: { matched: results.filter(row => row.status === 'matched').length, rows: results.length, matchedUsdc: formatUnits(matchedUnits), transactionFeesUsdc: formatUnits(feeUnits), distinctTransactions: evidenceMap.size } };
}
export async function reconcile(rows, networkKey, { rpc = createRpc(networkKey), onProgress = () => {} } = {}) {
  const chainId = hexInteger(await rpc('eth_chainId'), 'chain ID');
  if (chainId !== BigInt(NETWORKS[networkKey].chainId)) throw new Error('RPC reported a different network. No payments were marked as matched.');
  const hashes = [...new Set(rows.map(row => row.hash))];
  const evidenceMap = new Map();
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(3, hashes.length) }, async () => {
    while (next < hashes.length) {
      const hash = hashes[next++];
      try { evidenceMap.set(hash, await fetchEvidence(hash, rpc)); }
      catch (error) { evidenceMap.set(hash, { error: error.message, fee: '' }); }
      onProgress(++completed, hashes.length);
    }
  }));
  return matchRows(rows, evidenceMap, networkKey);
}
export async function recentExample(networkKey, rpc = createRpc(networkKey)) {
  if (hexInteger(await rpc('eth_chainId'), 'chain ID') !== BigInt(NETWORKS[networkKey].chainId)) throw new Error('RPC reported a different network.');
  const latest = hexInteger(await rpc('eth_blockNumber'), 'latest block');
  const start = latest > 127n ? latest - 127n : 0n;
  const logs = await rpc('eth_getLogs', [{ address: NATIVE_EMITTER, topics: [TRANSFER_TOPIC], fromBlock: '0x' + start.toString(16), toBlock: '0x' + latest.toString(16) }]);
  if (!Array.isArray(logs)) throw new Error('RPC returned an invalid log list.');
  for (const log of logs.slice(-100).reverse()) {
    if (!log.removed && log.topics?.length === 3 && /^0x0{24}[0-9a-f]{40}$/i.test(log.topics[1]) && /^0x0{24}[0-9a-f]{40}$/i.test(log.topics[2]) && /^0x[0-9a-f]{64}$/i.test(log.data)) {
      const sender = '0x' + log.topics[1].slice(-40).toLowerCase(), recipient = '0x' + log.topics[2].slice(-40).toLowerCase();
      if (sender === ZERO_ADDRESS || recipient === ZERO_ADDRESS || BigInt(log.data) === 0n) continue;
      return serializeCsv([['reference', 'transaction_hash', 'recipient', 'amount_usdc', 'sender'], ['Public transfer example', normalizeHash(log.transactionHash), recipient, formatUnits(log.data), sender]]);
    }
  }
  throw new Error('No eligible transfer found in the most recent 128 blocks. Enter a transaction hash from Arc Explorer instead.');
}
export function reportCsv(report) {
  return serializeCsv([
    ['reference', 'network', 'chain_id', 'evidence_source', 'rpc_endpoint', 'transaction_hash', 'expected_recipient', 'expected_sender', 'expected_amount_usdc', 'status', 'actual_amount_usdc', 'actual_sender', 'native_log_index', 'transaction_fee_usdc', 'fee_payer', 'block', 'block_time_utc', 'checked_at_utc', 'details'],
    ...report.results.map(row => [row.reference, NETWORKS[report.networkKey]?.name || 'Arc practice', report.chainId, report.source, report.rpcEndpoint || '', row.hash, row.recipient, row.sender, row.amount, row.status, row.actualAmount, row.actualSender, row.logIndex, row.fee, row.feePayer, row.block, row.time, report.checkedAt, row.detail]),
  ]);
}
