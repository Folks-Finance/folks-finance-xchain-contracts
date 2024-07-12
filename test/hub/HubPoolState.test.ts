import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { HubPoolStateExposed__factory, HubPoolState__factory } from "../../typechain-types";
import { PoolData, getInitialPoolData } from "./libraries/assets/poolData";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { SECONDS_IN_DAY, getLatestBlockTimestamp } from "../utils/time";
import { unixTime } from "./utils/formulae";

describe("HubPoolState (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const PARAM_ROLE = ethers.keccak256(convertStringToBytes("PARAM"));
  const ORACLE_ROLE = ethers.keccak256(convertStringToBytes("ORACLE"));

  async function deployHubPoolStateFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const poolId = 1;
    const initialPoolData = getInitialPoolData();
    const oracleManager = getRandomAddress();
    const hubPoolState = await new HubPoolState__factory(user).deploy(admin, poolId, initialPoolData, oracleManager);

    return { admin, user, unusedUsers, hubPoolState, poolId, initialPoolData, oracleManager };
  }

  async function addChainSpokeFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const poolId = 1;
    const initialPoolData = getInitialPoolData();
    const oracleManager = getRandomAddress();
    const hubPoolState = await new HubPoolStateExposed__factory(user).deploy(
      admin,
      poolId,
      initialPoolData,
      oracleManager
    );

    // add chain spoke
    const spokeChainId = 4;
    const spokeAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    const addChainSpoke = await hubPoolState.addChainSpoke(spokeChainId, spokeAddress);

    return { admin, user, unusedUsers, hubPoolState, addChainSpoke, spokeChainId, spokeAddress };
  }

  describe("Deployment", () => {
    it("Should set admin and contracts correctly", async () => {
      const { admin, hubPoolState, poolId, initialPoolData, oracleManager } =
        await loadFixture(deployHubPoolStateFixture);

      // check default admin role
      expect(await hubPoolState.owner()).to.equal(admin.address);
      expect(await hubPoolState.defaultAdmin()).to.equal(admin.address);
      expect(await hubPoolState.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await hubPoolState.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPoolState.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check other roles
      expect(await hubPoolState.getRoleAdmin(PARAM_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPoolState.hasRole(PARAM_ROLE, admin.address)).to.be.true;
      expect(await hubPoolState.getRoleAdmin(ORACLE_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPoolState.hasRole(ORACLE_ROLE, admin.address)).to.be.true;

      // check state
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      expect(await hubPoolState.poolId()).to.equal(poolId);
      expect(await hubPoolState.getLastUpdateTimestamp()).to.equal(latestBlockTimestamp);
      expect(await hubPoolState.getFeeData()).to.deep.equal(Object.values(initialPoolData.feeData));
      expect(await hubPoolState.getDepositData()).to.deep.equal(Object.values(initialPoolData.depositData));
      expect(await hubPoolState.getVariableBorrowData()).to.deep.equal(
        Object.values(initialPoolData.variableBorrowData)
      );
      expect(await hubPoolState.getStableBorrowData()).to.deep.equal(Object.values(initialPoolData.stableBorrowData));
      expect(await hubPoolState.getCapsData()).to.deep.equal(Object.values(initialPoolData.capsData));
      expect(await hubPoolState.getConfigData()).to.deep.equal(Object.values(initialPoolData.configData));
      expect(await hubPoolState.getOracleManager()).to.equal(oracleManager);
    });

    it("Should override interest rates", async () => {
      const [admin] = await ethers.getSigners();

      // set incorrect interest rates
      const initialPoolData = getInitialPoolData();
      const incorrectPoolData = structuredClone(initialPoolData);
      incorrectPoolData.variableBorrowData.interestRate = BigInt(1e18);
      incorrectPoolData.stableBorrowData.interestRate = BigInt(2e18);
      incorrectPoolData.depositData.interestRate = BigInt(0.5e18);

      // check are different
      expect(incorrectPoolData.depositData).to.not.deep.equal(initialPoolData.depositData);
      expect(incorrectPoolData.variableBorrowData).to.not.deep.equal(initialPoolData.variableBorrowData);
      expect(incorrectPoolData.stableBorrowData).to.not.deep.equal(initialPoolData.stableBorrowData);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = await new HubPoolState__factory(admin).deploy(admin, poolId, initialPoolData, oracleManager);

      // check state
      expect(await hubPoolState.getDepositData()).to.deep.equal(Object.values(initialPoolData.depositData));
      expect(await hubPoolState.getVariableBorrowData()).to.deep.equal(
        Object.values(initialPoolData.variableBorrowData)
      );
      expect(await hubPoolState.getStableBorrowData()).to.deep.equal(Object.values(initialPoolData.stableBorrowData));
    });

    it("Should override fee total retained amount", async () => {
      const [admin] = await ethers.getSigners();

      // set incorrect total retained amount
      const initialPoolData = getInitialPoolData();
      initialPoolData.feeData.totalRetainedAmount = BigInt(1e18);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = await new HubPoolState__factory(admin).deploy(admin, poolId, initialPoolData, oracleManager);

      // check state
      expect((await hubPoolState.getFeeData()).totalRetainedAmount).to.equal(BigInt(0));
    });

    it("Should override deposit total amount", async () => {
      const [admin] = await ethers.getSigners();

      // set incorrect deposit total amount
      const initialPoolData = getInitialPoolData();
      initialPoolData.depositData.totalAmount = BigInt(10e18);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = await new HubPoolState__factory(admin).deploy(admin, poolId, initialPoolData, oracleManager);

      // check state
      expect((await hubPoolState.getDepositData()).totalAmount).to.equal(BigInt(0));
    });

    it("Should override interest indexes", async () => {
      const [admin] = await ethers.getSigners();

      // set incorrect interest indexes
      const initialPoolData = getInitialPoolData();
      initialPoolData.depositData.interestIndex = BigInt(1.1e18);
      initialPoolData.variableBorrowData.interestIndex = BigInt(1.2e18);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = await new HubPoolState__factory(admin).deploy(admin, poolId, initialPoolData, oracleManager);

      // check state
      expect((await hubPoolState.getDepositData()).interestIndex).to.equal(BigInt(1e18));
      expect((await hubPoolState.getVariableBorrowData()).interestIndex).to.equal(BigInt(1e18));
    });

    it("Should override stable borrow total amount and avg interest rates", async () => {
      const [admin] = await ethers.getSigners();

      // set incorrect borrow total amount and avg interest rates
      const initialPoolData = getInitialPoolData();
      initialPoolData.stableBorrowData.totalAmount = BigInt(10e18);
      initialPoolData.stableBorrowData.averageInterestRate = BigInt(0.1e18);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = await new HubPoolState__factory(admin).deploy(admin, poolId, initialPoolData, oracleManager);

      // check state
      const stableBorrowData = await hubPoolState.getStableBorrowData();
      expect(stableBorrowData.totalAmount).to.equal(BigInt(0));
      expect(stableBorrowData.averageInterestRate).to.equal(BigInt(0));
    });

    it("Should override last update timestamp", async () => {
      const [admin] = await ethers.getSigners();

      // set incorrect last update timestamp
      const initialPoolData = getInitialPoolData();
      initialPoolData.lastUpdateTimestamp = BigInt(unixTime() - SECONDS_IN_DAY);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = await new HubPoolState__factory(admin).deploy(admin, poolId, initialPoolData, oracleManager);

      // check state
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      expect(await hubPoolState.getLastUpdateTimestamp()).to.equal(latestBlockTimestamp);
    });

    it("Should fail when flash loan fee is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set flash loan fee which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.feeData.flashLoanFee = BigInt(0.1e6) + BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "FlashLoanFeeTooHigh");

      // set flash loan fee which is okay
      initialPoolData.feeData.flashLoanFee = BigInt(0.1e6);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when retention rate is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set retention rate which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.feeData.retentionRate = BigInt(1e6) + BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "RetentionRateTooHigh");

      // set retention rate which is okay
      initialPoolData.feeData.retentionRate = BigInt(1e6);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when optimal utilisation ratio is outside of valid range", async () => {
      const [admin] = await ethers.getSigners();

      // set optimal utilisation ratio which is too low
      const initialPoolData = getInitialPoolData();
      initialPoolData.depositData.optimalUtilisationRatio = BigInt(0);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "OptimalUtilisationRatioTooLow");

      // set optimal utilisation ratio which is too high
      initialPoolData.depositData.optimalUtilisationRatio = BigInt(1e4);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "OptimalUtilisationRatioTooHigh");

      // set optimal utilisation ratio which is okay
      initialPoolData.depositData.optimalUtilisationRatio = BigInt(1);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;

      initialPoolData.depositData.optimalUtilisationRatio = BigInt(1e4) - BigInt(1);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when max variable borrow interest rate is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set max variable borrow interest rate which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.variableBorrowData.vr0 = BigInt(100e6) - BigInt(1);
      initialPoolData.variableBorrowData.vr1 = BigInt(1);
      initialPoolData.variableBorrowData.vr2 = BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "MaxVariableInterestRateTooHigh");

      // set max variable borrow interest rate which is okay
      initialPoolData.variableBorrowData.vr2 = BigInt(0);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when max stable borrow interest rate is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set max stable borrow interest rate which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.stableBorrowData.sr0 = BigInt(100e6) - BigInt(3);
      initialPoolData.variableBorrowData.vr1 = BigInt(1);
      initialPoolData.stableBorrowData.sr1 = BigInt(1);
      initialPoolData.stableBorrowData.sr2 = BigInt(1);
      initialPoolData.stableBorrowData.sr3 = BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "MaxStableInterestRateTooHigh");

      // set max stable borrow interest rate which is okay
      initialPoolData.stableBorrowData.sr3 = BigInt(0);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when optimal stable to total debt ratio is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set optimal stable to total debt ratio which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.stableBorrowData.optimalStableToTotalDebtRatio = BigInt(1e4);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "OptimalStableToTotalDebtRatioTooHigh");

      // set optimal stable to total debt ratio which is okay
      initialPoolData.stableBorrowData.optimalStableToTotalDebtRatio = BigInt(1e4) - BigInt(1);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when rebalance up utilisation ratio is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set rebalance up utilisation ratio which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.stableBorrowData.rebalanceUpUtilisationRatio = BigInt(1e4) + BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "RebalanceUpUtilisationRatioTooHigh");

      // set rebalance up utilisation ratio which is okay
      initialPoolData.stableBorrowData.rebalanceUpUtilisationRatio = BigInt(1e4);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when rebalance up deposit interest rate is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set rebalance up deposit interest rate which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.stableBorrowData.rebalanceUpDepositInterestRate = BigInt(1e4) + BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "RebalanceUpDepositInterestRateTooHigh");

      // set rebalance up deposit interest rate which is okay
      initialPoolData.stableBorrowData.rebalanceUpDepositInterestRate = BigInt(1e4);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });

    it("Should fail when stable borrow percentage cap is too high", async () => {
      const [admin] = await ethers.getSigners();

      // set stable borrow percentage cap which is too high
      const initialPoolData = getInitialPoolData();
      initialPoolData.capsData.stableBorrowPercentage = BigInt(1e18) + BigInt(1);

      // deploy contract
      const poolId = 1;
      const oracleManager = getRandomAddress();
      const hubPoolState = new HubPoolState__factory(admin);
      let deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.be.revertedWithCustomError(hubPoolState, "StableBorrowPercentageTooHigh");

      // set stable borrow percentage cap which is okay
      initialPoolData.capsData.stableBorrowPercentage = BigInt(1e18);
      deploy = hubPoolState.deploy(admin, poolId, initialPoolData, oracleManager);
      await expect(deploy).to.not.be.reverted;
    });
  });

  describe("Update Fee Data", () => {
    it("Should successfuly update fee data", async () => {
      const { admin, hubPoolState, initialPoolData } = await loadFixture(deployHubPoolStateFixture);

      // update fee data
      const flashLoanFee = BigInt(0.05e6);
      const retentionRate = BigInt(0.2e6);
      const fTokenFeeRecipient = getRandomAddress();
      const tokenFeeClaimer = getRandomAddress();
      const tokenFeeRecipient = convertEVMAddressToGenericAddress(getRandomAddress());

      const updateFeeData = await hubPoolState
        .connect(admin)
        .updateFeeData(flashLoanFee, retentionRate, fTokenFeeRecipient, tokenFeeClaimer, tokenFeeRecipient);
      expect(await hubPoolState.getFeeData()).to.deep.equal([
        flashLoanFee,
        retentionRate,
        fTokenFeeRecipient,
        tokenFeeClaimer,
        initialPoolData.feeData.totalRetainedAmount,
        tokenFeeRecipient,
      ]);
      await expect(updateFeeData).to.emit(hubPoolState, "InterestIndexesUpdated");
      await expect(updateFeeData).to.emit(hubPoolState, "InterestRatesUpdated");
    });

    it("Should fail to update fee data when flash loan fee is too high", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update fee data
      const flashLoanFee = BigInt(0.1e6) + BigInt(1);
      const retentionRate = BigInt(0.2e6);
      const fTokenFeeRecipient = getRandomAddress();
      const tokenFeeClaimer = getRandomAddress();
      const tokenFeeRecipient = convertEVMAddressToGenericAddress(getRandomAddress());
      const updateFeeData = hubPoolState
        .connect(admin)
        .updateFeeData(flashLoanFee, retentionRate, fTokenFeeRecipient, tokenFeeClaimer, tokenFeeRecipient);
      await expect(updateFeeData).to.be.revertedWithCustomError(hubPoolState, "FlashLoanFeeTooHigh");
    });

    it("Should fail to update fee data when retention rate is too high", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update fee data
      const flashLoanFee = BigInt(0.05e6);
      const retentionRate = BigInt(1e6) + BigInt(1);
      const fTokenFeeRecipient = getRandomAddress();
      const tokenFeeClaimer = getRandomAddress();
      const tokenFeeRecipient = convertEVMAddressToGenericAddress(getRandomAddress());
      const updateFeeData = hubPoolState
        .connect(admin)
        .updateFeeData(flashLoanFee, retentionRate, fTokenFeeRecipient, tokenFeeClaimer, tokenFeeRecipient);
      await expect(updateFeeData).to.be.revertedWithCustomError(hubPoolState, "RetentionRateTooHigh");
    });

    it("Should fail to update fee data when sender is not param admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update fee data
      const flashLoanFee = BigInt(0.05e6);
      const retentionRate = BigInt(0.2e6);
      const fTokenFeeRecipient = getRandomAddress();
      const tokenFeeClaimer = getRandomAddress();
      const tokenFeeRecipient = convertEVMAddressToGenericAddress(getRandomAddress());
      const updateFeeData = hubPoolState
        .connect(user)
        .updateFeeData(flashLoanFee, retentionRate, fTokenFeeRecipient, tokenFeeClaimer, tokenFeeRecipient);
      await expect(updateFeeData)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Update Deposit Data", () => {
    it("Should successfuly update optimal utilisation ratio", async () => {
      const { admin, hubPoolState, initialPoolData } = await loadFixture(deployHubPoolStateFixture);

      // verify different
      const optimalUtilisationRatio = BigInt(0.6e4);
      expect(optimalUtilisationRatio).to.not.equal(initialPoolData.depositData.optimalUtilisationRatio);

      // update optimal utilisation ratio
      const updateDepositData = await hubPoolState.connect(admin).updateDepositData(optimalUtilisationRatio);
      const depositData = await hubPoolState.getDepositData();
      expect(depositData[0]).to.equal(optimalUtilisationRatio);
      await expect(updateDepositData).to.emit(hubPoolState, "InterestIndexesUpdated");
      await expect(updateDepositData).to.emit(hubPoolState, "InterestRatesUpdated");
    });

    it("Should fail to update when optimal utilisation ratio is outside of valid range", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // set optimal utilisation ratio which is too low
      let optimalUtilisationRatio = BigInt(0);
      let updateDepositData = hubPoolState.connect(admin).updateDepositData(optimalUtilisationRatio);
      await expect(updateDepositData).to.be.revertedWithCustomError(hubPoolState, "OptimalUtilisationRatioTooLow");

      // set optimal utilisation ratio which is too high
      optimalUtilisationRatio = BigInt(1e4);
      updateDepositData = hubPoolState.connect(admin).updateDepositData(optimalUtilisationRatio);
      await expect(updateDepositData).to.be.revertedWithCustomError(hubPoolState, "OptimalUtilisationRatioTooHigh");
    });

    it("Should fail to update optimal utilisation ratio when sender is not param admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update optimal utilisation ratio
      const optimalUtilisationRatio = BigInt(0.6e4);
      const updateDepositData = hubPoolState.connect(user).updateDepositData(optimalUtilisationRatio);
      await expect(updateDepositData)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Update Variable Borrow Data", () => {
    it("Should successfuly update variable borrow data", async () => {
      const { admin, hubPoolState, initialPoolData } = await loadFixture(deployHubPoolStateFixture);

      // update variable borrow data
      const vr0 = BigInt(0);
      const vr1 = BigInt(0.01e6);
      const vr2 = BigInt(1e6);
      const updateVariableBorrowData = await hubPoolState.connect(admin).updateVariableBorrowData(vr0, vr1, vr2);
      const newInterestRate = vr0;
      const variableBorrowData = await hubPoolState.getVariableBorrowData();
      expect(variableBorrowData[0]).to.equal(vr0);
      expect(variableBorrowData[1]).to.equal(vr1);
      expect(variableBorrowData[2]).to.equal(vr2);
      expect(variableBorrowData[3]).to.equal(initialPoolData.variableBorrowData.totalAmount);
      expect(variableBorrowData[4]).to.equal(newInterestRate);
      expect(variableBorrowData[5]).to.be.greaterThan(BigInt(1e18));
      await expect(updateVariableBorrowData).to.emit(hubPoolState, "InterestIndexesUpdated");
      await expect(updateVariableBorrowData).to.emit(hubPoolState, "InterestRatesUpdated");
    });

    it("Should fail to update variable borrow data when max variable interest rate is too high", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update variable borrow data
      const vr0 = BigInt(100e6) - BigInt(1);
      const vr1 = BigInt(1);
      const vr2 = BigInt(1);
      const updateVariableBorrowData = hubPoolState.connect(admin).updateVariableBorrowData(vr0, vr1, vr2);
      await expect(updateVariableBorrowData).to.be.revertedWithCustomError(
        hubPoolState,
        "MaxVariableInterestRateTooHigh"
      );
    });

    it("Should fail to update variable borrow data when sender is not param admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update variable borrow data
      const vr0 = BigInt(0);
      const vr1 = BigInt(0.01e6);
      const vr2 = BigInt(1e6);
      const updateVariableBorrowData = hubPoolState.connect(user).updateVariableBorrowData(vr0, vr1, vr2);
      await expect(updateVariableBorrowData)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Update Stable Borrow Data", () => {
    it("Should successfuly update stable borrow data", async () => {
      const { admin, hubPoolState, initialPoolData } = await loadFixture(deployHubPoolStateFixture);

      // update stable borrow data
      const sr0 = BigInt(0);
      const sr1 = BigInt(0.01e6);
      const sr2 = BigInt(1e6);
      const sr3 = BigInt(0.25e6);
      const optimalStableToTotalDebtRatio = BigInt(0.2e4);
      const rebalanceUpUtilisationRatio = BigInt(0.8e4);
      const rebalanceUpDepositInterestRate = BigInt(0.4e4);
      const rebalanceDownDelta = BigInt(0.3e4);
      const updateStableBorrowData = await hubPoolState
        .connect(admin)
        .updateStableBorrowData(
          sr0,
          sr1,
          sr2,
          sr3,
          optimalStableToTotalDebtRatio,
          rebalanceUpUtilisationRatio,
          rebalanceUpDepositInterestRate,
          rebalanceDownDelta
        );

      const newInterestRate = (initialPoolData.variableBorrowData.vr1 + sr0) * BigInt(1e12);
      expect(await hubPoolState.getStableBorrowData()).to.deep.equal([
        sr0,
        sr1,
        sr2,
        sr3,
        optimalStableToTotalDebtRatio,
        rebalanceUpUtilisationRatio,
        rebalanceUpDepositInterestRate,
        rebalanceDownDelta,
        initialPoolData.stableBorrowData.totalAmount,
        newInterestRate,
        initialPoolData.stableBorrowData.averageInterestRate,
      ]);
      await expect(updateStableBorrowData).to.emit(hubPoolState, "InterestIndexesUpdated");
      await expect(updateStableBorrowData).to.emit(hubPoolState, "InterestRatesUpdated");
    });

    it("Should fail to update variable borrow data when max stable interest rate is too high", async () => {
      const { admin, hubPoolState, initialPoolData } = await loadFixture(deployHubPoolStateFixture);

      // update stable borrow data
      const sr0 = BigInt(100e6) - initialPoolData.variableBorrowData.vr1 - BigInt(2);
      const sr1 = BigInt(1);
      const sr2 = BigInt(1);
      const sr3 = BigInt(1);
      const optimalStableToTotalDebtRatio = BigInt(0.2e4);
      const rebalanceUpUtilisationRatio = BigInt(0.8e4);
      const rebalanceUpDepositInterestRate = BigInt(0.4e4);
      const rebalanceDownDelta = BigInt(0.3e4);
      const updateStableBorrowData = hubPoolState
        .connect(admin)
        .updateStableBorrowData(
          sr0,
          sr1,
          sr2,
          sr3,
          optimalStableToTotalDebtRatio,
          rebalanceUpUtilisationRatio,
          rebalanceUpDepositInterestRate,
          rebalanceDownDelta
        );
      await expect(updateStableBorrowData).to.be.revertedWithCustomError(hubPoolState, "MaxStableInterestRateTooHigh");
    });

    it("Should fail to update stable borrow data when sender is not param admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update stable borrow data
      const sr0 = BigInt(0);
      const sr1 = BigInt(0.01e6);
      const sr2 = BigInt(1e6);
      const sr3 = BigInt(0.25e6);
      const optimalStableToTotalDebtRatio = BigInt(0.2e4);
      const rebalanceUpUtilisationRatio = BigInt(0.8e4);
      const rebalanceUpDepositInterestRate = BigInt(0.4e4);
      const rebalanceDownDelta = BigInt(0.3e4);
      const updateStableBorrowData = hubPoolState
        .connect(user)
        .updateStableBorrowData(
          sr0,
          sr1,
          sr2,
          sr3,
          optimalStableToTotalDebtRatio,
          rebalanceUpUtilisationRatio,
          rebalanceUpDepositInterestRate,
          rebalanceDownDelta
        );
      await expect(updateStableBorrowData)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Update Caps Data", () => {
    it("Should successfuly update caps data", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update caps data
      const capsData = {
        deposit: BigInt(50e6),
        borrow: BigInt(20e6),
        stableBorrowPercentage: BigInt(0.05e18),
      };
      await hubPoolState.connect(admin).updateCapsData(capsData);
      expect(await hubPoolState.getCapsData()).to.deep.equal(Object.values(capsData));
    });

    it("Should fail to update caps data when stable borrow percentage cap is too high", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // set stable borrow percentage cap which is too high
      const capsData = {
        deposit: BigInt(50e6),
        borrow: BigInt(20e6),
        stableBorrowPercentage: BigInt(1e18) + BigInt(1),
      };
      let updateCapsData = hubPoolState.connect(admin).updateCapsData(capsData);
      await expect(updateCapsData).to.be.revertedWithCustomError(hubPoolState, "StableBorrowPercentageTooHigh");

      // set stable borrow percentage cap which is okay
      capsData.stableBorrowPercentage = BigInt(1e18);
      updateCapsData = hubPoolState.connect(admin).updateCapsData(capsData);
      await expect(updateCapsData).to.not.be.reverted;
    });

    it("Should fail to update caps data when sender is not param admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update caps data
      const capsData = {
        deposit: BigInt(50e6),
        borrow: BigInt(20e6),
        stableBorrowPercentage: BigInt(0.05e18),
      };
      const updateCapsData = hubPoolState.connect(user).updateCapsData(capsData);
      await expect(updateCapsData)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Update Config Data", () => {
    it("Should successfuly update config data", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update config data
      const configData = {
        deprecated: false,
        stableBorrowSupported: true,
        canMintFToken: true,
        flashLoanSupported: true,
      };
      await hubPoolState.connect(admin).updateConfigData(configData);
      expect(await hubPoolState.getConfigData()).to.deep.equal(Object.values(configData));

      // update config data again
      configData.deprecated = true;
      await hubPoolState.connect(admin).updateConfigData(configData);
      expect(await hubPoolState.getConfigData()).to.deep.equal(Object.values(configData));
    });

    it("Should fail to update config data when sender is not param admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update config data
      const configData = {
        deprecated: false,
        stableBorrowSupported: true,
        canMintFToken: true,
        flashLoanSupported: true,
      };
      const updateConfigData = hubPoolState.connect(user).updateConfigData(configData);
      await expect(updateConfigData)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Update Oracle Manager", () => {
    it("Should succesfully update oracle manager", async () => {
      const { admin, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update oracle manager
      const oracleManager = getRandomAddress();
      await hubPoolState.connect(admin).updateOracleManager(oracleManager);
      expect(await hubPoolState.getOracleManager()).to.equal(oracleManager);
    });

    it("Should fail to update oracle manager when sender is not oracle admin", async () => {
      const { user, hubPoolState } = await loadFixture(deployHubPoolStateFixture);

      // update oracle manager
      const oracleManager = getRandomAddress();
      const updateOracleManager = hubPoolState.connect(user).updateOracleManager(oracleManager);
      await expect(updateOracleManager)
        .to.be.revertedWithCustomError(hubPoolState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, ORACLE_ROLE);
    });
  });

  describe("Add Chain Spoke", () => {
    it("Should succesfully add chain spoke", async () => {
      const { hubPoolState, spokeChainId, spokeAddress } = await loadFixture(addChainSpokeFixture);

      // verify added
      expect(await hubPoolState.getChainSpoke(spokeChainId)).to.equal(spokeAddress);
    });

    it("Should fail to add chain spoke when spoke already exists for given chain", async () => {
      const { hubPoolState, spokeChainId } = await loadFixture(addChainSpokeFixture);

      // add chain spoke
      const spokeAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      const addChainSpoke = hubPoolState.addChainSpoke(spokeChainId, spokeAddress);
      await expect(addChainSpoke)
        .to.be.revertedWithCustomError(hubPoolState, "ExistingChainSpoke")
        .withArgs(spokeChainId);
    });
  });

  describe("Remove Chain Spoke", () => {
    it("Should succesfully remove chain spoke", async () => {
      const { hubPoolState, spokeChainId } = await loadFixture(addChainSpokeFixture);

      // remove chain spoke
      await hubPoolState.removeChainSpoke(spokeChainId);
      await expect(hubPoolState.getChainSpoke(spokeChainId)).to.be.reverted;
    });

    it("Should fail to remove chain spoke when no spoke added for given chain", async () => {
      const { hubPoolState } = await loadFixture(addChainSpokeFixture);

      // verify not added
      const spokeChainId = 24;
      await expect(hubPoolState.getChainSpoke(spokeChainId)).to.be.reverted;

      // remove chain spoke
      const removeChainSpoke = hubPoolState.removeChainSpoke(spokeChainId);
      await expect(removeChainSpoke).to.be.revertedWithCustomError(hubPoolState, "NoChainSpoke").withArgs(spokeChainId);
    });
  });

  describe("Get Chain Spoke", () => {
    it("Should fail to get chain spoke when no spoke added for given chain", async () => {
      const { hubPoolState, spokeChainId } = await loadFixture(addChainSpokeFixture);

      // check different to added chain spoke
      const unknownSpokeChainId = 24;
      expect(unknownSpokeChainId).to.not.equal(spokeChainId);

      // get chain spoke
      const getChainSpoke = hubPoolState.getChainSpoke(unknownSpokeChainId);
      await expect(getChainSpoke)
        .to.be.revertedWithCustomError(hubPoolState, "NoChainSpoke")
        .withArgs(unknownSpokeChainId);
    });
  });
});
