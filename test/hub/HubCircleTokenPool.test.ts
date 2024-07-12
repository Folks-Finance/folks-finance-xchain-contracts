import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  HubCircleTokenPool__factory,
  HubPoolLogged__factory,
  HubPoolLogic__factory,
  MockOracleManager__factory,
  SimpleERC20Token__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  UINT256_LENGTH,
  convertEVMAddressToGenericAddress,
  convertGenericAddressToEVMAddress,
  convertNumberToBytes,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { Action, Finality, MessageParams, buildMessagePayload, extraArgsToBytes } from "../utils/messages/messages";
import { SECONDS_IN_DAY, getLatestBlockTimestamp } from "../utils/time";
import { PoolData, getInitialPoolData } from "./libraries/assets/poolData";

describe("HubCircleTokenPool (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const PARAM_ROLE = ethers.keccak256(convertStringToBytes("PARAM"));
  const ORACLE_ROLE = ethers.keccak256(convertStringToBytes("ORACLE"));
  const HUB_ROLE = ethers.keccak256(convertStringToBytes("HUB"));
  const LOAN_MANAGER_ROLE = ethers.keccak256(convertStringToBytes("LOAN_MANAGER"));

  async function deployHubCircleTokenPoolFixture() {
    const [admin, hub, loanManager, user, ...unusedUsers] = await ethers.getSigners();

    // deploy token and fund user
    const token = await new SimpleERC20Token__factory(user).deploy("USD Coin", "USDC");
    await token.mint(user, BigInt(1000e18));
    const tokenAddr = await token.getAddress();

    // libraries
    const hubPoolLogic = await new HubPoolLogic__factory(user).deploy();
    const hubPoolLogicAddress = await hubPoolLogic.getAddress();

    // deploy contract
    const tokenDecimals = 6;
    const fTokenName = "Folks USD Coin";
    const fTokenSymbol = "fUSDC";
    const poolId = 1;
    const initialPoolData = getInitialPoolData();
    const oracleManager = await new MockOracleManager__factory(user).deploy();
    const hubPool = await new HubCircleTokenPool__factory(
      {
        "contracts/hub/logic/HubPoolLogic.sol:HubPoolLogic": hubPoolLogicAddress,
      },
      user
    ).deploy(
      admin,
      hub,
      loanManager,
      tokenDecimals,
      fTokenName,
      fTokenSymbol,
      poolId,
      initialPoolData,
      oracleManager,
      token
    );

    // common
    const hubPoolAddress = await hubPool.getAddress();

    return {
      admin,
      hub,
      loanManager,
      user,
      unusedUsers,
      hubPool,
      hubPoolAddress,
      hubPoolLogicAddress,
      tokenDecimals,
      fTokenName,
      fTokenSymbol,
      poolId,
      initialPoolData,
      oracleManager,
      token,
      tokenAddr,
    };
  }

  async function addChainSpokeFixture() {
    const {
      admin,
      hub,
      loanManager,
      user,
      unusedUsers,
      hubPool,
      hubPoolAddress,
      hubPoolLogicAddress,
      tokenDecimals,
      fTokenName,
      fTokenSymbol,
      poolId,
      initialPoolData,
      oracleManager,
      token,
      tokenAddr,
    } = await loadFixture(deployHubCircleTokenPoolFixture);

    // add chain spoke
    const spokeChainId = 4;
    const spokeAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    await hubPool.connect(admin).addChainSpoke(spokeChainId, spokeAddress);

    return {
      admin,
      hub,
      loanManager,
      user,
      unusedUsers,
      hubPool,
      hubPoolAddress,
      hubPoolLogicAddress,
      tokenDecimals,
      fTokenName,
      fTokenSymbol,
      poolId,
      initialPoolData,
      oracleManager,
      token,
      spokeChainId,
      spokeAddress,
      tokenAddr,
    };
  }

  describe("Deployment", () => {
    it("Should set admin and contracts correctly", async () => {
      const {
        admin,
        hub,
        loanManager,
        tokenDecimals,
        fTokenName,
        fTokenSymbol,
        hubPool,
        poolId,
        initialPoolData,
        oracleManager,
        token,
      } = await loadFixture(deployHubCircleTokenPoolFixture);

      // check default admin role
      expect(await hubPool.owner()).to.equal(admin.address);
      expect(await hubPool.defaultAdmin()).to.equal(admin.address);
      expect(await hubPool.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await hubPool.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPool.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check other roles
      expect(await hubPool.getRoleAdmin(PARAM_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPool.hasRole(PARAM_ROLE, admin.address)).to.be.true;
      expect(await hubPool.getRoleAdmin(ORACLE_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPool.hasRole(ORACLE_ROLE, admin.address)).to.be.true;
      expect(await hubPool.getRoleAdmin(HUB_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPool.hasRole(HUB_ROLE, hub.address)).to.be.true;
      expect(await hubPool.getRoleAdmin(LOAN_MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await hubPool.hasRole(LOAN_MANAGER_ROLE, loanManager.address)).to.be.true;

      // check state - hubPool
      const latestBlockTimestamp = await getLatestBlockTimestamp();
      expect(await hubPool.poolId()).to.equal(poolId);
      expect(await hubPool.getLastUpdateTimestamp()).to.equal(latestBlockTimestamp);
      expect(await hubPool.getFeeData()).to.deep.equal(Object.values(initialPoolData.feeData));
      expect(await hubPool.getDepositData()).to.deep.equal(Object.values(initialPoolData.depositData));
      expect(await hubPool.getVariableBorrowData()).to.deep.equal(Object.values(initialPoolData.variableBorrowData));
      expect(await hubPool.getStableBorrowData()).to.deep.equal(Object.values(initialPoolData.stableBorrowData));
      expect(await hubPool.getCapsData()).to.deep.equal(Object.values(initialPoolData.capsData));
      expect(await hubPool.getConfigData()).to.deep.equal(Object.values(initialPoolData.configData));
      expect(await hubPool.getOracleManager()).to.equal(oracleManager);

      // check state - HubPool
      expect(await hubPool.getPoolId()).to.equal(poolId);
      expect(await hubPool.getTokenFeeClaimer()).to.equal(initialPoolData.feeData.tokenFeeClaimer);
      expect(await hubPool.getTokenFeeRecipient()).to.deep.equal(initialPoolData.feeData.tokenFeeRecipient);
      expect(await hubPool.decimals()).to.equal(tokenDecimals);
      expect(await hubPool.name()).to.equal(fTokenName);
      expect(await hubPool.symbol()).to.equal(fTokenSymbol);

      // check state - HubCircleTokenPool
      expect(await hubPool.token()).to.equal(token);
    });
  });

  describe("Add Chain Spoke", () => {
    it("Should succesfully add chain spoke", async () => {
      const { hubPool, spokeChainId, spokeAddress } = await loadFixture(addChainSpokeFixture);

      // verify added
      expect(await hubPool.getChainSpoke(spokeChainId)).to.equal(spokeAddress);
    });

    it("Should fail to add chain spoke when spoke already exists for given chain", async () => {
      const { admin, hubPool, spokeChainId } = await loadFixture(addChainSpokeFixture);

      // add chain spoke
      const spokeAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      const addChainSpoke = hubPool.connect(admin).addChainSpoke(spokeChainId, spokeAddress);
      await expect(addChainSpoke).to.be.revertedWithCustomError(hubPool, "ExistingChainSpoke").withArgs(spokeChainId);
    });

    it("Should fail to add chain spoke when sender is not param manager", async () => {
      const { user, hubPool } = await loadFixture(addChainSpokeFixture);

      // add chain spoke
      const spokeChainId = 23;
      const spokeAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      const addChainSpoke = hubPool.addChainSpoke(spokeChainId, spokeAddress);
      await expect(addChainSpoke)
        .to.be.revertedWithCustomError(hubPool, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Remove Chain Spoke", () => {
    it("Should succesfully remove chain spoke", async () => {
      const { admin, hubPool, spokeChainId } = await loadFixture(addChainSpokeFixture);

      // remove chain spoke
      await hubPool.connect(admin).removeChainSpoke(spokeChainId);
      await expect(hubPool.getChainSpoke(spokeChainId)).to.be.reverted;
    });

    it("Should fail to remove chain spoke when no spoke added for given chain", async () => {
      const { admin, hubPool } = await loadFixture(addChainSpokeFixture);

      // verify not added
      const spokeChainId = 24;
      await expect(hubPool.getChainSpoke(spokeChainId)).to.be.reverted;

      // remove chain spoke
      const removeChainSpoke = hubPool.connect(admin).removeChainSpoke(spokeChainId);
      await expect(removeChainSpoke).to.be.revertedWithCustomError(hubPool, "NoChainSpoke").withArgs(spokeChainId);
    });

    it("Should fail to remove chain spoke when sender is not param manager", async () => {
      const { user, hubPool } = await loadFixture(addChainSpokeFixture);

      // verify not added
      const spokeChainId = 24;
      await expect(hubPool.getChainSpoke(spokeChainId)).to.be.reverted;

      // remove chain spoke
      const removeChainSpoke = hubPool.connect(user).removeChainSpoke(spokeChainId);
      expect(removeChainSpoke)
        .to.be.revertedWithCustomError(hubPool, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, PARAM_ROLE);
    });
  });

  describe("Send Token", () => {
    it("Should successfully send token and return extra args", async () => {
      const { admin, user, hubPool, spokeChainId, spokeAddress, token, tokenAddr } =
        await loadFixture(addChainSpokeFixture);

      // fund pool (would normally be done by deposit/repay)
      const funding = BigInt(500e6);
      await token.connect(user).transfer(hubPool, funding);

      // deploy mock hub so can emit event with message
      const hub = await new HubPoolLogged__factory(user).deploy(hubPool);
      const hubAddress = await hub.getAddress();
      await hubPool.connect(admin).grantRole(HUB_ROLE, hub);

      // deploy mock bridge router so can get adapter address
      const bridgeRouter = await new BridgeRouterSender__factory(user).deploy();
      const adapterId = BigInt(2);
      const adapter = getRandomAddress();
      await bridgeRouter.setAdapter(adapter);

      // balances before
      const hubPoolBalance = await token.balanceOf(hubPool);
      const adapterBalance = await token.balanceOf(adapter);

      // get send token message
      const gasLimit = BigInt(30000);
      const accountId = getAccountIdBytes("ACCOUNT_ID");
      const recipient = convertEVMAddressToGenericAddress(getRandomAddress());
      const amount = BigInt(100e6);
      const getSendTokenMessage = await hub.getSendTokenMessage(
        bridgeRouter,
        adapterId,
        gasLimit,
        accountId,
        spokeChainId,
        amount,
        recipient
      );

      // verify message
      const MESSAGE_PARAMS: MessageParams = {
        adapterId,
        returnAdapterId: BigInt(0),
        receiverValue: BigInt(0),
        gasLimit,
        returnGasLimit: BigInt(0),
      };
      const payload = buildMessagePayload(
        Action.SendToken,
        accountId,
        convertGenericAddressToEVMAddress(recipient),
        convertNumberToBytes(amount, UINT256_LENGTH)
      );
      const extraArgs = extraArgsToBytes(tokenAddr, convertGenericAddressToEVMAddress(spokeAddress), amount);
      await expect(getSendTokenMessage)
        .to.emit(hub, "SendMessage")
        .withArgs(
          Object.values(MESSAGE_PARAMS),
          convertEVMAddressToGenericAddress(hubAddress),
          spokeChainId,
          spokeAddress,
          payload,
          Finality.FINALISED,
          extraArgs
        );

      // balances after
      expect(await token.balanceOf(hubPool)).to.equal(hubPoolBalance - amount);
      expect(await token.balanceOf(adapter)).to.equal(adapterBalance + amount);
    });
  });
});
