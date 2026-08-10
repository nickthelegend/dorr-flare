const $ = (id) => document.getElementById(id);

let currentCommitmentHex = "";

function ts() { return new Date().toISOString().slice(11, 23); }
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function apiBase() { return $("apiBase").value.trim().replace(/\/$/, ""); }

async function apiFetch(path, { method = "GET", body } = {}) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(apiBase() + path, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function setStepStatus(n, status) {
  const el = $(`step-${n}`);
  if (!el) return;
  el.dataset.status = status;
  const icon = $(`icon-${n}`);
  if (icon) {
    if (status === "running") icon.innerHTML = '<span class="spinner"></span>';
    else if (status === "complete") icon.textContent = "✓";
    else if (status === "error") icon.textContent = "✗";
    else icon.textContent = "";
  }
}

function activateStep(n) {
  setStepStatus(n, "active");
  $(`step-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showResult(id) {
  const el = $(id);
  if (el) el.hidden = false;
}

function appendLog(paneId, msg, severity) {
  const pane = $(paneId);
  if (!pane) return;
  const row = document.createElement("div");
  row.className = `log-row ${severity || ""}`;
  row.innerHTML = `<span class="log-time">${ts()}</span> ${escapeHtml(msg)}`;
  pane.appendChild(row);
  pane.scrollTop = pane.scrollHeight;
}

function appendMidnight(msg, sev) { appendLog("logMidnight", msg, sev); }
function appendCardano(msg, sev) { appendLog("logCardano", msg, sev); }
function appendBoth(msg, sev) { appendMidnight(msg, sev); appendCardano(msg, sev); }

// ── Connect / Health ──────────────────────────────────────────────────────

$("btnConnect").addEventListener("click", async () => {
  try {
    const h = await apiFetch("/health");
    $("statusDot").classList.add("ok");
    $("healthPill").textContent = `Connected — ${h.midnightNetwork} / ${h.cardanoNetwork}`;
    $("healthPill").classList.remove("err");
    appendBoth(`OK health: ${h.service} v${h.version}`, "ok");
  } catch (e) {
    $("statusDot").classList.remove("ok");
    $("healthPill").textContent = `Error: ${e.message}`;
    $("healthPill").classList.add("err");
    appendBoth(`ERR health: ${e.message}`, "err");
  }
});

// ── Step 1: Create Order Commitment ───────────────────────────────────────

$("btnCreateOrder").addEventListener("click", async () => {
  setStepStatus(1, "running");
  try {
    const result = await apiFetch("/api/order/create", {
      method: "POST",
      body: {
        pairId: $("inPairId").value,
        side: $("inSide").value,
        price: $("inPrice").value,
        size: $("inSize").value,
        leverage: Number($("inLeverage").value),
        margin: $("inMargin").value,
      },
    });
    currentCommitmentHex = result.commitmentHash;
    $("outOrderId").textContent = result.orderId;
    $("outCommitment").textContent = result.commitmentHash;
    $("outNonce").textContent = result.nonce;
    showResult("result-1");
    setStepStatus(1, "complete");
    activateStep(2);
    appendMidnight(`OK order created id=${result.orderId}`, "ok");
    appendMidnight(`   commitment=${result.commitmentHash}`, "ok");
  } catch (e) {
    setStepStatus(1, "error");
    appendMidnight(`ERR order: ${e.message}`, "err");
  }
});

// ── Step 2: Run Order Pipeline ────────────────────────────────────────────

$("btnRunOrder").addEventListener("click", async () => {
  setStepStatus(2, "running");
  appendMidnight("Running 3-step order pipeline (deploy + prove + bind)...", "warn");
  try {
    const result = await apiFetch("/api/pipeline/run-order", { method: "POST" });
    $("outOrderStatus").textContent = result.status;
    $("outOrderOutput").textContent = (result.output || "").slice(0, 300);
    showResult("result-2");
    if (result.success) {
      setStepStatus(2, "complete");
      activateStep(3);
      appendMidnight(`OK order pipeline complete`, "ok");
    } else {
      setStepStatus(2, "error");
      appendMidnight(`ERR order pipeline: ${result.error || "unknown"}`, "err");
    }
  } catch (e) {
    setStepStatus(2, "error");
    appendMidnight(`ERR order pipeline: ${e.message}`, "err");
  }
});

// ── Step 3: Run Full Pipeline ─────────────────────────────────────────────

$("btnRunPipeline").addEventListener("click", async () => {
  setStepStatus(3, "running");
  appendMidnight("Running full 5-contract ZK pipeline (3-5 min)...", "warn");
  try {
    const result = await apiFetch("/api/pipeline/run-all", { method: "POST" });
    $("outPipelineStatus").textContent = result.status;
    $("outPipelineId").textContent = result.runId;
    $("outPipelineOutput").textContent = (result.output || "").slice(0, 500);
    showResult("result-3");
    if (result.success) {
      setStepStatus(3, "complete");
      activateStep(4);
      appendMidnight(`OK full pipeline complete runId=${result.runId}`, "ok");
    } else {
      setStepStatus(3, "error");
      appendMidnight(`ERR pipeline: ${result.error || "unknown"}`, "err");
    }
  } catch (e) {
    setStepStatus(3, "error");
    appendMidnight(`ERR pipeline: ${e.message}`, "err");
  }
});

// ── Step 4: Cardano Anchor ────────────────────────────────────────────────

$("btnAnchor").addEventListener("click", async () => {
  setStepStatus(4, "running");
  const commitHex = currentCommitmentHex || "0".repeat(64);
  appendCardano(`Submitting L1 anchor settle=${$("inSettlementId").value}...`, "warn");
  try {
    const result = await apiFetch("/api/cardano/anchor", {
      method: "POST",
      body: {
        settlementId: $("inSettlementId").value,
        orderCommitmentHex: commitHex,
      },
    });
    $("outAnchorTx").textContent = result.txHash || "pending";
    $("outAnchorAddr").textContent = result.scriptAddress || "—";
    if (result.explorerUrl) {
      $("outAnchorExplorer").innerHTML = `<a class="tx-link" href="${result.explorerUrl}" target="_blank">View on Cardanoscan ↗</a>`;
    }
    showResult("result-4");
    if (result.success) {
      setStepStatus(4, "complete");
      appendCardano(`OK anchor txHash=${result.txHash}`, "ok");
    } else {
      setStepStatus(4, "error");
      appendCardano(`ERR anchor: ${result.error || "failed"}`, "err");
    }
  } catch (e) {
    setStepStatus(4, "error");
    appendCardano(`ERR anchor: ${e.message}`, "err");
  }
});

// ── Step 5: Security Validation ───────────────────────────────────────────

$("btnSecurity").addEventListener("click", async () => {
  setStepStatus(5, "running");
  appendMidnight("Running 4 front-running attack scenarios...", "warn");
  try {
    const result = await apiFetch("/api/security/test-front-running", { method: "POST" });
    const container = $("securityResults");
    container.innerHTML = "";
    for (const a of result.attacks) {
      const card = document.createElement("div");
      card.className = "attack-card";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <strong>${escapeHtml(a.attack)}</strong>
          <span class="outcome blocked">${a.outcome}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--zk-muted)">${escapeHtml(a.reason)}</div>
      `;
      container.appendChild(card);
    }
    setStepStatus(5, "complete");
    appendMidnight(`OK security: ${result.totalAttacks} attacks, all blocked=${result.allBlocked}`, "ok");
  } catch (e) {
    setStepStatus(5, "error");
    appendMidnight(`ERR security: ${e.message}`, "err");
  }
});

// ── Step 6: Privacy Validation ────────────────────────────────────────────

$("btnPrivacy").addEventListener("click", async () => {
  setStepStatus(6, "running");
  appendMidnight("Running 8 privacy enforcement checks...", "warn");
  try {
    const result = await apiFetch("/api/privacy/test-enforcement", { method: "POST" });
    const container = $("privacyResults");
    container.innerHTML = "";
    for (const ch of result.checks) {
      const card = document.createElement("div");
      card.className = "check-card";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <strong>${escapeHtml(ch.check)}</strong>
          <span class="status ${ch.passed ? 'pass' : 'fail'}">${ch.passed ? 'PASS' : 'FAIL'}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--zk-muted)">${escapeHtml(ch.detail)}</div>
      `;
      container.appendChild(card);
    }
    setStepStatus(6, "complete");
    appendMidnight(`OK privacy: ${result.totalChecks} checks, all passed=${result.allPassed}`, "ok");
  } catch (e) {
    setStepStatus(6, "error");
    appendMidnight(`ERR privacy: ${e.message}`, "err");
  }
});

// ── Evidence ──────────────────────────────────────────────────────────────

$("btnLoadEvidence").addEventListener("click", async () => {
  try {
    const ev = await apiFetch("/api/evidence");
    let html = "<h4>Cardano Preprod</h4>";
    html += `<p style="font-size:0.8rem;margin-bottom:8px">Script: <code>${ev.cardanoPreprod.scriptAddress}</code></p>`;
    html += '<table class="evidence-table"><tr><th>ID</th><th>Tx Hash</th><th>Explorer</th></tr>';
    for (const tx of ev.cardanoPreprod.transactions) {
      html += `<tr><td>${tx.id}</td><td style="font-family:var(--font-mono);font-size:0.75rem">${tx.txHash.slice(0, 16)}...</td><td><a class="tx-link" href="${tx.explorerUrl}" target="_blank">View ↗</a></td></tr>`;
    }
    html += "</table>";

    html += "<h4 style='margin-top:16px'>Midnight ZK Pipeline</h4>";
    html += `<p style="font-size:0.8rem;margin-bottom:8px">Block range: ${ev.midnightUndeployed.blockRange}</p>`;
    html += '<table class="evidence-table"><tr><th>Contract</th><th>Step</th><th>Tx Hash</th><th>Block</th></tr>';
    for (const c of ev.midnightUndeployed.contracts) {
      for (const s of c.steps) {
        html += `<tr><td>${c.name}</td><td>${s.step}</td><td style="font-family:var(--font-mono);font-size:0.72rem">${s.txHash.slice(0, 16)}...</td><td>${s.block}</td></tr>`;
      }
    }
    html += "</table>";

    $("evidenceContent").innerHTML = html;
    appendBoth("OK evidence loaded", "ok");
  } catch (e) {
    $("evidenceContent").innerHTML = `<p style="color:var(--err)">Error: ${escapeHtml(e.message)}</p>`;
  }
});

// ── Benchmarks ────────────────────────────────────────────────────────────

$("btnLoadBench").addEventListener("click", async () => {
  try {
    const b = await apiFetch("/api/benchmarks");
    let html = `<p style="font-size:0.85rem"><strong>Commitment latency:</strong> ~${b.commitmentLatency.avgMicroseconds} µs (target: ${b.commitmentLatency.target}) ${b.commitmentLatency.met ? '✓' : '✗'}</p>`;

    html += '<h4 style="margin-top:12px">Proof Generation Times</h4>';
    html += '<table class="evidence-table"><tr><th>Step</th><th>Time (ms)</th><th>Time (s)</th></tr>';
    for (const s of b.proofGeneration.steps) {
      html += `<tr><td>${s.label}</td><td>${s.ms.toLocaleString()}</td><td>${(s.ms / 1000).toFixed(1)}s</td></tr>`;
    }
    html += `<tr style="font-weight:700"><td>Total</td><td>${b.proofGeneration.totalWallMs.toLocaleString()}</td><td>${(b.proofGeneration.totalWallMs / 1000).toFixed(1)}s</td></tr>`;
    html += "</table>";

    html += '<h4 style="margin-top:12px">ZK IR Sizes</h4>';
    html += '<table class="evidence-table"><tr><th>Contract</th><th>Size</th></tr>';
    for (const [k, v] of Object.entries(b.zkIrSizes)) {
      html += `<tr><td>${k}</td><td>${v}</td></tr>`;
    }
    html += "</table>";

    $("benchContent").innerHTML = html;
    appendBoth("OK benchmarks loaded", "ok");
  } catch (e) {
    $("benchContent").innerHTML = `<p style="color:var(--err)">Error: ${escapeHtml(e.message)}</p>`;
  }
});
