pragma solidity 0.4.26;

import "../../ETO/ETOTermsConstraints.sol";

contract MockETOTermsConstraints is ETOTermsConstraints {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // you can start your ETO in 5 minutes on dev
    uint256 public constant DATE_TO_WHITELIST_MIN_DURATION = 8 hours;

    // claim duration is 1 day minimum
    uint256 public constant MIN_CLAIM_DURATION = 8 hours;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        bool canSetTransferability,
        bool hasNominee,
        uint256 minTicketSizeEurUlps,
        uint256 maxTicketSizeEurUlps,
        uint256 minInvestmentAmountEurUlps,
        uint256 maxInvestmentAmountEurUlps,
        string name,
        OfferingDocumentType offeringDocumentType,
        OfferingDocumentSubType offeringDocumentSubType,
        string jurisdiction,
        AssetType assetType,
        address tokenOfferingOperator
    )
        public
        ETOTermsConstraints(
            canSetTransferability,
            hasNominee,
            minTicketSizeEurUlps,
            maxTicketSizeEurUlps,
            minInvestmentAmountEurUlps,
            maxInvestmentAmountEurUlps,
            name,
            offeringDocumentType,
            offeringDocumentSubType,
            jurisdiction,
            assetType,
            tokenOfferingOperator
        )
    {}
}
