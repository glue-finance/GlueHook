// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {GlueHook} from "../../contracts/GlueHook.sol";
import {IGlueHook} from "../../contracts/interfaces/IGlueHook.sol";
import {GluedV4Core, IPoolManagerMin} from "../../contracts/libs/GluedV4Core.sol";
import {V4PoolHelper} from "./V4PoolHelper.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/**
 * @title  GlueHookFixture — shared deterministic fixture for the GlueHook audit suites.
 * @notice Etches the REAL Uniswap V4 PoolManager (the Sepolia runtime bytecode), deploys the hook at
 *         an address carrying exactly its permission bits, and provides pool builders for the two
 *         shapes every suite trades: an ETH-secondary pool (main = a mock token, secondary = native)
 *         and an ERC20/ERC20 pool with sorted currencies. The TEST CONTRACT initialises each pool, so
 *         it is the pot admin everywhere and the auth tests have a real admin to impersonate around.
 */
abstract contract GlueHookFixture is Test {
    /// @dev The Sepolia PoolManager slot the whole campaign etches.
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    /// @dev An address carrying EXACTLY `beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta`.
    address constant HOOK_ADDR = 0x91110000000000000000000000000000000020c8;
    /// @dev The SENTINEL the hook artifact is statically linked against (see foundry.toml): the
    ///      fixture etches the GlueLiquidity runtime here, mirroring production where the deploy
    ///      script links the real nonce-0 library address instead.
    address constant LIQ_LIB = 0xb0B0000000000000000000000000000000000B0B;
    address constant ETH = address(0);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint24 constant FEE = 3000;
    int24 constant SPACING = 120;
    int24 constant TICK_LO = -887160;
    int24 constant TICK_HI = 887160;
    /// @dev √(1000)·2^96 — 1000 token per ETH at launch.
    uint160 constant LAUNCH_SQRT = 2505413655765166104291548792414;
    /// @dev 1:1 launch price for the ERC20/ERC20 pools.
    uint160 constant PAR_SQRT = 79228162514264337593543950336;

    GlueHook pump;
    V4PoolHelper helper;

    /// @dev Deploy the venue, the linked library and the hook. Suites call this from their own `setUp`.
    function _deployCore() internal {
        vm.etch(POOL_MANAGER, _poolManagerRuntime());
        vm.etch(LIQ_LIB, vm.getDeployedCode("GlueLiquidity.sol:GlueLiquidity"));
        deployCodeTo("GlueHook.sol:GlueHook", abi.encode(POOL_MANAGER), HOOK_ADDR);
        pump = GlueHook(payable(HOOK_ADDR));
        helper = new V4PoolHelper(POOL_MANAGER);
        vm.deal(address(this), 50_000 ether);
        vm.deal(address(helper), 10_000 ether);
    }

    /// @dev ETH-secondary pool around `mainToken`: initialise, declare roles, seed liquidity.
    ///      100 ETH against 100_000 token, hooked.
    function _openEthPool(address mainToken, address recipient)
        internal
        returns (IPoolManagerMin.PoolKey memory key, bytes32 id)
    {
        key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: mainToken, fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        id = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, mainToken, recipient);
        _mintTo(mainToken, address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());
    }

    /// @dev The hookless twin of {_openEthPool}: identical currencies, fee, spacing, price and
    ///      liquidity — the differential yardstick the parity tests price the shield against.
    function _openTwinPool(address mainToken) internal returns (IPoolManagerMin.PoolKey memory key) {
        key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: mainToken, fee: FEE, tickSpacing: SPACING, hooks: address(0)
        });
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        _mintTo(mainToken, address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());
    }

    /// @dev ERC20/ERC20 pool with sorted currencies at par, `main` declared as the defended side.
    ///      `seedLiquidity = false` leaves the pool empty — a fee-on-transfer currency cannot settle
    ///      into the PoolManager, and the funding tests never trade anyway.
    function _openErc20Pool(address main, address secondary, address recipient, bool seedLiquidity)
        internal
        returns (IPoolManagerMin.PoolKey memory key, bytes32 id)
    {
        (address c0, address c1) = main < secondary ? (main, secondary) : (secondary, main);
        key = IPoolManagerMin.PoolKey({
            currency0: c0, currency1: c1, fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        id = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, PAR_SQRT);
        pump.initPot(key, main, recipient);
        if (seedLiquidity) {
            _mintTo(main, address(helper), 20_000_000e18);
            _mintTo(secondary, address(helper), 20_000_000e18);
            // At par over the full range, both leg formulas collapse to ~the token amount
            helper.addLiquidity(key, TICK_LO, TICK_HI, uint128(100_000e18));
        }
    }

    /// @dev Full-range liquidity implied by 100 ETH against 100_000 token at the launch price.
    function _launchLiquidity() internal pure returns (uint128) {
        uint256 l0 = (100e18 * uint256(LAUNCH_SQRT)) / GluedV4Core.Q96;
        uint256 l1 = (100_000e18 * GluedV4Core.Q96) / (LAUNCH_SQRT - GluedV4Core.MIN_SQRT_RATIO);
        return uint128(l0 < l1 ? l0 : l1);
    }

    /// @dev Mint on any of the campaign's mock tokens (they all expose `mint(address,uint256)`).
    function _mintTo(address token, address to, uint256 amount) internal {
        (bool ok, ) = token.call(abi.encodeWithSignature("mint(address,uint256)", to, amount));
        require(ok, "mint failed");
    }

    /// @dev The pool's live sqrt price, straight out of PoolManager storage.
    function _sqrtPrice(bytes32 poolId) internal view returns (uint160 p) {
        bytes32 slot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6))));
        p = uint160(uint256(IPoolManagerMin(POOL_MANAGER).extsload(slot)));
    }

    /// @dev Fund the pot with native secondary.
    function _donateEth(IPoolManagerMin.PoolKey memory key, uint256 amount) internal {
        pump.donate{value: amount}(key, amount);
    }

    // ── recorded-log decoding for the hook's own events ─────────────────────────────

    /// @dev The LAST `Delivered` in a recorded window, or `found = false`.
    function _lastDelivered(Vm.Log[] memory logs)
        internal
        view
        returns (bool found, address to, uint256 amount, IGlueHook.Delivery mode)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Delivered(bytes32,address,uint256,uint8)")) continue;
            found = true;
            to = address(uint160(uint256(logs[i].topics[2])));
            uint256 m;
            (amount, m) = abi.decode(logs[i].data, (uint256, uint256));
            mode = IGlueHook.Delivery(m);
        }
    }

    /// @dev The LAST `Pumped` in a recorded window, or `found = false`.
    function _lastPumped(Vm.Log[] memory logs)
        internal
        view
        returns (bool found, uint256 spent, uint256 bought)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Pumped(bytes32,uint256,uint256)")) continue;
            found = true;
            (spent, bought) = abi.decode(logs[i].data, (uint256, uint256));
        }
    }

    /// @dev The LAST `Shielded` in a recorded window, or `found = false`.
    function _lastShielded(Vm.Log[] memory logs)
        internal
        view
        returns (bool found, uint256 absorbed, uint256 paid)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Shielded(bytes32,uint256,uint256)")) continue;
            found = true;
            (absorbed, paid) = abi.decode(logs[i].data, (uint256, uint256));
        }
    }

    /// @dev The PoolManager's runtime bytecode out of the fixture module (its only quoted string).
    function _poolManagerRuntime() internal view returns (bytes memory) {
        string[] memory parts = vm.split(vm.readFile("test/fixtures/v4PoolManagerBytecode.ts"), "\"");
        require(parts.length >= 2, "pm bytecode fixture");
        return vm.parseBytes(parts[1]);
    }

    /// @notice The fixture itself may receive ETH (pot admin refunds, helper change).
    receive() external payable {}
}
