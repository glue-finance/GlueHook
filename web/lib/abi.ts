// Generated from out/GlueHook.sol/GlueHook.json — do not edit by hand.
export const glueHookAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_poolManager",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "REQUIRED_HOOK_FLAGS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "addLiquidity",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "addLiquidityAdvanced",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct IGlueHook.ProgramConfig",
        "components": [
          {
            "name": "buybackShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "burnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "compoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potCompoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potBurnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "publicHarvest",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "secondaryRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "mainRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minMain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minSecondary",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "addProgramLiquidity",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "afterSwap",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "delta",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "selector",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "hookDelta",
        "type": "int128",
        "internalType": "int128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeInitialize",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeSwap",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "selector",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "hookDelta",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "lpFeeOverride",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "credited",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeCompound",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "inUnlock",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "used0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "used1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeHarvest",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "mainIsZero",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "burnLeg",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "mainLeg",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "secLeg",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executePump",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "zeroForOne",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "spend",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "bought",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "flushDirect",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "delivered",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "harvest",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "mainFees",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "secondaryFees",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "heldOf",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initPot",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "main",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "launchPool",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "sqrtPriceX96",
        "type": "uint160",
        "internalType": "uint160"
      },
      {
        "name": "main",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct IGlueHook.ProgramConfig",
        "components": [
          {
            "name": "buybackShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "burnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "compoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potCompoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potBurnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "publicHarvest",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "secondaryRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "mainRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minMain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minSecondary",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "obligationOf",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owedOf",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "parkedDirectOf",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "parkedOf",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "potOf",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "pot",
        "type": "tuple",
        "internalType": "struct IGlueHook.Pot",
        "components": [
          {
            "name": "admin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "main",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "secondary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "configured",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "balance",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "programOf",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "program",
        "type": "tuple",
        "internalType": "struct IGlueHook.Program",
        "components": [
          {
            "name": "liquidity",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "publicHarvest",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "buybackShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "burnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "secondaryRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "compoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "mainRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "potCompoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "potBurnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "minMain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minSecondary",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "carryMain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "carrySecondary",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quotePump",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "userAmountIn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "spend",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteShield",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "amountSpecified",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "outputs": [
      {
        "name": "absorbed",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "paid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "removeProgramLiquidity",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct IPoolManagerMin.PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setProgramConfig",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct IGlueHook.ProgramConfig",
        "components": [
          {
            "name": "buybackShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "burnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "compoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potCompoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potBurnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "publicHarvest",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "secondaryRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "mainRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minMain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minSecondary",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setProgramOperator",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "newOperator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRecipient",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferProgramOwnership",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unlockCallback",
    "inputs": [
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Compounded",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0Used",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1Used",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Delivered",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "mode",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum IGlueHook.Delivery"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Donated",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "donor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FlushedDirect",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Harvested",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "mainFees",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "secondaryFees",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "burned",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fueled",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Owed",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paid",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PotInitialized",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "main",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "secondary",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PotOpened",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "admin",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProgramConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "config",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct IGlueHook.ProgramConfig",
        "components": [
          {
            "name": "buybackShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "burnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "compoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potCompoundShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "potBurnShareWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "publicHarvest",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "secondaryRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "mainRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minMain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minSecondary",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProgramCreated",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tickLower",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProgramLiquidityAdded",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0Used",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1Used",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProgramLiquidityRemoved",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProgramOperatorSet",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newOperator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProgramOwnershipTransferred",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Pumped",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "spent",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bought",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RecipientSet",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Shielded",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "absorbed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paid",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadDonation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadRoles",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FailedCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PotAlreadyReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PotNotReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuoteMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Reentrancy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
