# Arc Recon

A small, read-only payment reconciliation app for Arc. Paste up to 25 CSV records, check their transactions, and export the results. It does not connect a wallet or request signatures.

## What it does

- Compares expected recipient, USDC amount and optional token sender against successful included transactions.
- Reads Arc's native USDC movement stream at 18 decimals. Native sends are covered, and the ERC-20 mirror is not counted again.
- Flags a repeated transfer used for two records in the same batch.
- Leaves failed, pending, missing, inconsistent and ambiguous evidence unmatched.
- Reports USDC transaction fees once per distinct transaction, including fees on failed transactions.
- Exports CSV and a JSON report with the evidence source.
- Includes a clearly labelled synthetic practice batch. Practice data is not mainnet evidence.

This is a prototype. A matching result compares transfer details; the reference is an off-chain label. There is no global invoice settlement register, tax certification or independent audit. Historical testnet events before the current native-event format are unsupported.

## Run locally

Requires Node.js for checks and Python 3 for the simple local server. The deployed app has no package dependencies or backend. A separate self-contained HTML preview is provided for opening directly; the module-based `dist` folder should be served over HTTP.

```sh
npm test
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080` in a modern browser. ES modules should be served over HTTP; opening `index.html` as a local file is not the supported preview route.

## Neutral Cloudflare Pages deployment

The separate `Arc_Recon_Pages_Upload_2026-10-06.zip` contains only deployable assets, with `index.html` at the root.

1. Open the Cloudflare dashboard's Workers & Pages section.
2. Choose Create application, then the Pages/Get started route for dragging and dropping files.
3. Enter a project name, upload the Pages ZIP, and deploy.
4. Use the actual `pages.dev` URL Cloudflare returns; name availability is not assumed.

For Git-based hosting, use this source repository and set the public output directory to `dist`. No build step is necessary. Cloudflare Direct Upload projects cannot later switch to Git integration; create a new Git-integrated project if needed.

Official deployment guide: <https://developers.cloudflare.com/pages/get-started/direct-upload/>

## CSV format

Required columns are `reference,transaction_hash,recipient,amount_usdc`. The optional `sender` column is the token sender, which can differ from the transaction's gas payer in relayed transactions. Amounts are exact decimal strings with up to 18 decimal places. Do not use scientific notation.

The UI can load a recent public transfer from the selected Arc network. This example is someone else's transaction and should not be represented as the builder's payment or customer activity.

## Validation before a grant submission

The 22 local accounting/parser checks pass. These checks use synthetic receipts. Separately, the app's verification code matched an existing public 18 USDC Arc mainnet transfer in block 24528444. Its reported transaction fee was 0.003111740155742587 USDC. The input and exported reports are included under `evidence/`; the transfer is third-party demonstration data, not the builder's activity or a customer payment.

Before submitting, deploy the app, select Arc mainnet, find a public transfer, and check it. Compare the amount, sender, recipient, block and fee with Arc Explorer; export the live report. Make both the demo and source repository publicly accessible. No new payment is necessary for this read-only workflow.

The primary public RPC returned HTTP 403 in the development workspace. The documented Blockdaemon public mainnet endpoint returned the correct chain ID and successfully supplied the live transaction evidence; the app uses that endpoint. End-to-end deployed-browser testing and supported-browser WebMCP testing have not been completed. See `evidence/validation.json` for the exact validation status.

## Network references

- Mainnet configuration: <https://docs.arc.io/arc/references/connect-to-arc>
- USDC event format: <https://docs.arc.io/arc/references/usdc-system-events>
- Event indexing: <https://docs.arc.io/integrate/infrastructure/indexing-events>
- Fee model: <https://docs.arc.io/arc/references/gas-and-fees>

Arc mainnet is chain 5042; testnet is 5042002. RPC results are a trust and availability dependency. Browser requests send transaction hashes to the selected public RPC. References and expected payment details are held in page memory; there is no analytics service or application database.

## License

MIT. This is an independent community prototype, not an official Circle or Arc product.
