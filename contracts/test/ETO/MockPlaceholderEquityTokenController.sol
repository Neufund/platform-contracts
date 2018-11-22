pragma solidity 0.4.25;

import "../../Company/PlaceholderEquityTokenController.sol";


contract MockPlaceholderEquityTokenController is
    PlaceholderEquityTokenController
{
    ////////////////////////
    // Immutable State
    ////////////////////////

    IControllerGovernance private MIGRATED_CONTROLLER;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        PlaceholderEquityTokenController migrated
    )
        public
        PlaceholderEquityTokenController(universe, migrated.companyLegalRepresentative())
    {
        MIGRATED_CONTROLLER = migrated;
    }

    ////////////////////////
    // Public Methods
    ////////////////////////


    function _finalizeMigration()
        public
        //onlyCompany
    {
        // must be migrated with us as a target
        require(MIGRATED_CONTROLLER.state() == GovState.Migrated, "NF_NOT_MIGRATED");
        require(MIGRATED_CONTROLLER.newTokenController() == address(this), "NF_NOT_MIGRATED_TO_US");
        // migrate cap table
        (address[] memory equityTokens, ) = MIGRATED_CONTROLLER.capTable();
        (address[] memory offerings, ) = MIGRATED_CONTROLLER.tokenOfferings();
        newOffering(IEquityToken(equityTokens[0]), offerings[0]);
        // migrate ISHA
        (,,string memory ISHAUrl,) = MIGRATED_CONTROLLER.currentAgreement();
        (
            uint256 totalShares,
            uint256 companyValuationEurUlps,
            ShareholderRights newShareholderRights
        ) = MIGRATED_CONTROLLER.shareholderInformation();
        amendISHA(ISHAUrl, totalShares, companyValuationEurUlps, newShareholderRights);
        // this token controller always disables transfers
        enableTransfers(false);
        transitionTo(GovState.Funded);
    }

    function _enableTransfers(bool transfersEnabled)
        public
        onlyCompany
    {
        enableTransfers(transfersEnabled);
    }

    //
    // Implements IControllerGovernance
    //

    function oldTokenController()
        public
        constant
        returns (address)
    {
        return MIGRATED_CONTROLLER;
    }
}
