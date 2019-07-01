pragma solidity 0.4.26;

import "../SnapshotToken/StandardToken.sol";
import "../SnapshotToken/Helpers/TrustlessTokenController.sol";


contract TestToken is
    StandardToken,
    TrustlessTokenController
{

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(uint256 initialBalance)
        StandardToken()
        public
    {
        _balances[msg.sender] = initialBalance;
    }
}
