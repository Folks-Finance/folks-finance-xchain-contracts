// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../interfaces/IHubPool.sol";
import "../libraries/DataTypes.sol";

contract HubPoolLogged {
    // TODO Messages.MessageToSend - nested structs workaround https://github.com/NomicFoundation/hardhat/issues/4207
    event SendMessage(
        Messages.MessageParams params,
        bytes32 sender,
        uint16 destinationChainId,
        bytes32 handler,
        bytes payload,
        uint64 finalityLevel,
        bytes extraArgs
    );
    event InterestIndex(uint256 value);
    event DepositPoolParams(DataTypes.DepositPoolParams params);
    event WithdrawPoolParams(DataTypes.WithdrawPoolParams params);
    event BorrowPoolParams(DataTypes.BorrowPoolParams params);
    event RepayWithCollateralPoolParams(DataTypes.RepayWithCollateralPoolParams params);
    event RebalanceDownPoolParams(DataTypes.RebalanceDownPoolParams params);

    IHubPool internal pool;

    constructor(IHubPool pool_) {
        pool = pool_;
    }

    function getSendTokenMessage(
        IBridgeRouter bridgeRouter,
        uint16 adapterId,
        uint256 gasLimit,
        bytes32 accountId,
        uint16 chainId,
        uint256 amount,
        bytes32 recipient
    ) external {
        Messages.MessageToSend memory message = pool.getSendTokenMessage(
            bridgeRouter,
            adapterId,
            gasLimit,
            accountId,
            chainId,
            amount,
            recipient
        );
        emit SendMessage(
            message.params,
            message.sender,
            message.destinationChainId,
            message.handler,
            message.payload,
            message.finalityLevel,
            message.extraArgs
        );
    }

    function getUpdatedDepositInterestIndex() external {
        uint256 value = pool.getUpdatedDepositInterestIndex();
        emit InterestIndex(value);
    }

    function getUpdatedVariableBorrowInterestIndex() external {
        uint256 value = pool.getUpdatedVariableBorrowInterestIndex();
        emit InterestIndex(value);
    }

    function updatePoolWithDeposit(uint256 amount) external {
        DataTypes.DepositPoolParams memory params = pool.updatePoolWithDeposit(amount);
        emit DepositPoolParams(params);
    }

    function updatePoolWithWithdraw(uint256 amount, bool isFAmount) external {
        DataTypes.WithdrawPoolParams memory params = pool.updatePoolWithWithdraw(amount, isFAmount);
        emit WithdrawPoolParams(params);
    }

    function preparePoolForBorrow(uint256 amount, uint256 maxStableRate) external {
        DataTypes.BorrowPoolParams memory params = pool.preparePoolForBorrow(amount, maxStableRate);
        emit BorrowPoolParams(params);
    }

    function preparePoolForRepay() external {
        DataTypes.BorrowPoolParams memory params = pool.preparePoolForRepay();
        emit BorrowPoolParams(params);
    }

    function updatePoolWithRepayWithCollateral(
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate
    ) external {
        DataTypes.RepayWithCollateralPoolParams memory params = pool.updatePoolWithRepayWithCollateral(
            principalPaid,
            interestPaid,
            loanStableRate
        );
        emit RepayWithCollateralPoolParams(params);
    }

    function preparePoolForSwitchBorrowType(uint256 amount, uint256 maxStableRate) external {
        DataTypes.BorrowPoolParams memory params = pool.preparePoolForSwitchBorrowType(amount, maxStableRate);
        emit BorrowPoolParams(params);
    }

    function preparePoolForRebalanceUp() external {
        DataTypes.BorrowPoolParams memory params = pool.preparePoolForRebalanceUp();
        emit BorrowPoolParams(params);
    }

    function preparePoolForRebalanceDown() external {
        DataTypes.RebalanceDownPoolParams memory params = pool.preparePoolForRebalanceDown();
        emit RebalanceDownPoolParams(params);
    }
}
