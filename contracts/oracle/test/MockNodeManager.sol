// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/INodeManager.sol";
import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

contract MockNodeManager is INodeManager {
    error CannotProcess();

    NodeOutput.Data private _nodeOutput;
    bool private _throwsErrorOnProcess = false;
    bool private _supportsInterface = true;

    function setSupportsInterface(bool newSupportsInterface) external {
        _supportsInterface = newSupportsInterface;
    }

    function setNodeOutput(NodeOutput.Data memory newNodeOutput) external {
        _nodeOutput = newNodeOutput;
    }

    function setThrowsErrorOnProcess(bool newThrowsErrorOnProcess) external {
        _throwsErrorOnProcess = newThrowsErrorOnProcess;
    }

    function registerNode(
        NodeDefinition.NodeType,
        bytes calldata,
        bytes32[] calldata
    ) external view override returns (bytes32 nodeId) {}

    function isNodeRegistered(bytes32) external pure override returns (bool) {
        return true;
    }

    function process(bytes32) external view override returns (NodeOutput.Data memory node) {
        if (_throwsErrorOnProcess) revert CannotProcess();
        return _nodeOutput;
    }

    function supportsInterface(bytes4) external view override returns (bool) {
        return _supportsInterface;
    }

    function getNodeId(
        NodeDefinition.NodeType,
        bytes calldata,
        bytes32[] calldata
    ) external pure override returns (bytes32 nodeId) {}

    function getNode(bytes32 nodeId) external pure override returns (NodeDefinition.Data memory node) {}
}
