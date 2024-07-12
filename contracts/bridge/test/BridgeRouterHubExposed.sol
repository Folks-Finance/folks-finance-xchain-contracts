// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../BridgeRouterHub.sol";
import "../libraries/Messages.sol";

contract BridgeRouterHubExposed is BridgeRouterHub {
    constructor(address admin) BridgeRouterHub(admin) {}

    function getUserId(Messages.MessagePayload memory payload) external pure returns (bytes32) {
        return _getUserId(payload);
    }
}
