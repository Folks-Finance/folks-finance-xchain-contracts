// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "./interfaces/IAddressOracle.sol";

contract AlwaysEligibleAddressOracle is IAddressOracle {
    function isEligible(address, uint16) external pure override returns (bool) {
        return true;
    }
}
