pragma solidity 0.4.23;


/// @title Abstracts snapshot id creation logics
/// @dev Mixin (internal interface) of the snapshot policy which abstracts snapshot id creation logics from Snapshot contract
/// @dev to be implemented and such implementation should be mixed with Snapshot-derived contract, see EveryBlock for simplest example of implementation and StandardSnapshotToken
contract MSnapshotPolicy {

    ////////////////////////
    // Internal functions
    ////////////////////////

    // The snapshot Ids need to be strictly increasing.
    // Whenever the snaspshot id changes, a new snapshot will be created.
    // As long as the same snapshot id is being returned, last snapshot will be updated as this indicates that snapshot id didn't change
    //
    // Values passed to `hasValueAt` and `valuteAt` are required
    // to be less or equal to `mCurrentSnapshotId()`.
    function mAdvanceSnapshotId()
        internal
        returns (uint256);

    // this is a version of mAdvanceSnapshotId that does not modify state but MUST return the same value
    // it is required to implement ITokenSnapshots interface cleanly
    function mCurrentSnapshotId()
        internal
        constant
        returns (uint256);

}
