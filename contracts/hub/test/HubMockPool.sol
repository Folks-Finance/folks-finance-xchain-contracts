// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../HubPool.sol";

contract HubMockPool is HubPool {
    event SendToken(IBridgeRouter bridgeRouter, bytes32 recipient, Messages.MessageParams params, uint256 amount);

    bytes private _extraArgs;

    constructor(
        address admin,
        address hub,
        address loanManager,
        uint8 tokenDecimals,
        string memory fTokenName,
        string memory fTokenSymbol,
        uint8 poolId,
        PoolData memory pooldata,
        IOracleManager oracleManager
    ) HubPool(admin, hub, loanManager, tokenDecimals, fTokenName, fTokenSymbol, poolId, pooldata, oracleManager) {}

    function setPoolData(PoolData memory newPoolData) external {
        _poolData = newPoolData;
    }

    function setExtraArgs(bytes memory newExtraArgs) external {
        _extraArgs = newExtraArgs;
    }

    function addChainSpoke(uint16 chainId, bytes32 spokeAddress) external {
        _addChainSpoke(chainId, spokeAddress);
    }

    function removeChainSpoke(uint16 chainId) external {
        _removeChainSpoke(chainId);
    }

    // flashFee already defined in ERC20FlashMint

    function flashFeeReceiver() external view returns (address) {
        return _flashFeeReceiver();
    }

    function _sendToken(
        IBridgeRouter bridgeRouter,
        bytes32 recipient,
        Messages.MessageParams memory params,
        uint256 amount
    ) internal override returns (bytes memory extraArgs) {
        emit SendToken(bridgeRouter, recipient, params, amount);
        extraArgs = _extraArgs;
    }
}
