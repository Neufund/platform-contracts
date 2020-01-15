pragma solidity 0.4.26;

import "../Math.sol";
import "../Universe.sol";
import "../Agreement.sol";
import "../Reclaimable.sol";

import "./IEquityTokenController.sol";
import "./IEquityToken.sol";
import "./IControllerGovernance.sol";
import "../ETO/IETOCommitment.sol";
import "../Standards/IContractId.sol";

// version history as per contract id
// 0 - initial version
// 1 - standardizes migration function to require two side commitment
// 2 - migration management shifted from company to UPGRADE ADMIN
// 3 - company shares replaced by share capital


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
    KnownInterfaces,
    Math
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    // a root of trust contract
    Universe internal UNIVERSE;

    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;

    // old token controller
    address private OLD_TOKEN_CONTROLLER;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // controller lifecycle state
    GovState private _state;

    // share capital of Company in currency defined in ISHA
    uint256 private _shareCapital;

    // valuation of the company
    uint256 private _companyValuationEurUlps;

    // set of shareholder rights that will be executed
    ShareholderRights private _shareholderRights;

    // new controller when migrating
    address private _newController;

    // equity token from ETO
    IEquityToken private _equityToken;

    // ETO contract
    address private _commitment;

    // are transfers on token enabled
    bool private _transfersEnabled;

    ////////////////////////
    // Modifiers
    ////////////////////////

    // require caller is ETO in universe
    modifier onlyUniverseETO() {
        require(UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_COMMITMENT, msg.sender), "NF_ETC_ETO_NOT_U");
        _;
    }

    modifier onlyCompany() {
        require(msg.sender == COMPANY_LEGAL_REPRESENTATIVE, "NF_ONLY_COMPANY");
        _;
    }

    modifier onlyOperational() {
        require(_state == GovState.Offering || _state == GovState.Funded || _state == GovState.Closing, "NF_INV_STATE");
        _;
    }

    modifier onlyState(GovState state) {
        require(_state == state, "NF_INV_STATE");
        _;
    }

    modifier onlyStates(GovState state1, GovState state2) {
        require(_state == state1 || _state == state2, "NF_INV_STATE");
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
    {
        UNIVERSE = universe;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
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

    function companyLegalRepresentative()
        public
        constant
        returns (address)
    {
        return COMPANY_LEGAL_REPRESENTATIVE;
    }

    function shareholderInformation()
        public
        constant
        returns (
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            ShareholderRights shareholderRights
        )
    {
        return (
            _shareCapital,
            _companyValuationEurUlps,
            _shareholderRights
        );
    }

    function capTable()
        public
        constant
        returns (
            address[] equityTokens,
            uint256[] shares
        )
    {
        // no cap table before ETO completed
        if (_state == GovState.Setup || _state == GovState.Offering) {
            return;
        }
        equityTokens = new address[](1);
        shares = new uint256[](1);

        equityTokens[0] = _equityToken;
        shares[0] = _equityToken.sharesTotalSupply();
    }

    function tokenOfferings()
        public
        constant
        returns (
            address[] offerings,
            address[] equityTokens
        )
    {
        // no offerings in setup mode
        if (_state == GovState.Setup) {
            return;
        }
        offerings = new address[](1);
        equityTokens = new address[](1);

        equityTokens[0] = _equityToken;
        offerings[0] = _commitment;
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
        revert("NF_NOT_IMPL");
    }


    function executeResolution(bytes32 /*resolutionId*/)
        public
        onlyOperational
    {
        revert("NF_NOT_IMPL");
    }

    function closeCompany()
        public
        onlyState(GovState.Closing)
    {
        revert("NF_NOT_IMPL");
    }

    function cancelCompanyClosing()
        public
        onlyState(GovState.Closing)
    {
        revert("NF_NOT_IMPL");
    }

    function changeTokenController(IControllerGovernance newController)
        public
        onlyStates(GovState.Funded, GovState.Closed)
        // we allow account with that role to perform controller migrations, initially platform account is used
        // company may move to separate access policy contract and fully overtake migration control if they wish
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        require(newController != address(this));
        // must be migrated with us as a source
        require(newController.oldTokenController() == address(this), "NF_NOT_MIGRATED_FROM_US");
        _newController = newController;
        transitionTo(GovState.Migrated);
        emit LogResolutionExecuted(0, Action.ChangeTokenController);
        emit LogMigratedTokenController(0, newController);
    }

    function newTokenController()
        public
        constant
        returns (address)
    {
        // _newController is set only in Migrated state, otherwise zero address is returned as required
        return _newController;
    }

    function oldTokenController()
        public
        constant
        returns (address)
    {
        return OLD_TOKEN_CONTROLLER;
    }

    //
    // Implements ITokenController
    //

    function onTransfer(address broker, address from, address /*to*/, uint256 /*amount*/)
        public
        constant
        returns (bool allow)
    {
        // allow for initial token distribution by ETOCommitment contract (token claim)
        if (from == _commitment && broker == from) {
            allow = true;
        } else {
            allow = _transfersEnabled;
        }
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
        return sender == _commitment && _state == GovState.Offering;
    }

    function onDestroyTokens(address sender, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return sender == _commitment && _state == GovState.Offering;
    }

    function onChangeTokenController(address /*sender*/, address newController)
        public
        constant
        returns (bool)
    {
        return newController == _newController;
    }

    // no forced transfers allowed in this controller
    function onAllowance(address /*owner*/, address /*spender*/)
        public
        constant
        returns (uint256)
    {
        return 0;
    }

    //
    // Implements IEquityTokenController
    //

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
        revert("NF_NOT_IMPL");
    }

    //
    // Implements IETOCommitmentObserver
    //

    function commitmentObserver() public
        constant
        returns (address)
    {
        return _commitment;
    }

    function onStateTransition(ETOState, ETOState newState)
        public
        onlyUniverseETO
    {
        if (newState == ETOState.Whitelist) {
            require(_state == GovState.Setup, "NF_ETC_BAD_STATE");
            registerTokenOfferingPrivate(IETOCommitment(msg.sender));
            return;
        }
        // must be same eto that started offering
        require(msg.sender == _commitment, "NF_ETC_UNREG_COMMITMENT");
        if (newState == ETOState.Claim) {
            require(_state == GovState.Offering, "NF_ETC_BAD_STATE");
            aproveTokenOfferingPrivate(IETOCommitment(msg.sender));
        }
        if (newState == ETOState.Refund) {
            require(_state == GovState.Offering, "NF_ETC_BAD_STATE");
            failTokenOfferingPrivate(IETOCommitment(msg.sender));
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xf7e00d1a4168be33cbf27d32a37a5bc694b3a839684a8c2bef236e3594345d70, 3);
    }

    //
    // Other functions
    //

    function migrateTokenController(IControllerGovernance oldController, bool transfersEnables)
        public
        onlyState(GovState.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        require(oldController.newTokenController() == address(0), "NF_OLD_CONTROLLED_ALREADY_MIGRATED");
        // migrate cap table
        (address[] memory equityTokens, ) = oldController.capTable();
        (address[] memory offerings, ) = oldController.tokenOfferings();
        // migrate ISHA
        (,,string memory ISHAUrl,) = oldController.currentAgreement();
        (
            _shareCapital,
            _companyValuationEurUlps,
            _shareholderRights
        ) = oldController.shareholderInformation();
        _equityToken = IEquityToken(equityTokens[0]);
        _commitment = offerings[0];
        // set ISHA. use this.<> to call externally so msg.sender is correct in mCanAmend
        this.amendAgreement(ISHAUrl);
        // transfer flag may be changed during migration of the controller
        enableTransfers(transfersEnables);
        transitionTo(GovState.Funded);
        OLD_TOKEN_CONTROLLER = oldController;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function newOffering(IEquityToken equityToken, address tokenOffering)
        internal
    {
        _equityToken = equityToken;
        _commitment = tokenOffering;

        emit LogResolutionExecuted(0, Action.RegisterOffer);
        emit LogOfferingRegistered(0, tokenOffering, equityToken);
    }

    function amendISHA(
        string memory ISHAUrl,
        uint256 shareCapital,
        uint256 companyValuationEurUlps,
        ShareholderRights newShareholderRights
    )
        internal
    {
        // set ISHA. use this.<> to call externally so msg.sender is correct in mCanAmend
        this.amendAgreement(ISHAUrl);
        // set new share capital
        _shareCapital = shareCapital;
        // set new valuation
        _companyValuationEurUlps = companyValuationEurUlps;
        // set shareholder rights corresponding to SHA part of ISHA
        _shareholderRights = newShareholderRights;
        emit LogResolutionExecuted(0, Action.AmendISHA);
        emit LogISHAAmended(0, ISHAUrl, shareCapital, companyValuationEurUlps, newShareholderRights);
    }

    function enableTransfers(bool transfersEnabled)
        internal
    {
        if (_transfersEnabled != transfersEnabled) {
            _transfersEnabled = transfersEnabled;
        }
        emit LogResolutionExecuted(0, transfersEnabled ? Action.ContinueToken : Action.StopToken);
        emit LogTransfersStateChanged(0, _equityToken, transfersEnabled);
    }

    function transitionTo(GovState newState)
        internal
    {
        emit LogGovStateTransition(uint32(_state), uint32(newState), uint32(block.timestamp));
        _state = newState;
    }

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
        (address nomineeToken,,,) = equityToken.currentAgreement();
        // require token controller match
        require(equityToken.tokenController() == address(this), "NF_NDT_ET_TC_MIS");
        // require nominee and agreement match
        (address nomineOffering,,,) = tokenOffering.currentAgreement();
        require(nomineOffering == nomineeToken, "NF_NDT_ETO_A_MIS");
        // require terms set and legalRep match
        require(tokenOffering.etoTerms() != address(0), "NF_NDT_ETO_NO_TERMS");
        require(tokenOffering.companyLegalRep() == COMPANY_LEGAL_REPRESENTATIVE, "NF_NDT_ETO_LREP_MIS");

        newOffering(equityToken, tokenOffering);
        transitionTo(GovState.Offering);
    }

    function aproveTokenOfferingPrivate(IETOCommitment tokenOffering)
        private
    {
        // execute pending resolutions on completed ETO
        (uint256 newShares, uint256 capitalIncreaseUlps,,,,,,) = tokenOffering.contributionSummary();
        // compute increased share capital (in ISHA currency!)
        uint256 increasedShareCapital = tokenOffering.etoTerms().EXISTING_SHARE_CAPITAL() + capitalIncreaseUlps;
        // use full price of a share as a marginal price from which to compute valuation
        uint256 marginalSharePrice = tokenOffering.etoTerms().TOKEN_TERMS().SHARE_PRICE_EUR_ULPS();
        // compute new valuation by having market price for a single unit of ISHA currency
        // (share_price_eur / share_nominal_value_curr) * increased_share_capital_curr
        uint256 shareNominalValueUlps = tokenOffering.etoTerms().TOKEN_TERMS().SHARE_NOMINAL_VALUE_ULPS();
        uint256 increasedValuationEurUlps = proportion(marginalSharePrice, increasedShareCapital, shareNominalValueUlps);
        string memory ISHAUrl = tokenOffering.signedInvestmentAgreementUrl();
        // set new ISHA, increase share capital and company valuations, establish shareholder rights matrix
        amendISHA(
            ISHAUrl,
            increasedShareCapital,  // share capital increased
            increasedValuationEurUlps, // new valuation set based on increased share capital
            tokenOffering.etoTerms().SHAREHOLDER_RIGHTS()
        );
        // enable/disable transfers per ETO Terms
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
        _commitment = IETOCommitment(0);
        _shareCapital = 0;
        _companyValuationEurUlps = 0;
        transitionTo(GovState.Setup);
        emit LogOfferingFailed(tokenOffering, tokenOffering.equityToken());
    }
}
