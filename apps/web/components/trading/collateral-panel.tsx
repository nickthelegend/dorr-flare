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
import { cn, formatUsd, humanizeError, truncateHash } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { useAccount, useInvalidateTrading } from "@/hooks/use-operator";
import { operator } from "@/lib/operator";
import { createPublicClient, http, parseUnits, formatUnits, getAddress, type Address } from "viem";
import { coston2 } from "@/hooks/use-evm-wallet";

const FXRP_DECIMALS = 6;

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const VAULT_ABI = [
  { inputs: [{ name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amount", type: "uint256" }], name: "withdraw", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

const readClient = () => createPublicClient({ chain: coston2, transport: http() });

const explorerTx = (h: string) => `https://coston2-explorer.flare.network/tx/${h}`;

export default function CollateralPanel() {
  const { connected, address, wallet, wrongNetwork, switchToCoston2 } = useDorrWallet();
  const { data: account } = useAccount(address);
  const invalidate = useInvalidateTrading();

  /**
   * Deposits and withdrawals are Coston2 transactions. Catching the mismatch
   * here — rather than letting the wallet reject it — means the user gets a
   * sentence telling them what to do instead of a chain-id comparison, and one
   * click to fix it.
   */
  const ensureCoston2 = async (action: string): Promise<boolean> => {
    if (!wrongNetwork) return true;
    try {
      await switchToCoston2();
      return true;
    } catch {
      toast.error(`Wrong network to ${action}.`, {
        description: "Switch your wallet to Flare Coston2 and try again.",
      });
      return false;
    }
  };

  const [depositAmt, setDepositAmt] = useState("100");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [fauceting, setFauceting] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [depositStage, setDepositStage] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const cancelled = useRef(false);

  const handleFaucet = () => {
    // FXRP on Coston2 comes from Flare's own faucet (100 C2FLR + 10 FXRP + 10 USDT0).
    window.open("https://faucet.flare.network/coston2", "_blank");
    toast.info("Flare faucet opened", {
      description: "Request C2FLR for gas and FXRP for margin, then deposit below.",
    });
  };

  /** Real FXRP deposit on Flare: ERC-20 approve, then DorrVault.deposit(). */
  const handleDeposit = async () => {
    if (!address || !wallet) return;
    const n = parseFloat(depositAmt);
    if (!(n > 0)) {
      toast.error("Enter an FXRP amount to deposit.");
      return;
    }
    if (!(await ensureCoston2("deposit"))) return;
    setDepositing(true);
    cancelled.current = false;
    try {
      setDepositStage("reading vault");
      const info = await operator.flareInfo();
      const vault = getAddress(info.contracts.vault) as Address;
      const fxrp = getAddress(info.collateral.address) as Address;
      const amount = parseUnits(String(n), FXRP_DECIMALS);

      const pc = readClient();
      const balance = (await pc.readContract({
        address: fxrp, abi: ERC20_ABI, functionName: "balanceOf", args: [address as Address],
      })) as bigint;
      if (balance < amount) {
        throw new Error(
          `wallet holds ${formatUnits(balance, FXRP_DECIMALS)} FXRP — claim more from the Flare faucet first`,
        );
      }

      const allowance = (await pc.readContract({
        address: fxrp, abi: ERC20_ABI, functionName: "allowance", args: [address as Address, vault],
      })) as bigint;

      if (allowance < amount) {
        setDepositStage("approve FXRP (wallet)");
        const approveHash = await wallet.writeContract({
          address: fxrp, abi: ERC20_ABI, functionName: "approve", args: [vault, amount],
          account: address as Address, chain: coston2,
        });
        setDepositStage("confirming approval");
        await pc.waitForTransactionReceipt({ hash: approveHash });
      }

      setDepositStage("deposit (wallet)");
      const txHash = await wallet.writeContract({
        address: vault, abi: VAULT_ABI, functionName: "deposit", args: [amount],
        account: address as Address, chain: coston2,
      });
      setDepositStage("confirming deposit");
      await pc.waitForTransactionReceipt({ hash: txHash });

      setLastTx(txHash);
      toast.success(`Deposited ${n} FXRP`, { description: truncateHash(txHash) });
      invalidate(address);
    } catch (e: any) {
      const msg = humanizeError(e);
      toast.error("Deposit failed", { description: msg.slice(0, 200) });
    } finally {
      setDepositing(false);
      setDepositStage(null);
    }
  };

  /** Real FXRP withdrawal — signed by the depositor, the only account that can. */
  const handleWithdraw = async () => {
    if (!address || !wallet) return;
    const n = parseFloat(withdrawAmt);
    if (!(n > 0)) {
      toast.error("Enter an FXRP amount to withdraw.");
      return;
    }
    if (!(await ensureCoston2("withdraw"))) return;
    setWithdrawing(true);
    try {
      const info = await operator.flareInfo();
      const vault = getAddress(info.contracts.vault) as Address;
      const amount = parseUnits(String(n), FXRP_DECIMALS);

      const txHash = await wallet.writeContract({
        address: vault, abi: VAULT_ABI, functionName: "withdraw", args: [amount],
        account: address as Address, chain: coston2,
      });
      await readClient().waitForTransactionReceipt({ hash: txHash });

      setLastTx(txHash);
      toast.success(`Withdrew ${n} FXRP`, { description: truncateHash(txHash) });
      setWithdrawAmt("");
      invalidate(address);
    } catch (e: any) {
      const msg = humanizeError(e);
      toast.error("Withdraw failed", { description: msg.slice(0, 200) });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <Card>
      <PanelHeader title="Collateral · FXRP vault" icon={<Vault className="size-3" />} />
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
            Connect a wallet to manage collateral.
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
              Get FXRP
            </Button>

            {/* deposit */}
            <div className="flex gap-1.5">
              <Input
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                inputMode="numeric"
                className="h-8 text-xs font-mono"
                placeholder="FXRP"
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
                placeholder="FXRP"
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
