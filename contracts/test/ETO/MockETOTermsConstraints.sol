pragma solidity 0.4.25;

import "../../ETO/ETOTermsConstraints.sol";

contract MockETOTermsConstraints is ETOTermsConstraints {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // you can start your ETO in 5 minutes on dev
    uint256 public constant DATE_TO_WHITELIST_MIN_DURATION = 5 * 60;

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
