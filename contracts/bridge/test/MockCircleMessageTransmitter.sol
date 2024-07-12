// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@wormhole-solidity-sdk/interfaces/CCTPInterfaces/IMessageTransmitter.sol";

contract MockCircleMessageTransmitter is IMessageTransmitter {
    event ReceiveMessage(bytes message, bytes signature);

    bool private _success = true;
    address private _token;
    address private _recipient;
    uint256 private _amount;

    function setSuccess(bool newSuccess) external {
        _success = newSuccess;
    }

    function setToken(address newToken) external {
        _token = newToken;
    }

    function setRecipient(address newRecipient) external {
        _recipient = newRecipient;
    }

    function setAmount(uint256 newAmount) external {
        _amount = newAmount;
    }

    function sendMessage(uint32, bytes32, bytes calldata) external pure override returns (uint64) {
        return 0;
    }

    function sendMessageWithCaller(uint32, bytes32, bytes32, bytes calldata) external pure override returns (uint64) {
        return 0;
    }

    function replaceMessage(bytes calldata, bytes calldata, bytes calldata, bytes32) external override {}

    function receiveMessage(bytes calldata message, bytes calldata signature) external override returns (bool success) {
        SafeERC20.safeTransfer(IERC20(_token), _recipient, _amount);
        emit ReceiveMessage(message, signature);
        success = _success;
    }
}
