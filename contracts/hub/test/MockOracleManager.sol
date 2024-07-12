// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../../oracle/storage/NodeOutput.sol";
import "../interfaces/IOracleManager.sol";

contract MockOracleManager is IOracleManager {
    mapping(uint8 poolId => NodeOutput.Data) private _nodeOutputs;
    mapping(uint8 poolId => DataTypes.PriceFeed) private _priceFeeds;

    function setNodeOutput(uint8 poolId, uint8 decimals, NodeOutput.Data memory newNodeOutput) external {
        _nodeOutputs[poolId] = newNodeOutput;
        _priceFeeds[poolId] = DataTypes.PriceFeed({ price: newNodeOutput.price, decimals: decimals });
    }

    function processPriceFeed(uint8 poolId) external view returns (DataTypes.PriceFeed memory) {
        return _priceFeeds[poolId];
    }
}
