// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/INodeManager.sol";
import "../storage/NodeDefinition.sol";
import "../nodes/ConstantNode.sol";
import "../nodes/ReducerNode.sol";
import "../nodes/StalenessCircuitBreakerNode.sol";
import "../nodes/ExternalNode.sol";
import "../nodes/ChainlinkNode.sol";
import "../nodes/PythNode.sol";
import "../nodes/PriceDeviationSameOracleCircuitBreakerNode.sol";

contract NodeManager is INodeManager {
    /// @notice Registers a new node.
    /// @param nodeType The type of the node.
    /// @param parameters The parameters of the node.
    /// @param parents The parent nodes of the node.
    /// @return nodeId The ID of the registered node.
    function registerNode(
        NodeDefinition.NodeType nodeType,
        bytes calldata parameters,
        bytes32[] calldata parents
    ) external override returns (bytes32 nodeId) {
        NodeDefinition.Data memory nodeDefinition = NodeDefinition.Data({
            nodeType: nodeType,
            parameters: parameters,
            parents: parents
        });
        return _registerNode(nodeDefinition);
    }

    /// @notice Checks if a node is registered.
    /// @param nodeId The ID of the node to check.
    /// @return A boolean indicating whether the node is registered.
    function isNodeRegistered(bytes32 nodeId) external view override returns (bool) {
        return _isNodeRegistered(nodeId);
    }

    /// @notice Processes a node so the output with: price, timestamp, node type, additional params.
    /// @param nodeId The ID of the node to process, can be a base node or a composite node.
    /// @return node The output of the processed node.
    function process(bytes32 nodeId) external view override returns (NodeOutput.Data memory node) {
        if (!_isNodeRegistered(nodeId)) revert NodeNotRegistered(nodeId);
        return _process(nodeId);
    }

    /// @notice Checks if the contract supports an interface.
    /// @param interfaceId The ID of the interface to check.
    /// @return A boolean indicating whether the contract supports the interface.
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(INodeManager).interfaceId;
    }

    /// @notice Gets the ID of a node from its node definition: node type, parameters, parents.
    /// @param nodeType The type of the node.
    /// @param parameters The parameters of the node.
    /// @param parents The parent nodes of the node.
    /// @return nodeId The ID of the node.
    function getNodeId(
        NodeDefinition.NodeType nodeType,
        bytes calldata parameters,
        bytes32[] calldata parents
    ) external pure override returns (bytes32 nodeId) {
        NodeDefinition.Data memory nodeDefinition = NodeDefinition.Data({
            parents: parents,
            nodeType: nodeType,
            parameters: parameters
        });

        return NodeDefinition.getId(nodeDefinition);
    }

    /// @notice Gets the node definition from a node ID.
    /// @param nodeId The ID of the node to get.
    /// @return node The node definition.
    function getNode(bytes32 nodeId) external pure override returns (NodeDefinition.Data memory node) {
        return NodeDefinition.load(nodeId);
    }

    /// @notice Registers a new node.
    /// @dev This function is internal and can only be called by this contract.
    /// @param nodeDefinition The definition of the node to register.
    /// @return nodeId The ID of the registered node.
    function _registerNode(NodeDefinition.Data memory nodeDefinition) internal returns (bytes32 nodeId) {
        /// @dev Get the ID of the node definition
        nodeId = NodeDefinition.getId(nodeDefinition);

        /// @dev Check if the node is already registered
        if (_isNodeRegistered(nodeId)) {
            revert NodeAlreadyRegistered(nodeId);
        }

        /// @dev Check if the node definition is valid
        if (!_isValidNodeDefinition(nodeDefinition)) {
            revert InvalidNodeDefinition(nodeDefinition);
        }

        /// @dev Check if each parent node is registered
        for (uint256 i = 0; i < nodeDefinition.parents.length; i++) {
            if (!_isNodeRegistered(nodeDefinition.parents[i])) {
                revert NodeNotRegistered(nodeDefinition.parents[i]);
            }
        }

        /// @dev Create the node saving the node definition in the storage and emit the NodeRegistered event
        (, nodeId) = NodeDefinition.create(nodeDefinition);
        emit NodeRegistered(nodeId, nodeDefinition.nodeType, nodeDefinition.parameters, nodeDefinition.parents);
    }

    /// @notice Processes a node.
    /// @dev This function is internal and can only be called by this contract.
    /// @param nodeId The ID of the node to process.
    /// @return node The output of the processed node.
    function _process(bytes32 nodeId) internal view returns (NodeOutput.Data memory node) {
        /// @dev Load the node definition
        NodeDefinition.Data memory nodeDefinition = NodeDefinition.load(nodeId);

        /// @dev Process the node based on its type
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER) {
            return
                PriceDeviationSameOracleCircuitBreakerNode.process(
                    _processParentsNode(nodeDefinition),
                    nodeDefinition.parameters
                );
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.STALENESS_CIRCUIT_BREAKER) {
            return StalenessCircuitBreakerNode.process(_processParentsNode(nodeDefinition), nodeDefinition.parameters);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.CHAINLINK) {
            return ChainlinkNode.process(nodeDefinition.parameters);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.PYTH) {
            return PythNode.process(nodeDefinition.parameters);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.EXTERNAL) {
            return ExternalNode.process(_processParentsNode(nodeDefinition), nodeDefinition.parameters);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.PRICE_DEVIATION_CIRCUIT_BREAKER) {
            return
                PriceDeviationSameOracleCircuitBreakerNode.process(
                    _processParentsNode(nodeDefinition),
                    nodeDefinition.parameters
                );
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.REDUCER) {
            return ReducerNode.process(_processParentsNode(nodeDefinition), nodeDefinition.parameters);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.CONSTANT) {
            return ConstantNode.process(nodeDefinition.parameters);
        }
        /// @dev If the node type is not recognized, revert
        revert UnprocessableNode(nodeId);
    }

    /// @notice Checks if a node definition is valid.
    /// @dev This function is internal and can only be called by this contract.
    /// @param nodeDefinition The node definition to check.
    /// @return A boolean indicating whether the node definition is valid.
    function _isValidNodeDefinition(NodeDefinition.Data memory nodeDefinition) internal returns (bool) {
        /// @dev Check the node type and call the corresponding isValid function
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER) {
            return PriceDeviationSameOracleCircuitBreakerNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.STALENESS_CIRCUIT_BREAKER) {
            return StalenessCircuitBreakerNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.CHAINLINK) {
            return ChainlinkNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.PYTH) {
            return PythNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.EXTERNAL) {
            return ExternalNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.PRICE_DEVIATION_CIRCUIT_BREAKER) {
            return PriceDeviationSameOracleCircuitBreakerNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.REDUCER) {
            return ReducerNode.isValid(nodeDefinition);
        }
        if (nodeDefinition.nodeType == NodeDefinition.NodeType.CONSTANT) {
            return ConstantNode.isValid(nodeDefinition);
        }
        /// @dev If the node type is not recognized, return false
        return false;
    }

    /// @notice Checks if a node is registered.
    /// @dev This function is internal and can only be called by this contract.
    /// @param nodeId The ID of the node to check.
    /// @return A boolean indicating whether the node is registered.
    function _isNodeRegistered(bytes32 nodeId) internal view returns (bool) {
        /// @dev Load the node definition and check if its type is not NONE
        return NodeDefinition.load(nodeId).nodeType != NodeDefinition.NodeType.NONE;
    }

    /// @notice Processes the parent nodes of a node.
    /// @dev This function is private and can only be called by this contract.
    /// @param nodeDefinition The definition of the node whose parents to process.
    /// @return parentNodeOutputs The outputs of the processed parent nodes.
    function _processParentsNode(
        NodeDefinition.Data memory nodeDefinition
    ) private view returns (NodeOutput.Data[] memory parentNodeOutputs) {
        /// @dev Initialize an array to store the outputs of the parent nodes
        parentNodeOutputs = new NodeOutput.Data[](nodeDefinition.parents.length);

        /// @dev Process each parent node and store its output
        for (uint256 i = 0; i < nodeDefinition.parents.length; i++) {
            parentNodeOutputs[i] = _process(nodeDefinition.parents[i]);
        }
    }
}
