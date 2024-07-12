// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "./BridgeRouter.sol";
import "./libraries/Messages.sol";

contract BridgeRouterHub is BridgeRouter {
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER");

    constructor(address admin) BridgeRouter(admin) {
        _grantRole(WITHDRAWER_ROLE, admin);
    }

    function withdraw(bytes32 userId, address receiver) external onlyRole(WITHDRAWER_ROLE) {
        uint256 amount = balances[userId];
        balances[userId] = 0;

        // send balance to user
        (bool sent, ) = receiver.call{ value: amount }("");
        if (!sent) revert FailedToWithdrawFunds(receiver, amount);

        emit Withdraw(userId, receiver, amount);
    }

    function _getUserId(Messages.MessagePayload memory payload) internal pure override returns (bytes32) {
        return payload.accountId;
    }
}
