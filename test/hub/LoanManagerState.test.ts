import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { LoanManagerState__factory, MockHubPool__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import { SECONDS_IN_DAY, getLatestBlockTimestamp } from "../utils/time";
import { LoanManagerStateExposed__factory } from "../../typechain-types";
import { UserLoanBorrow, UserLoanCollateral, UserPoolRewards } from "./libraries/assets/loanData";
import { unixTime } from "./utils/formulae";

describe("LoanManagerState (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const LISTING_ROLE = ethers.keccak256(convertStringToBytes("LISTING"));
  const ORACLE_ROLE = ethers.keccak256(convertStringToBytes("ORACLE"));

  async function deployLoanManagerStateFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const oracleManager = getRandomAddress();
    const loanManagerState = await new LoanManagerState__factory(user).deploy(admin, oracleManager);

    return { admin, user, unusedUsers, loanManagerState, oracleManager };
  }

  async function createLoanTypeFixture() {
    const { admin, user, unusedUsers, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

    // create loan type
    const loanTypeId = 1;
    const loanTargetHealth = BigInt(1.05e4);
    const createLoanType = await loanManagerState.connect(admin).createLoanType(loanTypeId, loanTargetHealth);

    return { admin, user, unusedUsers, loanManagerState, createLoanType, loanTypeId, loanTargetHealth };
  }

  async function deprecateLoanTypeFixture() {
    const { admin, user, unusedUsers, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

    // deprecate loan type
    const deprecateLoanType = await loanManagerState.connect(admin).deprecateLoanType(loanTypeId);

    return {
      admin,
      user,
      unusedUsers,
      loanManagerState,
      deprecateLoanType,
      loanTypeId,
    };
  }

  async function addPoolFixture() {
    const { admin, user, unusedUsers, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

    // add pool
    const poolId = 1;
    const pool = await new MockHubPool__factory(user).deploy("Folks USD Coin", "fUSDC", poolId);
    const addPool = await loanManagerState.connect(admin).addPool(pool);

    return { admin, user, unusedUsers, loanManagerState, addPool, loanTypeId, pool, poolId };
  }

  async function addPoolToLoanTypeFixture() {
    const { admin, user, unusedUsers, loanManagerState, loanTypeId, pool, poolId } = await loadFixture(addPoolFixture);

    // add pool to loan type
    const collateralFactor = BigInt(0.8e4);
    const collateralCap = BigInt(20e6);
    const borrowFactor = BigInt(1e4);
    const borrowCap = BigInt(10e6);
    const liquidationBonus = BigInt(0.04e4);
    const liquidationFee = BigInt(0.1e4);
    const rewardCollateralSpeed = BigInt(0.0002e18);
    const rewardBorrowSpeed = BigInt(0.0001e18);
    const rewardMinimumAmount = BigInt(1e18);
    const addPoolToLoanType = await loanManagerState
      .connect(admin)
      .addPoolToLoanType(
        loanTypeId,
        poolId,
        collateralFactor,
        collateralCap,
        borrowFactor,
        borrowCap,
        liquidationBonus,
        liquidationFee,
        rewardCollateralSpeed,
        rewardBorrowSpeed,
        rewardMinimumAmount
      );

    return {
      admin,
      user,
      unusedUsers,
      loanManagerState,
      addPoolToLoanType,
      loanTypeId,
      pool,
      poolId,
      collateralFactor,
      collateralCap,
      borrowFactor,
      borrowCap,
      liquidationBonus,
      liquidationFee,
      rewardCollateralSpeed,
      rewardBorrowSpeed,
      rewardMinimumAmount,
    };
  }

  async function deprecatePoolInLoanTypeFixture() {
    const { admin, user, unusedUsers, loanManagerState, loanTypeId, pool, poolId } =
      await loadFixture(addPoolToLoanTypeFixture);

    // deprecate pool in loan type
    const deprecatePoolInLoanType = await loanManagerState.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);

    return {
      admin,
      user,
      unusedUsers,
      loanManagerState,
      deprecatePoolInLoanType,
      loanTypeId,
      pool,
      poolId,
    };
  }

  async function deployLoanManagerStateExposedFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const oracleManager = getRandomAddress();
    const loanManagerState = await new LoanManagerStateExposed__factory(user).deploy(admin, oracleManager);

    return { admin, user, unusedUsers, loanManagerState, oracleManager };
  }

  describe("Deployment", () => {
    it("Should set admin and contracts correctly", async () => {
      const { admin, loanManagerState, oracleManager } = await loadFixture(deployLoanManagerStateFixture);

      // check default admin role
      expect(await loanManagerState.owner()).to.equal(admin.address);
      expect(await loanManagerState.defaultAdmin()).to.equal(admin.address);
      expect(await loanManagerState.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await loanManagerState.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManagerState.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check other roles
      expect(await loanManagerState.getRoleAdmin(LISTING_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManagerState.hasRole(LISTING_ROLE, admin.address)).to.be.true;
      expect(await loanManagerState.getRoleAdmin(ORACLE_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManagerState.hasRole(ORACLE_ROLE, admin.address)).to.be.true;

      // check state
      expect(await loanManagerState.getOracleManager()).to.equal(oracleManager);
    });
  });

  describe("Update Oracle Manager", () => {
    it("Should succesfully update oracle manager", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // update oracle manager
      const oracleManager = getRandomAddress();
      await loanManagerState.connect(admin).updateOracleManager(oracleManager);
      expect(await loanManagerState.getOracleManager()).to.equal(oracleManager);
    });

    it("Should fail to update oracle manager when sender is not oracle admin", async () => {
      const { user, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // update oracle manager
      const oracleManager = getRandomAddress();
      const updateOracleManager = loanManagerState.connect(user).updateOracleManager(oracleManager);
      await expect(updateOracleManager)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, ORACLE_ROLE);
    });
  });

  describe("Create Loan Type", () => {
    it("Should successfuly create loan type", async () => {
      const { loanManagerState, loanTypeId, loanTargetHealth } = await loadFixture(createLoanTypeFixture);

      // verify created
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.true;
      expect(await loanManagerState.isLoanTypeDeprecated(loanTypeId)).to.be.false;
      expect(await loanManagerState.getLoanTypeLoanTargetHealth(loanTypeId)).to.be.equal(loanTargetHealth);
    });

    it("Should fail to create loan type when already created", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // create loan type
      const loanTargetHealth = BigInt(1.2e4);
      const createLoanType = loanManagerState.connect(admin).createLoanType(loanTypeId, loanTargetHealth);
      await expect(createLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeAlreadyCreated")
        .withArgs(loanTypeId);
    });

    it("Should fail to create loan type when loan target health is too low", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // create loan type when loan target health is too low
      const loanTypeId = 2;
      let loanTargetHealth = BigInt(1e4) - BigInt(1);
      let createLoanType = loanManagerState.connect(admin).createLoanType(loanTypeId, loanTargetHealth);
      await expect(createLoanType).to.be.revertedWithCustomError(loanManagerState, "LoanTargetHealthTooLow");

      // create loan type when loan target health is okay
      loanTargetHealth = BigInt(1e4);
      createLoanType = loanManagerState.connect(admin).createLoanType(loanTypeId, loanTargetHealth);
      await expect(createLoanType).to.not.be.reverted;
    });

    it("Should fail to create loan type when sender is not listing admin", async () => {
      const { user, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // create loan type
      const loanTypeId = 2;
      const loanTargetHealth = BigInt(1.2e4);
      const createLoanType = loanManagerState.connect(user).createLoanType(loanTypeId, loanTargetHealth);
      await expect(createLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Deprecate Loan Type", () => {
    it("Should successfuly deprecate loan type", async () => {
      const { loanManagerState, loanTypeId } = await loadFixture(deprecateLoanTypeFixture);

      // deprecate loan type
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.true;
      expect(await loanManagerState.isLoanTypeDeprecated(loanTypeId)).to.be.true;
    });

    it("Should fail to deprecate loan type when is unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // deprecate loan type
      const loanTypeId = 2;
      const deprecateLoanType = loanManagerState.connect(admin).deprecateLoanType(loanTypeId);
      await expect(deprecateLoanType).to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown");
    });

    it("Should fail to deprecate loan type when is already deprecated", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(deprecateLoanTypeFixture);

      // deprecate loan type
      const deprecateLoanType = loanManagerState.connect(admin).deprecateLoanType(loanTypeId);
      await expect(deprecateLoanType).to.be.revertedWithCustomError(loanManagerState, "LoanTypeAlreadyDeprecated");
    });

    it("Should fail to deprecate loan type when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // deprecate loan type
      const deprecateLoanType = loanManagerState.connect(user).deprecateLoanType(loanTypeId);
      await expect(deprecateLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Update Loan Type", () => {
    it("Should successfuly update loan type target health", async () => {
      const { admin, loanManagerState, loanTypeId, loanTargetHealth } = await loadFixture(createLoanTypeFixture);

      // verify different
      const newLoanTargetHealth = BigInt(1.2e4);
      expect(newLoanTargetHealth).to.not.equal(loanTargetHealth);

      // update loan type target health
      await loanManagerState.connect(admin).updateLoanTypeLoanTargetHealth(loanTypeId, newLoanTargetHealth);
      expect(await loanManagerState.getLoanTypeLoanTargetHealth(loanTypeId)).to.be.equal(newLoanTargetHealth);
    });

    it("Should fail to update loan type when is unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // update loan type target health
      const loanTypeId = 2;
      const loanTargetHealth = BigInt(1.2e4);
      const updateLoanTypeLoanTargetHealth = loanManagerState
        .connect(admin)
        .updateLoanTypeLoanTargetHealth(loanTypeId, loanTargetHealth);
      await expect(updateLoanTypeLoanTargetHealth).to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown");
    });

    it("Should fail to update when loan type target health is too low", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // update loan type when loan target health is too low
      let loanTargetHealth = BigInt(1e4) - BigInt(1);
      let updateLoanTypeLoanTargetHealth = loanManagerState
        .connect(admin)
        .updateLoanTypeLoanTargetHealth(loanTypeId, loanTargetHealth);
      await expect(updateLoanTypeLoanTargetHealth).to.be.revertedWithCustomError(
        loanManagerState,
        "LoanTargetHealthTooLow"
      );

      // update loan type target health is okay
      loanTargetHealth = BigInt(1e4);
      updateLoanTypeLoanTargetHealth = loanManagerState
        .connect(admin)
        .updateLoanTypeLoanTargetHealth(loanTypeId, loanTargetHealth);
      await expect(updateLoanTypeLoanTargetHealth).to.not.be.reverted;
    });

    it("Should fail to update loan type when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // update loan type when loan target health
      const loanTargetHealth = BigInt(1.2e4);
      const updateLoanTypeLoanTargetHealth = loanManagerState
        .connect(user)
        .updateLoanTypeLoanTargetHealth(loanTypeId, loanTargetHealth);
      await expect(updateLoanTypeLoanTargetHealth)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Add Pool", () => {
    it("Should successfuly add pool", async () => {
      const { loanManagerState, poolId } = await loadFixture(addPoolFixture);

      // verify added
      expect(await loanManagerState.isPoolAdded(poolId)).to.be.true;
    });

    it("Should fail to add pool when pool id already used", async () => {
      const { admin, user, loanManagerState, poolId } = await loadFixture(addPoolFixture);

      // add pool
      const pool = await new MockHubPool__factory(user).deploy("Folks USD Coin 2", "fUSDC2", poolId);
      const addPool = loanManagerState.connect(admin).addPool(pool);
      await expect(addPool).to.be.revertedWithCustomError(loanManagerState, "PoolAlreadyAdded").withArgs(poolId);
    });

    it("Should fail to add pool when sender is not listing admin", async () => {
      const { user, loanManagerState } = await loadFixture(createLoanTypeFixture);

      // add pool
      const poolId = 1;
      const pool = await new MockHubPool__factory(user).deploy("Folks USD Coin", "fUSDC", poolId);
      const addPool = loanManagerState.connect(user).addPool(pool);
      await expect(addPool)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Add Pool To Loan Type", () => {
    it("Should successfuly add pool to loan type", async () => {
      const {
        loanManagerState,
        loanTypeId,
        poolId,
        collateralCap,
        borrowCap,
        collateralFactor,
        borrowFactor,
        liquidationBonus,
        liquidationFee,
        rewardCollateralSpeed,
        rewardBorrowSpeed,
        rewardMinimumAmount,
      } = await loadFixture(addPoolToLoanTypeFixture);

      // verify added
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      expect(await loanManagerState.isPoolInLoanType(loanTypeId, poolId)).to.be.true;
      expect(await loanManagerState.isPoolInLoanTypeDeprecated(loanTypeId, poolId)).to.be.false;
      expect(await loanManagerState.getLoanPool(loanTypeId, poolId)).to.deep.equal([
        BigInt(0),
        BigInt(0),
        collateralCap,
        borrowCap,
        collateralFactor,
        borrowFactor,
        liquidationBonus,
        liquidationFee,
        true,
        false,
        [latestBlockTimestamp, rewardMinimumAmount, rewardCollateralSpeed, rewardBorrowSpeed, BigInt(0), BigInt(0)],
      ]);
    });

    it("Should fail to add pool to loan type when loan type unknown", async () => {
      const { admin, loanManagerState, poolId } = await loadFixture(addPoolFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // add pool to loan type
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      const addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to add pool to loan type when loan type deprecated", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(deprecateLoanTypeFixture);

      // add pool to loan type
      const poolId = 1;
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      const addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeDeprecated")
        .withArgs(loanTypeId);
    });

    it("Should fail to add pool to loan type when pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // add pool to loan type
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      const addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "PoolUnknown").withArgs(poolId);
    });

    it("Should fail to add pool to loan type when loan pool already added", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // verify added
      expect(await loanManagerState.isPoolInLoanType(loanTypeId, poolId)).to.be.true;

      // add pool to loan type
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      const addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolAlreadyAdded")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to add pool to loan type when collateral factor is too high", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolFixture);

      // add pool to loan type when collateral factor too high
      let collateralFactor = BigInt(1e4) + BigInt(1);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      let addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "CollateralFactorTooHigh");

      // add pool to loan type when collateral factor is okay
      collateralFactor = BigInt(1e4);
      addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).not.to.be.reverted;
    });

    it("Should fail to add pool to loan type when borrow factor is too low", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolFixture);

      // add pool to loan type when borrow factor too low
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      let borrowFactor = BigInt(1e4) - BigInt(1);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      let addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "BorrowFactorTooLow");

      // add pool to loan type when borrow factor is okay
      borrowFactor = BigInt(1e4);
      addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).not.to.be.reverted;
    });

    it("Should fail to add pool to loan type when liquidation bonus is too high", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolFixture);

      // add pool to loan type when liquidation bonus too low
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      let liquidationBonus = BigInt(1e4) + BigInt(1);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      let addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "LiquidationBonusTooHigh");

      // add pool to loan type when liquidation bonus is okay
      liquidationBonus = BigInt(1e4);
      addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).not.to.be.reverted;
    });

    it("Should fail to add pool to loan type when liquidation fee is too high", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolFixture);

      // add pool to loan type when liquidation fee too low
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      let liquidationFee = BigInt(1e4) + BigInt(1);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      let addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "LiquidationFeeTooHigh");

      // add pool to loan type when liquidation fee is okay
      liquidationFee = BigInt(1e4);
      addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).not.to.be.reverted;
    });

    it("Should fail to add pool to loan type when reward overflows", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolFixture);

      // add pool to loan type when collateral reward overflows
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardMinimumAmount = BigInt(1e4);
      let rewardCollateralSpeed = BigInt(3.7e71);
      let rewardBorrowSpeed = BigInt(0);
      let addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "MathOverflowedMulDiv");

      // add pool to loan type when borrow reward overflows
      rewardCollateralSpeed = BigInt(0);
      rewardBorrowSpeed = BigInt(3.7e71);
      addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).to.be.revertedWithCustomError(loanManagerState, "MathOverflowedMulDiv");

      // add pool to loan type when collateral and borrow reward is okay
      rewardCollateralSpeed = BigInt(3.6e71);
      rewardBorrowSpeed = BigInt(3.6e71);
      addPoolToLoanType = loanManagerState
        .connect(admin)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType).not.to.be.reverted;
    });

    it("Should fail to add pool to loan type when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolFixture);

      // add pool to loan type when liquidation bonus too low
      const collateralFactor = BigInt(0.8e4);
      const collateralCap = BigInt(20e6);
      const borrowFactor = BigInt(1e4);
      const borrowCap = BigInt(10e6);
      const liquidationBonus = BigInt(0.04e4);
      const liquidationFee = BigInt(0.1e4);
      const rewardCollateralSpeed = BigInt(0.0002e18);
      const rewardBorrowSpeed = BigInt(0.0001e18);
      const rewardMinimumAmount = BigInt(1e18);
      const addPoolToLoanType = loanManagerState
        .connect(user)
        .addPoolToLoanType(
          loanTypeId,
          poolId,
          collateralFactor,
          collateralCap,
          borrowFactor,
          borrowCap,
          liquidationBonus,
          liquidationFee,
          rewardCollateralSpeed,
          rewardBorrowSpeed,
          rewardMinimumAmount
        );
      await expect(addPoolToLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Deprecate Pool In Loan Type", () => {
    it("Should successfuly deprecate pool in loan type", async () => {
      const { loanManagerState, loanTypeId, poolId } = await loadFixture(deprecatePoolInLoanTypeFixture);

      // verify deprecated
      expect(await loanManagerState.isPoolInLoanType(loanTypeId, poolId)).to.be.true;
      expect(await loanManagerState.isPoolInLoanTypeDeprecated(loanTypeId, poolId)).to.be.true;
    });

    it("Should fail to deprecate pool in loan type when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // deprecate pool in loan type
      const poolId = 1;
      const deprecatePoolInLoanType = loanManagerState.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);
      await expect(deprecatePoolInLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to deprecate pool in loan type when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // deprecate pool in loan type
      const deprecatePoolInLoanType = loanManagerState.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);
      await expect(deprecatePoolInLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to deprecate pool in loan type when loan pool already deprecated", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(deprecatePoolInLoanTypeFixture);

      // verify deprecated
      expect(await loanManagerState.isPoolInLoanType(loanTypeId, poolId)).to.be.true;

      // deprecate pool in loan type
      const deprecatePoolInLoanType = loanManagerState.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);
      await expect(deprecatePoolInLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolAlreadyDeprecated")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to deprecate pool in loan type when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // deprecate pool in loan type
      const deprecatePoolInLoanType = loanManagerState.connect(user).deprecatePoolInLoanType(loanTypeId, poolId);
      await expect(deprecatePoolInLoanType)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Update Loan Pool Caps", () => {
    it("Should successfuly update loan pool caps", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool caps
      const collateralCap = BigInt(5.5e6);
      const borrowCap = BigInt(3.5e6);
      await loanManagerState.connect(admin).updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);
      const loanPool = await loanManagerState.getLoanPool(loanTypeId, poolId);
      expect(loanPool[2]).to.equal(collateralCap);
      expect(loanPool[3]).to.equal(borrowCap);
    });

    it("Should fail to update loan pool caps when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // update loan pool caps
      const poolId = 1;
      const collateralCap = BigInt(5.5e6);
      const borrowCap = BigInt(3.5e6);
      const updateLoanPoolCaps = loanManagerState
        .connect(admin)
        .updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);
      await expect(updateLoanPoolCaps)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to update loan pool caps when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // update loan pool caps
      const collateralCap = BigInt(5.5e6);
      const borrowCap = BigInt(3.5e6);
      const updateLoanPoolCaps = loanManagerState
        .connect(admin)
        .updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);
      await expect(updateLoanPoolCaps)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to update loan pool caps when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool caps
      const collateralCap = BigInt(5.5e6);
      const borrowCap = BigInt(3.5e6);
      const updateLoanPoolCaps = loanManagerState
        .connect(user)
        .updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);
      await expect(updateLoanPoolCaps)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Update Loan Pool Collateral Factor", () => {
    it("Should successfuly update loan pool collateral factor", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool collateral factor
      const collateralFactor = BigInt(0.5e4);
      await loanManagerState.connect(admin).updateLoanPoolCollateralFactor(loanTypeId, poolId, collateralFactor);
      const loanPool = await loanManagerState.getLoanPool(loanTypeId, poolId);
      expect(loanPool[4]).to.equal(collateralFactor);
    });

    it("Should fail to update loan pool collateral factor when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // update loan pool collateral factor
      const poolId = 1;
      const collateralFactor = BigInt(0.5e4);
      const updateLoanPoolCollateralFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolCollateralFactor(loanTypeId, poolId, collateralFactor);
      await expect(updateLoanPoolCollateralFactor)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to update loan pool collateral factor when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // update loan pool collateral factor
      const collateralFactor = BigInt(0.5e4);
      const updateLoanPoolCollateralFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolCollateralFactor(loanTypeId, poolId, collateralFactor);
      await expect(updateLoanPoolCollateralFactor)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to update loan pool collateral factor when is too high", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool collateral factor when is too high
      let collateralFactor = BigInt(1e4) + BigInt(1);
      let updateLoanPoolCollateralFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolCollateralFactor(loanTypeId, poolId, collateralFactor);
      await expect(updateLoanPoolCollateralFactor).to.be.revertedWithCustomError(
        loanManagerState,
        "CollateralFactorTooHigh"
      );

      // update loan pool collateral factor when is okay
      collateralFactor = BigInt(1e4);
      updateLoanPoolCollateralFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolCollateralFactor(loanTypeId, poolId, collateralFactor);
      await expect(updateLoanPoolCollateralFactor).not.to.be.reverted;
    });

    it("Should fail to update loan pool collateral factor when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool collateral factor
      const collateralFactor = BigInt(0.5e4);
      const updateLoanPoolCollateralFactor = loanManagerState
        .connect(user)
        .updateLoanPoolCollateralFactor(loanTypeId, poolId, collateralFactor);
      await expect(updateLoanPoolCollateralFactor)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Update Loan Pool Borrow Factor", () => {
    it("Should successfuly update loan pool borrow factor", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool borrow factor
      const borrowFactor = BigInt(1.5e4);
      await loanManagerState.connect(admin).updateLoanPoolBorrowFactor(loanTypeId, poolId, borrowFactor);
      const loanPool = await loanManagerState.getLoanPool(loanTypeId, poolId);
      expect(loanPool[5]).to.equal(borrowFactor);
    });

    it("Should fail to update loan pool borrow factor when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // update loan pool borrow factor
      const poolId = 1;
      const borrowFactor = BigInt(1.5e4);
      const updateLoanPoolBorrowFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolBorrowFactor(loanTypeId, poolId, borrowFactor);
      await expect(updateLoanPoolBorrowFactor)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to update loan pool borrow factor when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // update loan pool borrow factor
      const borrowFactor = BigInt(1.5e4);
      const updateLoanPoolBorrowFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolBorrowFactor(loanTypeId, poolId, borrowFactor);
      await expect(updateLoanPoolBorrowFactor)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to update loan pool borrow factor when is too low", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool borrow factor when is too low
      let borrowFactor = BigInt(1e4) - BigInt(1);
      let updateLoanPoolBorrowFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolBorrowFactor(loanTypeId, poolId, borrowFactor);
      await expect(updateLoanPoolBorrowFactor).to.be.revertedWithCustomError(loanManagerState, "BorrowFactorTooLow");

      // update loan pool borrow factor when is okay
      borrowFactor = BigInt(1e4);
      updateLoanPoolBorrowFactor = loanManagerState
        .connect(admin)
        .updateLoanPoolBorrowFactor(loanTypeId, poolId, borrowFactor);
      await expect(updateLoanPoolBorrowFactor).not.to.be.reverted;
    });

    it("Should fail to update loan pool borrow factor when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool borrow factor
      const borrowFactor = BigInt(0.5e4);
      const updateLoanPoolBorrowFactor = loanManagerState
        .connect(user)
        .updateLoanPoolCollateralFactor(loanTypeId, poolId, borrowFactor);
      await expect(updateLoanPoolBorrowFactor)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Update Loan Pool Liquidation", () => {
    it("Should successfuly update loan pool liquidation", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool liquidation
      const liquidationBonus = BigInt(0.1e4);
      const liquidationFee = BigInt(0.2e4);
      await loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      const loanPool = await loanManagerState.getLoanPool(loanTypeId, poolId);
      expect(loanPool[6]).to.equal(liquidationBonus);
      expect(loanPool[7]).to.equal(liquidationFee);
    });

    it("Should fail to update loan pool liquidation when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // update loan pool liquidation
      const poolId = 1;
      const liquidationBonus = BigInt(0.1e4);
      const liquidationFee = BigInt(0.2e4);
      const updateLoanPoolLiquidation = loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to update loan pool liquidation when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // update loan pool caps
      const liquidationBonus = BigInt(0.1e4);
      const liquidationFee = BigInt(0.2e4);
      const updateLoanPoolLiquidation = loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to update loan pool liquidation when liquidation bonus is too high", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool liquidation bonus when is too high
      let liquidationBonus = BigInt(1e4) + BigInt(1);
      const liquidationFee = BigInt(0.2e4);
      let updateLoanPoolLiquidation = loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation).to.be.revertedWithCustomError(
        loanManagerState,
        "LiquidationBonusTooHigh"
      );

      // update loan pool liquidation bonus when is okay
      liquidationBonus = BigInt(1e4);
      updateLoanPoolLiquidation = loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation).not.to.be.reverted;
    });

    it("Should fail to update loan pool liquidation when liquidation fee is too low", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool liquidation bonus when is too high
      const liquidationBonus = BigInt(0.1e4);
      let liquidationFee = BigInt(1e4) + BigInt(1);
      let updateLoanPoolLiquidation = loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation).to.be.revertedWithCustomError(loanManagerState, "LiquidationFeeTooHigh");

      // update loan pool liquidation bonus when is okay
      liquidationFee = BigInt(1e4);
      updateLoanPoolLiquidation = loanManagerState
        .connect(admin)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation).not.to.be.reverted;
    });

    it("Should fail to update loan pool liquidation when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool caps
      const liquidationBonus = BigInt(0.1e4);
      const liquidationFee = BigInt(0.2e4);
      const updateLoanPoolLiquidation = loanManagerState
        .connect(user)
        .updateLoanPoolLiquidation(loanTypeId, poolId, liquidationBonus, liquidationFee);
      await expect(updateLoanPoolLiquidation)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Update Reward Params", () => {
    it("Should successfuly update reward params", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update reward params
      const rewardCollateralSpeed = BigInt(0.00015e18);
      const rewardBorrowSpeed = BigInt(0.00005e18);
      const rewardMinimumAmount = BigInt(3e18);
      const updateRewardParams = await loanManagerState
        .connect(admin)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      const loanPool = await loanManagerState.getLoanPool(loanTypeId, poolId);
      expect(loanPool[10][1]).to.equal(rewardMinimumAmount);
      expect(loanPool[10][2]).to.equal(rewardCollateralSpeed);
      expect(loanPool[10][3]).to.equal(rewardBorrowSpeed);
      await expect(updateRewardParams).to.emit(loanManagerState, "RewardIndexesUpdated");
    });

    it("Should fail to update reward params when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // update reward params
      const poolId = 1;
      const rewardCollateralSpeed = BigInt(0.00015e18);
      const rewardBorrowSpeed = BigInt(0.00005e18);
      const rewardMinimumAmount = BigInt(3e18);
      const updateRewardParams = loanManagerState
        .connect(admin)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      await expect(updateRewardParams)
        .to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown")
        .withArgs(loanTypeId);
    });

    it("Should fail to update reward params when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // update reward params
      const rewardCollateralSpeed = BigInt(0.00015e18);
      const rewardBorrowSpeed = BigInt(0.00005e18);
      const rewardMinimumAmount = BigInt(3e18);
      const updateRewardParams = loanManagerState
        .connect(admin)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      await expect(updateRewardParams)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to update reward params when when reward overflows", async () => {
      const { admin, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update reward when collateral rewardoverflows
      const rewardMinimumAmount = BigInt(1e4);
      let rewardCollateralSpeed = BigInt(3.7e71);
      let rewardBorrowSpeed = BigInt(0);
      let updateRewardParams = loanManagerState
        .connect(admin)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      await expect(updateRewardParams).to.be.revertedWithCustomError(loanManagerState, "MathOverflowedMulDiv");

      // update reward when borrow reward overflows
      rewardCollateralSpeed = BigInt(0);
      rewardBorrowSpeed = BigInt(3.7e71);
      updateRewardParams = loanManagerState
        .connect(admin)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      await expect(updateRewardParams).to.be.revertedWithCustomError(loanManagerState, "MathOverflowedMulDiv");

      // update reward when collateral and borrow reward is okay
      rewardCollateralSpeed = BigInt(3.6e71);
      rewardBorrowSpeed = BigInt(3.6e71);
      updateRewardParams = loanManagerState
        .connect(admin)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      await expect(updateRewardParams).not.to.be.reverted;
    });

    it("Should fail to update reward params when sender is not listing admin", async () => {
      const { user, loanManagerState, loanTypeId, poolId } = await loadFixture(addPoolToLoanTypeFixture);

      // update loan pool caps
      const rewardCollateralSpeed = BigInt(0.00015e18);
      const rewardBorrowSpeed = BigInt(0.00005e18);
      const rewardMinimumAmount = BigInt(3e18);
      const updateRewardParams = loanManagerState
        .connect(user)
        .updateRewardParams(loanTypeId, poolId, rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
      await expect(updateRewardParams)
        .to.be.revertedWithCustomError(loanManagerState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, LISTING_ROLE);
    });
  });

  describe("Get Loan Pool", () => {
    it("Should fail to get loan pool when loan type unknown", async () => {
      const { admin, loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // verify unknown
      const loanTypeId = 32;
      expect(await loanManagerState.isLoanTypeCreated(loanTypeId)).to.be.false;

      // get loan pool
      const poolId = 1;
      const getLoanPool = loanManagerState.connect(admin).getLoanPool(loanTypeId, poolId);
      await expect(getLoanPool).to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown").withArgs(loanTypeId);
    });

    it("Should fail to get loan pool when loan pool unknown", async () => {
      const { admin, loanManagerState, loanTypeId } = await loadFixture(createLoanTypeFixture);

      // verify unknown
      const poolId = 32;
      expect(await loanManagerState.isPoolAdded(loanTypeId)).to.be.false;

      // get loan pool
      const getLoanPool = loanManagerState.connect(admin).getLoanPool(loanTypeId, poolId);
      await expect(getLoanPool)
        .to.be.revertedWithCustomError(loanManagerState, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });
  });

  describe("Get User Loan", () => {
    it("Should successfuly get user loan", async () => {
      const { loanManagerState } = await loadFixture(deployLoanManagerStateExposedFixture);

      // set user loan
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const isActive = true;
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const loanTypeId = 4;
      const colPools = [5, 1];
      const borPools = [0];
      const collaterals: UserLoanCollateral[] = [
        {
          balance: BigInt(0.5e18),
          rewardIndex: BigInt(100),
        },
        {
          balance: BigInt(1e18),
          rewardIndex: BigInt(0),
        },
      ];
      const borrows: UserLoanBorrow[] = [
        {
          amount: BigInt(0.1e18),
          balance: BigInt(0.11e18),
          lastInterestIndex: BigInt(1.2e18),
          stableInterestRate: BigInt(0.05e18),
          lastStableUpdateTimestamp: BigInt(unixTime() - SECONDS_IN_DAY),
          rewardIndex: BigInt(50),
        },
      ];
      await loanManagerState.setUserLoan(
        loanId,
        isActive,
        accountId,
        loanTypeId,
        colPools,
        borPools,
        collaterals,
        borrows
      );

      // get user loan
      const userLoan = await loanManagerState.getUserLoan(loanId);
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal(colPools);
      expect(userLoan[3]).to.deep.equal(borPools);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));
    });

    it("Should fail to get user loan when inactive", async () => {
      const { loanManagerState } = await loadFixture(deployLoanManagerStateExposedFixture);

      // set user loan
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const isActive = false;
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const loanTypeId = 4;
      const colPools: bigint[] = [];
      const borPools: bigint[] = [];
      const collaterals: UserLoanCollateral[] = [];
      const borrows: UserLoanBorrow[] = [];
      await loanManagerState.setUserLoan(
        loanId,
        isActive,
        accountId,
        loanTypeId,
        colPools,
        borPools,
        collaterals,
        borrows
      );

      // get user loan
      const getUserLoan = loanManagerState.getUserLoan(loanId);
      await expect(getUserLoan).to.be.revertedWithCustomError(loanManagerState, "UserLoanInactive").withArgs(loanId);
    });
  });

  describe("Get User Pool Rewards", () => {
    it("Should successfully get user pool rewards", async () => {
      const { loanManagerState } = await loadFixture(deployLoanManagerStateExposedFixture);

      // set user pool rewards
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const poolId = 1;
      const rewards: UserPoolRewards = {
        collateral: BigInt(100),
        borrow: BigInt(50),
        interestPaid: BigInt(10),
      };
      await loanManagerState.setUserPoolRewards(accountId, poolId, rewards);

      // get user pool rewards
      const userPoolRewards = await loanManagerState.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal(Object.values(rewards));
    });
  });

  describe("Get Loan Type Loan Target Health", () => {
    it("Should fail when loan type unknown", async () => {
      const { loanManagerState } = await loadFixture(deployLoanManagerStateFixture);

      // get loan type loan target health
      const loanTypeId = 1;
      const getLoanTypeLoanTargetHealth = loanManagerState.getLoanTypeLoanTargetHealth(loanTypeId);
      await expect(getLoanTypeLoanTargetHealth).to.be.revertedWithCustomError(loanManagerState, "LoanTypeUnknown");
    });
  });
});
