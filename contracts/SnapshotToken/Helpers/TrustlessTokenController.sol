pragma solidity 0.4.25;

import "./MTokenController.sol";


contract TrustlessTokenController is
    MTokenController
{
    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MTokenController
    //

    function mOnTransfer(
        address /*from*/,
        address /*to*/,
        uint256 /*amount*/
    )
        internal
        returns (bool allow)
    {
        return true;
    }

    function mOnApprove(
        address /*owner*/,
        address /*spender*/,
        uint256 /*amount*/
    )
        internal
        returns (bool allow)
    {
        return true;
    }
}
