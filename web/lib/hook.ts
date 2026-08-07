import { encodeAbiParameters, keccak256, zeroAddress, type Address, type Hex } from "viem";

export { glueHookAbi } from "./abi";

// ---------------------------------------------------------------------------
// Types mirroring the on-chain structs
// ---------------------------------------------------------------------------

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type Pot = {
  admin: Address;
  main: Address;
  secondary: Address;
  recipient: Address;
  configured: boolean;
  balance: bigint;
};

export type ProgramConfig = {
  buybackShareWad: bigint;
  burnShareWad: bigint;
  compoundShareWad: bigint;
  potCompoundShareWad: bigint;
  potBurnShareWad: bigint;
  publicHarvest: boolean;
  secondaryRecipient: Address;
  mainRecipient: Address;
  minMain: bigint;
  minSecondary: bigint;
};

export type Program = {
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  exists: boolean;
  publicHarvest: boolean;
  buybackShareWad: bigint;
  owner: Address;
  burnShareWad: bigint;
  secondaryRecipient: Address;
  compoundShareWad: bigint;
  mainRecipient: Address;
  potCompoundShareWad: bigint;
  operator: Address;
  potBurnShareWad: bigint;
  minMain: bigint;
  minSecondary: bigint;
  carryMain: bigint;
  carrySecondary: bigint;
};

export const WAD = 10n ** 18n;
/** afterSwap pump spend safety haircut: the pump uses at most 80% of the pot slice the buy unlocks */
export const PUMP_HAIRCUT_WAD = (WAD * 80n) / 100n;

// ---------------------------------------------------------------------------
// PoolKey <-> poolId
// ---------------------------------------------------------------------------

const POOL_KEY_ABI = [
  {
    type: "tuple" as const,
    components: [
      { type: "address" as const, name: "currency0" },
      { type: "address" as const, name: "currency1" },
      { type: "uint24" as const, name: "fee" },
      { type: "int24" as const, name: "tickSpacing" },
      { type: "address" as const, name: "hooks" },
    ],
  },
];

export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(POOL_KEY_ABI, [
      {
        currency0: key.currency0,
        currency1: key.currency1,
        fee: key.fee,
        tickSpacing: key.tickSpacing,
        hooks: key.hooks,
      },
    ]),
  );
}

export function isNative(addr: Address): boolean {
  return addr.toLowerCase() === zeroAddress;
}

/** full-range ticks for a given spacing (V4 min/max snapped to spacing) */
export function fullRangeTicks(tickSpacing: number): { tickLower: number; tickUpper: number } {
  const MIN = -887272;
  const MAX = 887272;
  const lower = Math.ceil(MIN / tickSpacing) * tickSpacing;
  const upper = Math.floor(MAX / tickSpacing) * tickSpacing;
  return { tickLower: lower, tickUpper: upper };
}

export const FEE_TIERS = [
  { fee: 100, spacing: 1, label: "0.01%" },
  { fee: 500, spacing: 10, label: "0.05%" },
  { fee: 3000, spacing: 60, label: "0.30%" },
  { fee: 10000, spacing: 200, label: "1.00%" },
] as const;

/**
 * Client-side mirror of the on-chain config validation, so forms can flag
 * a bad split before the wallet is even opened.
 */
export function validateConfig(
  cfg: ProgramConfig,
  mainIsNative: boolean,
): string | null {
  if (cfg.buybackShareWad + cfg.compoundShareWad > WAD)
    return "compound + buyback must be ≤ 100% (secondary side)";
  if (cfg.burnShareWad + cfg.compoundShareWad > WAD)
    return "compound + burn must be ≤ 100% (main side)";
  if (mainIsNative && cfg.burnShareWad > 0n)
    return "burn share must be 0 when MAIN is the network token";
  if (cfg.potCompoundShareWad + cfg.potBurnShareWad > WAD)
    return "buyback compound + burn must be ≤ 100% (pot output)";
  if (mainIsNative && cfg.potBurnShareWad > 0n)
    return "buyback burn share must be 0 when MAIN is the network token";
  if (
    cfg.buybackShareWad + cfg.compoundShareWad < WAD &&
    cfg.secondaryRecipient === zeroAddress
  )
    return "secondary recipient required when its residual share is > 0";
  if (
    cfg.burnShareWad + cfg.compoundShareWad < WAD &&
    cfg.mainRecipient === zeroAddress
  )
    return "main recipient required when its residual share is > 0";
  return null;
}

export const EMPTY_CONFIG: ProgramConfig = {
  buybackShareWad: 0n,
  burnShareWad: 0n,
  compoundShareWad: 0n,
  potCompoundShareWad: 0n,
  potBurnShareWad: 0n,
  publicHarvest: false,
  secondaryRecipient: zeroAddress,
  mainRecipient: zeroAddress,
  minMain: 0n,
  minSecondary: 0n,
};
