import { expect } from "chai";
import { ethers } from "hardhat";
import { PANIC_CODES } from "@nomicfoundation/hardhat-chai-matchers/panic";
import { loadFixture, reset, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  LiquidationLogic__factory,
  LoanManagerLogic__factory,
  LoanManager__factory,
  LoanPoolLogic__factory,
  MockHubPool__factory,
  MockOracleManager__factory,
  RewardLogic__factory,
  UserLoanLogic__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  BYTES4_LENGTH,
  convertStringToBytes,
  generateLoanId,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomBytes,
} from "../utils/bytes";
import { SECONDS_IN_DAY, SECONDS_IN_HOUR, getLatestBlockTimestamp, getRandomInt } from "../utils/time";
import { UserLoanBorrow, UserLoanCollateral } from "./libraries/assets/loanData";
import { getNodeOutputData } from "./libraries/assets/oracleData";
import {
  calcAverageStableRate,
  calcBorrowBalance,
  calcBorrowInterestIndex,
  calcReserveCol,
  calcStableInterestRate,
  convToCollateralFAmount,
  convToRepayBorrowAmount,
  convToSeizedCollateralAmount,
  toFAmount,
  toUnderlingAmount,
} from "./utils/formulae";

describe("LoanManager (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const LISTING_ROLE = ethers.keccak256(convertStringToBytes("LISTING"));
  const ORACLE_ROLE = ethers.keccak256(convertStringToBytes("ORACLE"));
  const HUB_ROLE = ethers.keccak256(convertStringToBytes("HUB"));
  const REBALANCER_ROLE = ethers.keccak256(convertStringToBytes("REBALANCER"));

  async function deployLoanManagerFixture() {
    const [admin, hub, rebalancer, user, ...unusedUsers] = await ethers.getSigners();

    // libraries
    const userLoanLogic = await new UserLoanLogic__factory(user).deploy();
    const userLoanLogicAddress = await userLoanLogic.getAddress();
    const loanPoolLogic = await new LoanPoolLogic__factory(user).deploy();
    const loanPoolLogicAddress = await loanPoolLogic.getAddress();
    const liquidationLogic = await new LiquidationLogic__factory(
      {
        ["contracts/hub/logic/UserLoanLogic.sol:UserLoanLogic"]: userLoanLogicAddress,
      },
      user
    ).deploy();
    const liquidationLogicAddress = await liquidationLogic.getAddress();
    const loanManagerLogic = await new LoanManagerLogic__factory(
      {
        ["contracts/hub/logic/UserLoanLogic.sol:UserLoanLogic"]: userLoanLogicAddress,
        ["contracts/hub/logic/LoanPoolLogic.sol:LoanPoolLogic"]: loanPoolLogicAddress,
        ["contracts/hub/logic/LiquidationLogic.sol:LiquidationLogic"]: liquidationLogicAddress,
      },
      user
    ).deploy();
    const loanManagerLogicAddress = await loanManagerLogic.getAddress();
    const rewardLogic = await new RewardLogic__factory(user).deploy();
    const rewardLogicAddress = await rewardLogic.getAddress();

    const libraries = {
      userLoanLogic,
      loanPoolLogic,
      liquidationLogic,
      loanManagerLogic,
      rewardLogic,
    };

    // deploy contract
    const oracleManager = await new MockOracleManager__factory(user).deploy();
    const loanManager = await new LoanManager__factory(
      {
        ["contracts/hub/logic/LoanManagerLogic.sol:LoanManagerLogic"]: loanManagerLogicAddress,
        ["contracts/hub/logic/RewardLogic.sol:RewardLogic"]: rewardLogicAddress,
      },
      user
    ).deploy(admin, oracleManager);

    // set hub and rebalance role
    await loanManager.connect(admin).grantRole(HUB_ROLE, hub);
    await loanManager.connect(admin).grantRole(REBALANCER_ROLE, rebalancer);

    // common
    const loanManagerAddress = await loanManager.getAddress();

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
    };
  }

  async function createLoanTypeFixture() {
    const { admin, hub, rebalancer, user, unusedUsers, loanManager, loanManagerAddress, oracleManager, libraries } =
      await loadFixture(deployLoanManagerFixture);

    // create loan type
    const loanTypeId = 1;
    const loanTargetHealth = BigInt(1.05e4);
    await loanManager.connect(admin).createLoanType(loanTypeId, loanTargetHealth);

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      loanTargetHealth,
    };
  }

  async function deprecateLoanTypeFixture() {
    const { admin, hub, user, unusedUsers, loanManager, loanTypeId } = await loadFixture(createLoanTypeFixture);

    // deprecate loan type
    await loanManager.connect(admin).deprecateLoanType(loanTypeId);

    return {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanTypeId,
    };
  }

  async function addPoolsFixture() {
    const {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
    } = await loadFixture(createLoanTypeFixture);

    // prepare pools
    const usdcPoolId = 1;
    const usdcPool = await new MockHubPool__factory(user).deploy("Folks USD Coin", "fUSDC", usdcPoolId);
    const ethPoolId = 2;
    const ethPool = await new MockHubPool__factory(user).deploy("Folks Ethereum", "fETH", ethPoolId);

    // add pools
    await loanManager.connect(admin).addPool(usdcPool);
    await loanManager.connect(admin).addPool(ethPool);

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      usdcPoolId,
      usdcPool,
      ethPoolId,
      ethPool,
    };
  }

  async function addPoolToLoanTypeFixture() {
    const {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      usdcPoolId,
      usdcPool,
      ethPoolId,
      ethPool,
    } = await loadFixture(addPoolsFixture);

    // add pools to loan type
    const rewardCollateralSpeed = BigInt(0);
    const rewardBorrowSpeed = BigInt(0);
    const rewardMinimumAmount = BigInt(1e18);
    const collateralCap = BigInt(20e6);
    const borrowCap = BigInt(10e6);

    const usdcCollateralFactor = BigInt(0.8e4);
    const usdcBorrowFactor = BigInt(1e4);
    const usdcLiquidationBonus = BigInt(0.04e4);
    const usdcLiquidationFee = BigInt(0.1e4);

    const ethCollateralFactor = BigInt(0.7e4);
    const ethBorrowFactor = BigInt(1e4);
    const ethLiquidationBonus = BigInt(0.06e4);
    const ethLiquidationFee = BigInt(0.1e4);

    const pools = {
      USDC: {
        poolId: usdcPoolId,
        pool: usdcPool,
        rewardCollateralSpeed,
        rewardBorrowSpeed,
        rewardMinimumAmount,
        collateralCap,
        borrowCap,
        collateralFactor: usdcCollateralFactor,
        borrowFactor: usdcBorrowFactor,
        liquidationBonus: usdcLiquidationBonus,
        liquidationFee: usdcLiquidationFee,
        tokenDecimals: BigInt(6),
      },
      ETH: {
        poolId: ethPoolId,
        pool: ethPool,
        rewardCollateralSpeed,
        rewardBorrowSpeed,
        rewardMinimumAmount,
        collateralCap,
        borrowCap,
        collateralFactor: ethCollateralFactor,
        borrowFactor: ethBorrowFactor,
        liquidationBonus: ethLiquidationBonus,
        liquidationFee: ethLiquidationFee,
        tokenDecimals: BigInt(18),
      },
    };

    await loanManager
      .connect(admin)
      .addPoolToLoanType(
        loanTypeId,
        usdcPoolId,
        usdcCollateralFactor,
        collateralCap,
        usdcBorrowFactor,
        borrowCap,
        usdcLiquidationBonus,
        usdcLiquidationFee,
        rewardCollateralSpeed,
        rewardBorrowSpeed,
        rewardMinimumAmount
      );
    await loanManager
      .connect(admin)
      .addPoolToLoanType(
        loanTypeId,
        ethPoolId,
        ethCollateralFactor,
        collateralCap,
        ethBorrowFactor,
        borrowCap,
        ethLiquidationBonus,
        ethLiquidationFee,
        rewardCollateralSpeed,
        rewardBorrowSpeed,
        rewardMinimumAmount
      );

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
    };
  }

  async function createUserLoanFixture() {
    const {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
    } = await loadFixture(addPoolToLoanTypeFixture);

    // create user loan
    const accountId = getAccountIdBytes("ACCOUNT_ID");
    const nonce = getRandomBytes(BYTES4_LENGTH);
    const loanId = generateLoanId(accountId, nonce);
    const loanName = getRandomBytes(BYTES32_LENGTH);
    const createUserLoan = await loanManager.connect(hub).createUserLoan(nonce, accountId, loanTypeId, loanName);

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      createUserLoan,
      loanTypeId,
      pools,
      nonce,
      loanId,
      accountId,
      loanName,
    };
  }

  async function depositEtherFixture() {
    const {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
      loanId,
      accountId,
    } = await loadFixture(createUserLoanFixture);

    // prepare deposit
    const depositAmount = BigInt(1e18); // 1 ETH
    const depositFAmount = depositAmount;
    const depositInterestIndex = BigInt(1e18);
    const ethPrice = BigInt(3000e18);
    await pools.ETH.pool.setDepositPoolParams({
      fAmount: depositFAmount,
      depositInterestIndex,
      priceFeed: { price: ethPrice, decimals: pools.ETH.tokenDecimals },
    });

    // deposit into eth pool
    const deposit = await loanManager.connect(hub).deposit(loanId, accountId, pools.ETH.poolId, depositAmount);

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      deposit,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
    };
  }

  async function depositFEtherFixture() {
    const {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
      loanId,
      accountId,
    } = await loadFixture(createUserLoanFixture);

    // prepare deposit f token
    const nodeOutputData = getNodeOutputData(BigInt(3000e18));

    await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, nodeOutputData);
    const depositFAmount = BigInt(1e18);
    const depositInterestIndex = BigInt(1e18);
    await pools.ETH.pool.setUpdatedDepositInterestIndex(depositInterestIndex);

    // deposit into eth pool
    const depositFToken = await loanManager
      .connect(hub)
      .depositFToken(loanId, accountId, pools.ETH.poolId, user.address, depositFAmount);

    return {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      depositFToken,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositFAmount,
    };
  }

  async function depositEtherAndVariableBorrowUSDCFixture() {
    const {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
    } = await loadFixture(depositEtherFixture);

    // set prices
    const usdcNodeOutputData = getNodeOutputData(BigInt(1e18));
    await oracleManager.setNodeOutput(pools.USDC.poolId, pools.USDC.tokenDecimals, usdcNodeOutputData);

    const ethNodeOutputData = getNodeOutputData(BigInt(3000e18));
    await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

    // prepare borrow
    const variableInterestIndex = BigInt(1.05e18);
    const stableInterestRate = BigInt(0.1e18);
    await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
    await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

    // borrow from USDC pool
    const borrowAmount = BigInt(1000e6); // 1000 USDC
    const borrow = await loanManager.connect(hub).borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      borrow,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
      borrowAmount,
      usdcVariableInterestIndex: variableInterestIndex,
      usdcStableInterestRate: stableInterestRate,
    };
  }

  async function depositEtherAndStableBorrowUSDCFixture() {
    const {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
    } = await loadFixture(depositEtherFixture);

    // set prices
    const usdcNodeOutputData = getNodeOutputData(BigInt(1e18));
    await oracleManager.setNodeOutput(pools.USDC.poolId, pools.USDC.tokenDecimals, usdcNodeOutputData);

    const ethNodeOutputData = getNodeOutputData(BigInt(3000e18));
    await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

    // prepare borrow
    const variableInterestIndex = BigInt(1.05e18);
    const stableInterestRate = BigInt(0.1e18);
    await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
    await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

    // borrow from USDC pool
    const borrowAmount = BigInt(1000e6); // 1000 USDC
    const borrow = await loanManager
      .connect(hub)
      .borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, stableInterestRate);

    return {
      admin,
      hub,
      rebalancer,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      borrow,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
      borrowAmount,
      usdcVariableInterestIndex: variableInterestIndex,
      usdcStableInterestRate: stableInterestRate,
    };
  }

  async function depositEtherAndVariableBorrowEtherFixture() {
    const {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
    } = await loadFixture(depositEtherFixture);

    // set prices
    const ethNodeOutputData = getNodeOutputData(BigInt(3000e18));
    await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

    // prepare borrow
    const variableInterestIndex = BigInt(1.05e18);
    const stableInterestRate = BigInt(0.08e18);
    await pools.ETH.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
    await pools.ETH.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

    // borrow from ETH pool
    const borrowAmount = BigInt(0.5e18); // 0.5 ETH
    const borrow = await loanManager.connect(hub).borrow(loanId, accountId, pools.ETH.poolId, borrowAmount, BigInt(0));

    return {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      libraries,
      borrow,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
      borrowAmount,
      ethVariableInterestIndex: variableInterestIndex,
    };
  }

  async function depositEtherAndStableBorrowEtherFixture() {
    const {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      oracleManager,
      libraries,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
    } = await loadFixture(depositEtherFixture);

    // set prices
    const ethNodeOutputData = getNodeOutputData(BigInt(3000e18));
    await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

    // prepare borrow
    const variableInterestIndex = BigInt(1.05e18);
    const stableInterestRate = BigInt(0.08e18);
    await pools.ETH.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
    await pools.ETH.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

    // borrow from ETH pool
    const borrowAmount = BigInt(0.5e18); // 0.5 ETH
    const borrow = await loanManager
      .connect(hub)
      .borrow(loanId, accountId, pools.ETH.poolId, borrowAmount, stableInterestRate);

    return {
      admin,
      hub,
      user,
      unusedUsers,
      loanManager,
      loanManagerAddress,
      libraries,
      borrow,
      loanTypeId,
      pools,
      loanId,
      accountId,
      depositAmount,
      depositFAmount,
      borrowAmount,
      ethStableInterestRate: stableInterestRate,
    };
  }

  // clear timestamp changes
  after(async () => {
    await reset();
  });

  describe("Deployment", () => {
    it("Should set admin and contracts correctly", async () => {
      const { admin, hub, loanManager, oracleManager } = await loadFixture(deployLoanManagerFixture);

      // check default admin role
      expect(await loanManager.owner()).to.equal(admin.address);
      expect(await loanManager.defaultAdmin()).to.equal(admin.address);
      expect(await loanManager.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await loanManager.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check other roles
      expect(await loanManager.getRoleAdmin(LISTING_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManager.hasRole(LISTING_ROLE, admin.address)).to.be.true;
      expect(await loanManager.getRoleAdmin(ORACLE_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManager.hasRole(ORACLE_ROLE, admin.address)).to.be.true;
      expect(await loanManager.getRoleAdmin(HUB_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManager.hasRole(HUB_ROLE, hub.address)).to.be.true;
      expect(await loanManager.getRoleAdmin(REBALANCER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await loanManager.hasRole(REBALANCER_ROLE, admin.address)).to.be.false;

      // check state
      expect(await loanManager.getOracleManager()).to.equal(oracleManager);
    });
  });

  describe("Get pool", () => {
    it("Should successfully get pool", async () => {
      const { loanManager, usdcPoolId, usdcPool } = await loadFixture(addPoolsFixture);

      // get pool
      const pool = await loanManager.getPool(usdcPoolId);
      expect(pool).to.equal(usdcPool);
    });

    it("Should fail to get pool when pool id is unknown", async () => {
      const { loanManager } = await loadFixture(deployLoanManagerFixture);

      // get pool
      const poolId = 1;
      const getPool = loanManager.getPool(poolId);
      await expect(getPool).to.be.revertedWithCustomError(loanManager, "PoolUnknown").withArgs(poolId);
    });
  });

  describe("Create User Loan", () => {
    it("Should successfully create user loan", async () => {
      const { loanManager, createUserLoan, loanId, accountId, loanTypeId, loanName } =
        await loadFixture(createUserLoanFixture);

      // verify user loan is created
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([]);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal([]);
      expect(userLoan[5]).to.deep.equal([]);
      await expect(createUserLoan)
        .to.emit(loanManager, "CreateUserLoan")
        .withArgs(loanId, accountId, loanTypeId, loanName);
    });

    it("Should fail to create user loan when loan type unknown", async () => {
      const { hub, loanManager } = await loadFixture(deployLoanManagerFixture);

      // verify loan type unknown
      const loanTypeId = 1;
      expect(await loanManager.isLoanTypeCreated(loanTypeId)).to.be.false;

      // create user loan
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const createUserLoan = loanManager.connect(hub).createUserLoan(nonce, accountId, loanTypeId, loanName);
      await expect(createUserLoan).to.be.revertedWithCustomError(loanManager, "LoanTypeUnknown").withArgs(loanTypeId);
    });

    it("Should fail to create user loan when loan type deprecated", async () => {
      const { hub, loanManager, loanTypeId } = await loadFixture(deprecateLoanTypeFixture);

      // verify loan type deprecated
      expect(await loanManager.isLoanTypeDeprecated(loanTypeId)).to.be.true;

      // create user loan
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const createUserLoan = loanManager.connect(hub).createUserLoan(nonce, accountId, loanTypeId, loanName);
      await expect(createUserLoan)
        .to.be.revertedWithCustomError(loanManager, "LoanTypeDeprecated")
        .withArgs(loanTypeId);
    });

    it("Should fail to create user loan when already created", async () => {
      const { hub, loanManager, nonce, loanId, accountId, loanTypeId, loanName } =
        await loadFixture(createUserLoanFixture);

      // verify already created
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;

      // create user loan
      const createUserLoan = loanManager.connect(hub).createUserLoan(nonce, accountId, loanTypeId, loanName);
      await expect(createUserLoan)
        .to.be.revertedWithCustomError(loanManager, "UserLoanAlreadyCreated")
        .withArgs(loanId);
    });

    it("Should fail to create user loan when sender is not hub", async () => {
      const { user, loanManager, loanTypeId } = await loadFixture(addPoolsFixture);

      // create user loan
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const createUserLoan = loanManager.connect(user).createUserLoan(nonce, accountId, loanTypeId, loanName);
      await expect(createUserLoan)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Delete User Loan", () => {
    it("Should successfully delete user loan", async () => {
      const { hub, loanManager, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // delete user loan
      const deleteUserLoan = await loanManager.connect(hub).deleteUserLoan(loanId, accountId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;
      await expect(loanManager.getUserLoan(loanId)).to.reverted;
      await expect(deleteUserLoan).to.emit(loanManager, "DeleteUserLoan").withArgs(loanId, accountId);
    });

    it("Should fail to delete when user loan is unknown", async () => {
      const { hub, loanManager, accountId } = await loadFixture(createUserLoanFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // delete user loan
      const deleteUserLoan = loanManager.connect(hub).deleteUserLoan(loanId, accountId);
      await expect(deleteUserLoan).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to delete user loan when user is not owner", async () => {
      const { hub, loanManager, loanId } = await loadFixture(createUserLoanFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // delete user loan
      const deleteUserLoan = loanManager.connect(hub).deleteUserLoan(loanId, accountId);
      await expect(deleteUserLoan)
        .to.be.revertedWithCustomError(loanManager, "NotAccountOwner")
        .withArgs(loanId, accountId);
    });

    it("Should fail to delete user loan when not empty", async () => {
      const { hub, loanManager, loanId, accountId } = await loadFixture(depositEtherFixture);

      // delete user loan
      const deleteUserLoan = loanManager.connect(hub).deleteUserLoan(loanId, accountId);
      await expect(deleteUserLoan).to.be.revertedWithCustomError(loanManager, "LoanNotEmpty").withArgs(loanId);
    });

    it("Should fail to delete user loan when sender is not hub", async () => {
      const { user, loanManager, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // delete user loan
      const deleteUserLoan = loanManager.connect(user).deleteUserLoan(loanId, accountId);
      await expect(deleteUserLoan)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Deposit", () => {
    it("Should successfully do new deposit", async () => {
      const {
        loanManager,
        loanManagerAddress,
        deposit,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositAmount,
        depositFAmount,
      } = await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.ETH;

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(deposit).to.emit(pool, "UpdatePoolWithDeposit").withArgs(depositAmount);
      await expect(deposit).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(deposit)
        .to.emit(loanManagerLogic, "Deposit")
        .withArgs(loanId, poolId, depositAmount, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully handle zero deposit", async () => {
      const { hub, loanManager, loanManagerAddress, loanTypeId, pools, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      // prepare deposit
      const depositAmount = BigInt(0);
      const depositFAmount = depositAmount;
      const depositInterestIndex = BigInt(1e18);
      const ethPrice = BigInt(3000e18);
      await pools.ETH.pool.setDepositPoolParams({
        fAmount: depositFAmount,
        depositInterestIndex,
        priceFeed: { price: ethPrice, decimals: pools.ETH.tokenDecimals },
      });

      // deposit into eth pool
      const deposit = await loanManager.connect(hub).deposit(loanId, accountId, pools.ETH.poolId, depositAmount);

      const { pool, poolId } = pools.ETH;

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(deposit).to.emit(pool, "UpdatePoolWithDeposit").withArgs(depositAmount);
      await expect(deposit).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(deposit)
        .to.emit(loanManagerLogic, "Deposit")
        .withArgs(loanId, poolId, depositAmount, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully increase deposit", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount: oldDepositFAmount,
      } = await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare deposit
      const depositAmount = BigInt(0.5e18); // 1 ETH
      const depositInterestIndex = BigInt(1.1e18);
      const depositFAmount = toFAmount(depositAmount, depositInterestIndex);
      const ethPrice = BigInt(3000e18);
      await pool.setDepositPoolParams({
        fAmount: depositFAmount,
        depositInterestIndex,
        priceFeed: { price: ethPrice, decimals: pools.ETH.tokenDecimals },
      });

      // deposit into eth pool
      const deposit = await loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(deposit).to.emit(pool, "UpdatePoolWithDeposit").withArgs(depositAmount);
      await expect(deposit).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(deposit)
        .to.emit(loanManagerLogic, "Deposit")
        .withArgs(loanId, poolId, depositAmount, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: oldDepositFAmount + depositFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(oldDepositFAmount + depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully do second deposit", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount: ethDepositFAmount,
      } = await loadFixture(depositEtherFixture);

      const { pool, poolId, tokenDecimals } = pools.USDC;

      // prepare deposit
      const depositAmount = BigInt(500e6); // 500 USDC
      const depositInterestIndex = BigInt(1.05e18);
      const depositFAmount = toFAmount(depositAmount, depositInterestIndex);
      const usdcPrice = BigInt(1e18);
      await pool.setDepositPoolParams({
        fAmount: depositFAmount,
        depositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: tokenDecimals },
      });

      // deposit into usdc pool
      const deposit = await loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(deposit).to.emit(pool, "UpdatePoolWithDeposit").withArgs(depositAmount);
      await expect(deposit).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(deposit)
        .to.emit(loanManagerLogic, "Deposit")
        .withArgs(loanId, poolId, depositAmount, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: ethDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: depositFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([pools.ETH.poolId, poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should fail to deposit when user loan is unknown", async () => {
      const { hub, loanManager, pools, accountId } = await loadFixture(createUserLoanFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // deposit
      const depositAmount = BigInt(1e18);
      const deposit = loanManager.connect(hub).deposit(loanId, accountId, pools.ETH.poolId, depositAmount);
      await expect(deposit).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to deposit when user is not owner", async () => {
      const { hub, loanManager, pools, loanId } = await loadFixture(createUserLoanFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // deposit
      const depositAmount = BigInt(1e18);
      const deposit = loanManager.connect(hub).deposit(loanId, accountId, pools.ETH.poolId, depositAmount);
      await expect(deposit).to.be.revertedWithCustomError(loanManager, "NotAccountOwner").withArgs(loanId, accountId);
    });

    it("Should fail to deposit when loan type deprecated", async () => {
      const { admin, hub, loanManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      // verify loan type deprecated
      await loanManager.connect(admin).deprecateLoanType(loanTypeId);
      expect(await loanManager.isLoanTypeDeprecated(loanTypeId)).to.be.true;

      // deposit
      const depositAmount = BigInt(1e18);
      const deposit = loanManager.connect(hub).deposit(loanId, accountId, pools.ETH.poolId, depositAmount);
      await expect(deposit).to.be.revertedWithCustomError(loanManager, "LoanTypeDeprecated").withArgs(loanTypeId);
    });

    it("Should fail to deposit when loan pool unknown", async () => {
      const { hub, loanManager, loanTypeId, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // verify loan pool unknown
      const poolId = 33;
      expect(await loanManager.isPoolInLoanType(loanTypeId, poolId)).to.be.false;

      // deposit
      const depositAmount = BigInt(1e18);
      const deposit = loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);
      await expect(deposit).to.be.revertedWithCustomError(loanManager, "LoanPoolUnknown").withArgs(loanTypeId, poolId);
    });

    it("Should fail to deposit when loan pool deprecated", async () => {
      const { admin, hub, loanManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      // verify loan pool deprecated
      const poolId = pools.ETH.poolId;
      await loanManager.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);
      expect(await loanManager.isPoolInLoanTypeDeprecated(loanTypeId, poolId)).to.be.true;

      // deposit
      const depositAmount = BigInt(1e18);
      const deposit = loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);
      await expect(deposit)
        .to.be.revertedWithCustomError(loanManager, "LoanPoolDeprecated")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to deposit when loan pool collateral cap is exceeded", async () => {
      const { admin, hub, loanManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      // set cap
      const poolId = pools.ETH.poolId;
      const collateralCap = BigInt(3000); // $3000
      const borrowCap = BigInt(0);
      await loanManager.connect(admin).updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);

      // prepare deposit
      const depositAmount = BigInt(1e18);
      const depositFAmount = depositAmount;
      const depositInterestIndex = BigInt(1e18);
      let ethPrice = BigInt(3000.1e18);
      await pools.ETH.pool.setDepositPoolParams({
        fAmount: depositFAmount,
        depositInterestIndex,
        priceFeed: { price: ethPrice, decimals: pools.ETH.tokenDecimals },
      });

      // deposit when collateral cap exceeded
      const deposit = loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);
      await expect(deposit).to.be.revertedWithCustomError(loanManager, "CollateralCapReached").withArgs(poolId);

      // deposit when collateral cap okay
      ethPrice = BigInt(3000e18);
      await pools.ETH.pool.setDepositPoolParams({
        fAmount: depositFAmount,
        depositInterestIndex,
        priceFeed: { price: ethPrice, decimals: pools.ETH.tokenDecimals },
      });
      await loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);
    });

    it("Should fail to deposit when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // deposit
      const depositAmount = BigInt(1e18);
      const deposit = loanManager.connect(user).deposit(loanId, accountId, pools.ETH.poolId, depositAmount);
      await expect(deposit)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Deposit F Token", () => {
    it("Should successfully do new deposit f token", async () => {
      const {
        user,
        loanManager,
        loanManagerAddress,
        depositFToken,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
      } = await loadFixture(depositFEtherFixture);

      const { pool, poolId } = pools.ETH;

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(depositFToken)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(depositFToken).to.emit(pool, "BurnFToken").withArgs(user.address, depositFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(depositFToken).to.emit(loanManagerLogic, "DepositFToken").withArgs(loanId, poolId, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully increase deposit with deposit f token", async () => {
      const {
        user,
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount: oldDepositFAmount,
      } = await loadFixture(depositFEtherFixture);

      const { pool, poolId, tokenDecimals } = pools.ETH;

      // prepare deposit f token
      const nodeOutputData = getNodeOutputData(BigInt(3000e18));
      await oracleManager.setNodeOutput(poolId, tokenDecimals, nodeOutputData);
      const depositFAmount = BigInt(2e18);
      const depositInterestIndex = BigInt(1.1e18);
      await pool.setUpdatedDepositInterestIndex(depositInterestIndex);

      // deposit into eth pool
      const depositFToken = await loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, poolId, user.address, depositFAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(depositFToken)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(depositFToken).to.emit(pool, "BurnFToken").withArgs(user.address, depositFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(depositFToken).to.emit(loanManagerLogic, "DepositFToken").withArgs(loanId, poolId, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: oldDepositFAmount + depositFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(oldDepositFAmount + depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully do second deposit with deposit f token", async () => {
      const {
        user,
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount: ethDepositFAmount,
      } = await loadFixture(depositFEtherFixture);

      const { pool, poolId, tokenDecimals } = pools.USDC;

      // prepare deposit f token
      const nodeOutputData = getNodeOutputData(BigInt(1e18));
      await oracleManager.setNodeOutput(poolId, tokenDecimals, nodeOutputData);
      const depositAmount = BigInt(500e6); // 500 USDC
      const depositInterestIndex = BigInt(1.05e18);
      const depositFAmount = toFAmount(depositAmount, depositInterestIndex);
      await pool.setUpdatedDepositInterestIndex(depositInterestIndex);

      // deposit into usdc pool
      const depositFToken = await loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, poolId, user.address, depositFAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(depositFToken)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(depositFToken).to.emit(pool, "BurnFToken").withArgs(user.address, depositFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(depositFToken).to.emit(loanManagerLogic, "DepositFToken").withArgs(loanId, poolId, depositFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: ethDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: depositFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([pools.ETH.poolId, poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should fail to deposit f token when user loan is unknown", async () => {
      const { user, hub, loanManager, pools, accountId } = await loadFixture(createUserLoanFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // deposit f token
      const depositFAmount = BigInt(0.1e18);
      const depositFToken = loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, pools.ETH.poolId, user.address, depositFAmount);
      await expect(depositFToken).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to deposit f token when user is not owner", async () => {
      const { user, hub, loanManager, pools, loanId } = await loadFixture(createUserLoanFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // deposit f token
      const depositFAmount = BigInt(0.1e18);
      const depositFToken = loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, pools.ETH.poolId, user.address, depositFAmount);
      await expect(depositFToken)
        .to.be.revertedWithCustomError(loanManager, "NotAccountOwner")
        .withArgs(loanId, accountId);
    });

    it("Should fail to deposit f token when loan type deprecated", async () => {
      const { user, admin, hub, loanManager, pools, loanTypeId, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      // verify loan type deprecated
      await loanManager.connect(admin).deprecateLoanType(loanTypeId);
      expect(await loanManager.isLoanTypeDeprecated(loanTypeId)).to.be.true;

      // deposit f token
      const depositFAmount = BigInt(0.1e18);
      const depositFToken = loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, pools.ETH.poolId, user.address, depositFAmount);
      await expect(depositFToken).to.be.revertedWithCustomError(loanManager, "LoanTypeDeprecated").withArgs(loanTypeId);
    });

    it("Should fail to deposit f token when loan pool unknown", async () => {
      const { user, hub, loanManager, loanTypeId, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // verify loan pool unknown
      const poolId = 33;
      expect(await loanManager.isPoolInLoanType(loanTypeId, poolId)).to.be.false;

      // deposit f token
      const depositFAmount = BigInt(0.1e18);
      const depositFToken = loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, poolId, user.address, depositFAmount);
      await expect(depositFToken)
        .to.be.revertedWithCustomError(loanManager, "LoanPoolUnknown")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to deposit f token when loan pool deprecated", async () => {
      const { user, admin, hub, loanManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      // verify loan pool deprecated
      const poolId = pools.ETH.poolId;
      await loanManager.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);
      expect(await loanManager.isPoolInLoanTypeDeprecated(loanTypeId, poolId)).to.be.true;

      // deposit f token
      const depositFAmount = BigInt(0.1e18);
      const depositFToken = loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, poolId, user.address, depositFAmount);
      await expect(depositFToken)
        .to.be.revertedWithCustomError(loanManager, "LoanPoolDeprecated")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to deposit f token when loan pool collateral cap is exceeded", async () => {
      const { user, admin, hub, loanManager, oracleManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(createUserLoanFixture);

      const { pool, poolId, tokenDecimals } = pools.ETH;

      // set cap
      const collateralCap = BigInt(3000); // $3000
      const borrowCap = BigInt(0);
      await loanManager.connect(admin).updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);

      // prepare deposit f token
      const nodeOutputData = getNodeOutputData(BigInt(3000.1e18));
      await oracleManager.setNodeOutput(poolId, tokenDecimals, nodeOutputData);
      const depositFAmount = BigInt(0.5e18);
      const depositInterestIndex = BigInt(2e18);
      await pool.setUpdatedDepositInterestIndex(depositInterestIndex);

      // deposit when collateral cap exceeded
      const depositFToken = loanManager
        .connect(hub)
        .depositFToken(loanId, accountId, poolId, user.address, depositFAmount);
      await expect(depositFToken).to.be.revertedWithCustomError(loanManager, "CollateralCapReached").withArgs(poolId);

      // deposit when collateral cap okay
      nodeOutputData.price = BigInt(3000e18);
      await oracleManager.setNodeOutput(poolId, tokenDecimals, nodeOutputData);
      await loanManager.connect(hub).depositFToken(loanId, accountId, poolId, user.address, depositFAmount);
    });

    it("Should fail to deposit f token when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // deposit f token
      const depositFAmount = BigInt(0.1e18);
      const depositFToken = loanManager
        .connect(user)
        .depositFToken(loanId, accountId, pools.ETH.poolId, user.address, depositFAmount);
      await expect(depositFToken)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Withdraw", () => {
    it("Should successfully fully withdraw", async () => {
      const { hub, loanManager, loanManagerAddress, loanTypeId, pools, loanId, accountId, depositFAmount } =
        await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare withdraw
      const depositInterestIndex = BigInt(1.05e18);
      const withdrawFAmount = depositFAmount;
      const withdrawAmount = toUnderlingAmount(withdrawFAmount, depositInterestIndex);

      await pool.setWithdrawPoolParams({ underlingAmount: withdrawAmount, fAmount: withdrawFAmount });

      // withdraw from eth pool
      const isFAmount = true;
      const withdraw = await loanManager.connect(hub).withdraw(loanId, accountId, poolId, withdrawFAmount, isFAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(withdraw).to.emit(pool, "UpdatePoolWithWithdraw").withArgs(withdrawFAmount, isFAmount);
      await expect(withdraw).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdraw)
        .to.emit(loanManagerLogic, "Withdraw")
        .withArgs(loanId, poolId, withdrawAmount, withdrawFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);

      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully partially withdraw", async () => {
      const { hub, loanManager, loanManagerAddress, loanTypeId, pools, loanId, accountId, depositFAmount } =
        await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare withdraw
      const withdrawAmount = BigInt(0.5e18);
      const withdrawFAmount = withdrawAmount;
      await pool.setWithdrawPoolParams({ underlingAmount: withdrawAmount, fAmount: withdrawFAmount });

      // withdraw from eth pool
      const isFAmount = false;
      const withdraw = await loanManager.connect(hub).withdraw(loanId, accountId, poolId, withdrawAmount, isFAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(withdraw).to.emit(pool, "UpdatePoolWithWithdraw").withArgs(withdrawAmount, isFAmount);
      await expect(withdraw).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdraw)
        .to.emit(loanManagerLogic, "Withdraw")
        .withArgs(loanId, poolId, withdrawAmount, withdrawFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - withdrawFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount - withdrawFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should fail to withdraw when user loan is unknown", async () => {
      const { hub, loanManager, pools, accountId } = await loadFixture(depositEtherFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // withdraw
      const withdrawAmount = BigInt(0.5e18);
      const isFAmount = false;
      const withdraw = loanManager
        .connect(hub)
        .withdraw(loanId, accountId, pools.ETH.poolId, withdrawAmount, isFAmount);
      await expect(withdraw).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to withdraw when user is not owner", async () => {
      const { hub, loanManager, pools, loanId } = await loadFixture(depositEtherFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // withdraw
      const withdrawAmount = BigInt(0.5e18);
      const isFAmount = false;
      const withdraw = loanManager
        .connect(hub)
        .withdraw(loanId, accountId, pools.ETH.poolId, withdrawAmount, isFAmount);
      await expect(withdraw).to.be.revertedWithCustomError(loanManager, "NotAccountOwner").withArgs(loanId, accountId);
    });

    it("Should fail to withdraw when user loan doesn't have the collateral", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(depositEtherFixture);

      // verify doesn't have collateral
      const poolId = pools.USDC.poolId;
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(userLoan[2].some((pid) => pid === BigInt(poolId))).to.be.false;

      // withdraw
      const withdrawAmount = BigInt(0.5e18);
      const isFAmount = false;
      const withdraw = loanManager.connect(hub).withdraw(loanId, accountId, poolId, withdrawAmount, isFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdraw)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoCollateralInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to withdraw when user loan doesn't have sufficient collateral", async () => {
      const { hub, loanManager, pools, loanId, accountId, depositFAmount } = await loadFixture(depositEtherFixture);

      // prepare withdraw
      const depositInterestIndex = BigInt(1.05e18);
      const withdrawFAmount = depositFAmount + BigInt(1);
      const withdrawAmount = toUnderlingAmount(withdrawFAmount, depositInterestIndex);
      await pools.ETH.pool.setWithdrawPoolParams({ underlingAmount: withdrawAmount, fAmount: withdrawFAmount });

      // withdraw
      const isFAmount = true;
      const withdraw = loanManager
        .connect(hub)
        .withdraw(loanId, accountId, pools.ETH.poolId, withdrawFAmount, isFAmount);
      await expect(withdraw).to.be.revertedWithPanic(PANIC_CODES.ARITHMETIC_OVERFLOW);
    });

    it("Should fail to withdraw when user loan becomes under-collateralised", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // User Loan:
      // Collateral 1.05 ETH = $3,150 -> 70% CF = $2100
      // Borrow 1,000 USDC = $1,000
      const { pool, poolId } = pools.ETH;

      // prepare withdraw
      const depositInterestIndex = BigInt(1.05e18);
      await pool.setUpdatedDepositInterestIndex(depositInterestIndex);

      // withdraw when becomes under-collateralised
      let withdrawAmount = BigInt(0.58e18);
      let withdrawFAmount = toFAmount(withdrawAmount, depositInterestIndex);
      await pool.setWithdrawPoolParams({ underlingAmount: withdrawAmount, fAmount: withdrawFAmount });
      const withdraw = loanManager.connect(hub).withdraw(loanId, accountId, poolId, withdrawAmount, false);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdraw)
        .to.be.revertedWithCustomError(loanManagerLogic, "UnderCollateralizedLoan")
        .withArgs(loanId);

      // withdraw when okay
      withdrawAmount = BigInt(0.57e18);
      withdrawFAmount = toFAmount(withdrawAmount, depositInterestIndex);
      await pool.setWithdrawPoolParams({ underlingAmount: withdrawAmount, fAmount: withdrawFAmount });
      await loanManager.connect(hub).withdraw(loanId, accountId, poolId, withdrawAmount, false);
    });

    it("Should fail to withdraw when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(depositEtherFixture);

      // withdraw
      const withdrawAmount = BigInt(0.5e18);
      const isFAmount = false;
      const withdraw = loanManager
        .connect(user)
        .withdraw(loanId, accountId, pools.ETH.poolId, withdrawAmount, isFAmount);
      await expect(withdraw)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Withdraw F Token", () => {
    it("Should successfully fully withdraw f token", async () => {
      const { user, hub, loanManager, loanManagerAddress, loanTypeId, pools, loanId, accountId, depositFAmount } =
        await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.ETH;

      // withdraw from eth pool
      const withdrawFAmount = depositFAmount;
      const withdrawFToken = await loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, poolId, user.address, withdrawFAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(withdrawFToken).to.emit(pool, "PreparePoolForWithdrawFToken");
      await expect(withdrawFToken)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(withdrawFToken).to.emit(pool, "MintFToken").withArgs(user.address, withdrawFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdrawFToken)
        .to.emit(loanManagerLogic, "WithdrawFToken")
        .withArgs(loanId, poolId, withdrawFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully partially withdraw f token", async () => {
      const { user, hub, loanManager, loanManagerAddress, loanTypeId, pools, loanId, accountId, depositFAmount } =
        await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.ETH;

      // withdraw from eth pool
      const withdrawFAmount = BigInt(0.5e18);
      const withdrawFToken = await loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, poolId, user.address, withdrawFAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(withdrawFToken).to.emit(pool, "PreparePoolForWithdrawFToken");
      await expect(withdrawFToken)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(withdrawFToken).to.emit(pool, "MintFToken").withArgs(user.address, withdrawFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdrawFToken)
        .to.emit(loanManagerLogic, "WithdrawFToken")
        .withArgs(loanId, poolId, withdrawFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - withdrawFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[0]).to.equal(depositFAmount - withdrawFAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should fail to withdraw f token when user loan is unknown", async () => {
      const { user, hub, loanManager, pools, accountId } = await loadFixture(createUserLoanFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // withdraw f token
      const withdrawFAmount = BigInt(0.5e18);
      const withdrawFToken = loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, pools.ETH.poolId, user.address, withdrawFAmount);
      await expect(withdrawFToken).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to withdraw f token when user is not owner", async () => {
      const { user, hub, loanManager, pools, loanId } = await loadFixture(createUserLoanFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // withdraw f token
      const withdrawFAmount = BigInt(0.5e18);
      const withdrawFToken = loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, pools.ETH.poolId, user.address, withdrawFAmount);
      await expect(withdrawFToken)
        .to.be.revertedWithCustomError(loanManager, "NotAccountOwner")
        .withArgs(loanId, accountId);
    });

    it("Should fail to withdraw f token when user loan doesn't have the collateral", async () => {
      const { user, hub, loanManager, loanManagerAddress, pools, loanId, accountId } =
        await loadFixture(depositEtherFixture);

      // verify doesn't have collateral
      const poolId = pools.USDC.poolId;
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(userLoan[2].some((pid) => pid === BigInt(poolId))).to.be.false;

      // withdraw f token
      const withdrawFAmount = BigInt(0.5e18);
      const withdrawFToken = loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, poolId, user.address, withdrawFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdrawFToken)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoCollateralInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to withdraw f token when user loan doesn't have sufficient collateral", async () => {
      const { user, hub, loanManager, pools, loanId, accountId, depositFAmount } =
        await loadFixture(depositEtherFixture);

      // withdraw f token
      const withdrawFAmount = depositFAmount + BigInt(1);
      const withdrawFToken = loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, pools.ETH.poolId, user.address, withdrawFAmount);
      await expect(withdrawFToken).to.be.revertedWithPanic(PANIC_CODES.ARITHMETIC_OVERFLOW);
    });

    it("Should fail to withdraw f token when user loan becomes under-collateralised", async () => {
      const { user, hub, loanManager, loanManagerAddress, pools, loanId, accountId, depositFAmount } =
        await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // User Loan:
      // Collateral 1.05 ETH = $3,150 -> 70% CF = $2100
      // Borrow 1,000 USDC = $1,000
      const { pool, poolId } = pools.ETH;

      // prepare withdraw f token
      const depositInterestIndex = BigInt(1.05e18);
      await pool.setUpdatedDepositInterestIndex(depositInterestIndex);

      // withdraw f token when becomes under-collateralised
      let withdrawAmount = BigInt(0.58e18);
      let withdrawFAmount = toFAmount(withdrawAmount, depositInterestIndex);
      const withdrawFToken = loanManager
        .connect(hub)
        .withdrawFToken(loanId, accountId, poolId, user.address, withdrawFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(withdrawFToken)
        .to.be.revertedWithCustomError(loanManagerLogic, "UnderCollateralizedLoan")
        .withArgs(loanId);

      // withdraw f token when okay
      withdrawAmount = BigInt(0.57e18);
      withdrawFAmount = toFAmount(withdrawAmount, depositInterestIndex);
      await loanManager.connect(hub).withdrawFToken(loanId, accountId, poolId, user.address, withdrawFAmount);
    });

    it("Should fail to withdraw f token when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(createUserLoanFixture);

      // withdraw f token
      const withdrawFAmount = BigInt(0.5e18);
      const withdrawFToken = loanManager
        .connect(user)
        .withdrawFToken(loanId, accountId, pools.ETH.poolId, user.address, withdrawFAmount);
      await expect(withdrawFToken)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Borrow", () => {
    it("Should successfully take new variable borrow", async () => {
      const {
        loanManager,
        loanManagerAddress,
        borrow,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcVariableInterestIndex,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(borrow).to.emit(pool, "PreparePoolForBorrow").withArgs(borrowAmount, 0);
      await expect(borrow).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(borrow).to.emit(pool, "UpdatePoolWithBorrow").withArgs(borrowAmount, false);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.emit(loanManagerLogic, "Borrow")
        .withArgs(loanId, poolId, borrowAmount, false, usdcStableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowAmount,
          lastInterestIndex: usdcVariableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully take new stable borrow", async () => {
      const {
        loanManager,
        loanManagerAddress,
        borrow,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(borrow).to.emit(pool, "PreparePoolForBorrow").withArgs(borrowAmount, usdcStableInterestRate);
      await expect(borrow).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(borrow).to.emit(pool, "UpdatePoolWithBorrow").withArgs(borrowAmount, true);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.emit(loanManagerLogic, "Borrow")
        .withArgs(loanId, poolId, borrowAmount, true, usdcStableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowAmount,
          lastInterestIndex: BigInt(1e18),
          stableInterestRate: usdcStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully handle zero borrow", async () => {
      const { hub, loanManager, loanManagerAddress, oracleManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(depositEtherFixture);

      // set prices
      const usdcNodeOutputData = getNodeOutputData(BigInt(1e18));
      await oracleManager.setNodeOutput(pools.USDC.poolId, pools.USDC.tokenDecimals, usdcNodeOutputData);

      const ethNodeOutputData = getNodeOutputData(BigInt(3000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // prepare borrow
      const variableInterestIndex = BigInt(1.05e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

      // borrow from USDC pool
      const borrowAmount = BigInt(0);
      const borrow = await loanManager
        .connect(hub)
        .borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));

      const { pool, poolId } = pools.USDC;

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(borrow).to.emit(pool, "PreparePoolForBorrow").withArgs(borrowAmount, 0);
      await expect(borrow).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(borrow).to.emit(pool, "UpdatePoolWithBorrow").withArgs(borrowAmount, false);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.emit(loanManagerLogic, "Borrow")
        .withArgs(loanId, poolId, borrowAmount, false, stableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully increase variable borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount: oldBorrowAmount,
        usdcVariableInterestIndex: oldvariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // prepare borrow
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.13e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

      // borrow
      const borrowAmount = BigInt(500e6);
      const borrow = await loanManager
        .connect(hub)
        .borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(borrow).to.emit(pool, "PreparePoolForBorrow").withArgs(borrowAmount, 0);
      await expect(borrow).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(borrow).to.emit(pool, "UpdatePoolWithBorrow").withArgs(borrowAmount, false);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.emit(loanManagerLogic, "Borrow")
        .withArgs(loanId, poolId, borrowAmount, false, stableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: oldBorrowAmount + borrowAmount,
          balance: calcBorrowBalance(oldBorrowAmount, variableInterestIndex, oldvariableInterestIndex) + borrowAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(oldBorrowAmount + borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully increase existing stable borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount: oldBorrowAmount,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare borrow
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.13e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

      // borrow
      const borrowAmount = BigInt(500e6);
      const borrow = await loanManager
        .connect(hub)
        .borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, stableInterestRate);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(borrow).to.emit(pool, "PreparePoolForBorrow").withArgs(borrowAmount, stableInterestRate);
      await expect(borrow).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(borrow).to.emit(pool, "UpdatePoolWithBorrow").withArgs(borrowAmount, true);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.emit(loanManagerLogic, "Borrow")
        .withArgs(loanId, poolId, borrowAmount, true, stableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(latestBlockTimestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const borrows: UserLoanBorrow[] = [
        {
          amount: oldBorrowAmount + borrowAmount,
          balance: borrowBalance + borrowAmount,
          lastInterestIndex: newInterestIndex,
          stableInterestRate: calcStableInterestRate(
            borrowBalance,
            borrowAmount,
            oldBorrow.stableInterestRate,
            stableInterestRate
          ),
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(oldBorrowAmount + borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully take second borrow", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId, loanTypeId } = await loadFixture(
        depositEtherAndStableBorrowUSDCFixture
      );

      const { pool, poolId } = pools.ETH;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const usdcBorrow = userLoanBefore[5][0];

      // prepare borrow
      const variableInterestIndex = BigInt(1.15e18);
      const stableInterestRate = BigInt(0.1e18);
      await pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

      // borrow
      const borrowAmount = BigInt(0.1e18); // 0.1 ETH
      const borrow = await loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(borrow).to.emit(pool, "PreparePoolForBorrow").withArgs(borrowAmount, 0);
      await expect(borrow).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(borrow).to.emit(pool, "UpdatePoolWithBorrow").withArgs(borrowAmount, false);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.emit(loanManagerLogic, "Borrow")
        .withArgs(loanId, poolId, borrowAmount, false, stableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        usdcBorrow,
        {
          amount: borrowAmount,
          balance: borrowAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([pools.USDC.poolId, poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should fail to borrow when user loan is unknown", async () => {
      const { hub, loanManager, pools, accountId } = await loadFixture(depositEtherFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));
      await expect(borrow).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to borrow when user is not owner", async () => {
      const { hub, loanManager, pools, loanId } = await loadFixture(depositEtherFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));
      await expect(borrow).to.be.revertedWithCustomError(loanManager, "NotAccountOwner").withArgs(loanId, accountId);
    });

    it("Should fail to borrow when loan type deprecated", async () => {
      const { admin, hub, loanManager, loanTypeId, pools, loanId, accountId } = await loadFixture(depositEtherFixture);

      // verify loan type deprecated
      await loanManager.connect(admin).deprecateLoanType(loanTypeId);
      expect(await loanManager.isLoanTypeDeprecated(loanTypeId)).to.be.true;

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));
      await expect(borrow).to.be.revertedWithCustomError(loanManager, "LoanTypeDeprecated").withArgs(loanTypeId);
    });

    it("Should fail to borrow when loan pool unknown", async () => {
      const { hub, loanManager, loanTypeId, loanId, accountId } = await loadFixture(depositEtherFixture);

      // verify loan pool unknown
      const poolId = 33;
      expect(await loanManager.isPoolInLoanType(loanTypeId, poolId)).to.be.false;

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));
      await expect(borrow).to.be.revertedWithCustomError(loanManager, "LoanPoolUnknown").withArgs(loanTypeId, poolId);
    });

    it("Should fail to borrow when loan pool deprecated", async () => {
      const { admin, hub, loanManager, loanTypeId, pools, loanId, accountId } = await loadFixture(depositEtherFixture);

      // verify loan pool deprecated
      const poolId = pools.USDC.poolId;
      await loanManager.connect(admin).deprecatePoolInLoanType(loanTypeId, poolId);
      expect(await loanManager.isPoolInLoanTypeDeprecated(loanTypeId, poolId)).to.be.true;

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));
      await expect(borrow)
        .to.be.revertedWithCustomError(loanManager, "LoanPoolDeprecated")
        .withArgs(loanTypeId, poolId);
    });

    it("Should fail to borrow when loan pool borrow cap is exceeded", async () => {
      const { admin, hub, loanManager, loanManagerAddress, oracleManager, loanTypeId, pools, loanId, accountId } =
        await loadFixture(depositEtherFixture);

      const { pool, poolId } = pools.USDC;

      // set prices
      const usdcNodeOutputData = getNodeOutputData(BigInt(1e18));
      await oracleManager.setNodeOutput(pools.USDC.poolId, pools.USDC.tokenDecimals, usdcNodeOutputData);

      const ethNodeOutputData = getNodeOutputData(BigInt(3000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // set cap
      const collateralCap = BigInt(0);
      const borrowCap = BigInt(100); // $100
      await loanManager.connect(admin).updateLoanPoolCaps(loanTypeId, poolId, collateralCap, borrowCap);

      // prepare borrow
      const variableInterestIndex = BigInt(1.05e18);
      const stableInterestRate = BigInt(0.1e18);
      await pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);

      // borrow when borrow cap exceeded
      let borrowAmount = BigInt(100.1e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow)
        .to.be.revertedWithCustomError(loanManagerLogic, "BorrowCapReached")
        .withArgs(loanTypeId, poolId);

      // borrow when borrow cap okay
      borrowAmount = BigInt(99.9e6);
      await loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));
    });

    it("Should fail to borrow when user loan becomes under-collateralised", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // User Loan:
      // Collateral 1.00 ETH = $3,000 -> 70% CF = $2100
      // Borrow 1,000 USDC = $1,000

      const { poolId } = pools.USDC;

      // borrow when becomes under-collateralised
      let borrowAmount = BigInt(1100e6) + BigInt(1);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(borrow).to.be.revertedWithCustomError(loanManagerLogic, "UnderCollateralizedLoan").withArgs(loanId);

      // borrow when okay
      borrowAmount = BigInt(1100e6);
      await loanManager.connect(hub).borrow(loanId, accountId, poolId, borrowAmount, BigInt(0));
    });

    it("Should fail to borrow when existing variable borrow and trying to stable borrow", async () => {
      const { hub, loanManager, libraries, pools, loanId, accountId, usdcStableInterestRate } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager
        .connect(hub)
        .borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, usdcStableInterestRate);
      const userLoanLogic = await ethers.getContractAt("UserLoanLogic", libraries.userLoanLogic);
      await expect(borrow).to.be.revertedWithCustomError(userLoanLogic, "BorrowTypeMismatch");
    });

    it("Should fail to borrow when existing stable borrow and trying to variable borrow", async () => {
      const { hub, loanManager, libraries, pools, loanId, accountId } = await loadFixture(
        depositEtherAndStableBorrowUSDCFixture
      );

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(hub).borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));
      const userLoanLogic = await ethers.getContractAt("UserLoanLogic", libraries.userLoanLogic);
      await expect(borrow).to.be.revertedWithCustomError(userLoanLogic, "BorrowTypeMismatch");
    });

    it("Should fail to borrow when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(depositEtherFixture);

      // borrow
      const borrowAmount = BigInt(100e6);
      const borrow = loanManager.connect(user).borrow(loanId, accountId, pools.USDC.poolId, borrowAmount, BigInt(0));
      await expect(borrow)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Repay", () => {
    it("Should successfully fully repay borrow with no excess", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId, loanTypeId, borrowAmount } =
        await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // repay
      const repayAmount = borrowAmount;
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepay").withArgs(repayAmount, 0, 0, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, repayAmount, 0, 0);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully fully repay stable borrow with no excess", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;

      // repay
      const repayAmount = borrowBalance;
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepay")
        .withArgs(borrowAmount, interest, usdcStableInterestRate, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, borrowAmount, interest, 0);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully fully repay variable borrow with excess", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // prepare repay
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });

      // calculate interest
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const excess = BigInt(10);

      // repay
      const repayAmount = borrowBalance + excess;
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, excess);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepay").withArgs(borrowAmount, interest, 0, excess);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, borrowAmount, interest, excess);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully fully repay stable borrow with excess", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const excess = BigInt(50);

      // repay
      const repayAmount = borrowBalance + excess;
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, excess);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepay")
        .withArgs(borrowAmount, interest, usdcStableInterestRate, excess);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, borrowAmount, interest, excess);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully partially repay variable borrow both interest and principal", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // prepare repay
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });

      // calculate interest
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const remaining = BigInt(1e6);

      // repay
      const repayAmount = borrowBalance - remaining;
      const prinicipalPaid = repayAmount - interest;
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepay").withArgs(prinicipalPaid, interest, 0, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, prinicipalPaid, interest, 0);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: remaining,
          balance: remaining,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(remaining);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully partially repay stable borrow both interest and principal", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const remaining = BigInt(0.5e6);

      // repay
      const repayAmount = borrowBalance - remaining;
      const prinicipalPaid = repayAmount - interest;
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepay")
        .withArgs(prinicipalPaid, interest, usdcStableInterestRate, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, prinicipalPaid, interest, 0);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: remaining,
          balance: remaining,
          lastInterestIndex: newInterestIndex,
          stableInterestRate: usdcStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(remaining);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully partially repay variable borrow only interest", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // prepare repay
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });

      // calculate interest
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);
      const interest = borrowBalance - borrowAmount;

      // repay
      const repayAmount = interest - BigInt(1);
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepay").withArgs(0, repayAmount, 0, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, 0, repayAmount, 0);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, repayAmount]);
    });

    it("Should successfully partially repay stable borrow only interest", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;

      // repay
      const repayAmount = interest - BigInt(1);
      const repay = await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay").withArgs();
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepay").withArgs(0, repayAmount, usdcStableInterestRate, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay).to.emit(loanManagerLogic, "Repay").withArgs(loanId, poolId, 0, repayAmount, 0);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: newInterestIndex,
          stableInterestRate: usdcStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, repayAmount]);
    });

    it("Should fail to repay when user loan is unknown", async () => {
      const { hub, loanManager, pools, accountId } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // repay
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repay(loanId, accountId, pools.USDC.poolId, repayAmount, 0);
      await expect(repay).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to repay when user is not owner", async () => {
      const { hub, loanManager, pools, loanId } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // repay
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repay(loanId, accountId, pools.USDC.poolId, repayAmount, 0);
      await expect(repay).to.be.revertedWithCustomError(loanManager, "NotAccountOwner").withArgs(loanId, accountId);
    });

    it("Should fail to repay when user loan doesn't have the borrow", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      const { poolId } = pools.ETH;

      // repay
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoBorrowInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to repay when max over-repayement is exceeded", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId, borrowAmount } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      const { poolId } = pools.USDC;

      // repay when max over-repayment is exceeded
      const excess = BigInt(10);
      let repayAmount = borrowAmount + excess + BigInt(1);
      const repay = loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, excess);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.be.revertedWithCustomError(loanManagerLogic, "ExcessRepaymentExceeded")
        .withArgs(excess, excess + BigInt(1));

      // repay when max over-repayment is okay
      repayAmount = borrowAmount + excess;
      await loanManager.connect(hub).repay(loanId, accountId, poolId, repayAmount, excess);
    });

    it("Should fail to repay when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // repay
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(user).repay(loanId, accountId, pools.USDC.poolId, repayAmount, 0);
      await expect(repay)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Repay With Collateral", () => {
    it("Should successfully fully repay with collateral variable borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
      } = await loadFixture(depositEtherAndVariableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare repay with collateral
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // repay with collateral
      const repayAmount = borrowAmount;
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepayWithCollateral").withArgs(repayAmount, 0, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, repayAmount, 0, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully fully repay with collateral stable borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare repay with collateral
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;

      // repay with collateral
      const repayAmount = borrowBalance;
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepayWithCollateral")
        .withArgs(borrowAmount, interest, ethStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, borrowAmount, interest, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully fully repay with collateral variable borrow and ignore excess", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare repay with collateral
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const excess = BigInt(10);

      // repay with collateral
      const repayAmount = borrowBalance + excess;
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepayWithCollateral").withArgs(borrowAmount, interest, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, borrowAmount, interest, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully fully repay with collateral stable borrow and ignore excess", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare repay with collateral
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const excess = BigInt(10);

      // repay with collateral
      const repayAmount = borrowBalance + excess;
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepayWithCollateral")
        .withArgs(borrowAmount, interest, ethStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, borrowAmount, interest, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal([]);

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(0);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully partially repay with collateral variable borrow both interest and principal", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare repay with collateral
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const remaining = BigInt(0.05e18);

      // repay with collateral
      const repayAmount = borrowBalance - remaining;
      const prinicipalPaid = repayAmount - interest;
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepayWithCollateral").withArgs(prinicipalPaid, interest, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, prinicipalPaid, interest, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const borrows: UserLoanBorrow[] = [
        {
          amount: remaining,
          balance: remaining,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(remaining);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully partially repay with collateral stable borrow both interest and principal", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare repay with collateral
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;
      const remaining = BigInt(0.05e18);

      // repay with collateral
      const repayAmount = borrowBalance - remaining;
      const prinicipalPaid = repayAmount - interest;
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepayWithCollateral")
        .withArgs(prinicipalPaid, interest, ethStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, prinicipalPaid, interest, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const borrows: UserLoanBorrow[] = [
        {
          amount: remaining,
          balance: remaining,
          lastInterestIndex: newInterestIndex,
          stableInterestRate: ethStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(remaining);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, interest]);
    });

    it("Should successfully partially repay with collateral variable borrow only interest", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;

      // prepare repay with collateral
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);
      const interest = borrowBalance - borrowAmount;

      // repay with collateral
      const repayAmount = interest - BigInt(1);
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay).to.emit(pool, "UpdatePoolWithRepayWithCollateral").withArgs(0, repayAmount, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, 0, repayAmount, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, repayAmount]);
    });

    it("Should successfully partially repay with collateral stable borrow only interest", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        ethStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowEtherFixture);

      const { pool, poolId } = pools.ETH;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare repay with collateral
      const repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);
      const interest = borrowBalance - borrowAmount;

      // repay with collateral
      const repayAmount = interest - BigInt(1);
      const repay = await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(repay).to.emit(pool, "PreparePoolForRepay");
      await expect(repay).to.emit(loanManager, "RewardIndexesUpdated").withArgs(poolId, 0, 0, latestBlockTimestamp);
      await expect(repay)
        .to.emit(pool, "UpdatePoolWithRepayWithCollateral")
        .withArgs(0, repayAmount, ethStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.emit(loanManagerLogic, "RepayWithCollateral")
        .withArgs(loanId, poolId, 0, repayAmount, repayCollateralFAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const collaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - repayCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: newInterestIndex,
          stableInterestRate: ethStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[2]).to.deep.equal([poolId]);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[4]).to.deep.equal(collaterals.map((col) => Object.values(col)));
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
      expect(loanPool[10][0]).to.equal(latestBlockTimestamp);
      expect(loanPool[10][4]).to.equal(0);
      expect(loanPool[10][5]).to.equal(0);

      // check user rewards
      const userPoolRewards = await loanManager.getUserPoolRewards(accountId, poolId);
      expect(userPoolRewards).to.deep.equal([0, 0, repayAmount]);
    });

    it("Should fail to repay with collateral when user loan is unknown", async () => {
      const { hub, loanManager, pools, accountId } = await loadFixture(depositEtherAndVariableBorrowEtherFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // repay with collateral
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repayWithCollateral(loanId, accountId, pools.ETH.poolId, repayAmount);
      await expect(repay).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to repay with collateral when user is not owner", async () => {
      const { hub, loanManager, pools, loanId } = await loadFixture(depositEtherAndVariableBorrowEtherFixture);

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // repay with collateral
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repayWithCollateral(loanId, accountId, pools.ETH.poolId, repayAmount);
      await expect(repay).to.be.revertedWithCustomError(loanManager, "NotAccountOwner").withArgs(loanId, accountId);
    });

    it("Should fail to repay with collateral when user loan doesn't have the borrow", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      const { poolId } = pools.ETH;

      // repay with collateral
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoBorrowInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to repay with collateral when user loan doesn't have the collateral", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      const { poolId } = pools.USDC;

      // repay with collateral
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(repay)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoCollateralInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to repay with collateral when user loan doesn't have sufficient collateral", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId, borrowAmount } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      const { pool, poolId, tokenDecimals } = pools.USDC;

      // prepare repay with collateral
      let repayCollateralFAmount = borrowAmount + BigInt(10);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });

      // deposit insufficient amount of USDC
      const depositAmount = borrowAmount;
      const depositFAmount = repayCollateralFAmount - BigInt(1);
      const depositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pool.setDepositPoolParams({
        fAmount: depositFAmount,
        depositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: tokenDecimals },
      });
      await loanManager.connect(hub).deposit(loanId, accountId, poolId, depositAmount);

      // repay with collateral when insufficient collateral
      const repayAmount = borrowAmount;
      const repay = loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);
      await expect(repay).to.be.revertedWithPanic(PANIC_CODES.ARITHMETIC_OVERFLOW);

      // repay with collateral when okay
      repayCollateralFAmount -= BigInt(1);
      await pool.setRepayWithCollateralPoolParams({ fAmount: repayCollateralFAmount });
      await loanManager.connect(hub).repayWithCollateral(loanId, accountId, poolId, repayAmount);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      expect(userLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(userLoan[4].length).to.equal(1);
    });

    it("Should fail to repay with collateral when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowEtherFixture
      );

      // repay with collateral
      const repayAmount = BigInt(1);
      const repay = loanManager.connect(user).repayWithCollateral(loanId, accountId, pools.ETH.poolId, repayAmount);
      await expect(repay)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Liquidate", () => {
    it("Should successfully liquidate variable borrow when seizing new borrow and collateral", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);

      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(1000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate interest
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);

      // Violator:
      // Collateral 1 ETH = $1,000
      // Borrow 1,000 USDC = $1,000

      // Liquidator:
      // Collateral 10,000 USDC = $10,000
      // Borrow $0
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;

      // liquidate
      const minSeizedAmount = BigInt(0);
      const liquidate = await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.ETH.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.USDC.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate).to.emit(pools.USDC.pool, "PreparePoolForRepay");
      await expect(liquidate).to.emit(pools.USDC.pool, "UpdatePoolWithLiquidation");
      await expect(liquidate).to.emit(pools.ETH.pool, "MintFTokenForFeeRecipient").withArgs(reserveCollateralFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(liquidate)
        .to.emit(loanManagerLogic, "Liquidate")
        .withArgs(
          violatorLoanId,
          liquidatorLoanId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          liquidatorCollateralFAmount,
          reserveCollateralFAmount
        );

      // check violator loan
      const violatorLoan = await loanManager.getUserLoan(violatorLoanId);
      const violatorCollaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - seizeCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const violatorBorrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount - repayAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.true;
      expect(violatorLoan[0]).to.equal(violatorAccountId);
      expect(violatorLoan[1]).to.equal(loanTypeId);
      expect(violatorLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(violatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(violatorLoan[4]).to.deep.equal(violatorCollaterals.map((col) => Object.values(col)));
      expect(violatorLoan[5]).to.deep.equal(violatorBorrows.map((bor) => Object.values(bor)));

      // check liquidator loan
      const liquidatorLoan = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorCollaterals: UserLoanCollateral[] = [
        {
          balance: liquidatorDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: liquidatorCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const liquidatorBorrows: UserLoanBorrow[] = [
        {
          amount: repayAmount,
          balance: repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.true;
      expect(liquidatorLoan[0]).to.equal(liquidatorAccountId);
      expect(liquidatorLoan[1]).to.equal(loanTypeId);
      expect(liquidatorLoan[2]).to.deep.equal([pools.USDC.poolId, pools.ETH.poolId]);
      expect(liquidatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(liquidatorLoan[4]).to.deep.equal(liquidatorCollaterals.map((col) => Object.values(col)));
      expect(liquidatorLoan[5]).to.deep.equal(liquidatorBorrows.map((bor) => Object.values(bor)));

      // check user rewards - no interest rewards paid out
      const colViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.ETH.poolId);
      const borViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.USDC.poolId);
      expect(colViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      const colLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.ETH.poolId);
      const borLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.USDC.poolId);
      expect(colLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully liquidate stable borrow when seizing new borrow and collateral", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        usdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(1000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate interest
      const violatorLoanBefore = await loanManager.getUserLoan(violatorLoanId);
      const violatorOldBorrow = violatorLoanBefore[5][0];
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        violatorOldBorrow.stableInterestRate,
        violatorOldBorrow.lastInterestIndex,
        BigInt(timestamp) - violatorOldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(
        violatorOldBorrow.balance,
        newInterestIndex,
        violatorOldBorrow.lastInterestIndex
      );

      // Violator:
      // Collateral 1 ETH = $1,000
      // Borrow 1,000 USDC = $1,000

      // Liquidator:
      // Collateral 10,000 USDC = $10,000
      // Borrow $0
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;

      // liquidate
      const minSeizedAmount = BigInt(0);
      const liquidate = await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.ETH.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.USDC.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate).to.emit(pools.USDC.pool, "PreparePoolForRepay");
      await expect(liquidate).to.emit(pools.USDC.pool, "UpdatePoolWithLiquidation");
      await expect(liquidate).to.emit(pools.ETH.pool, "MintFTokenForFeeRecipient").withArgs(reserveCollateralFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(liquidate)
        .to.emit(loanManagerLogic, "Liquidate")
        .withArgs(
          violatorLoanId,
          liquidatorLoanId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          liquidatorCollateralFAmount,
          reserveCollateralFAmount
        );

      // check violator loan
      const violatorLoan = await loanManager.getUserLoan(violatorLoanId);
      const violatorCollaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - seizeCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const violatorBorrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount - repayAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: newInterestIndex,
          stableInterestRate: usdcStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.true;
      expect(violatorLoan[0]).to.equal(violatorAccountId);
      expect(violatorLoan[1]).to.equal(loanTypeId);
      expect(violatorLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(violatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(violatorLoan[4]).to.deep.equal(violatorCollaterals.map((col) => Object.values(col)));
      expect(violatorLoan[5]).to.deep.equal(violatorBorrows.map((bor) => Object.values(bor)));

      // check liquidator loan
      const liquidatorLoan = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorCollaterals: UserLoanCollateral[] = [
        {
          balance: liquidatorDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: liquidatorCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const liquidatorBorrows: UserLoanBorrow[] = [
        {
          amount: repayAmount,
          balance: repayAmount,
          lastInterestIndex: BigInt(1e18),
          stableInterestRate: usdcStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.true;
      expect(liquidatorLoan[0]).to.equal(liquidatorAccountId);
      expect(liquidatorLoan[1]).to.equal(loanTypeId);
      expect(liquidatorLoan[2]).to.deep.equal([pools.USDC.poolId, pools.ETH.poolId]);
      expect(liquidatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(liquidatorLoan[4]).to.deep.equal(liquidatorCollaterals.map((col) => Object.values(col)));
      expect(liquidatorLoan[5]).to.deep.equal(liquidatorBorrows.map((bor) => Object.values(bor)));

      // check user rewards - no interest rewards paid out
      const colViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.ETH.poolId);
      const borViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.USDC.poolId);
      expect(colViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      const colLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.ETH.poolId);
      const borLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.USDC.poolId);
      expect(colLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully liquidate variable borrow when liquidator has existing borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        usdcVariableInterestIndex: oldViolatorVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // borrow USDC in liquidator loan
      const oldLiquidatorVariableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({
        variableInterestIndex: oldLiquidatorVariableInterestIndex,
        stableInterestRate,
      });
      const liquidatorBorrowAmount = BigInt(50e6); // 50 USDC
      await loanManager
        .connect(hub)
        .borrow(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorBorrowAmount, BigInt(0));

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(1000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate interest
      const variableInterestIndex = BigInt(1.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);
      const violatorBorrowBalance = calcBorrowBalance(
        borrowAmount,
        variableInterestIndex,
        oldViolatorVariableInterestIndex
      );
      const liquidatorBorrowBalance = calcBorrowBalance(
        liquidatorBorrowAmount,
        variableInterestIndex,
        oldLiquidatorVariableInterestIndex
      );

      // Violator:
      // Collateral 1 ETH = $1,000
      // Borrow 1,000 USDC = $1,000

      // Liquidator:
      // Collateral 10,000 USDC = $10,000
      // Borrow 50 USDC = $50
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;

      // liquidate
      const minSeizedAmount = BigInt(0);
      const liquidate = await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.ETH.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.USDC.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate).to.emit(pools.USDC.pool, "PreparePoolForRepay");
      await expect(liquidate).to.emit(pools.USDC.pool, "UpdatePoolWithLiquidation");
      await expect(liquidate).to.emit(pools.ETH.pool, "MintFTokenForFeeRecipient").withArgs(reserveCollateralFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(liquidate)
        .to.emit(loanManagerLogic, "Liquidate")
        .withArgs(
          violatorLoanId,
          liquidatorLoanId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          liquidatorCollateralFAmount,
          reserveCollateralFAmount
        );

      // check violator loan
      const violatorLoan = await loanManager.getUserLoan(violatorLoanId);
      const violatorCollaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - seizeCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const violatorBorrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount - repayAmount,
          balance: violatorBorrowBalance - repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.true;
      expect(violatorLoan[0]).to.equal(violatorAccountId);
      expect(violatorLoan[1]).to.equal(loanTypeId);
      expect(violatorLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(violatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(violatorLoan[4]).to.deep.equal(violatorCollaterals.map((col) => Object.values(col)));
      expect(violatorLoan[5]).to.deep.equal(violatorBorrows.map((bor) => Object.values(bor)));

      // check liquidator loan
      const liquidatorLoan = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorCollaterals: UserLoanCollateral[] = [
        {
          balance: liquidatorDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: liquidatorCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const liquidatorBorrows: UserLoanBorrow[] = [
        {
          amount: liquidatorBorrowAmount + repayAmount,
          balance: liquidatorBorrowBalance + repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.true;
      expect(liquidatorLoan[0]).to.equal(liquidatorAccountId);
      expect(liquidatorLoan[1]).to.equal(loanTypeId);
      expect(liquidatorLoan[2]).to.deep.equal([pools.USDC.poolId, pools.ETH.poolId]);
      expect(liquidatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(liquidatorLoan[4]).to.deep.equal(liquidatorCollaterals.map((col) => Object.values(col)));
      expect(liquidatorLoan[5]).to.deep.equal(liquidatorBorrows.map((bor) => Object.values(bor)));

      // check user rewards - no interest rewards paid out
      const colViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.ETH.poolId);
      const borViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.USDC.poolId);
      expect(colViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      const colLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.ETH.poolId);
      const borLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.USDC.poolId);
      expect(colLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully liquidate stable borrow when liquidator has existing borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        usdcVariableInterestIndex,
        usdcStableInterestRate: violatorUsdcStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // borrow USDC in liquidator loan
      const liquidatorStableInterestRate = BigInt(0.2e18);
      await pools.USDC.pool.setBorrowPoolParams({
        variableInterestIndex: usdcVariableInterestIndex,
        stableInterestRate: liquidatorStableInterestRate,
      });
      const liquidatorBorrowAmount = BigInt(50e6); // 50 USDC
      await loanManager
        .connect(hub)
        .borrow(
          liquidatorLoanId,
          liquidatorAccountId,
          pools.USDC.poolId,
          liquidatorBorrowAmount,
          liquidatorStableInterestRate
        );

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(1000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate interest
      const violatorLoanBefore = await loanManager.getUserLoan(violatorLoanId);
      const violatorOldBorrow = violatorLoanBefore[5][0];
      const liquidatorLoanBefore = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorOldBorrow = liquidatorLoanBefore[5][0];
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newViolatorInterestIndex = calcBorrowInterestIndex(
        violatorOldBorrow.stableInterestRate,
        violatorOldBorrow.lastInterestIndex,
        BigInt(timestamp) - violatorOldBorrow.lastStableUpdateTimestamp,
        true
      );
      const violatorBorrowBalance = calcBorrowBalance(
        violatorOldBorrow.balance,
        newViolatorInterestIndex,
        violatorOldBorrow.lastInterestIndex
      );
      const newLiquidatorInterestIndex = calcBorrowInterestIndex(
        liquidatorOldBorrow.stableInterestRate,
        liquidatorOldBorrow.lastInterestIndex,
        BigInt(timestamp) - liquidatorOldBorrow.lastStableUpdateTimestamp,
        true
      );
      const liquidatorBorrowBalance = calcBorrowBalance(
        liquidatorOldBorrow.balance,
        newLiquidatorInterestIndex,
        liquidatorOldBorrow.lastInterestIndex
      );

      // Violator:
      // Collateral 1 ETH = $1,000
      // Borrow 1,000 USDC = $1,000

      // Liquidator:
      // Collateral 10,000 USDC = $10,000
      // Borrow $0
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;

      // liquidate
      const minSeizedAmount = BigInt(0);
      const liquidate = await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.ETH.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.USDC.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate).to.emit(pools.USDC.pool, "PreparePoolForRepay");
      await expect(liquidate).to.emit(pools.USDC.pool, "UpdatePoolWithLiquidation");
      await expect(liquidate).to.emit(pools.ETH.pool, "MintFTokenForFeeRecipient").withArgs(reserveCollateralFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(liquidate)
        .to.emit(loanManagerLogic, "Liquidate")
        .withArgs(
          violatorLoanId,
          liquidatorLoanId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          liquidatorCollateralFAmount,
          reserveCollateralFAmount
        );

      // check violator loan
      const violatorLoan = await loanManager.getUserLoan(violatorLoanId);
      const violatorCollaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - seizeCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const violatorBorrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount - repayAmount,
          balance: violatorBorrowBalance - repayAmount,
          lastInterestIndex: newViolatorInterestIndex,
          stableInterestRate: violatorUsdcStableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.true;
      expect(violatorLoan[0]).to.equal(violatorAccountId);
      expect(violatorLoan[1]).to.equal(loanTypeId);
      expect(violatorLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(violatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(violatorLoan[4]).to.deep.equal(violatorCollaterals.map((col) => Object.values(col)));
      expect(violatorLoan[5]).to.deep.equal(violatorBorrows.map((bor) => Object.values(bor)));

      // check liquidator loan
      const liquidatorLoan = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorCollaterals: UserLoanCollateral[] = [
        {
          balance: liquidatorDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: liquidatorCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const liquidatorBorrows: UserLoanBorrow[] = [
        {
          amount: liquidatorBorrowAmount + repayAmount,
          balance: liquidatorBorrowBalance + repayAmount,
          lastInterestIndex: newLiquidatorInterestIndex,
          stableInterestRate: calcAverageStableRate(
            liquidatorBorrowAmount,
            liquidatorStableInterestRate,
            repayAmount,
            violatorUsdcStableInterestRate
          ),
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.true;
      expect(liquidatorLoan[0]).to.equal(liquidatorAccountId);
      expect(liquidatorLoan[1]).to.equal(loanTypeId);
      expect(liquidatorLoan[2]).to.deep.equal([pools.USDC.poolId, pools.ETH.poolId]);
      expect(liquidatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(liquidatorLoan[4]).to.deep.equal(liquidatorCollaterals.map((col) => Object.values(col)));
      expect(liquidatorLoan[5]).to.deep.equal(liquidatorBorrows.map((bor) => Object.values(bor)));

      // check user rewards - no interest rewards paid out
      const colViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.ETH.poolId);
      const borViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.USDC.poolId);
      expect(colViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      const colLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.ETH.poolId);
      const borLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.USDC.poolId);
      expect(colLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully liquidate when liquidator has existing collateral", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
        loanTypeId,
        depositFAmount,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit ETH into liquidator loan
      const liquidatorDepositAmount = BigInt(5e18); // 5 ETH
      const liquidatorDepositInterestIndex = BigInt(1.05e18);
      const liquidatorDepositFAmount = toFAmount(liquidatorDepositAmount, liquidatorDepositInterestIndex);
      const usdcPrice = BigInt(1e18);
      const ethPrice = BigInt(3000e18);

      await pools.ETH.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: ethPrice, decimals: pools.ETH.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.ETH.poolId, liquidatorDepositAmount);

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(1000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate interest
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);

      // Violator:
      // Collateral 1 ETH = $1,000
      // Borrow 1,000 USDC = $1,000

      // Liquidator:
      // Collateral 5 ETH = $5,000
      // Borrow $0
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;

      // liquidate
      const minSeizedAmount = BigInt(0);
      const liquidate = await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.ETH.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.USDC.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate).to.emit(pools.USDC.pool, "PreparePoolForRepay");
      await expect(liquidate).to.emit(pools.USDC.pool, "UpdatePoolWithLiquidation");
      await expect(liquidate).to.emit(pools.ETH.pool, "MintFTokenForFeeRecipient").withArgs(reserveCollateralFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(liquidate)
        .to.emit(loanManagerLogic, "Liquidate")
        .withArgs(
          violatorLoanId,
          liquidatorLoanId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          liquidatorCollateralFAmount,
          reserveCollateralFAmount
        );

      // check violator loan
      const violatorLoan = await loanManager.getUserLoan(violatorLoanId);
      const violatorCollaterals: UserLoanCollateral[] = [
        {
          balance: depositFAmount - seizeCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const violatorBorrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount - repayAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.true;
      expect(violatorLoan[0]).to.equal(violatorAccountId);
      expect(violatorLoan[1]).to.equal(loanTypeId);
      expect(violatorLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(violatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(violatorLoan[4]).to.deep.equal(violatorCollaterals.map((col) => Object.values(col)));
      expect(violatorLoan[5]).to.deep.equal(violatorBorrows.map((bor) => Object.values(bor)));

      // check liquidator loan
      const liquidatorLoan = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorCollaterals: UserLoanCollateral[] = [
        {
          balance: liquidatorDepositFAmount + liquidatorCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const liquidatorBorrows: UserLoanBorrow[] = [
        {
          amount: repayAmount,
          balance: repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.true;
      expect(liquidatorLoan[0]).to.equal(liquidatorAccountId);
      expect(liquidatorLoan[1]).to.equal(loanTypeId);
      expect(liquidatorLoan[2]).to.deep.equal([pools.ETH.poolId]);
      expect(liquidatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(liquidatorLoan[4]).to.deep.equal(liquidatorCollaterals.map((col) => Object.values(col)));
      expect(liquidatorLoan[5]).to.deep.equal(liquidatorBorrows.map((bor) => Object.values(bor)));

      // check user rewards - no interest rewards paid out
      const colViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.ETH.poolId);
      const borViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.USDC.poolId);
      expect(colViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      const colLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.ETH.poolId);
      const borLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.USDC.poolId);
      expect(colLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should successfully liquidate when max repay borrow is set from target loan to health ratio", async () => {});

    it("Should successfully liquidate when bonus collateral to seize leaving bad debt", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
        loanTypeId,
        depositAmount,
        depositFAmount,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(10000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(500e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate interest
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({ variableInterestIndex, stableInterestRate });
      await pools.USDC.pool.setUpdatedVariableBorrowInterestIndex(variableInterestIndex);
      const borrowBalance = calcBorrowBalance(borrowAmount, variableInterestIndex, oldVariableInterestIndex);

      // Violator:
      // Collateral 1 ETH = $500
      // Borrow 1,000 USDC = $1,000

      // Liquidator:
      // Collateral 10,000 USDC = $10,000
      // Borrow $0
      const seizeCollateralAmount = depositAmount;
      const seizeCollateralFAmount = depositFAmount;
      const repayAmount = convToRepayBorrowAmount(
        seizeCollateralAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;
      const attemptedRepayAmount = repayAmount + BigInt(10e6);

      // liquidate
      const minSeizedAmount = BigInt(0);
      const liquidate = await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          attemptedRepayAmount,
          minSeizedAmount
        );

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.ETH.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate)
        .to.emit(loanManager, "RewardIndexesUpdated")
        .withArgs(pools.USDC.poolId, 0, 0, latestBlockTimestamp);
      await expect(liquidate).to.emit(pools.USDC.pool, "PreparePoolForRepay");
      await expect(liquidate).to.emit(pools.USDC.pool, "UpdatePoolWithLiquidation");
      await expect(liquidate).to.emit(pools.ETH.pool, "MintFTokenForFeeRecipient").withArgs(reserveCollateralFAmount);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(liquidate)
        .to.emit(loanManagerLogic, "Liquidate")
        .withArgs(
          violatorLoanId,
          liquidatorLoanId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          liquidatorCollateralFAmount,
          reserveCollateralFAmount
        );

      // check violator loan
      const violatorLoan = await loanManager.getUserLoan(violatorLoanId);
      const violatorBorrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount - repayAmount,
          balance: borrowBalance - repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.true;
      expect(violatorLoan[0]).to.equal(violatorAccountId);
      expect(violatorLoan[1]).to.equal(loanTypeId);
      expect(violatorLoan[2]).to.deep.equal([]);
      expect(violatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(violatorLoan[4]).to.deep.equal([]);
      expect(violatorLoan[5]).to.deep.equal(violatorBorrows.map((bor) => Object.values(bor)));

      // check liquidator loan
      const liquidatorLoan = await loanManager.getUserLoan(liquidatorLoanId);
      const liquidatorCollaterals: UserLoanCollateral[] = [
        {
          balance: liquidatorDepositFAmount,
          rewardIndex: BigInt(0),
        },
        {
          balance: liquidatorCollateralFAmount,
          rewardIndex: BigInt(0),
        },
      ];
      const liquidatorBorrows: UserLoanBorrow[] = [
        {
          amount: repayAmount,
          balance: repayAmount,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.true;
      expect(liquidatorLoan[0]).to.equal(liquidatorAccountId);
      expect(liquidatorLoan[1]).to.equal(loanTypeId);
      expect(liquidatorLoan[2]).to.deep.equal([pools.USDC.poolId, pools.ETH.poolId]);
      expect(liquidatorLoan[3]).to.deep.equal([pools.USDC.poolId]);
      expect(liquidatorLoan[4]).to.deep.equal(liquidatorCollaterals.map((col) => Object.values(col)));
      expect(liquidatorLoan[5]).to.deep.equal(liquidatorBorrows.map((bor) => Object.values(bor)));

      // check user rewards - no interest rewards paid out
      const colViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.ETH.poolId);
      const borViolatorPoolRewards = await loanManager.getUserPoolRewards(violatorAccountId, pools.USDC.poolId);
      expect(colViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borViolatorPoolRewards).to.deep.equal([0, 0, 0]);
      const colLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.ETH.poolId);
      const borLiquidatorPoolRewards = await loanManager.getUserPoolRewards(liquidatorAccountId, pools.USDC.poolId);
      expect(colLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
      expect(borLiquidatorPoolRewards).to.deep.equal([0, 0, 0]);
    });

    it("Should fail to liquidate when violator loan is unknown", async () => {
      const { hub, loanManager, pools, loanTypeId } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // verify unknown
      const violatorLoanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(violatorLoanId)).to.be.false;

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      await expect(liquidate).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(violatorLoanId);
    });

    it("Should fail to liquidate when liquidator loan is unknown", async () => {
      const {
        hub,
        loanManager,
        pools,
        loanId: violatorLoanId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // verify unknown
      const liquidatorLoanId = getRandomBytes(BYTES32_LENGTH);
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      expect(await loanManager.isUserLoanActive(liquidatorLoanId)).to.be.false;

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      await expect(liquidate).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(liquidatorLoanId);
    });

    it("Should fail to liquidate when sender is not liquidator loan owner", async () => {
      const {
        hub,
        loanManager,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      let liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // verify not owner
      liquidatorAccountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(liquidatorLoanId, liquidatorAccountId)).to.be.false;

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      await expect(liquidate)
        .to.be.revertedWithCustomError(loanManager, "NotAccountOwner")
        .withArgs(liquidatorLoanId, liquidatorAccountId);
    });

    it("Should fail to liquidate when when liquidator and violator loan are the same", async () => {
      const {
        hub,
        loanManager,
        pools,
        loanId: violatorLoanId,
        accountId: violatorAccountId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // liquidator loan is violator loan
      const liquidatorLoanId = violatorLoanId;
      const liquidatorAccountId = violatorAccountId;

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      await expect(liquidate).to.be.revertedWithCustomError(loanManager, "SameLoan").withArgs(liquidatorLoanId);
    });

    it("Should fail to liquidate when when violator loan doesn't have the borrow", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.ETH.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate)
        .to.be.revertedWithCustomError(liquidationLogic, "NoBorrowInLoanForPool")
        .withArgs(violatorLoanId, pools.ETH.poolId);
    });

    it("Should fail to liquidate when when violator loan doesn't have the collateral", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.USDC.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate)
        .to.be.revertedWithCustomError(liquidationLogic, "NoCollateralInLoanForPool")
        .withArgs(violatorLoanId, pools.USDC.poolId);
    });

    it("Should fail to liquidate when when loan type mismatch", async () => {
      const {
        admin,
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId: violatorLoanId,
        loanTypeId: violatorLoanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create loan type
      const liquidatorLoanTypeId = 24;
      const loanTargetHealth = BigInt(1.1e4);
      await loanManager.connect(admin).createLoanType(liquidatorLoanTypeId, loanTargetHealth);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager
        .connect(hub)
        .createUserLoan(nonce, liquidatorAccountId, liquidatorLoanTypeId, liquidatorLoanName);

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate)
        .to.be.revertedWithCustomError(liquidationLogic, "LoanTypeMismatch")
        .withArgs(violatorLoanTypeId, liquidatorLoanTypeId);
    });

    it("Should fail to liquidate when when borrow type mismatch", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // borrow USDC in liquidator loan
      const oldLiquidatorVariableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({
        variableInterestIndex: oldLiquidatorVariableInterestIndex,
        stableInterestRate,
      });
      const liquidatorBorrowAmount = BigInt(50e6); // 50 USDC
      await loanManager
        .connect(hub)
        .borrow(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorBorrowAmount, stableInterestRate);

      // prepare liquidation
      const ethNodeOutputData = getNodeOutputData(BigInt(1000e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate)
        .to.be.revertedWithCustomError(liquidationLogic, "BorrowTypeMismatch")
        .withArgs(violatorLoanId, liquidatorLoanId, pools.USDC.poolId);
    });

    it("Should fail to liquidate when when violator loan is over-collateralised", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // Violator:
      // Collateral 1 ETH = $1,500 -> CF 70% -> $1050
      // Borrow 1,000 USDC = $1,000
      let ethNodeOutputData = getNodeOutputData(BigInt(1500e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // liquidate when violator loan over-collateralised
      const repayAmount = BigInt(100e6); // 100 USDC
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate)
        .to.be.revertedWithCustomError(liquidationLogic, "OverCollateralizedLoan")
        .withArgs(violatorLoanId);

      // Violator:
      // Collateral 1 ETH = $1,400 -> CF 70% -> $980
      // Borrow 1,000 USDC = $1,000
      ethNodeOutputData = getNodeOutputData(BigInt(1400e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // liquidate when violator loan under-collateralised
      await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
    });

    it("Should fail to liquidate when when insufficient collateral to seize", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // deposit USDC into liquidator loan
      const liquidatorDepositAmount = BigInt(1000e6); // 10,000 USDC
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      const usdcPrice = BigInt(1e18);

      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // Violator:
      // Collateral 1 ETH = $1,400 -> CF 70% -> $980
      // Borrow 1,000 USDC = $1,000
      const ethNodeOutputData = getNodeOutputData(BigInt(1400e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // calculate seized amount
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;

      // liquidate when insufficient collateral
      let minSeizedAmount = liquidatorCollateralFAmount + BigInt(1);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate).to.be.revertedWithCustomError(liquidationLogic, "InsufficientSeized");

      // liquidate when collateral okay
      minSeizedAmount = liquidatorCollateralFAmount;
      await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
    });

    it("Should fail to liquidate when when liquidator loan becomes under-collateralised", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        oracleManager,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // Violator:
      // Collateral 1 ETH = $1,400 -> CF 70% -> $980
      // Borrow 1,000 USDC = $1,000
      const ethNodeOutputData = getNodeOutputData(BigInt(1400e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);
      const usdcPrice = BigInt(1e18);

      // calculate amounts
      const repayAmount = BigInt(100e6); // 100 USDC
      const collateralFAmount = convToCollateralFAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        BigInt(1e18)
      );
      const seizeCollateralAmount = convToSeizedCollateralAmount(
        repayAmount,
        ethNodeOutputData.price,
        pools.ETH.tokenDecimals,
        usdcPrice,
        pools.USDC.tokenDecimals,
        pools.USDC.liquidationBonus
      );
      const seizeCollateralFAmount = toFAmount(seizeCollateralAmount, BigInt(1e18));
      const reserveCollateralFAmount = calcReserveCol(
        seizeCollateralFAmount,
        collateralFAmount,
        pools.ETH.liquidationFee
      );
      const liquidatorCollateralFAmount = seizeCollateralFAmount - reserveCollateralFAmount;
      const liquidatorCollateralAmount = toUnderlingAmount(liquidatorCollateralFAmount, BigInt(1e18));

      // calculate liquidator USDC to deposit TODO not hardcode
      const liquidatorDepositAmount = BigInt(35e6) - BigInt(1e6);
      const liquidatorDepositFAmount = liquidatorDepositAmount;
      const liquidatorDepositInterestIndex = BigInt(1e18);
      await pools.USDC.pool.setDepositPoolParams({
        fAmount: liquidatorDepositFAmount,
        depositInterestIndex: liquidatorDepositInterestIndex,
        priceFeed: { price: usdcPrice, decimals: pools.USDC.tokenDecimals },
      });
      await loanManager
        .connect(hub)
        .deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, liquidatorDepositAmount);

      // liquidate when when liquidator loan becomes under-collateralised
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      const liquidationLogic = await ethers.getContractAt("LiquidationLogic", loanManagerAddress);
      await expect(liquidate)
        .to.be.revertedWithCustomError(liquidationLogic, "UnderCollateralizedLoan")
        .withArgs(liquidatorLoanId);

      // liquidate when when liquidator loan remains over-collateralised
      await loanManager.connect(hub).deposit(liquidatorLoanId, liquidatorAccountId, pools.USDC.poolId, BigInt(1e6));
      await loanManager
        .connect(hub)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
    });

    it("Should fail to liquidate when sender is not hub", async () => {
      const {
        user,
        hub,
        loanManager,
        pools,
        loanId: violatorLoanId,
        loanTypeId,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // create liquidator loan
      const liquidatorAccountId = getAccountIdBytes("LIQUIDATOR_ACCOUNT_ID");
      const nonce = getRandomBytes(BYTES4_LENGTH);
      const liquidatorLoanId = generateLoanId(liquidatorAccountId, nonce);
      const liquidatorLoanName = getRandomBytes(BYTES32_LENGTH);
      await loanManager.connect(hub).createUserLoan(nonce, liquidatorAccountId, loanTypeId, liquidatorLoanName);

      // liquidate
      const repayAmount = BigInt(1);
      const minSeizedAmount = BigInt(0);
      const liquidate = loanManager
        .connect(user)
        .liquidate(
          violatorLoanId,
          liquidatorLoanId,
          liquidatorAccountId,
          pools.ETH.poolId,
          pools.USDC.poolId,
          repayAmount,
          minSeizedAmount
        );
      await expect(liquidate)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Switch Borrow Type", () => {
    it("Should successfully switch variable borrow type", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcVariableInterestIndex: oldVariableInterestIndex,
      } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;

      // prepare switch borrow type
      const newVariableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.1e18);
      await pools.USDC.pool.setBorrowPoolParams({
        variableInterestIndex: newVariableInterestIndex,
        stableInterestRate,
      });

      // switch variable borrow type to stable borrow type
      const switchBorrowType = await loanManager
        .connect(hub)
        .switchBorrowType(loanId, accountId, poolId, stableInterestRate);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(switchBorrowType)
        .to.emit(pool, "PreparePoolForSwitchBorrowType")
        .withArgs(borrowAmount, stableInterestRate);
      await expect(switchBorrowType).to.emit(pool, "UpdatePoolWithSwitchBorrowType").withArgs(borrowAmount, true, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(switchBorrowType).to.emit(loanManagerLogic, "SwitchBorrowType").withArgs(loanId, poolId);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: calcBorrowBalance(borrowAmount, newVariableInterestIndex, oldVariableInterestIndex),
          lastInterestIndex: BigInt(1e18),
          stableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
    });

    it("Should successfully switch stable borrow type", async () => {
      const {
        hub,
        loanManager,
        loanManagerAddress,
        pools,
        loanId,
        accountId,
        loanTypeId,
        borrowAmount,
        usdcStableInterestRate: oldStableInterestRate,
      } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare switch borrow type
      const variableInterestIndex = BigInt(1.1e18);
      const stableInterestRate = BigInt(0.15e18);
      await pools.USDC.pool.setBorrowPoolParams({
        variableInterestIndex,
        stableInterestRate,
      });

      // calculate interest
      const timestamp = (await getLatestBlockTimestamp()) + getRandomInt(SECONDS_IN_HOUR);
      await time.setNextBlockTimestamp(timestamp);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(timestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrowBalance = calcBorrowBalance(oldBorrow.balance, newInterestIndex, oldBorrow.lastInterestIndex);

      // switch variable borrow type to stable borrow type
      const switchBorrowType = await loanManager.connect(hub).switchBorrowType(loanId, accountId, poolId, 0);

      // check events
      await expect(switchBorrowType).to.emit(pool, "PreparePoolForSwitchBorrowType").withArgs(borrowAmount, 0);
      await expect(switchBorrowType)
        .to.emit(pool, "UpdatePoolWithSwitchBorrowType")
        .withArgs(borrowAmount, false, oldStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(switchBorrowType).to.emit(loanManagerLogic, "SwitchBorrowType").withArgs(loanId, poolId);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: borrowBalance,
          lastInterestIndex: variableInterestIndex,
          stableInterestRate: BigInt(0),
          lastStableUpdateTimestamp: BigInt(0),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[0]).to.equal(accountId);
      expect(userLoan[1]).to.equal(loanTypeId);
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));

      // check loan pool
      const loanPool = await loanManager.getLoanPool(loanTypeId, poolId);
      expect(loanPool[1]).to.equal(borrowAmount);
    });

    it("Should fail to switch borrow type when user loan is unknown", async () => {
      const { hub, loanManager, pools, accountId, usdcStableInterestRate } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // switch borrow type
      const switchBorrowType = loanManager
        .connect(hub)
        .switchBorrowType(loanId, accountId, pools.USDC.poolId, usdcStableInterestRate);
      await expect(switchBorrowType).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to switch borrow type when user is not owner", async () => {
      const { hub, loanManager, pools, loanId, usdcStableInterestRate } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // verify not owner
      const accountId = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await loanManager.isUserLoanOwner(loanId, accountId)).to.be.false;

      // switch borrow type
      const switchBorrowType = loanManager
        .connect(hub)
        .switchBorrowType(loanId, accountId, pools.USDC.poolId, usdcStableInterestRate);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManager, "NotAccountOwner")
        .withArgs(loanId, accountId);
    });

    it("Should fail to switch borrow type when user loan doesn't have the variable borrow", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId, usdcStableInterestRate } =
        await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      // switch borrow type when incorrect pool
      let switchBorrowType = loanManager
        .connect(hub)
        .switchBorrowType(loanId, accountId, pools.ETH.poolId, usdcStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoVariableBorrowInLoanForPool")
        .withArgs(loanId, pools.ETH.poolId);

      // switch borrow type when stable borrow
      switchBorrowType = loanManager
        .connect(hub)
        .switchBorrowType(loanId, accountId, pools.USDC.poolId, usdcStableInterestRate);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoVariableBorrowInLoanForPool")
        .withArgs(loanId, pools.USDC.poolId);
    });

    it("Should fail to switch borrow type when user loan doesn't have the stable borrow", async () => {
      const { hub, loanManager, loanManagerAddress, pools, loanId, accountId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // switch borrow type when incorrect pool
      let switchBorrowType = loanManager.connect(hub).switchBorrowType(loanId, accountId, pools.ETH.poolId, 0);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoStableBorrowInLoanForPool")
        .withArgs(loanId, pools.ETH.poolId);

      // switch borrow type when variable borrow
      switchBorrowType = loanManager.connect(hub).switchBorrowType(loanId, accountId, pools.USDC.poolId, 0);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoStableBorrowInLoanForPool")
        .withArgs(loanId, pools.USDC.poolId);
    });

    it("Should fail to switch borrow type when user loan is under-collateralised", async () => {
      const { hub, loanManager, loanManagerAddress, oracleManager, pools, loanId, accountId, usdcStableInterestRate } =
        await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      const { poolId } = pools.USDC;

      // Violator:
      // Collateral 1 ETH = $1,428 -> 70% CF = $996.6
      // Borrow 1,000 USDC = $1,000
      let ethNodeOutputData = getNodeOutputData(BigInt(1428e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);

      // switch variable borrow type to stable borrow type
      const switchBorrowType = loanManager
        .connect(hub)
        .switchBorrowType(loanId, accountId, poolId, usdcStableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManagerLogic, "UnderCollateralizedLoan")
        .withArgs(loanId);

      // switch borrow type when okay
      ethNodeOutputData = getNodeOutputData(BigInt(1429e18));
      await oracleManager.setNodeOutput(pools.ETH.poolId, pools.ETH.tokenDecimals, ethNodeOutputData);
      await loanManager.connect(hub).switchBorrowType(loanId, accountId, poolId, usdcStableInterestRate);
    });

    it("Should fail to switch borrow type when sender is not hub", async () => {
      const { user, loanManager, pools, loanId, accountId, usdcStableInterestRate } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // switch borrow type
      const switchBorrowType = loanManager
        .connect(user)
        .switchBorrowType(loanId, accountId, pools.USDC.poolId, usdcStableInterestRate);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, HUB_ROLE);
    });
  });

  describe("Rebalance Up", () => {
    it("Should successfully rebalance up", async () => {
      const { rebalancer, loanManager, loanManagerAddress, pools, loanId, borrowAmount } = await loadFixture(
        depositEtherAndStableBorrowUSDCFixture
      );

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare rebalance up
      const variableInterestIndex = BigInt(1.05e18);
      const stableInterestRate = BigInt(0.2e18);
      await pools.USDC.pool.setBorrowPoolParams({
        variableInterestIndex,
        stableInterestRate,
      });

      // rebalance up
      const rebalanceUp = await loanManager.connect(rebalancer).rebalanceUp(loanId, poolId);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(rebalanceUp).to.emit(pool, "PreparePoolForRebalanceUp").withArgs();
      await expect(rebalanceUp)
        .to.emit(pool, "UpdatePoolWithRebalanceUp")
        .withArgs(borrowAmount, oldBorrow.stableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(rebalanceUp).to.emit(loanManagerLogic, "RebalanceUp").withArgs(loanId, poolId, stableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(latestBlockTimestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: calcBorrowBalance(borrowAmount, newInterestIndex, oldBorrow.lastInterestIndex),
          lastInterestIndex: newInterestIndex,
          stableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));
    });

    it("Should fail to rebalance up when user loan is unknown", async () => {
      const { rebalancer, loanManager, pools } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // rebalance up
      const rebalanceUp = loanManager.connect(rebalancer).rebalanceUp(loanId, pools.USDC.poolId);
      await expect(rebalanceUp).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to rebalance up when user loan doesn't have the stable borrow", async () => {
      const { rebalancer, loanManager, loanManagerAddress, pools, loanId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // rebalance up when variable
      let poolId = pools.USDC.poolId;
      let rebalanceUp = loanManager.connect(rebalancer).rebalanceUp(loanId, poolId);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(rebalanceUp)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoStableBorrowInLoanForPool")
        .withArgs(loanId, poolId);

      // rebalance down when none
      poolId = pools.ETH.poolId;
      rebalanceUp = loanManager.connect(rebalancer).rebalanceUp(loanId, poolId);
      await expect(rebalanceUp)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoStableBorrowInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to rebalance up when sender doesn't have rebalance role", async () => {
      const { user, loanManager, pools, loanId } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // rebalance up
      const rebalanceUp = loanManager.connect(user).rebalanceUp(loanId, pools.USDC.poolId);
      await expect(rebalanceUp)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, REBALANCER_ROLE);
    });
  });

  describe("Rebalance Down", () => {
    it("Should successfully rebalance down", async () => {
      const { rebalancer, loanManager, loanManagerAddress, pools, loanId, borrowAmount } = await loadFixture(
        depositEtherAndStableBorrowUSDCFixture
      );

      const { pool, poolId } = pools.USDC;
      const userLoanBefore = await loanManager.getUserLoan(loanId);
      const oldBorrow = userLoanBefore[5][0];

      // prepare rebalance down
      const variableInterestIndex = BigInt(1.05e18);
      const stableInterestRate = BigInt(0.05e18);
      const threshold = BigInt(0.05e18);
      await pools.USDC.pool.setRebalanceDownPoolParams({
        variableInterestIndex,
        stableInterestRate,
        threshold,
      });

      // rebalance down
      const rebalanceDown = await loanManager.connect(rebalancer).rebalanceDown(loanId, poolId);

      // check events
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      await expect(rebalanceDown).to.emit(pool, "PreparePoolForRebalanceDown").withArgs();
      await expect(rebalanceDown)
        .to.emit(pool, "UpdatePoolWithRebalanceDown")
        .withArgs(borrowAmount, oldBorrow.stableInterestRate);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(rebalanceDown)
        .to.emit(loanManagerLogic, "RebalanceDown")
        .withArgs(loanId, poolId, stableInterestRate);

      // check user loan
      const userLoan = await loanManager.getUserLoan(loanId);
      const newInterestIndex = calcBorrowInterestIndex(
        oldBorrow.stableInterestRate,
        oldBorrow.lastInterestIndex,
        BigInt(latestBlockTimestamp) - oldBorrow.lastStableUpdateTimestamp,
        true
      );
      const borrows: UserLoanBorrow[] = [
        {
          amount: borrowAmount,
          balance: calcBorrowBalance(borrowAmount, newInterestIndex, oldBorrow.lastInterestIndex),
          lastInterestIndex: newInterestIndex,
          stableInterestRate,
          lastStableUpdateTimestamp: BigInt(latestBlockTimestamp),
          rewardIndex: BigInt(0),
        },
      ];
      expect(await loanManager.isUserLoanActive(loanId)).to.be.true;
      expect(userLoan[3]).to.deep.equal([poolId]);
      expect(userLoan[5]).to.deep.equal(borrows.map((bor) => Object.values(bor)));
    });

    it("Should fail to rebalance down when user loan is unknown", async () => {
      const { rebalancer, loanManager, pools } = await loadFixture(depositEtherAndStableBorrowUSDCFixture);

      // verify unknown
      const loanId = getRandomBytes(BYTES32_LENGTH);
      expect(await loanManager.isUserLoanActive(loanId)).to.be.false;

      // rebalance down
      const rebalanceDown = loanManager.connect(rebalancer).rebalanceDown(loanId, pools.USDC.poolId);
      await expect(rebalanceDown).to.be.revertedWithCustomError(loanManager, "UnknownUserLoan").withArgs(loanId);
    });

    it("Should fail to rebalance down when user loan doesn't have the stable borrow", async () => {
      const { rebalancer, loanManager, loanManagerAddress, pools, loanId } = await loadFixture(
        depositEtherAndVariableBorrowUSDCFixture
      );

      // rebalance down when variable
      let poolId = pools.USDC.poolId;
      let rebalanceDown = loanManager.connect(rebalancer).rebalanceDown(loanId, poolId);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(rebalanceDown)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoStableBorrowInLoanForPool")
        .withArgs(loanId, poolId);

      // rebalance down when none
      poolId = pools.ETH.poolId;
      rebalanceDown = loanManager.connect(rebalancer).rebalanceDown(loanId, poolId);
      await expect(rebalanceDown)
        .to.be.revertedWithCustomError(loanManagerLogic, "NoStableBorrowInLoanForPool")
        .withArgs(loanId, poolId);
    });

    it("Should fail to rebalance down when user loan borrow stable interest rate is below threshold", async () => {
      const { rebalancer, loanManager, loanManagerAddress, pools, loanId, usdcStableInterestRate } = await loadFixture(
        depositEtherAndStableBorrowUSDCFixture
      );

      const { pool, poolId } = pools.USDC;

      // prepare rebalance down
      const variableInterestIndex = BigInt(1.05e18);

      // rebalance down when stable interest rate below threhold
      let threshold = usdcStableInterestRate + BigInt(1);
      await pool.setRebalanceDownPoolParams({
        variableInterestIndex,
        stableInterestRate: usdcStableInterestRate,
        threshold,
      });
      const rebalanceDown = loanManager.connect(rebalancer).rebalanceDown(loanId, poolId);
      const loanManagerLogic = await ethers.getContractAt("LoanManagerLogic", loanManagerAddress);
      await expect(rebalanceDown).to.be.revertedWithCustomError(loanManagerLogic, "RebalanceDownThresholdNotReached");

      // rebalance down when stable interest rate okay
      threshold = usdcStableInterestRate;
      await pool.setRebalanceDownPoolParams({
        variableInterestIndex,
        stableInterestRate: usdcStableInterestRate,
        threshold,
      });
      await loanManager.connect(rebalancer).rebalanceDown(loanId, poolId);
    });

    it("Should fail to rebalance down when sender doesn't have rebalance role", async () => {
      const { user, loanManager, pools, loanId } = await loadFixture(depositEtherAndVariableBorrowUSDCFixture);

      // rebalance down
      const rebalanceDown = loanManager.connect(user).rebalanceDown(loanId, pools.USDC.poolId);
      await expect(rebalanceDown)
        .to.be.revertedWithCustomError(loanManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, REBALANCER_ROLE);
    });
  });

  describe("Update Loan Pools Reward Indexes", () => {
    it("Should successfully update loan pools reward indexes", async () => {});

    it("Should not update when timestamp hasn't increased", async () => {});

    it("Should not update collateral reward index when collateral used not above min amount", async () => {});

    it("Should not update borrow reward index when borrow used not above min amount", async () => {});
  });

  describe("Update User Loan Pools Rewards", () => {
    it("Should successfully update user loan pools rewards", async () => {
      // on each loan-colPool:
      //  * call updateRewardIndexes
      //  * call updateUserCollateralReward
      // on each loan-borPool pair:
      //  * call updateRewardIndexes
      //  * call updateUserBorrowReward
    });
  });
});
