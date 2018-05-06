pragma solidity 0.4.23;


import "./IEquityToken.sol";
import "../Snapshot/DailyAndSnapshotable.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../SnapshotToken/StandardSnapshotToken.sol";


contract EquityToken is
IEquityToken,
    // StandardSnapshotToken,
DailyAndSnapshotable,
TokenMetadata
{
    // TODO: implement
    //Company contract is token controller
    //Decimals is 0! tokens are not divisible but token per share

    //enable/disable trading
    //close token (liquidate)
    //whitelist distribution address
    //change token controller

    // transfers to 0 must be blocked
    // should we have way to recover balance?
}
