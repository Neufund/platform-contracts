pragma solidity 0.4.26;

import "../Standards/IAgreement.sol";
import "../Standards/IERC677Token.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IClonedTokenParent.sol";
import "./IEquityTokenController.sol";
import "../Standards/ITokenControllerHook.sol";


// minimum set of interfaces required by governance engine to control a token
// - must be snapshotable
// - must support ERC20 interface
// - must support ERC223 transfer
// - must support hook for standard token controller
contract IControlledToken is
    IClonedTokenParent,
    IERC223Token,
    ITokenControllerHook
{}
