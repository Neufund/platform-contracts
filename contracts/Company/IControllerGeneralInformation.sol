pragma solidity 0.4.26;

import "./Gov.sol";
import "./ITokenholderRights.sol";

/// @title interface of governance module providing general information rights and cap table management
contract IControllerGeneralInformation {

    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerGeneralInformationId = 0x41a703b63c912953a0cd27ec13238571806cc14534c4a31a6874db8759b9aa6a;
    uint256 internal constant ControllerGeneralInformationV = 0;


    ////////////////////////
    // Events
    ////////////////////////

    // logged when ISHA was amended (new text, new shareholders, new cap table, offline round etc.)
    event LogISHAAmended(
        bytes32 indexed resolutionId,
        string ISHAUrl
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
    // Interface methods
    ////////////////////////

    // return basic shareholder information
    function shareholderInformation()
        public
        constant
        returns (
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            uint256 authorizedCapital,
            string shaUrl,
            ITokenholderRights tokenholderRights
        );

    // single entry for general resolutions without on chain consequences
    // general actions are:
    //  - None - ordinary shareholder resolution,
    //  - RestrictedNone - restricted ordinary shareholder resolution
    //  - AnnualGeneralMeeting - annual meeting resolution
    //  - CompanyNone - general information from the company
    //  - THRNone - tokenholder voting/resolution, pro-rata
    function generalResolution(
        bytes32 resolutionId,
        Gov.Action generalAction,
        string title,
        string resolutionDocumentUrl
    )
        public;

    // used to change company governance, if run in Setup state it may create a controller
    // without a token, for example to use with ESOP
    function amendISHAResolution(
        bytes32 resolutionId,
        string ISHAUrl,
        uint256 shareCapitalUlps,
        uint256 authorizedCapital,
        uint256 companyValuationEurUlps,
        ITokenholderRights newTokenholderRights
    )
        public;

    function establishAuthorizedCapitalResolution(
        bytes32 resolutionId,
        uint256 authorizedCapital,
        string resolutionDocumentUrl
    )
        public;

    function amendShareCapitalResolution(
        bytes32 resolutionId,
        uint256 shareCapitalUlps,
        uint256 authorizedCapital,
        uint256 companyValuationEurUlps,
        string resolutionDocumentUrl
    )
        public;

    function amendCompanyValuationResolution(
        bytes32 resolutionId,
        uint256 companyValuationEurUlps,
        string resolutionDocumentUrl
    )
        public;
}
