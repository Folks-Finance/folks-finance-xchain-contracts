// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../bridge/interfaces/IBridgeRouter.sol";
import "./HubPool.sol";

contract HubCircleTokenPool is HubPool {
    address public immutable token;

    /**
     * @notice Contructor
     * @param admin The default admin for HubCircleTokenPool
     */
    constructor(
        address admin,
        address hub,
        address loanManager,
        uint8 tokenDecimals,
        string memory fTokenName,
        string memory fTokenSymbol,
        uint8 poolId,
        PoolData memory pooldata,
        IOracleManager oracleManager,
        address _token
    ) HubPool(admin, hub, loanManager, tokenDecimals, fTokenName, fTokenSymbol, poolId, pooldata, oracleManager) {
        token = _token;
    }

    function addChainSpoke(uint16 chainId, bytes32 spokeAddress) external onlyRole(PARAM_ROLE) {
        _addChainSpoke(chainId, spokeAddress);
    }

    function removeChainSpoke(uint16 chainId) external onlyRole(PARAM_ROLE) {
        _removeChainSpoke(chainId);
    }

    function _sendToken(
        IBridgeRouter bridgeRouter,
        bytes32 recipient,
        Messages.MessageParams memory params,
        uint256 amount
    ) internal override returns (bytes memory extraArgs) {
        // transfer tokens from sender to adapter (to then be bridged)
        address adapterAddress = address(bridgeRouter.getAdapter(params.adapterId));
        SafeERC20.safeTransfer(IERC20(token), adapterAddress, amount);

        // info for circle adapter to bridge token
        extraArgs = Messages.extraArgsToBytes(
            Messages.ExtraArgsV1({
                token: Messages.convertEVMAddressToGenericAddress(token),
                recipient: recipient,
                amount: amount
            })
        );
    }
}
