pragma solidity 0.4.25;

import "../../Universe.sol";
import "../../Agreement.sol";
import "../../Company/IEquityTokenController.sol";
import "../TestMockableTokenController.sol";


contract TestMockableEquityTokenController is
    IEquityTokenController,
    TestMockableTokenController,
    Agreement
{

    ////////////////////////
    // Mutable state
    ////////////////////////

    bool internal _allowChangeNominee;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
        _allowChangeNominee = true;
    }

    ////////////////////////
    // Public Methods
    ////////////////////////

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
    //  Mock functions
    //

    function setAllowChangeNominee(bool allow)
        public
    {
        _allowChangeNominee = allow;
    }

}
