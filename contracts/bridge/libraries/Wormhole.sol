// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

library Wormhole {
    uint8 internal constant CONSISTENCY_LEVEL_FINALIZED = 15;
    uint8 internal constant CONSISTENCY_LEVEL_INSTANT = 200;

    function getConsistencyLevel(uint64 finalityLevel) internal pure returns (uint8) {
        return finalityLevel == 0 ? CONSISTENCY_LEVEL_INSTANT : CONSISTENCY_LEVEL_FINALIZED;
    }
}
