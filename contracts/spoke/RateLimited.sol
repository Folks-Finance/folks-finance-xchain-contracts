// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

abstract contract RateLimited is AccessControlDefaultAdminRules {
    bytes32 public constant CONFIG_RATE_LIMIT_ROLE = keccak256("CONFIG_RATE_LIMIT");
    bytes32 public constant BOOST_RATE_LIMIT_ROLE = keccak256("BOOST_RATE_LIMIT");

    error PeriodTooLow();
    error PeriodTooHigh();
    error InvalidOffset();
    error InsufficientCapacity(uint256 capacity, uint256 requested);

    event PeriodUpdated(uint256 periodNumber, uint256 capacity);
    event CapacityIncreased(uint256 periodNumber, uint256 amount, uint256 newCapacity);
    event CapacityDecreased(uint256 periodNumber, uint256 amount, uint256 newCapacity);

    struct BucketConfig {
        uint32 period; // length of time in seconds before limit resets (1 hour - 1 week)
        uint32 offset; // used to control when change in period occurs
        uint256 limit; // max to consume per period
    }

    BucketConfig public bucketConfig;
    uint32 public currentPeriodNumber; // the period we are in
    uint256 public currentCapacity; // capacity in period

    /**
     * @notice Contructor
     * @param admin The default admin for RateLimiter
     * @param bucketConfig_ The initial bucket configuration
     */
    constructor(address admin, BucketConfig memory bucketConfig_) {
        _setBucketConfig(bucketConfig_);
        _grantRole(CONFIG_RATE_LIMIT_ROLE, admin);
        _grantRole(BOOST_RATE_LIMIT_ROLE, admin);
    }

    function setBucketConfig(BucketConfig memory newBucketConfig) external onlyRole(CONFIG_RATE_LIMIT_ROLE) {
        _setBucketConfig(newBucketConfig);
    }

    function boostCapacity(uint256 amount) external onlyRole(BOOST_RATE_LIMIT_ROLE) {
        _updatePeriod();

        // boost capacity temporarily
        currentCapacity += amount;
    }

    function _setBucketConfig(BucketConfig memory newBucketConfig) internal {
        if (newBucketConfig.period < 1 hours) revert PeriodTooLow();
        if (newBucketConfig.period > 1 weeks) revert PeriodTooHigh();
        if (newBucketConfig.offset >= newBucketConfig.period) revert InvalidOffset();

        // period is updated next time capacity is increased/decreased
        bucketConfig = newBucketConfig;
    }

    function _updatePeriod() internal {
        uint32 periodNumber = (uint32(block.timestamp) + bucketConfig.offset) / bucketConfig.period;

        // if new period, reset capacity
        if (periodNumber != currentPeriodNumber) {
            currentPeriodNumber = periodNumber;
            currentCapacity = Math.max(_minLimit(), bucketConfig.limit);

            emit PeriodUpdated(periodNumber, currentCapacity);
        }
    }

    function _decreaseCapacity(uint256 amount) internal {
        _updatePeriod();

        // decrease capacity if availablity to
        if (currentCapacity < amount) revert InsufficientCapacity(currentCapacity, amount);
        currentCapacity -= amount;

        emit CapacityDecreased(currentPeriodNumber, amount, currentCapacity);
    }

    function _increaseCapacity(uint256 amount) internal {
        _updatePeriod();

        // increase capacity without overflowing
        unchecked {
            uint256 newCapacity = currentCapacity + amount;
            currentCapacity = newCapacity < currentCapacity ? type(uint256).max : newCapacity;
        }

        emit CapacityIncreased(currentPeriodNumber, amount, currentCapacity);
    }

    function _minLimit() internal view virtual returns (uint256);
}
