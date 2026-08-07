// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeOnTransferERC20 — burns a configurable bps fee on every transfer.
/// @notice Models a hostile fee-on-transfer (FoT) token: the recipient of any `transfer` /
///         `transferFrom` receives strictly LESS than the nominal `amount` (the fee is burned).
///         Used to prove the protocol's balance-delta pull + floating-divisor reward accounting
///         never lets a position withdraw more than the clone actually received.
contract MockFeeOnTransferERC20 is ERC20 {
    uint8 private immutable _dec;
    uint256 public immutable feeBps; // fee taken on each transfer, in basis points (e.g. 300 = 3%)

    constructor(string memory n, string memory s, uint8 dec_, uint256 feeBps_) ERC20(n, s) {
        _dec = dec_;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    /// @dev Override the OZ internal transfer hook: move `amount - fee` to `to`, burn `fee`.
    function _update(address from, address to, uint256 amount) internal override {
        // Mints (from == 0) and burns (to == 0) pass through untaxed.
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, amount);
            return;
        }
        uint256 fee = (amount * feeBps) / 10_000;
        if (fee > 0) {
            super._update(from, address(0), fee); // burn the fee
        }
        super._update(from, to, amount - fee);
    }
}
