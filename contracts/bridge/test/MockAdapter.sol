// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../BridgeRouter.sol";
import "../interfaces/IBridgeAdapter.sol";
import "../libraries/Messages.sol";

contract MockAdapter is IBridgeAdapter {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");

    BridgeRouter bridgeRouter;

    constructor(BridgeRouter _bridgeRouter) {
        bridgeRouter = _bridgeRouter;
    }

    function getSendFee(Messages.MessageToSend memory message) external pure override returns (uint256 fee) {
        return message.params.gasLimit;
    }

    function sendMessage(Messages.MessageToSend memory message) external payable override {
        emit SendMessage("", message);
    }

    function receiveMessage(Messages.MessageReceived memory message) public payable {
        bridgeRouter.receiveMessage{ value: msg.value }(message);
        emit ReceiveMessage(message.messageId);
    }

    function isChainAvailable(uint16) public pure override returns (bool) {
        return true;
    }
}
