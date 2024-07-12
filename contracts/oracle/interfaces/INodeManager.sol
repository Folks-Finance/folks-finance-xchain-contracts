// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/interfaces/IERC165.sol";

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

interface INodeManager is IERC165 {
    error NodeAlreadyRegistered(bytes32 nodeId);
    error NodeNotRegistered(bytes32 nodeId);
    error InvalidNodeDefinition(NodeDefinition.Data nodeDefinition);
    error UnprocessableNode(bytes32 nodeId);

    event NodeRegistered(bytes32 nodeId, NodeDefinition.NodeType nodeType, bytes parameters, bytes32[] parents);

    function registerNode(
        NodeDefinition.NodeType nodeType,
        bytes memory parameters,
        bytes32[] memory parents
    ) external returns (bytes32 nodeId);

    function isNodeRegistered(bytes32 nodeId) external view returns (bool);

    function process(bytes32 nodeId) external view returns (NodeOutput.Data memory node);

    function getNodeId(
        NodeDefinition.NodeType nodeType,
        bytes memory parameters,
        bytes32[] memory parents
    ) external pure returns (bytes32 nodeId);

    function getNode(bytes32 nodeId) external pure returns (NodeDefinition.Data memory node);
}
