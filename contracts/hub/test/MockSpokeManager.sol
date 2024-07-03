// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "../interfaces/ISpokeManager.sol";

contract MockSpokeManager is ISpokeManager {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");

    bool private _isKnown = true;

    function setIsKnown(bool newIsKnown) external {
        _isKnown = newIsKnown;
    }

    function activateSpoke(uint16, bytes32) external override {}

    function depreciateSpoke(uint16, bytes32) external override {}

    function isSpoke(uint16, bytes32) external view override returns (bool) {
        return _isKnown;
    }
}
