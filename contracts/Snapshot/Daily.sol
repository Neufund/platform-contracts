pragma solidity 0.4.25;

import "./MSnapshotPolicy.sol";


/// @title creates new snapshot id on each day boundary
/// @dev snapshot id is unix timestamp of current day boundary
contract Daily is MSnapshotPolicy {

    ////////////////////////
    // Constants
    ////////////////////////

    // Floor[2**128 / 1 days]
    uint256 private MAX_TIMESTAMP = 3938453320844195178974243141571391;

    ////////////////////////
    // Constructor
    ////////////////////////

    /// @param start snapshotId from which to start generating values, used to prevent cloning from incompatible schemes
    /// @dev start must be for the same day or 0, required for token cloning
    constructor(uint256 start) internal {
        // 0 is invalid value as we are past unix epoch
        if (start > 0) {
            uint256 base = dayBase(uint128(block.timestamp));
            // must be within current day base
            require(start >= base);
            // dayBase + 2**128 will not overflow as it is based on block.timestamp
            require(start < base + 2**128);
        }
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function snapshotAt(uint256 timestamp)
        public
        constant
        returns (uint256)
    {
        require(timestamp < MAX_TIMESTAMP);

        return dayBase(uint128(timestamp));
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MSnapshotPolicy
    //

    function mAdvanceSnapshotId()
        internal
        returns (uint256)
    {
        return mCurrentSnapshotId();
    }

    function mCurrentSnapshotId()
        internal
        constant
        returns (uint256)
    {
        // disregard overflows on block.timestamp, see MAX_TIMESTAMP
        return dayBase(uint128(block.timestamp));
    }

    function dayBase(uint128 timestamp)
        internal
        pure
        returns (uint256)
    {
        // Round down to the start of the day (00:00 UTC) and place in higher 128bits
        return 2**128 * (uint256(timestamp) / 1 days);
    }
}
