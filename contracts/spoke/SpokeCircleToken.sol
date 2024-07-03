// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../bridge/interfaces/IBridgeRouter.sol";
import "../bridge/libraries/Messages.sol";
import "./interfaces/IAddressOracle.sol";
import "./SpokeToken.sol";

contract SpokeCircleToken is SpokeToken {
    address public immutable token;
    bytes32 public immutable hubTokenPoolAddress;
    uint256 public immutable minBucketLimit;

    constructor(
        address admin,
        IBridgeRouter bridgeRouter,
        uint16 hubChainId,
        bytes32 hubContractAddress,
        IAddressOracle addressOracle,
        BucketConfig memory bucketConfig,
        uint8 poolId,
        address token_,
        bytes32 hubTokenPoolAddress_,
        uint256 minBucketLimit_
    ) SpokeToken(admin, bridgeRouter, hubChainId, hubContractAddress, addressOracle, bucketConfig, poolId) {
        token = token_;
        hubTokenPoolAddress = hubTokenPoolAddress_;
        minBucketLimit = minBucketLimit_;
    }

    function _receiveToken(
        Messages.MessageParams memory params,
        uint256 amount
    ) internal override returns (bytes memory extraArgs, uint256 feeAmount) {
        // transfer tokens from sender to adapter (to then be bridged)
        address adapterAddress = address(bridgeRouter.getAdapter(params.adapterId));
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, adapterAddress, amount);

        // info for circle adapter to bridge token
        extraArgs = Messages.extraArgsToBytes(
            Messages.ExtraArgsV1({
                token: Messages.convertEVMAddressToGenericAddress(token),
                recipient: hubTokenPoolAddress,
                amount: amount
            })
        );

        // value passed excluding the received amount is available to be used
        feeAmount = msg.value;
    }

    function _sendToken(address recipient, uint256 amount) internal override {
        // token redeemed in adapter and received here, now forwarded to recipient
        SafeERC20.safeTransfer(IERC20(token), recipient, amount);
    }

    function _minLimit() internal view override returns (uint256) {
        return minBucketLimit;
    }
}
