/**
 * Uniswap Universal Router — V4 exact-input single swap, encoded by hand.
 *
 * UR command 0x10 (V4_SWAP) carries a mini-program of v4-periphery Actions:
 *   0x06 SWAP_EXACT_IN_SINGLE (ExactInputSingleParams)
 *   0x0c SETTLE_ALL           (pay the input currency, capped)
 *   0x0f TAKE_ALL             (collect the output currency, floored)
 *
 * An ERC20 input flows through Permit2: approve token→Permit2 ONCE on-chain,
 * then the Permit2→router grant rides the swap itself as a GASLESS EIP-712
 * signature via UR command 0x0a (PERMIT2_PERMIT) — never a second approval
 * transaction. A native input rides as msg.value.
 */

import { encodeAbiParameters, type Address, type Hex } from "viem";
import type { PoolKey } from "./hook";

export const UR_COMMAND_V4_SWAP = "0x10";
export const UR_COMMAND_PERMIT2_PERMIT = "0x0a";

const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;

export const universalRouterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { type: "bytes", name: "commands" },
      { type: "bytes[]", name: "inputs" },
      { type: "uint256", name: "deadline" },
    ],
    outputs: [],
  },
] as const;

export const permit2Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
    ],
    outputs: [
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
      { type: "uint48", name: "nonce" },
    ],
  },
] as const;

/* ------------------------------------------------ Permit2 signature permit */

/** EIP-712 typed-data shape of Permit2's AllowanceTransfer PermitSingle */
export const PERMIT2_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export type PermitSingle = {
  details: { token: Address; amount: bigint; expiration: number; nonce: number };
  spender: Address;
  sigDeadline: bigint;
};

/** the UR input for command 0x0a — abi.encode(PermitSingle, signature) */
export function encodePermit2PermitInput(permit: PermitSingle, signature: Hex): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        name: "permitSingle",
        components: [
          {
            type: "tuple",
            name: "details",
            components: [
              { type: "address", name: "token" },
              { type: "uint160", name: "amount" },
              { type: "uint48", name: "expiration" },
              { type: "uint48", name: "nonce" },
            ],
          },
          { type: "address", name: "spender" },
          { type: "uint256", name: "sigDeadline" },
        ],
      },
      { type: "bytes", name: "signature" },
    ],
    [permit, signature],
  );
}

const POOL_KEY_COMPONENTS = [
  { type: "address", name: "currency0" },
  { type: "address", name: "currency1" },
  { type: "uint24", name: "fee" },
  { type: "int24", name: "tickSpacing" },
  { type: "address", name: "hooks" },
] as const;

/** the (commands, inputs) pair for UR.execute — exact-input single V4 swap */
export function encodeV4ExactInSingle(opts: {
  key: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
}): { commands: Hex; inputs: Hex[] } {
  const { key, zeroForOne, amountIn, minAmountOut } = opts;
  const currencyIn = (zeroForOne ? key.currency0 : key.currency1) as Address;
  const currencyOut = (zeroForOne ? key.currency1 : key.currency0) as Address;

  const actions = `0x${[ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL]
    .map((a) => a.toString(16).padStart(2, "0"))
    .join("")}` as Hex;

  const swapParams = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "tuple", name: "poolKey", components: [...POOL_KEY_COMPONENTS] },
          { type: "bool", name: "zeroForOne" },
          { type: "uint128", name: "amountIn" },
          { type: "uint128", name: "amountOutMinimum" },
          { type: "bytes", name: "hookData" },
        ],
      },
    ],
    [
      {
        poolKey: key,
        zeroForOne,
        amountIn,
        amountOutMinimum: minAmountOut,
        hookData: "0x",
      },
    ],
  );

  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [currencyIn, amountIn],
  );
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [currencyOut, minAmountOut],
  );

  const input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settleParams, takeParams]],
  );

  return { commands: UR_COMMAND_V4_SWAP as Hex, inputs: [input] };
}
