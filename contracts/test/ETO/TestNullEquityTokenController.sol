pragma solidity 0.4.25;

import "../../Universe.sol";
import "../../Agreement.sol";
import "../../Company/IEquityTokenController.sol";
import "../TestEuroTokenControllerPassThrough.sol";


contract TestNullEquityTokenController is
    IEquityTokenController,
    TestEuroTokenControllerPassThrough,
    Agreement
{

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {

    }

    bool allowOnTransfer = true;
    bool allowApprove = true;
    bool allowDestroyTokens = true;
    bool allowGenerateTokens = true;
    bool allowChangeNominee = true;
    bool allowChangeTokenController = true;

    //
    // Implements IEquityTokenController
    //

    function onChangeNominee(address, address, address)
        public
        constant
        returns (bool)
    {
        return allowChangeNominee;
    }

    //
    // IERC223TokenCallback (proceeds disbursal)
    //

    /// allows contract to receive and distribure proceeds
    function tokenFallback(address, uint256, bytes)
        public
    {
    }

    //
    // Implements IETOCommitmentObserver
    //

    function commitmentObserver()
        public
        constant
        returns (address)
    {
        return address(0);
    }

    function onStateTransition(ETOState, ETOState)
        public
    {
        // msg.sender is ETOCommitment
    }

    //
    //  Implements ITokenController
    //

    function onTransfer(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return allowOnTransfer;
    }

    function onApprove(address, address, uint256) 
        public
        constant
        returns (bool)
    {
        return allowApprove;
    }

    function onGenerateTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return allowGenerateTokens;
    }

    function onDestroyTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return allowDestroyTokens;
    }

    function onChangeTokenController(address, address)
        public
        constant
        returns (bool)
    {
        return allowChangeTokenController;
    }

    //
    //  Mock functions
    //

    function setAllowOnTransfer(bool allow)
        public
    {
        allowOnTransfer = allow;
    }

    function setAllowApprove(bool allow)
        public
    {
        allowApprove = allow;
    }

    function setAllowOnGenerateTokens(bool allow)
        public
    {
        allowGenerateTokens = allow;
    }

    function setAllowDestroyTokens(bool allow)
        public
    {
        allowDestroyTokens = allow;
    }

    function setAllowChangeTokenController(bool allow)
        public
    {
        allowChangeTokenController = allow;
    }

    function setAllowChangeNominee(bool allow)
        public
    {
        allowChangeNominee = allow;
    }

}
