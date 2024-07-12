// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "../oracle/interfaces/INodeManager.sol";
import "../oracle/storage/NodeOutput.sol";
import "./interfaces/IOracleManager.sol";
import "./libraries/DataTypes.sol";

contract OracleManager is AccessControlDefaultAdminRules, IOracleManager {
    event NodeIdSetForPool(bytes32 nodeId, uint8 poolId);
    event NodeManagerSet(address nodeManager);

    error InvalidNodeManager(address nodeManager);
    error NoNodeIdForPool(uint8 poolId);

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER");

    mapping(uint8 poolId => DataTypes.OracleNode node) public poolIdToNode;
    INodeManager internal _nodeManager;

    constructor(address admin, address nodeManager) AccessControlDefaultAdminRules(1 days, admin) {
        _setNodeManager(nodeManager);
        _grantRole(MANAGER_ROLE, admin);
    }

    function setNodeManager(address nodeManager) external onlyRole(MANAGER_ROLE) {
        _setNodeManager(nodeManager);
        emit NodeManagerSet(nodeManager);
    }

    function setNodeId(uint8 poolId, bytes32 nodeId, uint8 decimals) external onlyRole(MANAGER_ROLE) {
        // check does not revert
        _nodeManager.process(nodeId);
        poolIdToNode[poolId] = DataTypes.OracleNode({ nodeId: nodeId, decimals: decimals });
        emit NodeIdSetForPool(nodeId, poolId);
    }

    function processPriceFeed(uint8 poolId) external view override returns (DataTypes.PriceFeed memory priceFeed) {
        return _processPriceFeed(poolId);
    }

    function getNodeManager() external view returns (address) {
        return address(_nodeManager);
    }

    function _setNodeManager(address nodeManager) internal {
        if (!INodeManager(nodeManager).supportsInterface(type(INodeManager).interfaceId))
            revert InvalidNodeManager(nodeManager);
        _nodeManager = INodeManager(nodeManager);
    }

    function _processPriceFeed(uint8 poolId) internal view returns (DataTypes.PriceFeed memory priceFeed) {
        DataTypes.OracleNode memory node = poolIdToNode[poolId];
        if (node.nodeId == bytes32(0)) revert NoNodeIdForPool(poolId);
        priceFeed.price = _nodeManager.process(node.nodeId).price;
        priceFeed.decimals = node.decimals;
    }
}
