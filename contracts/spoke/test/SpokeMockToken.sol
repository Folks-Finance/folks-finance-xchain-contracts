// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../../bridge/interfaces/IBridgeRouter.sol";
import "../../bridge/libraries/Messages.sol";
import "../interfaces/IAddressOracle.sol";
import "../SpokeToken.sol";

contract SpokeMockToken is SpokeToken {
    event ReceiveToken(Messages.MessageParams params, uint256 amount);
    event SendToken(address recipient, uint256 amount);

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
        Messages.MessageParams memory params,
        uint256 amount
    ) internal override returns (bytes memory extraArgs, uint256 feeAmount) {
        extraArgs = "";
        feeAmount = 0;
        emit ReceiveToken(params, amount);
    }

    function _sendToken(address recipient, uint256 amount) internal override {
        emit SendToken(recipient, amount);
    }

    function _minLimit() internal pure override returns (uint256) {
        return 0;
    }
}
