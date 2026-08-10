"use client";

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bullet } from "@/components/ui/bullet";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Droplets, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Vault } from "lucide-react";
import { cn, formatUsd, truncateHash } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { useAccount, useInvalidateTrading } from "@/hooks/use-operator";
import { operator } from "@/lib/operator";

const explorerTx = (h: string) => `https://preprod.cardanoscan.io/transaction/${h}`;

export default function CollateralPanel() {
  const { connected, address, wallet } = useDorrWallet();
  const { data: account } = useAccount(address);
  const invalidate = useInvalidateTrading();

  const [depositAmt, setDepositAmt] = useState("100");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [fauceting, setFauceting] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [depositStage, setDepositStage] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const cancelled = useRef(false);

  const handleFaucet = async () => {
    if (!address) return;
    setFauceting(true);
    try {
      const res = await operator.faucet(address, 10_000);
      setLastTx(res.txHash);
      toast.success(`Minted ${res.amount.toLocaleString()} dUSD to your wallet`, {
        description: truncateHash(res.txHash),
      });
      invalidate(address);
    } catch (e: any) {
      toast.error("Faucet failed", { description: String(e?.message ?? e) });
    } finally {
      setFauceting(false);
    }
  };

  /** Build + sign + submit a REAL Cardano deposit tx with Mesh, then sync credit. */
  const handleDeposit = async () => {
    if (!address || !wallet) return;
    const n = Math.floor(parseFloat(depositAmt));
    if (!(n > 0)) {
      toast.error("Enter a dUSD amount to deposit.");
      return;
    }
    setDepositing(true);
    cancelled.current = false;
    try {
      setDepositStage("fetching vault info");
      const info = await operator.vaultInfo(address);
      if (!info.depositDatumCbor) throw new Error("operator returned no deposit datum");

      setDepositStage("building transaction");
      const { MeshTxBuilder } = await import("@meshsdk/core");
      const utxos = await wallet.getUtxos();
      if (!utxos.length) throw new Error("wallet has no UTxOs — fund it with preprod tADA first");

      const txb = new MeshTxBuilder({ verbose: false });
      txb
        .txOut(info.vaultAddress, [
          { unit: "lovelace", quantity: "2000000" },
          { unit: info.dusdUnit, quantity: String(n * 1_000_000) },
        ])
        .txOutInlineDatumValue(info.depositDatumCbor, "CBOR")
        .changeAddress(address)
        .selectUtxosFrom(utxos);
      const unsigned = await txb.complete();

      setDepositStage("awaiting wallet signature");
      const signed = await wallet.signTx(unsigned);

      setDepositStage("submitting to cardano");
      const txHash = await wallet.submitTx(signed);
      setLastTx(txHash);
      toast.success("Deposit submitted", { description: truncateHash(txHash) });

      // Poll /deposits/sync until the operator credits the on-chain deposit.
      setDepositStage("waiting for confirmation");
      const deadline = Date.now() + 5 * 60_000;
      let credited = false;
      while (Date.now() < deadline && !cancelled.current) {
        try {
          const sync = await operator.syncDeposits(address);
          if (sync.credited.length > 0) {
            credited = true;
            toast.success(
              `Credited ${sync.credited.reduce((s, c) => s + c.dusd, 0).toLocaleString()} dUSD`,
              { description: `balance ${formatUsd(sync.balance)} dUSD` },
            );
            break;
          }
        } catch {
          /* operator hiccup — keep polling */
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      if (!credited && !cancelled.current) {
        toast.info("Deposit on-chain but not credited yet — it will sync automatically.", {
          description: truncateHash(txHash),
        });
      }
      invalidate(address);
    } catch (e: any) {
      const msg = String(e?.message ?? e?.info ?? e);
      toast.error("Deposit failed", { description: msg.slice(0, 200) });
    } finally {
      setDepositing(false);
      setDepositStage(null);
    }
  };

  const handleWithdraw = async () => {
    if (!address) return;
    const n = parseFloat(withdrawAmt);
    if (!(n > 0)) {
      toast.error("Enter a dUSD amount to withdraw.");
      return;
    }
    if (account && n > account.free) {
      toast.error(`Only ${formatUsd(account.free)} dUSD free.`);
      return;
    }
    setWithdrawing(true);
    try {
      const res = await operator.withdraw(address, n);
      setLastTx(res.txHash);
      toast.success(`Withdrew ${formatUsd(n)} dUSD to your wallet`, {
        description: truncateHash(res.txHash),
      });
      setWithdrawAmt("");
      invalidate(address);
    } catch (e: any) {
      toast.error("Withdraw failed", { description: String(e?.message ?? e) });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <Card>
      <PanelHeader title="Collateral · dUSD vault" icon={<Vault className="size-3" />} />
      <CardContent className="space-y-3">
        {/* balances */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["Balance", account?.balance, "default"],
              ["Free", account?.free, "success"],
              ["Locked", account?.locked, "warning"],
            ] as const
          ).map(([label, v, variant]) => (
            <div
              key={label}
              className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1"
            >
              <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase tracking-wide">
                <Bullet variant={variant} size="sm" />
                {label}
              </div>
              <div
                className={cn(
                  "font-mono text-sm font-semibold tabular-nums",
                  label === "Free" && "text-success",
                  label === "Locked" && "text-warning",
                )}
              >
                {connected && account ? formatUsd(v ?? 0, 0) : "—"}
              </div>
            </div>
          ))}
        </div>

        {!connected ? (
          <p className="text-[11px] text-muted-foreground text-center py-1">
            Connect a Cardano wallet to manage collateral.
          </p>
        ) : (
          <>
            <Separator />
            {/* faucet */}
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleFaucet}
              disabled={fauceting || !address}
            >
              {fauceting ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Droplets className="w-3.5 h-3.5 mr-1.5" />
              )}
              Faucet 10k dUSD
            </Button>

            {/* deposit */}
            <div className="flex gap-1.5">
              <Input
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                inputMode="numeric"
                className="h-8 text-xs font-mono"
                placeholder="dUSD"
                disabled={depositing}
              />
              <Button
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={handleDeposit}
                disabled={depositing || !address}
              >
                {depositing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
                )}
                Deposit
              </Button>
            </div>
            {depositStage && (
              <div className="text-[10px] text-primary flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> {depositStage}…
              </div>
            )}

            {/* withdraw */}
            <div className="flex gap-1.5">
              <Input
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                inputMode="numeric"
                className="h-8 text-xs font-mono"
                placeholder="dUSD"
                disabled={withdrawing}
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-xs shrink-0"
                onClick={handleWithdraw}
                disabled={withdrawing || !address}
              >
                {withdrawing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="w-3.5 h-3.5 mr-1.5" />
                )}
                Withdraw
              </Button>
            </div>

            {lastTx && (
              <a
                href={explorerTx(lastTx)}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-mono text-primary underline inline-flex items-center gap-1"
              >
                last tx {truncateHash(lastTx)} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
