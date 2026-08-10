# Demonstration (Milestone E)

## Stylized replay (no live chain required)

The **frozen snapshot** baked into [demo-terminal.html](demo-terminal.html) matches **`docs/benchmarks.md`** and **`docs/testnet-evidence.md`** (Midnight undeployed blocks **46574–46611**, Cardano Preprod anchors **`preprod-run-01` / `preprod-run-02`**, emulator bench **5 txs**). When you update those docs after a new run, edit the `DEMO` object in `docs/demo-terminal.html` so the replay stays consistent.

### Browser “broadcast” (record your own MP4)

Open **`docs/demo-terminal.html`** in Chrome or Firefox (double-click, or `cd docs && python3 -m http.server 4173` then visit `http://127.0.0.1:4173/demo-terminal.html`).

- Fullscreen the window, click **Replay**, record with **OBS**, **QuickTime**, or **GNOME Shell** screen capture → export **MP4**.
- Use **Faster / Slower** to match your target runtime (~60s–3min).

### Optional: terminal replay / ffmpeg (not shipped)

`scripts/cli-demo-replay.ts`, `scripts/demo-run-data.ts`, and `scripts/build-demo-mp4.ts` are **gitignored** and not part of the published tree. If you keep private copies for a terminal ANSI replay or ASS+ffmpeg renders, run them with `npx tsx …` and align hashes with **`docs/benchmarks.md`** / **`docs/testnet-evidence.md`**. Other generated **`docs/media/*.mp4`** / **`*.ass`** stay ignored; the checked-in demo is **[`zkperps-pipeline-demo.mp4`](media/zkperps-pipeline-demo.mp4)** (~1.3 MB).

### Optional: Charm VHS (GIF)

If [VHS](https://github.com/charmbracelet/vhs) is installed and you maintain a **local** `scripts/cli-demo-replay.ts`, you can record from the terminal (see `docs/vhs-demo.tape`). Otherwise prefer screen-recording **`docs/demo-terminal.html`**.

```bash
vhs docs/vhs-demo.tape
```

Edit `docs/vhs-demo.tape` paths and `Sleep` duration to match your machine. Output path is set to `demo/zkperps-pipeline-replay.gif` (create `demo/` or change `Output`).

---

## Public demo video (upload)

**URL:** _[Upload `docs/media/zkperps-pipeline-demo.mp4` or a screen recording, then paste the full URL here.]_

### Suggested script (timestamps)

1. **00:00** — Problem: transparent mempools / MEV on perps; protocol overview.
2. **00:45** — `docs/demo-terminal.html` replay (five Midnight contracts + benchmarks + Cardano); screen-record to MP4.
3. **03:00** — Repo walk: `contract/src/*.compact`, `midnight-local-cli`, `docs/architecture.md`.
4. **05:00** — Live path (optional): `npm run midnight:run-pipeline`, proof server, funded wallet.
5. **09:00** — Cardano anchor on preprod or emulator; explorer link.
6. **11:00** — `npm test`, `docs/benchmarks.md`.

---

## Local dry run (real chain)

```bash
cp .env.example .env
# set CARDANO_BACKEND=emulator and WALLET_MNEMONIC
npx tsx scripts/cardano-anchor-settlement.ts demo-1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
npm test
npm run bench
```
