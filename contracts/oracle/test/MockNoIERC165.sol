// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

contract MockNoIERC165 {
    NodeOutput.Data private output;

    constructor(uint256 price, uint256 timestamp) {
        output.price = price;
        output.timestamp = timestamp;
    }

    function process(
        NodeOutput.Data[] memory,
        bytes memory,
        bytes32[] memory runtimeKeys,
        bytes32[] memory runtimeValues
    ) external view returns (NodeOutput.Data memory) {
        NodeOutput.Data memory newOutput = output;

        for (uint256 i = 0; i < runtimeKeys.length; i++) {
            if (runtimeKeys[i] == "overridePrice") {
                newOutput.price = uint256(runtimeValues[i]);
            }

            if (runtimeKeys[i] == "overrideTimestamp") {
                newOutput.timestamp = uint256(runtimeValues[i]);
            }
        }
        return newOutput;
    }

    function isValid(NodeDefinition.Data memory nodeDefinition) external pure returns (bool) {
        return nodeDefinition.nodeType == NodeDefinition.NodeType.EXTERNAL;
    }
}
