pragma solidity 0.4.26;

import "./ControllerGeneralInformation.sol";


contract ControllerTokenOfferings is
    IETOCommitmentObserver,
    ControllerGeneralInformation,
    KnownInterfaces
{
    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerTokenOfferingsId = 0xb79bf4e4fbc68d01e103a81fa749364bfcbdbe3d19c4aa1cc1c747bbb30c8b5d;
    uint256 internal constant ControllerTokenOfferingsV = 0;

    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NF_ETC_ETO_NOT_U = "NF_ETC_ETO_NOT_U";

    ////////////////////////
    // Events
    ////////////////////////

    // offering of the token in ETO failed (Refund)
    event LogOfferingFailed(
        address etoCommitment,
        address equityToken
    );

    // offering of the token in ETO succeeded (with all on-chain consequences)
    event LogOfferingSucceeded(
        address etoCommitment,
        address equityToken,
        uint256 newShares
    );

    //
    event LogOfferingRegistered(
        bytes32 indexed resolutionId,
        address etoCommitment,
        address equityToken
    );

    ////////////////////////
    // Mutable state
    ////////////////////////

    // ETO contract
    address internal _commitment;

    ////////////////////////
    // Modifiers
    ////////////////////////

    // require caller is ETO in universe
    modifier onlyUniverseETO() {
        require(inUniverseCommitment(msg.sender), NF_ETC_ETO_NOT_U);
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}

    ////////////////////////
    // Public Methods
    ////////////////////////

    function tokenOfferings()
        public
        constant
        returns (
            address[] offerings,
            address[] equityTokens
        )
    {
        // no offerings before any shareholder agreement is attached
        if (amendmentsCount() == 0) {
            return;
        }
        offerings = new address[](1);
        equityTokens = new address[](1);

        equityTokens[0] = _g._equityToken;
        offerings[0] = _commitment;
    }

    function startNewOffering(bytes32 resolutionId, IETOCommitment commitment)
        public
        onlyStates(Gov.State.Setup, Gov.State.Funded)
        withNonAtomicExecution(resolutionId, commitmentUniverseValidator)
        withGovernance(
            resolutionId,
            Gov.Action.RegisterOffer,
            commitment.etoTerms().INVESTOR_OFFERING_DOCUMENT_URL()
        )
        // withExclusiveAction(resolutionId, Action.RegisterOffer)
    {}

    // TODO: implement cancelDelistedOffering(resolution, commitment) to fail resolution if commitment delisted, onlyCompany

    //
    // Implements IETOCommitmentObserver
    //

    function onStateTransition(ETOState, ETOState newState)
        public
        onlyUniverseETO
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

    function migrateAddCommitment(address commitment)
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _commitment = commitment;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function addOffering(
        bytes32 resolutionId,
        IEquityToken equityToken,
        address tokenOffering
    )
        internal
    {
        _g._equityToken = equityToken;
        _commitment = tokenOffering;

        emit LogOfferingRegistered(resolutionId, tokenOffering, equityToken);
    }

    function isActiveOffering(address commitment)
        internal
        constant
        returns (bool)
    {
        bytes32 resolutionId = keccak256(abi.encodePacked(address(commitment)));
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        return e.state == Gov.ExecutionState.Executing;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function commitmentUniverseValidator(Gov.ResolutionExecution storage /*e*/)
        private
        constant
        returns (string memory code)
    {
        // unpack calldata to extract address payload
        address commitment;
        assembly {
            // skip 4 bytes selector and 32 bytes resolution id
            // _rId := calldataload(4)
            commitment := calldataload(36)
        }
        if (!inUniverseCommitment(commitment)) {
            return NF_ETC_ETO_NOT_U;
        }
    }

    function inUniverseCommitment(address commitment)
        private
        constant
        returns (bool)
    {
        return _g.UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_COMMITMENT, commitment);
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
        Gov.validateNewOffering(_g, tokenOffering);
        // state transition to Offering
        if (_g._state != Gov.State.Offering) {
            // setup transition is called via setStartDate so it may happen multiple times
            transitionTo(Gov.State.Offering);
        }
    }

    function aproveTokenOfferingPrivate(bytes32 resolutionId, IETOCommitment tokenOffering)
        private
    {
        // call library to save a few kbs on contract size
        (
            uint256 newShares,
            uint256 authorizedCapitalUlps,
            uint256 increasedShareCapital,
            uint256 increasedValuationEurUlps,
            string memory ISHAUrl,
            EquityTokenholderRights tokenholderRights,
            IEquityToken equityToken,
            bool transferable
        ) = Gov.calculateNewValuation(tokenOffering);
        // set new ISHA, increase share capital and company valuations, establish shareholder rights matrix
        amendISHA(resolutionId, ISHAUrl, tokenholderRights);
        // new valuation set based on increased share capital
        amendCompanyValuation(resolutionId, increasedValuationEurUlps);
        // share capital increased
        amendShareCapital(resolutionId, increasedShareCapital);
        // establish authorized capital if it was specified
        if (authorizedCapitalUlps > 0) {
            establishAuthorizedCapital(resolutionId, authorizedCapitalUlps);
        }
        // register successful offering and equity token
        addOffering(resolutionId, equityToken, tokenOffering);
        // enable/disable transfers per ETO Terms
        enableTransfers(resolutionId, transferable);
        // move state to funded
        transitionTo(Gov.State.Funded);
        emit LogOfferingSucceeded(tokenOffering, equityToken, newShares);
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
