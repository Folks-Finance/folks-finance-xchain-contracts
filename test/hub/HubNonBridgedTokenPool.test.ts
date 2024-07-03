import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  HubNonBridgedTokenPool__factory,
  HubPoolLogged__factory,
  HubPoolLogic__factory,
  MockOracleManager__factory,
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
import { Action, Finality, MessageParams, buildMessagePayload } from "../utils/messages/messages";
import { SECONDS_IN_DAY, getLatestBlockTimestamp } from "../utils/time";
import { PoolData, getInitialPoolData } from "./libraries/assets/poolData";

describe("HubNonBridgedTokenPool (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const PARAM_ROLE = ethers.keccak256(convertStringToBytes("PARAM"));
  const ORACLE_ROLE = ethers.keccak256(convertStringToBytes("ORACLE"));
  const HUB_ROLE = ethers.keccak256(convertStringToBytes("HUB"));
  const LOAN_MANAGER_ROLE = ethers.keccak256(convertStringToBytes("LOAN_MANAGER"));

  async function deployHubNonBridgedTokenPoolFixture() {
    const [admin, hub, loanManager, user, ...unusedUsers] = await ethers.getSigners();

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
    const spokeChainId = 4;
    const spokeAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    const hubPool = await new HubNonBridgedTokenPool__factory(
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
      spokeChainId,
      spokeAddress
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
      spokeChainId,
      spokeAddress,
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
        spokeChainId,
        spokeAddress,
      } = await loadFixture(deployHubNonBridgedTokenPoolFixture);

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

      // check state - HubNonBridgedTokenPool
      expect(await hubPool.getChainSpoke(spokeChainId)).to.equal(spokeAddress);
    });
  });

  describe("Send Token", () => {
    it("Should successfully send token with empty extra args", async () => {
      const { admin, user, hubPool, spokeChainId, spokeAddress } = await loadFixture(
        deployHubNonBridgedTokenPoolFixture
      );

      // deploy mock hub so can emit event with message
      const hub = await new HubPoolLogged__factory(user).deploy(hubPool);
      const hubAddress = await hub.getAddress();
      await hubPool.connect(admin).grantRole(HUB_ROLE, hub);

      // deploy mock bridge router so can get adapter address
      const bridgeRouter = await new BridgeRouterSender__factory(user).deploy();
      const adapterId = BigInt(2);
      const adapter = getRandomAddress();
      await bridgeRouter.setAdapter(adapter);

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
      const extraArgs = "0x";
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
    });
  });
});
