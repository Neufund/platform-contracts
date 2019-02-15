pragma solidity 0.4.25;

import "../../Company/PlaceholderEquityTokenController.sol";


contract MockPlaceholderEquityTokenController is
    PlaceholderEquityTokenController
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
        address companyLegalRepresentative
    )
        public
        PlaceholderEquityTokenController(universe, companyLegalRepresentative)
    {}

    ////////////////////////
    // Public Methods
    ////////////////////////

    function _enableTransfers(bool transfersEnabled)
        public
        onlyCompany
    {
        enableTransfers(transfersEnabled);
    }

    // to easily mockup chains of controller changes
    function _overrideOldController(address oldController)
        public
    {
        _oldController = oldController;
    }

    // to easily mockup state
    function _overrideState(GovState state)
        public
    {
        transitionTo(state);
    }

    //
    // Implements IControllerGovernance
    //

    function oldTokenController()
        public
        constant
        returns (address)
    {
        if (_oldController == address(0)) {
            // in no override then return controller as set by base
            return PlaceholderEquityTokenController.oldTokenController();
        } else {
            return _oldController;
        }
    }
}
