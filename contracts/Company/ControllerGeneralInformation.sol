pragma solidity 0.4.26;

import "./ControllerGovernanceEngine.sol";
import "./IControllerGeneralInformation.sol";


contract ControllerGeneralInformation is
    ControllerGovernanceEngine,
    IControllerGeneralInformation
{
    ////////////////////////
    // Mutable state
    ////////////////////////

    // share capital of Company in currency defined in ISHA
    uint256 internal _shareCapital;

    // authorized capital of Company
    uint256 internal _authorizedCapital;

    // valuation of the company
    uint256 internal _companyValuationEurUlps;

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyGeneralActions(Gov.Action a) {
        require(isGeneralAction(a), "NF_NOT_GENERAL_ACTION");
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}

    ////////////////////////
    // Public Methods
    ////////////////////////

    //
    // Implements IControllerGeneralInformation
    //

    function shareholderInformation()
        public
        constant
        returns (
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            uint256 authorizedCapital,
            string shaUrl,
            ITokenholderRights tokenholderRights
        )
    {
        if (amendmentsCount() > 0) {
            (,,shaUrl,) = currentAgreement();
        }
        return (
            _shareCapital,
            _companyValuationEurUlps,
            _authorizedCapital,
            shaUrl,
            _t._tokenholderRights
        );
    }

    function generalResolution(
        bytes32 resolutionId,
        Gov.Action generalAction,
        string title,
        string resolutionDocumentUrl
    )
        public
        onlyOperational
        onlyGeneralActions(generalAction)
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernanceTitle(
            resolutionId,
            generalAction,
            title,
            resolutionDocumentUrl
        )
    {
        // no special on chain consequences
    }

    function amendISHAResolution(
        bytes32 resolutionId,
        string ISHAUrl,
        uint256 shareCapitalUlps,
        uint256 authorizedCapital,
        uint256 companyValuationEurUlps,
        ITokenholderRights newTokenholderRights
    )
        public
        onlyStates(Gov.State.Setup, Gov.State.Funded)
        withAtomicExecution(resolutionId, defaultValidator)
        withGovernance(
            resolutionId,
            Gov.Action.AmendGovernance,
            ISHAUrl
        )
    {
        // if in Setup, transition to Funded
        if (_g._state == Gov.State.Setup) {
            transitionTo(Gov.State.Funded);
        }
        amendISHA(resolutionId, ISHAUrl);
        amendGovernance(resolutionId, newTokenholderRights);
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

    //
    // Migration storage access
    //

    function migrateGeneralInformation(
        uint256 shareCapital,
        uint256 companyValuationEurUlps,
        uint256 authorizedCapital,
        string shaUrl,
        ITokenholderRights tokenholderRights
    )
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        this.amendAgreement(shaUrl);
        setShareCapital(shareCapital);
        _authorizedCapital = authorizedCapital;
        _companyValuationEurUlps = companyValuationEurUlps;
        _t._tokenholderRights = tokenholderRights;
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////


    function amendISHA(
        bytes32 resolutionId,
        string memory ISHAUrl
    )
        internal
    {
        // set ISHA. use this.<> to call externally so msg.sender is correct in mCanAmend
        this.amendAgreement(ISHAUrl);
        emit LogISHAAmended(resolutionId, ISHAUrl);
    }

    function amendCompanyValuation(
        bytes32 resolutionId,
        uint256 newCompanyValuationEurUlps
    )
        internal
    {
        // set new valuation
        _companyValuationEurUlps = newCompanyValuationEurUlps;
        // TODO: call observer with new valuation - other may nodules need to know it
        // e.g. this may trigger a downround when valuation increases
        emit LogCompanyValuationAmended(resolutionId, newCompanyValuationEurUlps);
    }

    function amendShareCapital(
        bytes32 resolutionId,
        uint256 newShareCapital
    )
        internal
    {
        setShareCapital(newShareCapital);
        emit LogShareCapitalAmended(resolutionId, newShareCapital);
    }

    function establishAuthorizedCapital(bytes32 resolutionId, uint256 newAuthorizedCapital)
        internal
    {
        // TODO: if we implement ESOP then we need observer in ESOP module to not let to deallocate authorized capital
        // below level required by ESOP
        _authorizedCapital = newAuthorizedCapital;
        emit LogAuthorizedCapitalEstablished(resolutionId, newAuthorizedCapital);
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
    // Private Methods
    ////////////////////////

    function setShareCapital(uint256 newShareCapital)
        private
    {
        // set new share capital
        _shareCapital = newShareCapital;
        // call observer in final contract
        mAfterShareCapitalChange(newShareCapital);
    }

    function isGeneralAction(Gov.Action a)
        internal
        pure
        returns (bool)
    {
        return a == Gov.Action.None ||
            a == Gov.Action.RestrictedNone ||
            a == Gov.Action.AnnualGeneralMeeting ||
            a == Gov.Action.CompanyNone ||
            a == Gov.Action.THRNone;
    }
}
