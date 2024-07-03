// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../BridgeMessenger.sol";
import "../interfaces/IBridgeAdapter.sol";
import "../interfaces/IBridgeRouter.sol";
import "../libraries/Messages.sol";

contract BridgeRouterSender is IBridgeRouter {
    event MessageReceived(Messages.MessageReceived message);

    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");
    bytes32 public constant override MESSAGE_SENDER_ROLE = keccak256("MESSAGE_SENDER");

    IBridgeAdapter private adapter;

    function setAdapter(IBridgeAdapter _adapter) external {
        adapter = _adapter;
    }

    function getAdapter(uint16) external view returns (IBridgeAdapter) {
        return adapter;
    }

    function getSendFee(Messages.MessageToSend memory message) external view override returns (uint256) {
        return adapter.getSendFee(message);
    }

    function sendMessage(Messages.MessageToSend memory message) external payable {
        adapter.sendMessage{ value: msg.value }(message);
    }

    function receiveMessage(Messages.MessageReceived memory message) external payable {
        emit MessageReceived(message);
    }
}
