// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../bridge/interfaces/IBridgeRouter.sol";
import "./HubPool.sol";

contract HubNonBridgedTokenPool is HubPool {
    /**
     * @notice Constructor
     * @param admin The default admin for HubNonBridgedTokenPool
     */
    constructor(
        address admin,
        address hub,
        address loanManager,
        uint8 tokenDecimals,
        string memory fTokenName,
        string memory fTokenSymbol,
        uint8 poolId,
        PoolData memory pooldata,
        IOracleManager oracleManager,
        uint16 chainId,
        bytes32 spokeAddress
    ) HubPool(admin, hub, loanManager, tokenDecimals, fTokenName, fTokenSymbol, poolId, pooldata, oracleManager) {
        _addChainSpoke(chainId, spokeAddress);
    }

    function _sendToken(
        IBridgeRouter,
        bytes32,
        Messages.MessageParams memory,
        uint256
    ) internal pure override returns (bytes memory extraArgs) {
        // not bridging token
        extraArgs = "";
    }
}
