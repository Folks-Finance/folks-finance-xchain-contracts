//SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import "./NodeDefinition.sol";

library NodeOutput {
    struct Data {
        //@dev Price returned from the oracle node, expressed with 18 decimals of precision
        uint256 price;
        //@dev Timestamp associated with the price
        uint256 timestamp;
        //@dev Type of the base node that returned the price e.g. Chainlink, Pyth, Constant
        NodeDefinition.NodeType nodeType;
        // @dev additional parameter can be used to handle extra data
        uint256 additionalParam1;
        // @dev additional parameter can be used to handle extra data
        uint256 additionalParam2;
    }
}
