pragma solidity 0.4.25;

import "../Zeppelin/StandardToken.sol";
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
