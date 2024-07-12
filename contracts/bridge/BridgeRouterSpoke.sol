// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "./BridgeRouter.sol";
import "./libraries/Messages.sol";

contract BridgeRouterSpoke is BridgeRouter {
    constructor(address admin) BridgeRouter(admin) {}

    function withdraw() external {
        bytes32 userId = Messages.convertEVMAddressToGenericAddress(msg.sender);
        uint256 amount = balances[userId];
        balances[userId] = 0;

        // send balance to user
        (bool sent, ) = msg.sender.call{ value: amount }("");
        if (!sent) revert FailedToWithdrawFunds(msg.sender, amount);

        emit Withdraw(userId, msg.sender, amount);
    }

    function _getUserId(Messages.MessagePayload memory payload) internal pure override returns (bytes32) {
        return payload.userAddress;
    }
}
