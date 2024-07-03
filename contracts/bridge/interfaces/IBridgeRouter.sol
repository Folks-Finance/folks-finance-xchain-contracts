// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "./IBridgeAdapter.sol";
import "../libraries/Messages.sol";

interface IBridgeRouter {
    function MANAGER_ROLE() external view returns (bytes32);
    function MESSAGE_SENDER_ROLE() external view returns (bytes32);

    function getAdapter(uint16 adapterId) external view returns (IBridgeAdapter);

    function getSendFee(Messages.MessageToSend memory message) external view returns (uint256);

    function sendMessage(Messages.MessageToSend memory message) external payable;

    function receiveMessage(Messages.MessageReceived memory message) external payable;
}
