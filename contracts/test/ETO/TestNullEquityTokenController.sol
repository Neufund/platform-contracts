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

    ////////////////////////
    // Mutable state
    ////////////////////////

    bool internal _allowOnTransfer = true;
    bool internal _allowOnApprove = true;
    bool internal _allowDestroyTokens = true;
    bool internal _allowGenerateTokens = true;
    bool internal _allowChangeNominee = true;
    bool internal _allowChangeTokenController = true;

    //
    // Implements IEquityTokenController
    //

    function onChangeNominee(address, address, address)
        public
        constant
        returns (bool)
    {
        return _allowChangeNominee;
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
        return _allowOnTransfer;
    }

    function onApprove(address, address, uint256) 
        public
        constant
        returns (bool)
    {
        return _allowOnApprove;
    }

    function onGenerateTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return _allowGenerateTokens;
    }

    function onDestroyTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return _allowDestroyTokens;
    }

    function onChangeTokenController(address, address)
        public
        constant
        returns (bool)
    {
        return _allowChangeTokenController;
    }

    //
    //  Mock functions
    //

    function setAllowOnTransfer(bool allow)
        public
    {
        _allowOnTransfer = allow;
    }

    function setAllowApprove(bool allow)
        public
    {
        _allowOnApprove = allow;
    }

    function setAllowOnGenerateTokens(bool allow)
        public
    {
        _allowGenerateTokens = allow;
    }

    function setAllowDestroyTokens(bool allow)
        public
    {
        _allowDestroyTokens = allow;
    }

    function setAllowChangeTokenController(bool allow)
        public
    {
        _allowChangeTokenController = allow;
    }

    function setAllowChangeNominee(bool allow)
        public
    {
        _allowChangeNominee = allow;
    }

}
