import * as StellarSdk from 'stellar-sdk';

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

const MAX_HOPS = 6;

export function createHorizonServer(): StellarSdk.Horizon.Server {
  return new StellarSdk.Horizon.Server(HORIZON_URL);
}

export interface RouteHop {
  asset: StellarSdk.Asset;
}

export interface AggregatedRoute {
  sourceAsset: StellarSdk.Asset;
  destinationAsset: StellarSdk.Asset;
  path: StellarSdk.Asset[];          // intermediate hops (excludes src/dest)
  sourceAmount: string;
  destinationAmount: string;
  type: 'strict_send' | 'strict_receive';
}

/**
 * Finds the best multi-hop route for a strict-send swap (fixed source amount).
 * Returns all candidate routes sorted by descending destination amount.
 */
export async function findBestStrictSendRoutes(
  sourceAsset: StellarSdk.Asset,
  sourceAmount: string,
  destinationAsset: StellarSdk.Asset,
  server: StellarSdk.Horizon.Server = createHorizonServer()
): Promise<AggregatedRoute[]> {
  const response = await server
    .strictSendPaths(sourceAsset, sourceAmount, [destinationAsset])
    .call();

  const records = response.records ?? [];

  const routes: AggregatedRoute[] = records
    .filter((r) => r.path.length <= MAX_HOPS - 1) // path excludes src/dest
    .map((r) => ({
      sourceAsset,
      destinationAsset,
      path: r.path.map(assetFromRecord),
      sourceAmount: r.source_amount,
      destinationAmount: r.destination_amount,
      type: 'strict_send' as const,
    }))
    .sort((a, b) => parseFloat(b.destinationAmount) - parseFloat(a.destinationAmount));

  return routes;
}

/**
 * Finds the best multi-hop route for a strict-receive swap (fixed destination amount).
 * Returns all candidate routes sorted by ascending source amount (cheapest first).
 */
export async function findBestStrictReceiveRoutes(
  sourceAsset: StellarSdk.Asset,
  destinationAsset: StellarSdk.Asset,
  destinationAmount: string,
  server: StellarSdk.Horizon.Server = createHorizonServer()
): Promise<AggregatedRoute[]> {
  const response = await server
    .strictReceivePaths([sourceAsset], destinationAsset, destinationAmount)
    .call();

  const records = response.records ?? [];

  const routes: AggregatedRoute[] = records
    .filter((r) => r.path.length <= MAX_HOPS - 1)
    .map((r) => ({
      sourceAsset,
      destinationAsset,
      path: r.path.map(assetFromRecord),
      sourceAmount: r.source_amount,
      destinationAmount: r.destination_amount,
      type: 'strict_receive' as const,
    }))
    .sort((a, b) => parseFloat(a.sourceAmount) - parseFloat(b.sourceAmount));

  return routes;
}

/**
 * Returns the single optimal route for the given pair and amount.
 * Uses strict-send semantics (maximise what you receive for a fixed spend).
 * Returns null if no path exists.
 */
export async function getOptimalRoute(
  sourceAsset: StellarSdk.Asset,
  sourceAmount: string,
  destinationAsset: StellarSdk.Asset,
  server: StellarSdk.Horizon.Server = createHorizonServer()
): Promise<AggregatedRoute | null> {
  const routes = await findBestStrictSendRoutes(
    sourceAsset,
    sourceAmount,
    destinationAsset,
    server
  );
  return routes[0] ?? null;
}

/**
 * Fetches the current mid-market price for an asset pair via the DEX order book.
 */
export async function getPrice(
  baseAsset: StellarSdk.Asset,
  counterAsset: StellarSdk.Asset,
  server: StellarSdk.Horizon.Server = createHorizonServer()
): Promise<number | null> {
  const orderbook = await server.orderbook(baseAsset, counterAsset).call();
  const bestAsk = orderbook.asks[0];
  const bestBid = orderbook.bids[0];
  if (!bestAsk || !bestBid) return null;
  return (parseFloat(bestAsk.price) + parseFloat(bestBid.price)) / 2;
}

// ---- helpers ----

function assetFromRecord(r: { asset_type: string; asset_code?: string; asset_issuer?: string }): StellarSdk.Asset {
  if (r.asset_type === 'native') return StellarSdk.Asset.native();
  return new StellarSdk.Asset(r.asset_code!, r.asset_issuer!);
}
