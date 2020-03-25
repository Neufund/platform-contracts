pragma solidity 0.4.26;

import "../Standards/IAgreement.sol";
import "../Standards/IERC223Callback.sol";
import "../Standards/ITokenController.sol";


contract IEquityTokenController is
    IAgreement,
    ITokenController,
    IERC223Callback
{
    /// controls if sender can change old nominee to new nominee
    /// @dev for this to succeed typically a voting of the token holders should happen and new nominee should be set
    function onChangeNominee(address sender, address oldNominee, address newNominee)
        public
        constant
        returns (bool);
}
