pragma solidity 0.4.15;

import "./ETODurationTerms.sol";
import "./ETOPlatformTerms.sol";
import "../Company/ShareholderRights.sol";
import "../Math.sol";

/// @title set terms of the ETO public offer
contract ETOTerms is Math {

    ////////////////////////
    // Constants
    ////////////////////////

    // how much shares is one token, where 1 to 1 is 2^18. W propose 1:1 value that is divisible into 2^18 parts
    uint256 public constant TOKENS_PER_SHARE_FRAC = 2**18;

    ////////////////////////
    // Immutable state
    ////////////////////////

    // reference to platform terms
    ETOPlatformTerms public PLATFORM_TERMS;
    // reference to duration terms
    ETODurationTerms public DURATION_TERMS;
    // total number of shares in the company (incl. Authorized Shares) at momemnt of sale
    uint256 public TOTAL_COMPANY_SHARES;
    // minimum number of tokens being offered. will set min cap
    uint256 public MIN_NUMBER_OF_TOKENS;
    // maximum number of tokens being offered. will set max cap
    uint256 public MAX_NUMBER_OF_TOKENS;
    // token price in EUR-T
    uint256 public TOKEN_EUR_PRICE_ULPS;
    // minimum ticket
    uint256 public MIN_TICKET_EUR_ULPS;
    // maximum ticket for sophisiticated investors
    uint256 public MAX_TICKET_EUR_ULPS;
    // maximum ticket for simple investors
    uint256 public MAX_TICKET_SIMPLE_EUR_ULPS;
    // should enable transfers on ETO success
    bool public ENABLE_TRANSFERS_ON_SUCCESS;
    // says if we work under crowdfunding regulation
    bool public IS_CROWDFUNDING;

    // paperwork
    // url (typically IPFS hash) to investment agreement between nominee and company
    string public INVESTMENT_AGREEMENT_TEMPLATE_URL;
    // url (typically IPFS hash) to new shareholder agreement betwen nomine (and other shareholders) and company
    string public SHA_TEMPLATE_URL;
    // settings for shareholder rights
    ShareholderRights public SHAREHOLDER_RIGHTS;

    ////////////////////////
    // Public methods
    ////////////////////////

    // gets company valuation
    function COMPANY_VALUATION_EUR_ULPS() public constant returns(uint256) {
        return TOTAL_COMPANY_SHARES * decimalFraction(TOKEN_EUR_PRICE_ULPS, TOKENS_PER_SHARE_FRAC);
    }

    // get mincap in EUR
    function MIN_CAP_EUR_ULPS() public constant returns(uint256) {
        return MIN_NUMBER_OF_TOKENS * TOKEN_EUR_PRICE_ULPS;
    }

    // get max cap in EUR
    function MAX_CAP_EUR_ULPS() public constant returns(uint256) {
        return MAX_NUMBER_OF_TOKENS * TOKEN_EUR_PRICE_ULPS;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    function ETOTerms(
            ETOPlatformTerms platformTerms,
            ETODurationTerms durationTerms,
            uint256 totalCompanyShares,
            uint256 minNumberOfTokens,
            uint256 maxNumberOfTokens,
            uint256 tokenEurPriceUlps,
            uint256 minTicketEurUlps,
            uint256 maxTicketEurUlps,
            uint256 maxTicketSimpleEurUlps,
            bool enableTransfersOnSuccess,
            bool isCrowdfunding,
            string investmentAgreementUrl,
            string shaTemplateUrl,
            ShareholderRights shareHolderRights
        )
        public
    {
        PLATFORM_TERMS = platformTerms;
        DURATION_TERMS = durationTerms;
        TOTAL_COMPANY_SHARES = totalCompanyShares;
        MIN_NUMBER_OF_TOKENS = minNumberOfTokens;
        MAX_NUMBER_OF_TOKENS = maxNumberOfTokens;
        TOKEN_EUR_PRICE_ULPS = tokenEurPriceUlps;
        MIN_TICKET_EUR_ULPS = minTicketEurUlps;
        MAX_TICKET_EUR_ULPS = maxTicketEurUlps;
        MAX_TICKET_SIMPLE_EUR_ULPS = maxTicketSimpleEurUlps;
        ENABLE_TRANSFERS_ON_SUCCESS = enableTransfersOnSuccess;
        IS_CROWDFUNDING = isCrowdfunding;
        INVESTMENT_AGREEMENT_TEMPLATE_URL = investmentAgreementUrl;
        SHA_TEMPLATE_URL = shaTemplateUrl;
        SHAREHOLDER_RIGHTS = shareHolderRights;
        validateTerms();
    }

    ////////////////////////
    // Private methods
    ////////////////////////

    /// @notice checks terms agains platform terms, reverts on any problem
    function validateTerms()
        private
    {
        // TODO: write checks
        // TODO: compute ticket size per regulations and settings in platform terms
    }

}
