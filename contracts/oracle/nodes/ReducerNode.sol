// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

library ReducerNode {
    error UnsupportedOperation(Operation operation);

    /// @dev Enum for the different operations that can be performed by the reducer node.
    enum Operation {
        RECENT,
        MIN,
        MAX,
        MEAN,
        MEDIAN,
        /// @dev To count Operation size, must remain at the end
        COUNT
    }

    /// @dev Processes the parent node outputs based on the operation specified in the parameters.
    /// @param parentNodeOutputs The outputs of the parent nodes.
    /// @param parameters The parameters specifying the operation to perform.
    /// @return nodeOutput The output of the reducer node.
    function process(
        NodeOutput.Data[] memory parentNodeOutputs,
        bytes memory parameters
    ) internal pure returns (NodeOutput.Data memory nodeOutput) {
        Operation op = abi.decode(parameters, (Operation));

        if (op == Operation.RECENT) {
            return recent(parentNodeOutputs);
        }
        if (op == Operation.MIN) {
            return min(parentNodeOutputs);
        }
        if (op == Operation.MAX) {
            return max(parentNodeOutputs);
        }
        if (op == Operation.MEAN) {
            return mean(parentNodeOutputs);
        }
        revert UnsupportedOperation(op);
    }

    /// @dev Checks if a node definition is valid for a reducer node.
    /// @param nodeDefinition The node definition to check.
    /// @return A boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal pure returns (bool) {
        uint256 operationId = abi.decode(nodeDefinition.parameters, (uint256));
        return nodeDefinition.parents.length > 1 && operationId < uint256(Operation.COUNT);
    }

    /// @dev Returns the most recent parent node output.
    /// @param parentNodeOutputs The outputs of the parent nodes.
    /// @return recentPrice The most recent parent node output.
    function recent(
        NodeOutput.Data[] memory parentNodeOutputs
    ) internal pure returns (NodeOutput.Data memory recentPrice) {
        for (uint256 i = 0; i < parentNodeOutputs.length; i++) {
            if (parentNodeOutputs[i].timestamp > recentPrice.timestamp) {
                recentPrice = parentNodeOutputs[i];
            }
        }
    }

    /// @dev Returns the parent node output with the minimum price.
    /// @param parentNodeOutputs The outputs of the parent nodes.
    /// @return minPrice The parent node output with the minimum price.
    function min(NodeOutput.Data[] memory parentNodeOutputs) internal pure returns (NodeOutput.Data memory minPrice) {
        minPrice = parentNodeOutputs[0];
        for (uint256 i = 1; i < parentNodeOutputs.length; i++) {
            if (parentNodeOutputs[i].price < minPrice.price) {
                minPrice = parentNodeOutputs[i];
            }
        }
    }

    /// @dev Returns the parent node output with the maximum price.
    /// @param parentNodeOutputs The outputs of the parent nodes.
    /// @return maxPrice The parent node output with the maximum price.
    function max(NodeOutput.Data[] memory parentNodeOutputs) internal pure returns (NodeOutput.Data memory maxPrice) {
        maxPrice = parentNodeOutputs[0];
        for (uint256 i = 1; i < parentNodeOutputs.length; i++) {
            if (parentNodeOutputs[i].price > maxPrice.price) {
                maxPrice = parentNodeOutputs[i];
            }
        }
    }

    /// @dev Returns the mean of the parent node outputs.
    /// @param parentNodeOutputs The outputs of the parent nodes.
    /// @return meanPrice The mean of the parent node outputs.
    function mean(NodeOutput.Data[] memory parentNodeOutputs) internal pure returns (NodeOutput.Data memory meanPrice) {
        for (uint256 i = 0; i < parentNodeOutputs.length; i++) {
            meanPrice.price += parentNodeOutputs[i].price;
            meanPrice.timestamp += parentNodeOutputs[i].timestamp;
        }

        meanPrice.price = meanPrice.price / parentNodeOutputs.length;
        meanPrice.timestamp = meanPrice.timestamp / parentNodeOutputs.length;
    }
}
