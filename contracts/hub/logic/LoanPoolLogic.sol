// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/MathUtils.sol";
import "../LoanManagerState.sol";

library LoanPoolLogic {
    using MathUtils for uint256;

    function isCollateralCapReached(
        LoanManagerState.LoanPool storage loanPool,
        DataTypes.PriceFeed memory priceFeed,
        uint256 fAmount,
        uint256 depositInterestIndex
    ) external view returns (bool) {
        return
            (loanPool.collateralUsed + fAmount).toUnderlingAmount(depositInterestIndex).calcAssetDollarValueRoundedUp(
                priceFeed.price,
                priceFeed.decimals
            ) > MathUtils.from0DPto18DP(loanPool.collateralCap);
    }

    function isBorrowCapReached(
        LoanManagerState.LoanPool storage loanPool,
        DataTypes.PriceFeed memory priceFeed,
        uint256 amount
    ) external view returns (bool) {
        return
            (loanPool.borrowUsed + amount).calcAssetDollarValueRoundedUp(priceFeed.price, priceFeed.decimals) >
            MathUtils.from0DPto18DP(loanPool.borrowCap);
    }

    function increaseCollateral(LoanManagerState.LoanPool storage loan, uint256 fAmount) internal {
        loan.collateralUsed += fAmount;
    }

    function decreaseCollateral(LoanManagerState.LoanPool storage loan, uint256 fAmount) internal {
        loan.collateralUsed -= fAmount;
    }

    function increaseBorrow(LoanManagerState.LoanPool storage loan, uint256 amount) internal {
        loan.borrowUsed += amount;
    }

    function decreaseBorrow(LoanManagerState.LoanPool storage loan, uint256 amount) internal {
        loan.borrowUsed -= amount;
    }
}
