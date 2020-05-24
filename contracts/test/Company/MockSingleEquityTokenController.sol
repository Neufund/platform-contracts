pragma solidity 0.4.26;

import "../../Company/SingleEquityTokenController.sol";


contract MockSingleEquityTokenController is
    SingleEquityTokenController
{
    ////////////////////////
    // Mutable state
    ////////////////////////

    // old controller override
    address private _oldController;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep
    )
        public
        SingleEquityTokenController(universe, companyLegalRep)
    {}

    ////////////////////////
    // Public Methods
    ////////////////////////

    function _enableTransfers(bool transfersEnabled)
        public
        onlyCompany
    {
        enableTransfers(0, transfersEnabled);
    }

    // to easily mockup chains of controller changes
    function _overrideOldController(address oldController)
        public
    {
        _oldController = oldController;
    }

    // to easily mockup state
    function _overrideState(Gov.State state)
        public
    {
        transitionTo(state);
    }

    //
    // Implements IMigrationChain
    //

    function migratedFrom()
        public
        constant
        returns (address)
    {
        if (_oldController == address(0)) {
            // in no override then return controller as set by base
            return SingleEquityTokenController.migratedFrom();
        } else {
            return _oldController;
        }
    }
}
