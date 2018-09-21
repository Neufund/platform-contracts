pragma solidity 0.4.25;

import "../Universe.sol";
import "../Agreement.sol";
import "../Reclaimable.sol";

import "./IEquityTokenController.sol";
import "./IEquityToken.sol";
import "./IControllerGovernance.sol";
import "../ETO/IETOCommitment.sol";
import "../Standards/IContractId.sol";


/// @title placeholder for on-chain company management
/// several simplifications apply:
///   - there is just one (primary) offering. no more offerings may be executed
///   - transfer rights are executed as per ETO_TERMS
///   - general information rights are executed
///   - no other rights can be executed and no on-chain shareholder resolution results are in place
///   - allows changing to better token controller by company
contract PlaceholderEquityTokenController is
    IEquityTokenController,
    IControllerGovernance,
    IContractId,
    Agreement,
    Reclaimable,
    KnownInterfaces
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    // a root of trust contract
    Universe private UNIVERSE;

    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // controller lifecycle state
    GovState private _state;

    // total number of shares owned by Company
    uint256 private _totalCompanyShares;

    // valuation of the company
    uint256 private _companyValuationEurUlps;

    // set of shareholder rights that will be executed
    ShareholderRights private _shareholderRights;

    // new controller when migrating
    address private _newController;

    // equity token from ETO
    IEquityToken private _equityToken;

    // ETO contract
    IETOCommitment private _etoCommitment;

    // are transfers on token enabled
    bool private _transfersEnabled;

    ////////////////////////
    // Modifiers
    ////////////////////////

    // require caller is ETO in universe
    modifier onlyETO() {
        require(UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_COMMITMENT, msg.sender), "ETC_ETO_NOT_U");
        _;
    }

    modifier onlyCompany() {
        require(msg.sender == COMPANY_LEGAL_REPRESENTATIVE);
        _;
    }

    modifier onlyOperational() {
        require(_state == GovState.Offering || _state == GovState.Funded || _state == GovState.Closing);
        _;
    }

    modifier onlyState(GovState state) {
        require(_state == state);
        _;
    }

    modifier onlyStates(GovState state1, GovState state2) {
        require(_state == state1 || _state == state2);
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
        Reclaimable()
    {
        UNIVERSE = universe;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
    }

    function changeTokenController(address newController)
        public
        onlyStates(GovState.Funded, GovState.Migrated)
        onlyCompany
    {
        require(newController != address(0));
        require(newController != address(this));
        _newController = newController;
        transitionTo(GovState.Migrated);
        emit ResolutionExecuted(0, Action.ChangeTokenController);
        emit LogMigratedTokenController(0, newController);
    }

    //
    // Implements IControllerGovernance
    //

    function state()
        public
        constant
        returns (GovState)
    {
        return _state;
    }

    function shareholderInformation()
        public
        constant
        returns (
            uint256 totalCompanyShares,
            uint256 companyValuationEurUlps,
            ShareholderRights shareholderRights
        )
    {
        return (
            _totalCompanyShares,
            _companyValuationEurUlps,
            _shareholderRights
        );
    }

    function capTable()
        public
        constant
        returns (
            address[] equityTokens,
            uint256[] shares,
            address[] lastOfferings
        )
    {
        // no cap table before ETO completed
        if (_state == GovState.Setup || _state == GovState.Offering) {
            return;
        }
        equityTokens = new address[](1);
        shares = new uint256[](1);
        lastOfferings = new address[](1);

        equityTokens[0] = _equityToken;
        lastOfferings[0] = _etoCommitment;
        shares[0] = _equityToken.sharesTotalSupply();
    }

    function issueGeneralInformation(
        string informationType,
        string informationUrl
    )
        public
        onlyOperational
        onlyCompany
    {
        // we emit this as Ethereum event, no need to store this in contract storage
        emit LogGeneralInformation(COMPANY_LEGAL_REPRESENTATIVE, informationType, informationUrl);
    }

    function startResolution(string /*title*/, string /*resolutionUri*/, Action /*action*/, bytes /*payload*/)
        public
        onlyStates(GovState.Offering, GovState.Funded)
        onlyCompany
        returns (bytes32 /*resolutionId*/)
    {
        revert();
    }


    function executeResolution(bytes32 /*resolutionId*/)
        public
        onlyOperational
    {
        revert();
    }

    function closeCompany()
        public
        onlyState(GovState.Closing)
    {
        revert();
    }

    function cancelCompanyClosing()
        public
        onlyState(GovState.Closing)
    {
        revert();
    }

    //
    // Implements ITokenController
    //

    function onTransfer(address, address ,uint256)
        public
        constant
        returns (bool allow)
    {
        return _transfersEnabled;
    }

    function onTransferFrom(address, address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return _transfersEnabled;
    }

    /// always approve
    function onApprove(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function onGenerateTokens(address sender, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return sender == address(_etoCommitment) && _state == GovState.Offering;
    }

    function onDestroyTokens(address sender, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return sender == address(_etoCommitment) && _state == GovState.Offering;
    }

    function onChangeTokenController(address /*sender*/, address newController)
        public
        constant
        returns (bool)
    {
        return newController == _newController;
    }

    //
    // Implements IEquityTokenController
    //

    function onCloseToken(address)
        public
        constant
        returns (bool)
    {
        return false;
    }

    function onChangeNominee(address, address, address)
        public
        constant
        returns (bool)
    {
        return false;
    }

    //
    // IERC223TokenCallback (proceeds disbursal)
    //

    /// allows contract to receive and distribure proceeds
    function tokenFallback(address, uint256, bytes)
        public
    {
        revert();
    }

    //
    // Implements IETOCommitmentObserver
    //

    function onStateTransition(ETOState, ETOState newState)
        public
        onlyETO
    {
        if (newState == ETOState.Whitelist) {
            require(_state == GovState.Setup);
            registerTokenOfferingPrivate(IETOCommitment(msg.sender));
            return;
        }
        // must be same eto that started offering
        require(msg.sender == address(_etoCommitment));
        if (newState == ETOState.Claim) {
            require(_state == GovState.Offering);
            aproveTokenOfferingPrivate(IETOCommitment(msg.sender));
        }
        if (newState == ETOState.Refund) {
            require(_state == GovState.Offering);
            failTokenOfferingPrivate(IETOCommitment(msg.sender));
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xf7e00d1a4168be33cbf27d32a37a5bc694b3a839684a8c2bef236e3594345d70, 0);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Overrides Agreement
    //

    function mCanAmend(address legalRepresentative)
        internal
        returns (bool)
    {
        // only this contract can amend ISHA typically due to resolution
        return legalRepresentative == address(this);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function registerTokenOfferingPrivate(IETOCommitment tokenOffering)
        private
    {
        IEquityToken equityToken = tokenOffering.equityToken();
        // require nominee match and agreement signature
        (address legalRepToken,,,) = equityToken.currentAgreement();
        // require token controller match
        require(equityToken.tokenController() == address(this), "NDT_ET_TC_MIS");
        // require nominee and agreement match
        (address legalRepOffering,,,) = tokenOffering.currentAgreement();
        require(legalRepOffering == legalRepToken, "NDT_ETO_A_MIS");
        // require terms set and legalRep match
        require(tokenOffering.etoTerms() != address(0), "NDT_ETO_NO_TERMS");
        require(tokenOffering.companyLegalRep() == COMPANY_LEGAL_REPRESENTATIVE, "NDT_ETO_LREP_MIS");

        _equityToken = equityToken;
        _etoCommitment = tokenOffering;
        _totalCompanyShares = tokenOffering.etoTerms().EXISTING_COMPANY_SHARES();
        _companyValuationEurUlps = _totalCompanyShares * tokenOffering.
            etoTerms().TOKEN_TERMS().TOKEN_PRICE_EUR_ULPS() * equityToken.tokensPerShare();

        transitionTo(GovState.Offering);
        emit ResolutionExecuted(0, Action.RegisterOffer);
        emit LogOfferingRegistered(0, tokenOffering, equityToken);
    }

    function aproveTokenOfferingPrivate(IETOCommitment tokenOffering)
        private
    {
        (uint256 newShares,,,,,,,) = tokenOffering.contributionSummary();
        uint256 totalShares = tokenOffering.etoTerms().EXISTING_COMPANY_SHARES() + newShares;
        uint256 marginalPrice = tokenOffering.etoTerms().TOKEN_TERMS().TOKEN_PRICE_EUR_ULPS();
        string memory ISHAUrl = tokenOffering.signedInvestmentAgreementUrl();
        amendISHA(
            ISHAUrl,
            totalShares,
            totalShares * marginalPrice,
            tokenOffering.etoTerms().SHAREHOLDER_RIGHTS()
        );
        // execute shareholder rights
        enableTransfers(tokenOffering.etoTerms().ENABLE_TRANSFERS_ON_SUCCESS());
        // move state to funded
        transitionTo(GovState.Funded);

        emit LogOfferingSucceeded(tokenOffering, tokenOffering.equityToken(), newShares);
    }

    function failTokenOfferingPrivate(IETOCommitment tokenOffering)
        private
    {
        // we failed. may try again
        _equityToken = IEquityToken(0);
        _etoCommitment = IETOCommitment(0);
        _totalCompanyShares = 0;
        _companyValuationEurUlps = 0;
        transitionTo(GovState.Setup);
        emit LogOfferingFailed(tokenOffering, tokenOffering.equityToken());
    }

    function amendISHA(
        string memory ISHAUrl,
        uint256 totalShares,
        uint256 companyValuationEurUlps,
        ShareholderRights newShareholderRights
    )
        private
    {
        // set ISHA. use this.<> to call externally so msg.sender is correct in mCanAmend
        this.amendAgreement(ISHAUrl);
        // set new number of shares
        _totalCompanyShares = totalShares;
        // set new valuation
        _companyValuationEurUlps = companyValuationEurUlps;
        // set shareholder rights corresponding to SHA part of ISHA
        _shareholderRights = newShareholderRights;
        emit ResolutionExecuted(0, Action.AmendISHA);
        emit LogISHAAmended(0, ISHAUrl, totalShares, companyValuationEurUlps, newShareholderRights);
    }

    function enableTransfers(bool transfersEnabled)
        private
    {
        if (_transfersEnabled != transfersEnabled) {
            _transfersEnabled = transfersEnabled;
        }
        emit ResolutionExecuted(0, transfersEnabled ? Action.StopToken : Action.ContinueToken);
        emit LogTransfersStateChanged(0, _equityToken, transfersEnabled);
    }

    function transitionTo(GovState newState)
        private
    {
        emit LogGovStateTransition(uint32(_state), uint32(newState), uint32(block.timestamp));
        _state = newState;
    }
}
