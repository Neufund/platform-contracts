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
    bool allowDestroyTokens = true;
    bool allowGenerateTokens = true;
    bool allowChangeNominee = true;
    bool allowChangeTokenController = true;

    function resetAllowance()
        public
    {
        allowOnTransfer = true;
        allowDestroyTokens = true;
        allowGenerateTokens = true;
        allowChangeNominee = true;
        allowChangeTokenController = true;
    }

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

    function onTransfer(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return allowOnTransfer;
    }

    function setAllowOnTransfer(bool _allow)
        public
    {
        allowOnTransfer = _allow;
    }


    function onGenerateTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return allowGenerateTokens;
    }

    function setAllowOnGenerateTokens(bool _allow)
        public
    {
        allowGenerateTokens = _allow;
    }


    function onDestroyTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return allowDestroyTokens;
    }

    function setAllowDestroyTokens(bool _allow)
        public
    {
        allowDestroyTokens = _allow;
    }


    function onChangeTokenController(address, address)
        public
        constant
        returns (bool)
    {
        return allowChangeTokenController;
    }

    function setAllowChangeTokenController(bool _allow)
        public
    {
        allowChangeTokenController = _allow;
    }

    function setAllowChangeNominee(bool _allow)
        public
    {
        allowChangeNominee = _allow;
    }

}
