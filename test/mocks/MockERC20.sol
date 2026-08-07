// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20 — configurable-decimal ERC20 with arbitrary mint + rebase-down (burn).
/// @dev   Used by the Foundry invariant suite to model normal tokens, low/high decimals,
///        and positive/negative rebases against a Glue staking clone.
contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 dec_) ERC20(n, s) {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    /// @notice Simulate a NEGATIVE rebase by burning `amt` from `account` (e.g. a staking clone).
    function rebaseDown(address account, uint256 amt) external {
        _burn(account, amt);
    }
}
