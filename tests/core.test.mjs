import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatUnits, parseCsv, serializeCsv, csvCell, nativeMovements, reconcile, fetchEvidence, reportCsv, NATIVE_EMITTER, ERC20_USDC, TRANSFER_TOPIC } from '../dist/core.mjs';
import { practiceReceipt, practiceRpc, practiceCsv, practiceHash, reconcilePractice } from '../dist/practice.mjs';
const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const one = () => parseCsv(serializeCsv([['reference', 'transaction_hash', 'recipient', 'amount_usdc', 'sender'], ['Invoice 1', practiceHash(1), recipient, '0.5', sender]]));

test('amounts preserve native 18-decimal precision and large values', () => {
  for (const value of ['0.5', '0.000000000000000001', '9007199254740993.123456789012345678']) assert.equal(formatUnits(parseAmount(value)), value);
});
test('invalid, zero and over-precise amounts are rejected', () => {
  for (const value of ['0', '-1', '1e3', '01', '.5', '1.0000000000000000001', 'Infinity']) assert.throws(() => parseAmount(value));
});
test('CSV parses commas, escaped quotes and embedded line breaks in references', () => {
  const reference = 'Client, "A"\nProject';
  const rows = parseCsv(serializeCsv([['reference', 'transaction_hash', 'recipient', 'amount_usdc'], [reference, practiceHash(1), recipient, '0.5']]));
  assert.equal(rows[0].reference, reference);
});
test('CSV rejects bad headers, widths, quoting and empty payment batches', () => {
  for (const csv of ['reference,reference\na,b', 'reference,transaction_hash,recipient,amount_usdc\na,b', 'reference,transaction_hash,recipient,amount_usdc\n"open', 'reference,transaction_hash,recipient,amount_usdc']) assert.throws(() => parseCsv(csv));
});
test('CSV rejects a zero recipient and excessive batches', () => {
  assert.throws(() => parseCsv(serializeCsv([['reference', 'transaction_hash', 'recipient', 'amount_usdc'], ['x', practiceHash(1), '0x' + '0'.repeat(40), '1']])));
  const header = ['reference', 'transaction_hash', 'recipient', 'amount_usdc'];
  assert.throws(() => parseCsv(serializeCsv([header, ...Array.from({ length: 26 }, (_, i) => ['x' + i, practiceHash(i + 1), recipient, '1'])])), /25/);
});
test('an ERC-20 and its native mirror become one movement', () => {
  const receipt = practiceReceipt();
  assert.equal(receipt.logs.length, 2);
  const moves = nativeMovements(receipt);
  assert.equal(moves.length, 1);
  assert.equal(formatUnits(moves[0].units), '0.5');
});
test('a native send without an ERC-20 log is accepted', async () => {
  const report = await reconcile(one(), 'mainnet', { rpc: practiceRpc([practiceReceipt(1, { withErc20: false })]) });
  assert.equal(report.results[0].status, 'matched');
});
test('repeated native evidence at the same log index is coalesced', () => {
  const receipt = practiceReceipt(); receipt.logs.push({ ...receipt.logs[0] });
  assert.equal(nativeMovements(receipt).length, 1);
});
test('conflicting native evidence at the same log index is rejected', () => {
  const receipt = practiceReceipt(); receipt.logs.push({ ...receipt.logs[0], data: '0x' + '0'.repeat(63) + '1' });
  assert.throws(() => nativeMovements(receipt), /Conflicting/);
});
test('duplicate payment rows do not double-count payment or fees', async () => {
  const rows = one(); rows.push({ ...rows[0], reference: 'Duplicate invoice' });
  const report = await reconcile(rows, 'mainnet', { rpc: practiceRpc() });
  assert.deepEqual(report.results.map(row => row.status), ['matched', 'duplicate']);
  assert.equal(report.summary.matchedUsdc, '0.5');
  assert.equal(report.summary.transactionFeesUsdc, '0.000021');
  assert.equal(report.summary.distinctTransactions, 1);
});
test('wrong amount and wrong recipient cannot match', async () => {
  const rows = [{ ...one()[0], amount: '0.6' }, { ...one()[0], recipient: '0x3333333333333333333333333333333333333333' }];
  const report = await reconcile(rows, 'mainnet', { rpc: practiceRpc() });
  assert.deepEqual(report.results.map(row => row.status), ['mismatch', 'mismatch']);
});
test('failed, pending and missing transactions cannot match', async () => {
  const rows = [3, 4, 99].map(i => ({ ...one()[0], hash: practiceHash(i) }));
  const report = await reconcile(rows, 'mainnet', { rpc: practiceRpc() });
  assert.deepEqual(report.results.map(row => row.status), ['pending', 'failed', 'not_found']);
  assert.equal(report.summary.matched, 0);
});
test('multiple identical matching transfers require review', async () => {
  const receipt = practiceReceipt(); receipt.logs.push({ ...receipt.logs[0], logIndex: '0x2' });
  const report = await reconcile(one(), 'mainnet', { rpc: practiceRpc([receipt]) });
  assert.equal(report.results[0].status, 'ambiguous');
  assert.equal(report.summary.matchedUsdc, '0');
});
test('ERC-20-only evidence is unverified rather than guessed', async () => {
  const receipt = practiceReceipt(); receipt.logs = receipt.logs.filter(log => log.address === ERC20_USDC);
  const report = await reconcile(one(), 'mainnet', { rpc: practiceRpc([receipt]) });
  assert.equal(report.results[0].status, 'unverified');
});
test('a mint is excluded from payment matching', async () => {
  const receipt = practiceReceipt(); receipt.logs[0].topics[1] = '0x' + '0'.repeat(64);
  const rows = one().map(row => ({ ...row, sender: '' }));
  const report = await reconcile(rows, 'mainnet', { rpc: practiceRpc([receipt]) });
  assert.equal(report.results[0].status, 'mismatch');
});
test('token sender is taken from the event even when a relayer pays fees', async () => {
  const receipt = practiceReceipt(); receipt.from = '0x3333333333333333333333333333333333333333';
  const report = await reconcile(one(), 'mainnet', { rpc: practiceRpc([receipt]) });
  assert.equal(report.results[0].status, 'matched');
  assert.equal(report.results[0].actualSender, sender);
  assert.equal(report.results[0].feePayer, receipt.from);
});
test('logs from the wrong transaction, removed logs and bad topic padding are rejected', () => {
  for (const mutate of [r => { r.logs[0].transactionHash = practiceHash(99); }, r => { r.logs[0].removed = true; }, r => { r.logs[0].topics[1] = '0x1' + '0'.repeat(63); }]) {
    const receipt = practiceReceipt(); mutate(receipt); assert.throws(() => nativeMovements(receipt));
  }
});
test('a network mismatch prevents all matching', async () => {
  await assert.rejects(reconcile(one(), 'testnet', { rpc: practiceRpc() }), /different network/);
});
test('inconsistent or missing block hashes remain unverified', async () => {
  for (const response of [{ number: '0x64', hash: '0x' + 'c'.repeat(64), timestamp: '0x6a000000' }, { number: '0x64', timestamp: '0x6a000000' }]) {
    const base = practiceRpc(); const rpc = (method, params) => method === 'eth_getBlockByNumber' ? Promise.resolve(response) : base(method, params);
    const report = await reconcile(one(), 'mainnet', { rpc });
    assert.equal(report.results[0].status, 'unverified');
    assert.equal(report.summary.matched, 0);
  }
});
test('RPC failures produce unverified results, never payment success', async () => {
  const rpc = async method => { if (method === 'eth_chainId') return '0x13b2'; throw new Error('RPC unavailable'); };
  const report = await reconcile(one(), 'mainnet', { rpc });
  assert.equal(report.results[0].status, 'unverified');
  assert.match(report.results[0].detail, /unavailable/);
});
test('practice batch stays marked synthetic and fees are summed once per transaction', async () => {
  const report = await reconcilePractice(parseCsv(practiceCsv()));
  assert.equal(report.source, 'synthetic_practice');
  assert.deepEqual(report.results.map(row => row.status), ['matched', 'matched', 'duplicate', 'mismatch', 'pending', 'failed']);
  assert.equal(report.summary.matchedUsdc, '1.2');
  assert.equal(report.summary.transactionFeesUsdc, '0.000063');
  assert.match(reportCsv(report), /synthetic_practice/);
});
test('CSV exports neutralize spreadsheet formula references', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(csvCell('Hello "client"'), '"Hello ""client"""');
});
