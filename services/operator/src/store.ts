/**
 * Durable off-chain storage.
 *
 * The ledger used to be a JSON file. That is fine on a box with a disk and wrong
 * on Heroku, where the filesystem is ephemeral: a dyno restart — which happens at
 * least daily, unprompted — took the activity log, the public feed and every
 * reconstructed candle with it. Measured, not assumed: 2 events and 408 candles
 * went to 0 and 1 across one restart.
 *
 * What was never at risk is the money. Balances, locked margin and settled
 * batches live on Flare and came back untouched. This module is for the
 * presentation layer around them — which is exactly why it is allowed to be
 * eventually consistent, and why a failed write must never take a request down.
 *
 * Writes are debounced and fire-and-forget so `persist()` keeps its synchronous
 * signature and no trading path waits on the network. Reads happen once, at boot.
 */

/** One document holds the whole ledger — it is a few hundred KB, far under the 16MB cap. */
const DOC_ID = "dorr-operator-state";
const DB_NAME = process.env.MONGODB_DB || "dorr";
const COLLECTION = "state";

/** How long to coalesce writes. `persist()` is called after every mutation. */
const FLUSH_MS = 1500;

// Typed loosely on purpose: the driver is imported dynamically below, so this
// module must not pull `mongodb` into the module graph at load time. Doing so
// broke every test that imports the ledger — the v7 driver's BSON init is not
// compatible with the test runner's snapshot, and a storage backend nobody has
// configured has no business being loaded to find that out.
type StateDoc = Record<string, unknown>;
let collection: {
  findOne(f: StateDoc): Promise<StateDoc | null>;
  updateOne(f: StateDoc, u: StateDoc, o: StateDoc): Promise<unknown>;
} | null = null;
let pending: unknown = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastError: string | null = null;
let writes = 0;

export const mongoConfigured = (): boolean => Boolean(process.env.MONGODB_URI);

/**
 * Connect and return the stored ledger, or null when there is nothing saved yet.
 *
 * Throws if a URI is configured but unreachable: silently continuing would start
 * an operator that looks healthy and quietly loses everything on the next
 * restart, which is the failure this module exists to remove.
 */
export async function connectStore(): Promise<Record<string, unknown> | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  collection = client.db(DB_NAME).collection(COLLECTION) as unknown as typeof collection;

  const doc = await collection!.findOne({ _id: DOC_ID });
  if (!doc) return null;
  const { _id, updatedAt, ...state } = doc;
  void _id;
  void updatedAt;
  return state;
}

/** Queue the ledger for writing. Safe to call on every mutation. */
export function saveStore(state: unknown): void {
  if (!collection) return;
  pending = state;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const snapshot = pending;
    pending = null;
    void flush(snapshot);
  }, FLUSH_MS);
}

async function flush(snapshot: unknown): Promise<void> {
  if (!collection || snapshot == null) return;
  try {
    await collection.updateOne(
      { _id: DOC_ID },
      { $set: { ...(snapshot as Record<string, unknown>), updatedAt: new Date() } },
      { upsert: true },
    );
    writes++;
    lastError = null;
  } catch (e) {
    // Reported through /health rather than thrown: losing a write costs the
    // activity log a few seconds, and taking a trading request down over it
    // would be a worse trade than the one being protected against.
    lastError = String(e).slice(0, 160);
    console.error(`[store] write failed: ${lastError}`);
  }
}

/** Write immediately — used on shutdown so the last mutations are not lost. */
export async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const snapshot = pending;
  pending = null;
  await flush(snapshot);
}

export const storeStatus = () => ({
  durable: Boolean(collection),
  backend: collection ? "mongodb" : mongoConfigured() ? "mongodb (not connected)" : "file (ephemeral)",
  writes,
  lastError,
});
