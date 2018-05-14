pragma solidity 0.4.23;

import "./MSnapshotPolicy.sol";


/// @title creates new snapshot id on each day boundary
/// @dev snapshot id is unix timestamp of current day boundary
contract Daily is MSnapshotPolicy {

    ////////////////////////
    // Public functions
    ////////////////////////

    function snapshotAt(uint256 timestamp)
        public
        pure
        returns (uint256)
    {
        // Round down to the start of the day (00:00 UTC)
        return timestamp - (timestamp % 1 days);
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
        // Take the current time in UTC
        uint256 timestamp = block.timestamp;

        // Round down to the start of the day (00:00 UTC)
        timestamp -= timestamp % 1 days;

        return timestamp;
    }
}