// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@wormhole-solidity-sdk/interfaces/IWormhole.sol";

contract MockWormhole is IWormhole {
    uint256 private _messageFee;

    function setMessageFee(uint256 newMessageFee) external {
        _messageFee = newMessageFee;
    }

    function messageFee() external view returns (uint256) {
        return _messageFee;
    }

    function publishMessage(uint32, bytes memory, uint8) external payable returns (uint64 sequence) {}

    function initialize() external {}

    function parseAndVerifyVM(bytes calldata) external view returns (VM memory vm, bool valid, string memory reason) {}

    function verifyVM(VM memory) external view returns (bool valid, string memory reason) {}

    function verifySignatures(
        bytes32 hash,
        Signature[] memory,
        GuardianSet memory
    ) external pure returns (bool valid, string memory reason) {}

    function parseVM(bytes memory) external pure returns (VM memory vm) {}

    function quorum(uint256) external pure returns (uint256 numSignaturesRequiredForQuorum) {}

    function getGuardianSet(uint32) external pure returns (GuardianSet memory) {}

    function getCurrentGuardianSetIndex() external pure returns (uint32) {
        return 0;
    }

    function getGuardianSetExpiry() external pure returns (uint32) {
        return 0;
    }

    function governanceActionIsConsumed(bytes32) external pure returns (bool) {
        return false;
    }

    function isInitialized(address) external pure returns (bool) {
        return false;
    }

    function chainId() external pure returns (uint16) {
        return 0;
    }

    function isFork() external pure returns (bool) {
        return false;
    }

    function governanceChainId() external pure returns (uint16) {
        return 0;
    }

    function governanceContract() external pure returns (bytes32) {
        return "";
    }

    function evmChainId() external pure returns (uint256) {
        return 0;
    }

    function nextSequence(address) external pure returns (uint64) {
        return 0;
    }

    function parseContractUpgrade(bytes memory) external pure returns (ContractUpgrade memory) {}

    function parseGuardianSetUpgrade(bytes memory) external pure returns (GuardianSetUpgrade memory gsu) {}

    function parseSetMessageFee(bytes memory) external pure returns (SetMessageFee memory smf) {}

    function parseTransferFees(bytes memory) external pure returns (TransferFees memory tf) {}

    function parseRecoverChainId(bytes memory) external pure returns (RecoverChainId memory rci) {}

    function submitContractUpgrade(bytes memory) external pure {}

    function submitSetMessageFee(bytes memory) external pure {}

    function submitNewGuardianSet(bytes memory) external pure {}

    function submitTransferFees(bytes memory) external pure {}

    function submitRecoverChainId(bytes memory) external pure {}
}
