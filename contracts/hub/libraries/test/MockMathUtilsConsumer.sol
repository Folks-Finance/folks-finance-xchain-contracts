// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../MathUtils.sol";

contract MockMathUtilsConsumer {
    using MathUtils for uint256;

    function calcVariableBorrowInterestRate(
        uint32 vr0,
        uint32 vr1,
        uint32 vr2,
        uint256 utilisationRatioAtT,
        uint16 optimalUtilisationRatio
    ) external pure returns (uint256) {
        return MathUtils.calcVariableBorrowInterestRate(vr0, vr1, vr2, utilisationRatioAtT, optimalUtilisationRatio);
    }

    function calcStableBorrowInterestRate(
        uint32 vr1,
        uint32 sr0,
        uint32 sr1,
        uint32 sr2,
        uint32 sr3,
        uint256 utilisationRatioAtT,
        uint16 optimalUtilisationRatio,
        uint256 stableDebtToTotalDebtRatioAtT,
        uint16 optimalStableDebtToTotalDebtRatio
    ) external pure returns (uint256) {
        return
            MathUtils.calcStableBorrowInterestRate(
                vr1,
                sr0,
                sr1,
                sr2,
                sr3,
                utilisationRatioAtT,
                optimalUtilisationRatio,
                stableDebtToTotalDebtRatioAtT,
                optimalStableDebtToTotalDebtRatio
            );
    }

    function calcOverallBorrowInterestRate(
        uint256 totalVarDebt,
        uint256 totalStblDebt,
        uint256 variableBorrowInterestRateAtT,
        uint256 avgStableBorrowInterestRateAtT
    ) external pure returns (uint256) {
        return
            MathUtils.calcOverallBorrowInterestRate(
                totalVarDebt,
                totalStblDebt,
                variableBorrowInterestRateAtT,
                avgStableBorrowInterestRateAtT
            );
    }

    function calcDepositInterestRate(
        uint256 utilisationRatioAtT,
        uint256 overallBorrowInterestRateAtT,
        uint32 retentionRate
    ) external pure returns (uint256) {
        return MathUtils.calcDepositInterestRate(utilisationRatioAtT, overallBorrowInterestRateAtT, retentionRate);
    }

    function calcCompoundInterestWithExpBySquaring(
        uint256 rate,
        uint256 timeDelta,
        uint256 scale
    ) external pure returns (uint256) {
        return MathUtils.exponentialBySquaring(rate, timeDelta, scale);
    }

    function calcBorrowInterestIndex(
        uint256 borrowInterestRate,
        uint256 borrowInterestIndex,
        uint256 timeDelta
    ) external pure returns (uint256) {
        return MathUtils.calcBorrowInterestIndex(borrowInterestRate, borrowInterestIndex, timeDelta);
    }

    function calcDepositInterestIndex(
        uint256 depositInterestRate,
        uint256 depositInterestIndex,
        uint256 timeDelta
    ) external pure returns (uint256) {
        return MathUtils.calcDepositInterestIndex(depositInterestRate, depositInterestIndex, timeDelta);
    }
}
