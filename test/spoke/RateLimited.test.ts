import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, reset, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SimpleRateLimited__factory } from "../../typechain-types";
import { BYTES32_LENGTH, convertStringToBytes, getEmptyBytes } from "../utils/bytes";
import { BucketConfig } from "../utils/rateLimiter";
import { SECONDS_IN_DAY, SECONDS_IN_HOUR, SECONDS_IN_WEEK } from "../utils/time";

describe("RateLimited contract (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const CONFIG_RATE_LIMIT_ROLE = ethers.keccak256(convertStringToBytes("CONFIG_RATE_LIMIT"));
  const BOOST_RATE_LIMIT_ROLE = ethers.keccak256(convertStringToBytes("BOOST_RATE_LIMIT"));

  const STARTING_TIMESTAMP = BigInt(1897776000);

  async function deployRateLimiter() {
    const [admin, configAdmin, boostAdmin, user] = await ethers.getSigners();

    // deploy rate limiter
    const initialBucketConfig: BucketConfig = {
      period: BigInt(SECONDS_IN_DAY),
      offset: BigInt(0),
      limit: BigInt(100),
    };
    const minBucketLimit = BigInt(10);
    const rateLimiter = await new SimpleRateLimited__factory(user).deploy(admin, initialBucketConfig, minBucketLimit);

    // set config rate and boost rate roles
    await rateLimiter.connect(admin).grantRole(CONFIG_RATE_LIMIT_ROLE, configAdmin.address);
    await rateLimiter.connect(admin).grantRole(BOOST_RATE_LIMIT_ROLE, boostAdmin.address);

    // set time to beginning of a day and initialise period
    await time.increaseTo(STARTING_TIMESTAMP);
    await rateLimiter.updatePeriod();

    return { configAdmin, boostAdmin, user, rateLimiter, initialBucketConfig, minBucketLimit };
  }

  // clear timestamp changes
  after(async () => {
    await reset();
  });

  describe("Deployment", () => {
    it("Should set roles and bucket config correctly", async () => {
      const { configAdmin, boostAdmin, rateLimiter, initialBucketConfig, minBucketLimit } =
        await loadFixture(deployRateLimiter);

      // check config rate and boost rate roles
      expect(await rateLimiter.getRoleAdmin(CONFIG_RATE_LIMIT_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await rateLimiter.hasRole(CONFIG_RATE_LIMIT_ROLE, configAdmin.address)).to.be.true;
      expect(await rateLimiter.getRoleAdmin(BOOST_RATE_LIMIT_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await rateLimiter.hasRole(BOOST_RATE_LIMIT_ROLE, boostAdmin.address)).to.be.true;

      // check state
      expect(await rateLimiter.bucketConfig()).to.deep.equal(Object.values(initialBucketConfig));
      expect(await rateLimiter.minBucketLimit()).to.equal(minBucketLimit);
      expect(await rateLimiter.currentPeriodNumber()).to.equal(
        (STARTING_TIMESTAMP + initialBucketConfig.offset) / initialBucketConfig.period
      );
      expect(await rateLimiter.currentCapacity()).to.equal(initialBucketConfig.limit);
    });
  });

  describe("Set Bucket Config", () => {
    it("Should successfuly set bucket config", async () => {
      const { configAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // set config
      const config: BucketConfig = {
        period: BigInt(SECONDS_IN_DAY),
        offset: BigInt(SECONDS_IN_HOUR),
        limit: BigInt(10),
      };
      await rateLimiter.connect(configAdmin).setBucketConfig(config);

      // check state
      expect(await rateLimiter.bucketConfig()).to.deep.equal(Object.values(config));
    });

    it("Should fail to set bucket config when sender is not config admin", async () => {
      const { user, rateLimiter } = await loadFixture(deployRateLimiter);

      const config: BucketConfig = {
        period: BigInt(SECONDS_IN_HOUR),
        offset: BigInt(SECONDS_IN_HOUR),
        limit: BigInt(10),
      };
      const setConfig = rateLimiter.connect(user).setBucketConfig(config);
      await expect(setConfig)
        .to.be.revertedWithCustomError(rateLimiter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, CONFIG_RATE_LIMIT_ROLE);
    });

    it("Should fail to set bucket config when period is less than 1 hour", async () => {
      const { configAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // set config
      const config: BucketConfig = {
        period: BigInt(SECONDS_IN_HOUR) - BigInt(1),
        offset: BigInt(0),
        limit: BigInt(100),
      };
      const setConfig = rateLimiter.connect(configAdmin).setBucketConfig(config);
      await expect(setConfig).to.be.revertedWithCustomError(rateLimiter, "PeriodTooLow");
    });

    it("Should fail to set bucket config when period is greater than 1 week", async () => {
      const { configAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // set config
      const config: BucketConfig = {
        period: BigInt(SECONDS_IN_WEEK) + BigInt(1),
        offset: BigInt(0),
        limit: BigInt(100),
      };
      const setConfig = rateLimiter.connect(configAdmin).setBucketConfig(config);
      await expect(setConfig).to.be.revertedWithCustomError(rateLimiter, "PeriodTooHigh");
    });

    it("Should fail to set bucket config when offset is not less than period", async () => {
      const { configAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // set config
      const config: BucketConfig = {
        period: BigInt(SECONDS_IN_DAY),
        offset: BigInt(SECONDS_IN_DAY),
        limit: BigInt(100),
      };
      const setConfig = rateLimiter.connect(configAdmin).setBucketConfig(config);
      await expect(setConfig).to.be.revertedWithCustomError(rateLimiter, "InvalidOffset");
    });
  });

  describe("Update period", () => {
    it("Should update period when new period", async () => {
      const { rateLimiter, initialBucketConfig } = await loadFixture(deployRateLimiter);

      // decrease capacity so different to limit
      await rateLimiter.decreaseCapacity(BigInt(1));
      expect(await rateLimiter.currentCapacity()).to.not.equal(initialBucketConfig.limit);

      // increase time so new period
      const newTimestamp = STARTING_TIMESTAMP + BigInt(SECONDS_IN_WEEK);
      await time.increaseTo(newTimestamp);

      // update period
      const updatePeriod = await rateLimiter.updatePeriod();

      // check is updated
      const newPeriodNumber = (newTimestamp + initialBucketConfig.offset) / initialBucketConfig.period;
      await expect(updatePeriod)
        .to.emit(rateLimiter, "PeriodUpdated")
        .withArgs(newPeriodNumber, initialBucketConfig.limit);
      expect(await rateLimiter.currentPeriodNumber()).to.equal(newPeriodNumber);
      expect(await rateLimiter.currentCapacity()).to.equal(initialBucketConfig.limit);
    });

    it("Should not update period when same period", async () => {
      const { rateLimiter, initialBucketConfig } = await loadFixture(deployRateLimiter);

      // decrease capacity so different to limit
      await rateLimiter.decreaseCapacity(BigInt(1));
      expect(await rateLimiter.currentCapacity()).to.not.equal(initialBucketConfig.limit);

      // before
      const oldPeriodNumber = await rateLimiter.currentPeriodNumber();
      const oldCapacity = await rateLimiter.currentCapacity();

      // update period
      const updatePeriod = await rateLimiter.updatePeriod();
      await expect(updatePeriod).to.not.emit(rateLimiter, "PeriodUpdated");
      expect(await rateLimiter.currentPeriodNumber()).to.equal(oldPeriodNumber);
      expect(await rateLimiter.currentCapacity()).to.equal(oldCapacity);
    });
  });

  describe("Boost Capacity", () => {
    it("Should successfuly boost capacity", async () => {
      const { boostAdmin, rateLimiter, initialBucketConfig } = await loadFixture(deployRateLimiter);

      // boost capacity
      const amount = BigInt(100);
      await rateLimiter.connect(boostAdmin).boostCapacity(amount);
      expect(await rateLimiter.currentCapacity()).to.equal(initialBucketConfig.limit + amount);
    });

    it("Should fail to boost capacity when sender is not boost admin", async () => {
      const { user, rateLimiter } = await loadFixture(deployRateLimiter);

      // boost capacity
      const amount = BigInt(100);
      const boostCapacity = rateLimiter.connect(user).boostCapacity(amount);
      await expect(boostCapacity)
        .to.be.revertedWithCustomError(rateLimiter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, BOOST_RATE_LIMIT_ROLE);
    });

    it("Should update period when new period", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // increase time so new period
      const newTimestamp = STARTING_TIMESTAMP + BigInt(SECONDS_IN_WEEK);
      await time.increaseTo(newTimestamp);

      // boost capacity
      const amount = BigInt(100);
      const boostCapacity = await rateLimiter.connect(boostAdmin).boostCapacity(amount);
      await expect(boostCapacity).to.emit(rateLimiter, "PeriodUpdated");
    });
  });

  describe("Decrease Capacity", () => {
    it("Should successfuly decrease capacity", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      const periodNumber = await rateLimiter.currentPeriodNumber();
      const capacity = await rateLimiter.currentCapacity();

      // decrease capacity
      const amount = BigInt(1);
      const decreaseCapacity = await rateLimiter.connect(boostAdmin).decreaseCapacity(amount);
      const newCapacity = capacity - amount;
      await expect(decreaseCapacity)
        .to.emit(rateLimiter, "CapacityDecreased")
        .withArgs(periodNumber, amount, newCapacity);
      expect(await rateLimiter.currentCapacity()).to.equal(newCapacity);
    });

    it("Should fail to decrease capacity when insufficient availability", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      const capacity = await rateLimiter.currentCapacity();

      // decrease capacity
      const amount = capacity + BigInt(1);
      const decreaseCapacity = rateLimiter.connect(boostAdmin).decreaseCapacity(amount);
      await expect(decreaseCapacity)
        .to.be.revertedWithCustomError(rateLimiter, "InsufficientCapacity")
        .withArgs(capacity, amount);
    });

    it("Should update period when new period", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // increase time so new period
      const newTimestamp = STARTING_TIMESTAMP + BigInt(SECONDS_IN_WEEK);
      await time.increaseTo(newTimestamp);

      // decrease capacity
      const amount = BigInt(1);
      const decreaseCapacity = await rateLimiter.connect(boostAdmin).decreaseCapacity(amount);
      await expect(decreaseCapacity).to.emit(rateLimiter, "PeriodUpdated");
    });
  });

  describe("Increase Capacity", () => {
    it("Should successfuly increase capacity", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      const periodNumber = await rateLimiter.currentPeriodNumber();
      const capacity = await rateLimiter.currentCapacity();

      // increase capacity
      const amount = BigInt(1);
      const increaseCapacity = await rateLimiter.connect(boostAdmin).increaseCapacity(amount);
      const newCapacity = capacity + amount;
      await expect(increaseCapacity)
        .to.emit(rateLimiter, "CapacityIncreased")
        .withArgs(periodNumber, amount, newCapacity);
      expect(await rateLimiter.currentCapacity()).to.equal(newCapacity);
    });

    it("Should not overflow when capacity exceeds max uint256", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      const periodNumber = await rateLimiter.currentPeriodNumber();
      const capacity = await rateLimiter.currentCapacity();

      // increase capacity
      const amount = ethers.MaxUint256 - capacity + BigInt(1);
      const increaseCapacity = await rateLimiter.connect(boostAdmin).increaseCapacity(amount);
      await expect(increaseCapacity)
        .to.emit(rateLimiter, "CapacityIncreased")
        .withArgs(periodNumber, amount, ethers.MaxUint256);
      expect(await rateLimiter.currentCapacity()).to.equal(ethers.MaxUint256);
    });

    it("Should update period when new period", async () => {
      const { boostAdmin, rateLimiter } = await loadFixture(deployRateLimiter);

      // increase time so new period
      const newTimestamp = STARTING_TIMESTAMP + BigInt(SECONDS_IN_WEEK);
      await time.increaseTo(newTimestamp);

      // increase capacity
      const amount = BigInt(1);
      const increaseCapacity = await rateLimiter.connect(boostAdmin).increaseCapacity(amount);
      await expect(increaseCapacity).to.emit(rateLimiter, "PeriodUpdated");
    });
  });
});
