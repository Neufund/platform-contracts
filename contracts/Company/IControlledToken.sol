pragma solidity 0.4.26;

import "../Standards/IAgreement.sol";
import "../Standards/IERC677Token.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IClonedTokenParent.sol";
import "./IEquityTokenController.sol";
import "../Standards/ITokenControllerHook.sol";


// minimum set of interfaces required by controlled
contract IControlledToken is
    IClonedTokenParent,
    IERC223Token,
    ITokenControllerHook
{}
