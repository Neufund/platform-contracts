pragma solidity 0.4.24;

import "./ETODurationTerms.sol";
import "./ETOPlatformTerms.sol";
import "../Company/ShareholderRights.sol";
import "../Math.sol";


/// @title base terms of Equity Token Offering
/// implements simple constant price curve without any discounts
contract ETOTerms is Math {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // reference to duration terms
    ETODurationTerms public DURATION_TERMS;
    // total number of shares in the company (incl. Authorized Shares) at moment of sale
    uint256 public EXISTING_COMPANY_SHARES;
    // sets nominal value of a share
    uint256 public SHARE_NOMINAL_VALUE_EUR_ULPS;
    // minimum number of tokens being offered. will set min cap
    uint256 public MIN_NUMBER_OF_TOKENS;
    // maximum number of tokens being offered. will set max cap
    uint256 public MAX_NUMBER_OF_TOKENS;
    // maximum number of tokens in whitelist phase
    uint256 public MAX_NUMBER_OF_TOKENS_IN_WHITELIST;
    // base token price in EUR-T, without any discount scheme
    uint256 public TOKEN_PRICE_EUR_ULPS;
    // maximum discount on token price that may be given to investor (as decimal fraction)
    // uint256 public MAXIMUM_TOKEN_PRICE_DISCOUNT_FRAC;
    // minimum ticket
    uint256 public MIN_TICKET_EUR_ULPS;
    // maximum ticket for sophisiticated investors
    uint256 public MAX_TICKET_EUR_ULPS;
    // maximum ticket for simple investors
    uint256 public MAX_TICKET_SIMPLE_EUR_ULPS;
    // should enable transfers on ETO success
    bool public ENABLE_TRANSFERS_ON_SUCCESS;
    // additional tokens issued to company on success (founders' tokens)
    uint256 public ADDITIONAL_COMPANY_TOKENS_ON_SUCCESS;
    // says if we work under crowdfunding regulation
    bool public IS_CROWDFUNDING;

    // paperwork
    // url (typically IPFS hash) to investment agreement between nominee and company
    string public INVESTMENT_AGREEMENT_TEMPLATE_URL;
    // prospectus url
    string public PROSPECTUS_URL;
    // settings for shareholder rights
    ShareholderRights public SHAREHOLDER_RIGHTS;

    // equity token setup
    string public EQUITY_TOKEN_NAME;
    string public EQUITY_TOKEN_SYMBOL;


    ////////////////////////
    // Public methods
    ////////////////////////

    // calculates token amount for a given commitment at a position of the curve
    // we require that equity token precision is 0
    function calculateTokenAmount(uint256 /*totalEurUlps*/, uint256 committedEurUlps)
        public
        constant
        returns (uint256 tokenAmountInt)
    {
        // we may disregard totalEurUlps as curve is flat
        return divRound(committedEurUlps, TOKEN_PRICE_EUR_ULPS);
    }

    // calculates amount of euro required to acquire amount of tokens at a position of the (inverse) curve
    // we require that equity token precision is 0
    function calculateEurUlpsAmount(uint256 /*totalTokensInt*/, uint256 tokenAmountInt)
        public
        constant
        returns (uint256 committedEurUlps)
    {
        // we may disregard totalTokensInt as curve is flat
        return mul(tokenAmountInt, TOKEN_PRICE_EUR_ULPS);
    }

    // gets company valuation
    /*function COMPANY_VALUATION_EUR_ULPS() public constant returns(uint256) {
        return calculateEurUlpsAmount(0, mul(EXISTING_COMPANY_SHARES, TOKENS_PER_SHARE));
    }*/

    // get mincap in EUR
    function MIN_CAP_EUR_ULPS() public constant returns(uint256) {
        return calculateEurUlpsAmount(0, MIN_NUMBER_OF_TOKENS);
    }

    // get max cap in EUR
    function MAX_CAP_EUR_ULPS() public constant returns(uint256) {
        return calculateEurUlpsAmount(0, MAX_NUMBER_OF_TOKENS);
    }

    // gets number of shares for an amount of tokens
    // function calculateNumberOfShares(uint256 )

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
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
        string prospectusUrl,
        ShareholderRights shareHolderRights,
        string equityTokenName,
        string equityTokenSymbol,
        uint256 shareNominalValueEurUlps
    )
        public
    {
        DURATION_TERMS = durationTerms;
        EXISTING_COMPANY_SHARES = totalCompanyShares;
        MIN_NUMBER_OF_TOKENS = minNumberOfTokens;
        MAX_NUMBER_OF_TOKENS = maxNumberOfTokens;
        TOKEN_PRICE_EUR_ULPS = tokenEurPriceUlps;
        MIN_TICKET_EUR_ULPS = minTicketEurUlps;
        MAX_TICKET_EUR_ULPS = maxTicketEurUlps;
        MAX_TICKET_SIMPLE_EUR_ULPS = maxTicketSimpleEurUlps;
        ENABLE_TRANSFERS_ON_SUCCESS = enableTransfersOnSuccess;
        IS_CROWDFUNDING = isCrowdfunding;
        INVESTMENT_AGREEMENT_TEMPLATE_URL = investmentAgreementUrl;
        PROSPECTUS_URL = prospectusUrl;
        SHAREHOLDER_RIGHTS = shareHolderRights;
        EQUITY_TOKEN_NAME = equityTokenName;
        EQUITY_TOKEN_SYMBOL = equityTokenSymbol;
        SHARE_NOMINAL_VALUE_EUR_ULPS = shareNominalValueEurUlps;
    }

    ////////////////////////
    // Public methods
    ////////////////////////

    /// @notice checks terms against platform terms, reverts on invalid
    function requireValidTerms(ETOPlatformTerms platformTerms)
        public
        constant
    {
        // TODO: write checks
        // TODO: compute ticket size per regulations and settings in platform terms
        // TODO: validate ETODurationTerms
    }

}
