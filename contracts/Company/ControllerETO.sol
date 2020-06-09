pragma solidity 0.4.26;

import "./ControllerGeneralInformation.sol";
import "./ControllerGovernanceToken.sol";
import "./IEquityTokenController.sol";
import "./IControllerETO.sol";


contract ControllerETO is
    IEquityTokenController,
    ControllerGeneralInformation,
    ControllerGovernanceToken,
    IControllerETO,
    KnownInterfaces
{

    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NF_ETC_ETO_NOT_U = "NF_ETC_ETO_NOT_U";

    ////////////////////////
    // Mutable state
    ////////////////////////

    // ETO contract
    address[] internal _offerings;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}

    //
    // Implements IControllerETO
    //

    function tokenOfferings()
        public
        constant
        returns (
            address[] offerings
        )
    {
        return _offerings;
    }

    function startNewOffering(bytes32 resolutionId, IETOCommitment commitment)
        public
        onlyStates(Gov.State.Setup, Gov.State.Funded)
        withNonAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.RegisterOffer,
            commitment.etoTerms().INVESTOR_OFFERING_DOCUMENT_URL()
        )
    {}

    //
    // Token Generation part of ITokenController
    //

    // no permission to destroy tokens by ETO commitment
    function onDestroyTokens(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return false;
    }

    // only active commitment may generate tokens
    function onGenerateTokens(address sender, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return _g._state == Gov.State.Offering && isOfferingInState(sender, Gov.ExecutionState.Executing);
    }

    // only active commitment can transfer tokens
    function onTransfer(address broker, address from, address /*to*/, uint256 /*amount*/)
        public
        constant
        returns (bool allow)
    {
        return isOfferingInState(from, Gov.ExecutionState.Completed) && broker == from;
    }
    //
    // Implements IETOCommitmentObserver
    //

    function onStateTransition(ETOState, ETOState newState)
        public
    {
        // resolution id is calculated from eto address
        bytes32 resolutionId = keccak256(abi.encodePacked(address(msg.sender)));
        Gov.State s;
        if (newState == ETOState.Setup) {
            // first setup transition
            s = _g._state;
            require(s == Gov.State.Setup || s == Gov.State.Funded || s == Gov.State.Offering, "NF_ETC_BAD_STATE");
            // with continued non atomic resolution
            startTokenOfferingPrivate(resolutionId, IETOCommitment(msg.sender));
        }
        if (newState == ETOState.Claim || newState == ETOState.Refund) {
            s = _g._state;
            require(s == Gov.State.Offering, "NF_ETC_BAD_STATE");
            // with continued atomic (final) resolution
            execOfferCompleted(resolutionId, IETOCommitment(msg.sender), newState);
        }
    }

    //
    // Migration storage access
    //

    function migrateOfferings(address[] offerings)
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _offerings = offerings;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function addOffering(
        bytes32 resolutionId,
        address tokenOffering
    )
        internal
    {
        _offerings.push(tokenOffering);
        emit LogOfferingRegistered(resolutionId, tokenOffering, _t._token);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function isOfferingInState(address commitment, Gov.ExecutionState expectedState)
        internal
        constant
        returns (bool)
    {
        bytes32 resolutionId = keccak256(abi.encodePacked(address(commitment)));
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        Gov.ExecutionState s = e.state;
        return s == expectedState;
    }

    function execOfferCompleted(bytes32 resolutionId, IETOCommitment commitment, ETOState newState)
        private
        withAtomicContinuedExecution(
            resolutionId,
            keccak256(abi.encodeWithSelector(this.startNewOffering.selector, resolutionId, address(commitment))),
            0
        )
    {
        if (newState == ETOState.Claim) {
            aproveTokenOfferingPrivate(resolutionId, commitment);
        } else {
            failTokenOfferingPrivate(resolutionId, commitment);
        }
    }


    function startTokenOfferingPrivate(bytes32 resolutionId, IETOCommitment tokenOffering)
        private
        withNonAtomicContinuedExecution(
            resolutionId,
            keccak256(abi.encodeWithSelector(this.startNewOffering.selector, resolutionId, address(tokenOffering))),
            0
        )
    {
        Gov.validateNewOffering(_g.COMPANY_LEGAL_REPRESENTATIVE, _t._token, tokenOffering);
        // state transition to Offering
        if (_g._state != Gov.State.Offering) {
            // setup transition is called via setStartDate so it may happen multiple times
            transitionTo(Gov.State.Offering);
        }
    }

    function aproveTokenOfferingPrivate(bytes32 resolutionId, IETOCommitment tokenOffering)
        private
    {
        // // installs new token via delegatecall
        (
            uint256 newShares,
            uint256 authorizedCapitalUlps,
            uint256 increasedShareCapital,
            uint256 increasedValuationEurUlps,
            string memory ISHAUrl
        ) = Gov.calculateNewValuationAndInstallToken(_t, tokenOffering);
        // token was already set in library
        emit LogTokenholderRightsAmended(resolutionId, _t._type, _t._token, _t._tokenholderRights);
        // set new ISHA, increase share capital and company valuations
        amendISHA(resolutionId, ISHAUrl);
        // new valuation set based on increased share capital
        amendCompanyValuation(resolutionId, increasedValuationEurUlps);
        // share capital increased
        amendShareCapital(resolutionId, increasedShareCapital);
        // establish authorized capital if it was specified
        if (authorizedCapitalUlps > 0) {
            establishAuthorizedCapital(resolutionId, authorizedCapitalUlps);
        }
        // register successful offering and equity token
        addOffering(resolutionId, tokenOffering);
        // enable/disable transfers per ETO Terms
        enableTransfers(resolutionId, _t._transferable);
        // move state to funded
        transitionTo(Gov.State.Funded);
        emit LogOfferingSucceeded(tokenOffering, _t._token, newShares);
    }

    function failTokenOfferingPrivate(bytes32 resolutionId, IETOCommitment tokenOffering)
        private
    {
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        terminateResolution(resolutionId, e, Gov.ExecutionState.Failed);
        transitionTo(amendmentsCount() == 0 ? Gov.State.Setup : Gov.State.Funded);
        emit LogOfferingFailed(tokenOffering, tokenOffering.equityToken());
    }
}
