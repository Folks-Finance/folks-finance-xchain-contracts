// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../HubPoolState.sol";
import "../interfaces/IOracleManager.sol";

contract HubPoolStateExposed is HubPoolState {
    constructor(
        address admin,
        uint8 poolId,
        PoolData memory poolData,
        IOracleManager oracleManager
    ) HubPoolState(admin, poolId, poolData, oracleManager) {}

    function addChainSpoke(uint16 chainId, bytes32 spokeAddress) external {
        _addChainSpoke(chainId, spokeAddress);
    }

    function removeChainSpoke(uint16 chainId) external {
        _removeChainSpoke(chainId);
    }
}
