pragma solidity 0.4.24;

import "../Standards/ISnapshotable.sol";
import "./Daily.sol";


/// @title creates snapshot id on each day boundary and allows to create additional snapshots within a given day
/// @dev snapshots are encoded in single uint256, where high 128 bits represents a day number (from unix epoch) and low 128 bits represents additional snapshots within given day create via ISnapshotable
contract DailyAndSnapshotable is
    Daily,
    ISnapshotable
{

    ////////////////////////
    // Mutable state
    ////////////////////////

    uint256 private _currentSnapshotId;

    ////////////////////////
    // Constructor
    ////////////////////////

    /// @param start snapshotId from which to start generating values
    /// @dev start must be for the same day or 0, required for token cloning
    constructor(uint256 start)
        internal
        Daily(start)
    {
        if (start > 0) {
            _currentSnapshotId = start;
        }
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    //
    // Implements ISnapshotable
    //

    function createSnapshot()
        public
        returns (uint256)
    {
        uint256 base = dayBase(uint128(block.timestamp));

        if (base > _currentSnapshotId) {
            // New day has started, create snapshot for midnight
            _currentSnapshotId = base;
        } else {
            // within single day, increase counter (assume 2**128 will not be crossed)
            _currentSnapshotId += 1;
        }

        // Log and return
        emit LogSnapshotCreated(_currentSnapshotId);
        return _currentSnapshotId;
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
        uint256 base = dayBase(uint128(block.timestamp));

        // New day has started
        if (base > _currentSnapshotId) {
            _currentSnapshotId = base;
            emit LogSnapshotCreated(base);
        }

        return _currentSnapshotId;
    }

    function mCurrentSnapshotId()
        internal
        constant
        returns (uint256)
    {
        uint256 base = dayBase(uint128(block.timestamp));

        return base > _currentSnapshotId ? base : _currentSnapshotId;
    }
}
