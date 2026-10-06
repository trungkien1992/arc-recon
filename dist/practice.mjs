import { NATIVE_EMITTER, ERC20_USDC, TRANSFER_TOPIC, formatUnits, serializeCsv, matchRows, fetchEvidence } from './core.mjs';
const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const blockHash = '0x' + 'b'.repeat(64);
const topic = address => '0x' + address.slice(2).padStart(64, '0');
export const practiceHash = i => '0x' + i.toString(16).padStart(64, '0');
export function practiceReceipt(i = 1, { amount = 500000000000000000n, withErc20 = true, failed = false } = {}) {
  const hash = practiceHash(i);
  const baseLog = { transactionHash: hash, blockHash, blockNumber: '0x64', removed: false };
  const logs = [{ ...baseLog, address: NATIVE_EMITTER, topics: [TRANSFER_TOPIC, topic(sender), topic(recipient)], data: '0x' + amount.toString(16).padStart(64, '0'), logIndex: '0x0' }];
  if (withErc20) logs.push({ ...baseLog, address: ERC20_USDC, topics: [TRANSFER_TOPIC, topic(sender), topic(recipient)], data: '0x' + (amount / 10n ** 12n).toString(16).padStart(64, '0'), logIndex: '0x1' });
  return { transactionHash: hash, blockHash, blockNumber: '0x64', from: sender, status: failed ? '0x0' : '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', logs: failed ? [] : logs };
}
export function practiceRpc(receipts = [practiceReceipt(1), practiceReceipt(2, { amount: 700000000000000000n, withErc20: false }), practiceReceipt(4, { failed: true })]) {
  const map = new Map(receipts.map(receipt => [receipt.transactionHash, receipt]));
  return async (method, params = []) => {
    if (method === 'eth_chainId') return '0x13b2';
    if (method === 'eth_getTransactionReceipt') return map.get(params[0]) || null;
    if (method === 'eth_getTransactionByHash') {
      if (params[0] === practiceHash(3)) return { hash: params[0], from: sender, blockHash: null, blockNumber: null };
      const receipt = map.get(params[0]);
      return receipt ? { hash: receipt.transactionHash, from: receipt.from, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber } : null;
    }
    if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: blockHash, timestamp: '0x6a000000' };
    throw new Error('Practice RPC method is not supported.');
  };
}
export function practiceCsv() {
  return serializeCsv([
    ['reference', 'transaction_hash', 'recipient', 'amount_usdc'],
    ['Example payment', practiceHash(1), recipient, '0.5'],
    ['Native USDC send', practiceHash(2), recipient, '0.7'],
    ['Repeated payment claim', practiceHash(1), recipient, '0.5'],
    ['Amount mismatch', practiceHash(2), recipient, '0.8'],
    ['Pending transaction', practiceHash(3), recipient, '1'],
    ['Failed transaction', practiceHash(4), recipient, '1'],
  ]);
}
export async function reconcilePractice(rows, onProgress = () => {}) {
  const rpc = practiceRpc();
  const map = new Map();
  const hashes = [...new Set(rows.map(row => row.hash))];
  for (const [i, hash] of hashes.entries()) { map.set(hash, await fetchEvidence(hash, rpc)); onProgress(i + 1, hashes.length); }
  return matchRows(rows, map, 'mainnet', 'synthetic_practice');
}
