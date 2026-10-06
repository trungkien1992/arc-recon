import { NETWORKS, parseCsv, reconcile, recentExample, reportCsv, serializeCsv } from './core.mjs';
import { practiceCsv, reconcilePractice } from './practice.mjs';
const $ = id => document.getElementById(id);
let currentReport = null;
let busy = false;
const labels = { matched: 'Matched', duplicate: 'Already assigned', mismatch: 'Does not match', ambiguous: 'Needs review', pending: 'Pending', not_found: 'Not found', failed: 'Transaction failed', unverified: 'Unverified' };
function message(text, tone = '') { $('message').textContent = text; $('message').className = 'message ' + tone; }
function setBusy(value) {
  busy = value;
  for (const id of ['check', 'example', 'practice', 'network', 'payments']) $(id).disabled = value;
  $('example').disabled = value || $('network').value === 'practice';
  $('check').textContent = value ? 'Checking…' : 'Check payments';
  $('export-csv').disabled = value || !currentReport;
  $('export-json').disabled = value || !currentReport;
}
function clearReport() {
  currentReport = null;
  $('results').replaceChildren();
  $('empty').hidden = false;
  $('tablewrap').hidden = true;
  for (const id of ['matched-total', 'matched-count', 'fee-total', 'transaction-count']) $(id).textContent = '—';
  $('results-label').textContent = 'Results appear after checking';
  $('report-meta').textContent = 'Nothing checked yet.';
  setBusy(busy);
}
function updateNetwork() {
  const key = $('network').value;
  const practice = key === 'practice';
  $('practice-notice').hidden = !practice;
  $('network-detail').textContent = practice ? 'No live blockchain evidence' : `Chain ${NETWORKS[key].chainId} · fees in USDC`;
  $('explorer').href = NETWORKS[key]?.explorer || NETWORKS.mainnet.explorer;
  clearReport();
  message(practice ? 'Practice mode uses synthetic receipts. It does not contact Arc RPC.' : 'Your references stay in this browser. Arc RPC receives transaction hashes.');
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function render(report) {
  currentReport = report;
  const practice = report.source === 'synthetic_practice';
  const fragment = document.createDocumentFragment();
  for (const row of report.results) {
    const tr = element('tr');
    tr.append(element('td', '', row.reference), element('td', '', row.amount));
    const state = element('td');
    state.append(element('span', 'status ' + row.status, labels[row.status] || 'Unverified'), element('p', 'detail', row.detail));
    if (row.actualAmount) state.append(element('p', 'detail', `Transfer amount: ${row.actualAmount} USDC`));
    const fee = element('td', '', row.fee ? row.fee + ' USDC' : '—');
    if (row.feePayer) fee.append(element('span', 'evidencenote', `Gas payer: ${row.feePayer.slice(0, 8)}…${row.feePayer.slice(-6)}`));
    const proof = element('td');
    if (practice) proof.append(element('span', 'txlink', 'Synthetic receipt'));
    else {
      const a = element('a', 'txlink', `${row.hash.slice(0, 10)}…${row.hash.slice(-6)}`);
      a.href = NETWORKS[report.networkKey].explorer + '/tx/' + row.hash;
      a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = row.hash;
      proof.append(a);
    }
    if (row.block) proof.append(element('span', 'evidencenote', `Block ${row.block}${row.logIndex ? ' · log ' + row.logIndex : ''}`));
    if (row.actualSender) proof.append(element('span', 'evidencenote', `Sender: ${row.actualSender.slice(0, 8)}…${row.actualSender.slice(-6)}`));
    tr.append(state, fee, proof); fragment.append(tr);
  }
  $('results').replaceChildren(fragment);
  $('empty').hidden = true; $('tablewrap').hidden = false;
  $('matched-total').textContent = report.summary.matchedUsdc;
  $('matched-count').textContent = `${report.summary.matched} / ${report.summary.rows}`;
  $('transaction-count').textContent = report.summary.distinctTransactions;
  $('fee-total').textContent = report.summary.transactionFeesUsdc;
  $('results-label').textContent = practice ? 'Practice results · synthetic data' : `${NETWORKS[report.networkKey].name} · ${report.summary.rows} records checked`;
  $('report-meta').textContent = (practice ? 'Synthetic practice evidence' : 'Arc public RPC evidence') + ' · ' + new Date(report.checkedAt).toLocaleString();
  setBusy(busy);
}
async function checkPayments(csv = $('payments').value, key = $('network').value) {
  if (busy) throw new Error('A batch is already being checked.');
  const rows = parseCsv(csv);
  clearReport(); setBusy(true);
  const onProgress = (count, total) => message(`Fetched ${count} of ${total} distinct transactions…`);
  try {
    const report = key === 'practice' ? await reconcilePractice(rows, onProgress) : await reconcile(rows, key, { onProgress });
    render(report);
    const review = report.summary.rows - report.summary.matched;
    message(`${report.summary.matched} of ${report.summary.rows} records match. ${review ? review + ' need review.' : 'Export the results to keep your record.'}${key === 'practice' ? ' These are synthetic practice results.' : ''}`, review ? '' : 'success');
    return report;
  } catch (error) { message(error.message, 'error'); throw error; }
  finally { setBusy(false); }
}
$('check').addEventListener('click', () => { checkPayments().catch(error => message(error.message, 'error')); });
$('payments').addEventListener('input', clearReport);
$('network').addEventListener('change', updateNetwork);
$('practice').addEventListener('click', () => { $('network').value = 'practice'; updateNetwork(); $('payments').value = practiceCsv(); message('Synthetic batch loaded. Click Check payments to try matching, duplicate detection and failed-payment results.'); });
$('example').addEventListener('click', async () => {
  clearReport(); setBusy(true); message('Looking for a public USDC transfer in the most recent 128 Arc blocks…');
  try { $('payments').value = await recentExample($('network').value); message('A public example is loaded. Click Check payments. This transfer is not evidence of your own activity.'); }
  catch (error) { message(error.message, 'error'); }
  finally { setBusy(false); }
});
$('template').addEventListener('click', () => download('arc-recon-template.csv', 'reference,transaction_hash,recipient,amount_usdc,sender\r\n', 'text/csv;charset=utf-8'));
$('export-csv').addEventListener('click', () => { if (currentReport) download('arc-recon-' + (currentReport.source === 'synthetic_practice' ? 'practice' : currentReport.networkKey) + '.csv', reportCsv(currentReport), 'text/csv;charset=utf-8'); });
$('export-json').addEventListener('click', () => { if (currentReport) download('arc-recon-' + (currentReport.source === 'synthetic_practice' ? 'practice' : currentReport.networkKey) + '.json', JSON.stringify(currentReport, null, 2) + '\n', 'application/json'); });
// Progressive WebMCP support uses the same visible payment-checking flow.
const context = document.modelContext;
if (context?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => {
    try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* An unsupported registry does not affect the visible interface. */ }
  };
  register({ name: 'get_reconciliation_result', title: 'Read reconciliation result', description: 'Read the current visible payment reconciliation result and evidence source.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => currentReport });
  register({ name: 'check_arc_payment_batch', title: 'Check an Arc payment batch', description: 'Check up to 25 CSV payment records and update the visible reconciliation ledger. Queries the selected Arc public RPC. Practice uses synthetic data.', inputSchema: { type: 'object', properties: { csv: { type: 'string', maxLength: 16000 }, network: { type: 'string', enum: ['mainnet', 'testnet', 'practice'] } }, required: ['csv', 'network'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, async execute(input) {
    if (busy) throw new Error('A batch is already being checked.');
    if (!input || Object.keys(input).some(key => !['csv', 'network'].includes(key)) || typeof input.csv !== 'string' || !['mainnet', 'testnet', 'practice'].includes(input.network)) throw new Error('Provide a valid CSV batch and a supported network.');
    parseCsv(input.csv);
    $('network').value = input.network; updateNetwork(); $('payments').value = input.csv;
    const report = await checkPayments(input.csv, input.network);
    return { source: report.source, summary: report.summary, results: report.results.map(({ reference, status, detail }) => ({ reference, status, detail })) };
  } });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
updateNetwork();
