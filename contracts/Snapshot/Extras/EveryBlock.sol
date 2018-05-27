pragma solidity 0.4.24;

import "../MSnapshotPolicy.sol";


/// @title creates snapshot id on each block
/// @dev this is snapshotting mode of MineMe token
contract EveryBlock is MSnapshotPolicy {

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
        return block.number;
    }

    function mCurrentSnapshotId()
        internal
        constant
        returns (uint256)
    {
        return block.number;
    }
}
