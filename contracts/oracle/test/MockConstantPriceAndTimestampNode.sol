// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/IExternalNode.sol";
import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

contract MockConstantPriceAndTimestampNode is IExternalNode {
    NodeOutput.Data private output;

    constructor(uint256 price, uint256 timestamp) {
        output.price = price;
        output.timestamp = timestamp;
    }

    function process(NodeOutput.Data[] memory, bytes memory) external view returns (NodeOutput.Data memory) {
        return output;
    }

    function isValid(NodeDefinition.Data memory nodeDefinition) external pure returns (bool) {
        return nodeDefinition.nodeType == NodeDefinition.NodeType.EXTERNAL;
    }

    function supportsInterface(bytes4 interfaceId) external pure override(IERC165) returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IExternalNode).interfaceId;
    }
}
