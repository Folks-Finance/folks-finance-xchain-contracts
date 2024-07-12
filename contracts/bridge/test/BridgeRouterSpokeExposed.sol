// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../BridgeRouterSpoke.sol";
import "../libraries/Messages.sol";

contract BridgeRouterSpokeExposed is BridgeRouterSpoke {
    constructor(address admin) BridgeRouterSpoke(admin) {}

    function getUserId(Messages.MessagePayload memory payload) external pure returns (bytes32) {
        return _getUserId(payload);
    }
}
