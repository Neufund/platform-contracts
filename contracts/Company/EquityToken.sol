pragma solidity 0.4.23;


import "./IEquityToken.sol";
import "../SnapshotToken/StandardSnapshotToken.sol";


contract EquityToken is
    StandardSnapshotToken
    // IEquityToken
{
    // TODO: implement
    //Company contract is token controller

    //enable/disable trading
    //close token (liquidate)
    //whitelist distribution address
    //move to other managing contract
}
