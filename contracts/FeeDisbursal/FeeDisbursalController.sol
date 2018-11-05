pragma solidity 0.4.25;

import "../AccessControl/AccessControlled.sol";
import "../Reclaimable.sol";
import "./IFeeDisbursalController.sol";

contract FeeDisbursalController is
    AccessControlled,
    Reclaimable,
    IFeeDisbursalController
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