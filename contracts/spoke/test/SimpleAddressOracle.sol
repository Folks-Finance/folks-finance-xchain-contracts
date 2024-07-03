// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../interfaces/IAddressOracle.sol";

contract SimpleAddressOracle is IAddressOracle {
    bool private _eligible = true;

    function setEligible(bool newEligible) external {
        _eligible = newEligible;
    }

    function isEligible(address, uint16) external view override returns (bool) {
        return _eligible;
    }
}
