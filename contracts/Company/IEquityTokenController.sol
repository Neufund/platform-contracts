pragma solidity 0.4.24;

import "../ETO/IETOCommitmentObserver.sol";
import "../Standards/IAgreement.sol";
import "../Standards/IERC223Callback.sol";
import "../Standards/ITokenController.sol";


contract IEquityTokenController is
    IAgreement,
    ITokenController,
    IETOCommitmentObserver,
    IERC223Callback
{

    /// controls if sender is allowed to close token
    /// @dev msg.sender must be a token known to controller
    function onCloseToken(address sender) public constant returns (bool);

    /// controls if sender can change controller to newController
    /// @dev for this to succeed current controller must be already migrated to a new one
    function onChangeTokenController(address sender, address newController) public constant returns (bool);

    /// controls if sender can change old nominee to new nominee
    /// @dev for this to succeed typically a voting of the token holders should happen and new nominee should be set
    function onChangeNominee(address sender, address oldNominee, address newNominee) public constant returns (bool);
}
