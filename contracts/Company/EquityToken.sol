pragma solidity 0.4.23;


import "./IEquityToken.sol";
import "../Snapshot/Daily.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../SnapshotToken/StandardSnapshotToken.sol";


contract EquityToken is
    IEquityToken,
    StandardSnapshotToken,
    Daily,
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
    // todo: constructor should take PLATFORM_TERMS and ETO_TERMS, however IEquityToken does not expose them
}
