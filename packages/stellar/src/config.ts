// Stellar package configuration
export const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? 'testnet';
export const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
export const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
