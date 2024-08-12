// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./interfaces/ISpokeManager.sol";

contract SpokeManager is ISpokeManager, AccessControlDefaultAdminRules {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");

    mapping(uint16 chainId => mapping(bytes32 addr => bool isActive)) internal spokes;

    /**
     * @notice Constructor
     * @param admin The default admin for SpokeManager
     */
    constructor(address admin) AccessControlDefaultAdminRules(1 days, admin) {
        _grantRole(MANAGER_ROLE, admin);
    }

    function activateSpoke(uint16 chainId, bytes32 addr) external override onlyRole(MANAGER_ROLE) {
        if (isSpoke(chainId, addr)) revert SpokeAlreadyActive(chainId, addr);

        spokes[chainId][addr] = true;
    }

    function depreciateSpoke(uint16 chainId, bytes32 addr) external override onlyRole(MANAGER_ROLE) {
        if (!isSpoke(chainId, addr)) revert SpokeNotActive(chainId, addr);

        spokes[chainId][addr] = false;
    }

    function isSpoke(uint16 chainId, bytes32 addr) public view override returns (bool) {
        return spokes[chainId][addr];
    }
}
