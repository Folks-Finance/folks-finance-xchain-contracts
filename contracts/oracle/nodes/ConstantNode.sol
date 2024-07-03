// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

library ConstantNode {
    /// @notice Returns the node output with the constant price set in the parameters.
    /// @param parameters Params in bytes to decode in order to extract: constant price.
    /// @return nodeOutput The output given by: constant price, current timestamp, node type.
    function process(bytes memory parameters) internal view returns (NodeOutput.Data memory nodeOutput) {
        return
            NodeOutput.Data(abi.decode(parameters, (uint256)), block.timestamp, NodeDefinition.NodeType.CONSTANT, 0, 0);
    }

    /// @notice Checks if a node definition is valid.
    /// @param nodeDefinition The node definition to check.
    /// @return A boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal pure returns (bool) {
        /// @dev Must have no parents && only one parameter to be converted to int256 i.e. the constant price
        return (nodeDefinition.parents.length == 0 && nodeDefinition.parameters.length == 32);
    }
}
