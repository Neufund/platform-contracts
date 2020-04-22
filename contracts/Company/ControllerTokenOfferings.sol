pragma solidity 0.4.26;

import "../Math.sol";
import "../ETO/IETOCommitment.sol";
import "./ControllerGeneralInformation.sol";


contract ControllerTokenOfferings is
    IETOCommitmentObserver,
    ControllerGeneralInformation,
    KnownInterfaces,
    Math
{
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

        equityTokens[0] = _equityToken;
        offerings[0] = _commitment;
    }

    function startNewOffering(bytes32 resolutionId, IETOCommitment commitment)
        public
        onlyStates(GovState.Setup, GovState.Funded)
        withNonAtomicExecution(resolutionId, commitmentUniverseValidator)
        withGovernance(
            resolutionId,
            Action.RegisterOffer,
            commitment.etoTerms().INVESTOR_OFFERING_DOCUMENT_URL(),
            defaultPermissionEscalator
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
        if (newState == ETOState.Setup) {
            // first setup transition
            require(_state == GovState.Setup || _state == GovState.Funded || _state == GovState.Offering, "NF_ETC_BAD_STATE");
            // with continued non atomic resolution
            startTokenOfferingPrivate(resolutionId, IETOCommitment(msg.sender));
        }
        if (newState == ETOState.Claim || newState == ETOState.Refund) {
            require(_state == GovState.Offering, "NF_ETC_BAD_STATE");
            // with continued atomic (final) resolution
            execOfferCompleted(resolutionId, IETOCommitment(msg.sender), newState);
        }
    }

    //
    // Migration storage access
    //

    function migrateAddCommitment(address commitment)
        public
        onlyState(GovState.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _commitment = commitment;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xb79bf4e4fbc68d01e103a81fa749364bfcbdbe3d19c4aa1cc1c747bbb30c8b5d, 0);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function addOffering(
        bytes32 resolutionId,
        IEquityToken equityToken,
        EquityTokenholderRights tokenholderRights,
        address tokenOffering
    )
        internal
    {
        _equityToken = equityToken;
        _tokenholderRights = tokenholderRights;
        _commitment = tokenOffering;

        emit LogOfferingRegistered(resolutionId, tokenOffering, equityToken);
    }

    function isActiveOffering(address commitment)
        internal
        constant
        returns (bool)
    {
        bytes32 resolutionId = keccak256(abi.encodePacked(address(commitment)));
        ResolutionExecution storage e = _resolutions[resolutionId];
        return e.state == ExecutionState.Executing;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function commitmentUniverseValidator(ResolutionExecution storage /*e*/)
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
        return UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_COMMITMENT, commitment);
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
        IEquityToken equityToken = tokenOffering.equityToken();
        // require nominee match and agreement signature
        (address nomineeToken,,,) = equityToken.currentAgreement();
        // require token controller match
        require(equityToken.tokenController() == address(this), "NF_NDT_ET_TC_MIS");
        // require nominee and agreement match
        (address nomineOffering,,,) = tokenOffering.currentAgreement();
        require(nomineOffering == nomineeToken, "NF_NDT_ETO_A_MIS");
        // require terms set and legalRep match
        require(tokenOffering.etoTerms() != address(0), "NF_NDT_ETO_NO_TERMS");
        require(tokenOffering.companyLegalRep() == COMPANY_LEGAL_REPRESENTATIVE, "NF_NDT_ETO_LREP_MIS");
        // secondary offering must be on the same token
        require(_equityToken == address(0) || equityToken == _equityToken, "NF_NDT_FUNDRAISE_NOT_SAME_TOKEN");
        // state transition to Offering
        if (_state != GovState.Offering) {
            // setup transition is called via setStartDate so it may happen multiple times
            transitionTo(GovState.Offering);
        }
    }

    function aproveTokenOfferingPrivate(bytes32 resolutionId, IETOCommitment tokenOffering)
        private
    {
        IEquityToken equityToken = tokenOffering.equityToken();
        ETOTerms etoTerms = tokenOffering.etoTerms();
        // execute pending resolutions on completed ETO
        (uint256 newShares, uint256 capitalIncreaseUlps,,,,,,) = tokenOffering.contributionSummary();
        // compute increased share capital (in ISHA currency!)
        uint256 increasedShareCapital = etoTerms.EXISTING_SHARE_CAPITAL() + capitalIncreaseUlps;
        // use full price of a share as a marginal price from which to compute valuation
        uint256 marginalSharePrice = etoTerms.TOKEN_TERMS().SHARE_PRICE_EUR_ULPS();
        // compute new valuation by having market price for a single unit of ISHA currency
        // (share_price_eur / share_nominal_value_curr) * increased_share_capital_curr
        uint256 shareNominalValueUlps = etoTerms.TOKEN_TERMS().SHARE_NOMINAL_VALUE_ULPS();
        uint256 increasedValuationEurUlps = proportion(marginalSharePrice, increasedShareCapital, shareNominalValueUlps);
        string memory ISHAUrl = tokenOffering.signedInvestmentAgreementUrl();
        EquityTokenholderRights tokenholderRights = tokenOffering.etoTerms().TOKENHOLDER_RIGHTS();
        // set new ISHA, increase share capital and company valuations, establish shareholder rights matrix
        amendISHA(
            resolutionId,
            ISHAUrl,
            increasedShareCapital,  // share capital increased
            increasedValuationEurUlps, // new valuation set based on increased share capital
            tokenholderRights
        );
        // establish authorized capital if it was specified
        uint256 authorizedCapitalUlps = etoTerms.AUTHORIZED_CAPITAL();
        if (authorizedCapitalUlps > 0) {
            establishAuthorizedCapital(resolutionId, authorizedCapitalUlps);
        }
        // register successful offering and equity token
        addOffering(resolutionId, equityToken, tokenholderRights, tokenOffering);
        // enable/disable transfers per ETO Terms
        enableTransfers(resolutionId, tokenOffering.etoTerms().ENABLE_TRANSFERS_ON_SUCCESS());
        // move state to funded
        transitionTo(GovState.Funded);
        emit LogOfferingSucceeded(tokenOffering, equityToken, newShares);
    }

    function failTokenOfferingPrivate(bytes32 resolutionId, IETOCommitment tokenOffering)
        private
    {
        ResolutionExecution storage e = _resolutions[resolutionId];
        terminateResolution(resolutionId, e, ExecutionState.Failed);
        transitionTo(amendmentsCount() == 0 ? GovState.Setup : GovState.Funded);
        emit LogOfferingFailed(tokenOffering, tokenOffering.equityToken());
    }
}
