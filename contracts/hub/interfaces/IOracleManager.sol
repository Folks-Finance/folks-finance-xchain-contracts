// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../../oracle/storage/NodeOutput.sol";
import "../libraries/DataTypes.sol";

interface IOracleManager {
    function processPriceFeed(uint8 poolId) external view returns (DataTypes.PriceFeed memory);
}
