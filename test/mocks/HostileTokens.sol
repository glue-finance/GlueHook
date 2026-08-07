// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title BurnableERC20 — a token whose `burn(uint256)` really destroys supply.
/// @dev   Exercises leg 2 of the delivery cascade (NATIVE BURN): the hook calls `burn(amount)` and
///        verifies the balance actually fell before it claims the leg succeeded.
contract BurnableERC20 is ERC20 {
    constructor() ERC20("Burnable", "BRN") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function burn(uint256 amt) external {
        _burn(msg.sender, amt);
    }
}

/// @title FakeBurnERC20 — a token whose `burn(uint256)` returns success but destroys NOTHING.
/// @dev   The trap the cascade's balance-drop verification exists for: a `call` that succeeds is not
///        a burn that happened. The hook must fall through to the dead route.
contract FakeBurnERC20 is ERC20 {
    constructor() ERC20("FakeBurn", "FKB") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    /// @dev Swallows the call without touching supply.
    function burn(uint256) external {}
}

/// @title BlockingERC20 — a token that reverts any transfer to addresses on its blocklist.
/// @dev   Models compliance-list tokens that freeze `0xdead` or arbitrary recipients. Blocking the
///        dead address (and having no `burn`) forces leg 4 (PARK); blocking a live recipient forces
///        the direct-delivery park.
contract BlockingERC20 is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blocking", "BLK") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function setBlocked(address who, bool isBlocked) external {
        blocked[who] = isBlocked;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[to], "blocked");
        super._update(from, to, amount);
    }
}

interface IDonatable {
    struct PoolKeyMirror {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }
}

/// @title ReentrantDonorERC20 — a secondary that re-enters `donate` from inside `transferFrom`.
/// @dev   The hook pulls a donation with `transferFrom`, which hands this token the execution thread
///        while the outer `donate` is still inside its `guarded` frame. The re-entered `donate` must
///        bounce off the transient guard; this token records whether it did.
contract ReentrantDonorERC20 is ERC20 {
    address public pump;
    bytes public reenterCalldata;
    bool public reentered;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant", "RNT") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address _pump, bytes calldata _calldata) external {
        pump = _pump;
        reenterCalldata = _calldata;
    }

    function _update(address from, address to, uint256 amount) internal override {
        // Fire exactly once, mid-pull, at the hook
        if (pump != address(0) && to == pump && !reentered) {
            reentered = true;
            (bool ok, ) = pump.call(reenterCalldata);
            reentrySucceeded = ok;
        }
        super._update(from, to, amount);
    }
}
