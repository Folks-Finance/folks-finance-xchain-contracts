// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../oracle/storage/NodeOutput.sol";
import "../libraries/DataTypes.sol";

interface IOracleManager {
    function processPriceFeed(uint8 poolId) external view returns (DataTypes.PriceFeed memory);
}
