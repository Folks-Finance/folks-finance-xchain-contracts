// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../bridge/interfaces/IBridgeRouter.sol";
import "../bridge/libraries/Messages.sol";
import "./interfaces/IAddressOracle.sol";
import "./SpokeToken.sol";

contract SpokeGasToken is SpokeToken {
    error FailedToSendToken(address recipient, uint256 amount);

    constructor(
        address admin,
        IBridgeRouter bridgeRouter,
        uint16 hubChainId,
        bytes32 hubContractAddress,
        IAddressOracle addressOracle,
        BucketConfig memory bucketConfig,
        uint8 poolId
    ) SpokeToken(admin, bridgeRouter, hubChainId, hubContractAddress, addressOracle, bucketConfig, poolId) {}

    function _receiveToken(
        Messages.MessageParams memory,
        uint256 amount
    ) internal override returns (bytes memory extraArgs, uint256 feeAmount) {
        // gas token already has been received from sender to this spoke

        // not bridging token
        extraArgs = "";

        // value passed excluding the received amount is available to be used
        feeAmount = msg.value - amount;
    }

    function _sendToken(address recipient, uint256 amount) internal override {
        (bool sent, ) = recipient.call{ value: amount }("");
        if (!sent) revert FailedToSendToken(recipient, amount);
    }

    function _minLimit() internal view override returns (uint256) {
        return address(this).balance / 100;
    }
}
