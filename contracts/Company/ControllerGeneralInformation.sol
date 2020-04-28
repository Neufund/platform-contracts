pragma solidity 0.4.26;

import "./ControllerGovernanceEngine.sol";

contract ControllerGeneralInformation is
    ControllerGovernanceEngine
{
    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerGeneralInformationId = 0x41a703b63c912953a0cd27ec13238571806cc14534c4a31a6874db8759b9aa6a;
    uint256 internal constant ControllerGeneralInformationV = 0;

    ////////////////////////
    // Events
    ////////////////////////

    // logged when transferability of given token was changed
    event LogTransfersStateChanged(
        bytes32 indexed resolutionId,
        address equityToken,
        bool transfersEnabled
    );

    // logged when ISHA was amended (new text, new shareholders, new cap table, offline round etc.)
    event LogISHAAmended(
        bytes32 indexed resolutionId,
        string ISHAUrl,
        address newShareholderRights
    );

    // logged when company valuation changes, in case of completed offering, it's POST valuation
    event LogCompanyValuationAmended(
        bytes32 indexed resolutionId,
        uint256 companyValuationEurUlps
    );

    // logged when share capital changes
    event LogShareCapitalAmended(
        bytes32 indexed resolutionId,
        uint256 shareCapitalUlps
    );


    // logged when authorized share capital is established
    event LogAuthorizedCapitalEstablished(
        bytes32 indexed resolutionId,
        uint256 authorizedCapitalUlps
    );

    ////////////////////////
    // Mutable state
    ////////////////////////

    // share capital of Company in currency defined in ISHA
    uint256 internal _shareCapital;

    // authorized capital of Company
    uint256 internal _authorizedCapital;

    // valuation of the company
    uint256 internal _companyValuationEurUlps;

    // are transfers on token enabled
    bool internal _transfersEnabled;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}

    ////////////////////////
    // Public Methods
    ////////////////////////

    //
    // Implements IControllerGovernance
    //

    function shareholderInformation()
        public
        constant
        returns (
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            EquityTokenholderRights shareholderRights,
            uint256 authorizedCapital,
            string shaUrl
        )
    {
        if (amendmentsCount() > 0) {
            (,,shaUrl,) = currentAgreement();
        }
        return (
            _shareCapital,
            _companyValuationEurUlps,
            _g._tokenholderRights,
            _authorizedCapital,
            shaUrl
        );
    }

    function tokens()
        public
        constant
        returns (
            address[] token,
            Gov.TokenType[] tokenType,
            Gov.TokenState[] tokenState,
            address[] holderRights,
            bool[] tokenTransferable
        )
    {
        // no table of tokens before any token is set
        if (_g._equityToken == address(0)) {
            return;
        }
        tokenType = new Gov.TokenType[](1);
        tokenType[0] = Gov.TokenType.Equity;
        token = new address[](1);
        token[0] = _g._equityToken;
        holderRights = new address[](1);
        holderRights[0] = _g._tokenholderRights;
        tokenTransferable = new bool[](1);
        tokenTransferable[0] = _transfersEnabled;
        tokenState = new Gov.TokenState[](1);
        tokenState[0] = Gov.TokenState.Open;
    }

    function issueGeneralInformation(
        bytes32 resolutionId,
        string title,
        string documentUrl
    )
        public
        onlyOperational
        onlyCompany
    {
        // we emit this as Ethereum event, no need to store this in contract storage
        emit LogResolutionStarted(resolutionId, title, documentUrl, Gov.Action.None, Gov.ExecutionState.Completed, msg.data);
    }

    // used to change company governance, if run in Setup state it may create a controller
    // without token, for example to use with ESOP
    function amendISHAResolution(
        bytes32 resolutionId,
        string ISHAUrl,
        uint256 shareCapitalUlps,
        uint256 authorizedCapital,
        uint256 companyValuationEurUlps,
        EquityTokenholderRights newShareholderRights
    )
        public
        onlyStates(Gov.State.Setup, Gov.State.Funded)
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.AmendISHA,
            ISHAUrl
        )
    {
        // if in Setup, transition to Funded
        if (_g._state == Gov.State.Setup) {
            require(!newShareholderRights.HAS_VOTING_RIGHTS(), "NF_TOKEN_REQ_VOTING_RIGHTS");
            transitionTo(Gov.State.Funded);
        }
        amendISHA(resolutionId, ISHAUrl, newShareholderRights);
        amendCompanyValuation(resolutionId, companyValuationEurUlps);
        amendShareCapital(resolutionId, shareCapitalUlps);
        establishAuthorizedCapital(resolutionId, authorizedCapital);
    }

    function establishAuthorizedCapitalResolution(
        bytes32 resolutionId,
        uint256 authorizedCapital,
        string resolutionDocumentUrl
    )
        public
        onlyState(Gov.State.Funded)
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.EstablishAuthorizedCapital,
            resolutionDocumentUrl
        )
    {
        establishAuthorizedCapital(resolutionId, authorizedCapital);
    }

    function annualGeneralMeetingResolution(
        bytes32 resolutionId,
        string resolutionDocumentUrl
    )
        public
        onlyOperational
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.AnnualGeneralMeeting,
            resolutionDocumentUrl
        )
    {
        // no special on chain consequences
    }

    function amendShareCapitalResolution(
        bytes32 resolutionId,
        uint256 shareCapitalUlps,
        uint256 authorizedCapital,
        uint256 companyValuationEurUlps,
        string resolutionDocumentUrl
    )
        public
        onlyState(Gov.State.Funded)
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.AmendSharesAndValuation,
            resolutionDocumentUrl
        )
    {
        amendCompanyValuation(resolutionId, companyValuationEurUlps);
        amendShareCapital(resolutionId, shareCapitalUlps);
        establishAuthorizedCapital(resolutionId, authorizedCapital);
    }

    function amendCompanyValuationResolution(
        bytes32 resolutionId,
        uint256 companyValuationEurUlps,
        string resolutionDocumentUrl
    )
        public
        onlyState(Gov.State.Funded)
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.AmendValuation,
            resolutionDocumentUrl
        )
    {
        amendCompanyValuation(resolutionId, companyValuationEurUlps);
    }


    // todo: special resolution with SHR initiative to start and None action
    // todo: generic (None) THR



    //
    // Migration storage access
    //

    function migrateGeneralInformation(
        string ISHAUrl,
        uint256 shareCapital,
        uint256 authorizedCapital,
        uint256 companyValuationEurUlps,
        bool transfersEnabled
    )
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        this.amendAgreement(ISHAUrl);
        _shareCapital = shareCapital;
        _authorizedCapital = authorizedCapital;
        _companyValuationEurUlps = companyValuationEurUlps;
        _transfersEnabled = transfersEnabled;
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////


    function amendISHA(
        bytes32 resolutionId,
        string memory ISHAUrl,
        EquityTokenholderRights newShareholderRights
    )
        internal
    {
        // set ISHA. use this.<> to call externally so msg.sender is correct in mCanAmend
        this.amendAgreement(ISHAUrl);
        // set shareholder rights corresponding to SHA part of ISHA
        _g._tokenholderRights = newShareholderRights;
        emit LogISHAAmended(resolutionId, ISHAUrl, newShareholderRights);
    }

    function amendCompanyValuation(
        bytes32 resolutionId,
        uint256 companyValuationEurUlps
    )
        internal
    {
        // set new valuation
        _companyValuationEurUlps = companyValuationEurUlps;
        // todo: call observer with new valuation - other may nodules need to know it
        // e.g. this may trigger a downround when valuation increases
        emit LogCompanyValuationAmended(resolutionId, companyValuationEurUlps);
    }

    function amendShareCapital(
        bytes32 resolutionId,
        uint256 shareCapital
    )
        internal
    {
        // set new share capital
        _shareCapital = shareCapital;
        emit LogShareCapitalAmended(resolutionId, shareCapital);
    }

    function establishAuthorizedCapital(bytes32 resolutionId, uint256 authorizedCapital)
        internal
    {
        // TODO: if we implement ESOP then we need observer in ESOP module to not let to deallocate authorized capital
        // below lever required by ESOP
        _authorizedCapital = authorizedCapital;
        emit LogAuthorizedCapitalEstablished(resolutionId, authorizedCapital);
    }

    function enableTransfers(bytes32 resolutionId, bool transfersEnabled)
        internal
    {
        if (_transfersEnabled != transfersEnabled) {
            _transfersEnabled = transfersEnabled;
        }
        emit LogTransfersStateChanged(resolutionId, _g._equityToken, transfersEnabled);
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
}
