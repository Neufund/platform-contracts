pragma solidity 0.4.25;

import "../AccessControl/AccessControlled.sol";
import "../Reclaimable.sol";


contract TestReclaimable is
    AccessControlled,
    Reclaimable
{
    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IAccessPolicy accessPolicy)
        AccessControlled(accessPolicy)
        Reclaimable()
        public
    {
    }
}
