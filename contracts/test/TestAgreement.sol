pragma solidity 0.4.25;

import "../AccessControl/AccessControlled.sol";
import "../Agreement.sol";


contract TestAgreement is
    AccessControlled,
    Agreement
{
    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IAccessPolicy accessPolicy, IEthereumForkArbiter forkArbiter)
        Agreement(accessPolicy, forkArbiter)
        public
    {
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function signMeUp()
        public
        acceptAgreement(msg.sender)
    {
    }

    function signMeUpAgain()
        public
        acceptAgreement(msg.sender)
    {
    }
}
