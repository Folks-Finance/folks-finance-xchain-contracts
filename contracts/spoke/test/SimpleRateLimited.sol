// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "../RateLimited.sol";

contract SimpleRateLimited is AccessControlDefaultAdminRules, RateLimited {
    uint256 public immutable minBucketLimit;

    constructor(
        address admin,
        BucketConfig memory bucketConfig,
        uint256 _minBucketLimit
    ) AccessControlDefaultAdminRules(1 days, admin) RateLimited(admin, bucketConfig) {
        minBucketLimit = _minBucketLimit;
    }

    function updatePeriod() external {
        _updatePeriod();
    }

    function decreaseCapacity(uint256 amount) external {
        _decreaseCapacity(amount);
    }

    function increaseCapacity(uint256 amount) external {
        _increaseCapacity(amount);
    }

    function _minLimit() internal view override returns (uint256) {
        return minBucketLimit;
    }
}
