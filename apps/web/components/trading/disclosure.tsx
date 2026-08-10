"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bullet } from "@/components/ui/bullet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import {
  Loader2,
  Unlock,
  Copy,
  Check,
  ShieldCheck,
  ShieldX,
  Eye,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { cn, humanizeError } from "@/lib/core";
import { operator, type Disclosure, type DisclosureVerdict, type Position } from "@/lib/operator";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-[11px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Copy failed — select the text manually.");
        }
      }}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy JSON"}
    </Button>
  );
}

/** Human-readable one-liner: "proves your LONG 6,667 ADA @ 0.157 to <audience>…". */
function humanSummary(d: Disclosure): string {
  const r = d.revealed;
  const base = r.pairId.split("-")[0];
  const size = Number(r.size).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const price = Number(r.price).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return (
    `Proves your ${r.side} ${size} ${base} @ ${price} (${r.leverage}x) to “${d.audience}”, ` +
    `verifiable against on-chain commitment ${d.commitment.slice(0, 10)}… — still hidden from everyone else.`
  );
}

/** The "Disclose" tab: pick an audience, generate the disclosure for a position's order. */
function DiscloseTab({ position }: { position?: Position }) {
  const [audience, setAudience] = useState("auditor");
  const [busy, setBusy] = useState(false);
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!position?.orderId) {
      setError("No order behind this position to disclose.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const d = await operator.disclose(position.orderId, audience.trim() || "auditor");
      setDisclosure(d);
    } catch (e: any) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const json = disclosure ? JSON.stringify(disclosure, null, 2) : "";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Bullet variant="default" />
          selective disclosure
        </div>
        <h2 className="text-2xl font-display leading-none flex items-center gap-2">
          <Unlock className="size-5 text-primary" /> Open to an auditor
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Private by default, provably disclosable. Reveal this position to a chosen party — they can
          verify it against the on-chain commitment, while everyone else still sees only a hash.
        </p>
      </div>

      {position && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "h-5 border-0 text-white text-[10px]",
                position.side === "LONG" ? "bg-green-600" : "bg-red-600",
              )}
            >
              {position.side}
            </Badge>
            <span className="font-mono">
              {position.sizeBase.toFixed(2)} {position.marketId.split("-")[0]}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground">{position.leverage}x</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">order {position.orderId}</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-[11px]">Audience label</Label>
          <Input
            placeholder="auditor"
            className="h-8 text-xs"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            disabled={busy}
          />
        </div>
        <Button onClick={generate} disabled={busy || !position?.orderId} className="gap-1.5 h-8">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Generate
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {disclosure && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {/* human summary */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              <ShieldCheck className="size-3.5 text-primary" /> what this proves
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed">{humanSummary(disclosure)}</p>
          </div>

          {/* copyable JSON blob */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                disclosure (hand to the auditor)
              </span>
              <CopyButton text={json} />
            </div>
            <pre className="max-h-56 overflow-auto rounded-md border border-border/60 bg-background p-2.5 font-mono text-[10px] leading-relaxed text-foreground/90">
              {json}
            </pre>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** The "Verify" tab: paste a disclosure, verify it against its committed hash. */
function VerifyTab({ initial }: { initial?: string }) {
  const [raw, setRaw] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<DisclosureVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setError(null);
    setVerdict(null);
    let parsed: Disclosure;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError("That isn't valid JSON — paste the full disclosure blob.");
      return;
    }
    setBusy(true);
    try {
      const v = await operator.verifyDisclosure(parsed);
      setVerdict(v);
    } catch (e: any) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Bullet variant="default" />
          verify a disclosure
        </div>
        <h2 className="text-2xl font-display leading-none flex items-center gap-2">
          <Eye className="size-5 text-primary" /> Check it against the chain
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Paste a disclosure you were handed. It recomputes the hash and checks it equals the
          committed value — proving exactly what was traded, or rejecting a forgery.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px]">Disclosure JSON</Label>
        <Textarea
          placeholder='{ "kind": "dorr-selective-disclosure/v1", … }'
          className="min-h-32 font-mono text-[10px] leading-relaxed"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          disabled={busy}
        />
        <Button onClick={verify} disabled={busy || !raw.trim()} className="gap-1.5 h-8 w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Verify
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {verdict && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "rounded-lg border p-3 space-y-2",
            verdict.valid ? "border-success/50 bg-success/5" : "border-destructive/50 bg-destructive/5",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 text-sm font-bold uppercase tracking-wide",
              verdict.valid ? "text-success" : "text-destructive",
            )}
          >
            {verdict.valid ? <ShieldCheck className="size-5" /> : <ShieldX className="size-5" />}
            {verdict.valid ? "Verified" : "Rejected"}
          </div>
          <p
            className={cn(
              "text-xs leading-relaxed",
              verdict.valid ? "text-success/90" : "text-destructive/90",
            )}
          >
            {verdict.reason}
          </p>
          <div className="space-y-1 pt-1 font-mono text-[10px] text-muted-foreground break-all">
            <div>
              <span className="uppercase tracking-wide">recomputed</span> {verdict.recomputed || "—"}
            </div>
            <div>
              <span className="uppercase tracking-wide">commitment</span> {verdict.commitment || "—"}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/**
 * Selective-disclosure dialog — "private by default, provably disclosable."
 * Two tabs: Disclose (open a position's order to a chosen audience → copyable
 * disclosure + human summary) and Verify (paste a disclosure → ✓/✗ against the
 * on-chain commitment). Triggered from a position row. Verify needs no wallet.
 */
export function DisclosureDialog({ position }: { position?: Position }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("disclose");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-1.5 text-[10px]"
          title="Disclose this position to an auditor"
        >
          <Unlock className="w-2.5 h-2.5" /> Disclose
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        {/* The panel carries its own visual heading, so name the dialog for
            screen readers without duplicating it on screen. */}
        <DialogHeader className="sr-only">
          <DialogTitle>Selective disclosure</DialogTitle>
          <DialogDescription>
            Open this position to a chosen party, or verify a disclosure you were handed against its commitment.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="disclose" className="gap-1.5">
              <Unlock className="size-3.5" /> Disclose
            </TabsTrigger>
            <TabsTrigger value="verify" className="gap-1.5">
              <ShieldCheck className="size-3.5" /> Verify
            </TabsTrigger>
          </TabsList>
          <TabsContent value="disclose">
            <DiscloseTab position={position} />
          </TabsContent>
          <TabsContent value="verify">
            <VerifyTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
