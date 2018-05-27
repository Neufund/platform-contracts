pragma solidity 0.4.24;

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

    //
    // Implements IEquityTokenController
    //

    function onCloseToken(address)
        public
        constant
        returns (bool)
    {
        return true;
    }

    function onChangeTokenController(address, address)
        public
        constant
        returns (bool)
    {
        return true;
    }

    function onChangeNominee(address, address, address)
        public
        constant
        returns (bool)
    {
        return true;
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

    function onStateTransition(ETOState, ETOState)
        public
    {
        // msg.sender is ETOCommitment
    }
}
