pragma solidity 0.4.24;

import "./ETODurationTerms.sol";
import "./ETOTokenTerms.sol";
import "../Standards/IContractId.sol";
import "../PlatformTerms.sol";
import "../Company/ShareholderRights.sol";
import "../Math.sol";


/// @title base terms of Equity Token Offering
/// encapsulates pricing, discounts and whitelisting mechanism
/// @dev to be split is mixins
contract ETOTerms is Math, IContractId {

    ////////////////////////
    // Types
    ////////////////////////

    // @notice whitelist entry with a discount
    struct WhitelistTicket {
        // this also overrides maximum ticket
        uint128 discountAmountEurUlps;
        // a percentage of full price to be paid (1 - discount)
        uint128 fullTokenPriceFrac;
    }

    ////////////////////////
    // Constants state
    ////////////////////////

    bytes32 private constant EMPTY_STRING_HASH = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;

    ////////////////////////
    // Immutable state
    ////////////////////////

    // reference to duration terms
    ETODurationTerms public DURATION_TERMS;
    // reference to token terms
    ETOTokenTerms public TOKEN_TERMS;
    // total number of shares in the company (incl. Authorized Shares) at moment of sale
    uint256 public EXISTING_COMPANY_SHARES;
    // sets nominal value of a share
    uint256 public SHARE_NOMINAL_VALUE_EUR_ULPS;
    // maximum discount on token price that may be given to investor (as decimal fraction)
    // uint256 public MAXIMUM_TOKEN_PRICE_DISCOUNT_FRAC;
    // minimum ticket
    uint256 public MIN_TICKET_EUR_ULPS;
    // maximum ticket for sophisiticated investors
    uint256 public MAX_TICKET_EUR_ULPS;
    // maximum ticket for simple investors
    uint256 public MAX_TICKET_SIMPLE_EUR_ULPS;
    // should enable transfers on ETO success
    // transfers are always disabled during token offering
    // if set to False transfers on Equity Token will remain disabled after offering
    // once those terms are on-chain this flags fully controls token transferability
    bool public ENABLE_TRANSFERS_ON_SUCCESS;
    // represents the discount % for whitelist participants
    uint256 public WHITELIST_DISCOUNT_FRAC;

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

    // variables from token terms for local use
    // minimum number of tokens being offered. will set min cap
    uint256 private MIN_NUMBER_OF_TOKENS;
    // maximum number of tokens being offered. will set max cap
    uint256 private MAX_NUMBER_OF_TOKENS;
    // base token price in EUR-T, without any discount scheme
    uint256 private TOKEN_PRICE_EUR_ULPS;

    // manages whitelist
    address private WHITELIST_MANAGER;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // mapping of investors allowed in whitelist
    mapping (address => WhitelistTicket) private _whitelist;

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyWhitelistManager() {
        require(msg.sender == WHITELIST_MANAGER);
        _;
    }

    ////////////////////////
    // Events
    ////////////////////////

    // raised on invesor added to whitelist
    event LogInvestorWhitelisted(
        address indexed investor,
        uint256 discountAmountEurUlps,
        uint256 fullTokenPriceFrac
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        ETODurationTerms durationTerms,
        ETOTokenTerms tokenTerms,
        uint256 existingCompanyShares,
        uint256 minTicketEurUlps,
        uint256 maxTicketEurUlps,
        bool enableTransfersOnSuccess,
        string investmentAgreementTemplateUrl,
        string prospectusUrl,
        ShareholderRights shareholderRights,
        string equityTokenName,
        string equityTokenSymbol,
        uint256 shareNominalValueEurUlps,
        uint256 whitelistDiscountFrac
    )
        public
    {
        require(durationTerms != address(0));
        require(tokenTerms != address(0));
        require(existingCompanyShares > 0);
        require(keccak256(abi.encodePacked(prospectusUrl)) != EMPTY_STRING_HASH);
        require(keccak256(abi.encodePacked(investmentAgreementTemplateUrl)) != EMPTY_STRING_HASH);
        require(keccak256(abi.encodePacked(equityTokenName)) != EMPTY_STRING_HASH);
        require(keccak256(abi.encodePacked(equityTokenSymbol)) != EMPTY_STRING_HASH);
        require(shareholderRights != address(0));
        // test interface
        require(shareholderRights.HAS_GENERAL_INFORMATION_RIGHTS());
        require(shareNominalValueEurUlps > 0);
        require(whitelistDiscountFrac >= 0 && whitelistDiscountFrac <= 99*10**16);

        // copy token terms variables
        MIN_NUMBER_OF_TOKENS = tokenTerms.MIN_NUMBER_OF_TOKENS();
        MAX_NUMBER_OF_TOKENS = tokenTerms.MAX_NUMBER_OF_TOKENS();
        TOKEN_PRICE_EUR_ULPS = tokenTerms.TOKEN_PRICE_EUR_ULPS();

        DURATION_TERMS = durationTerms;
        TOKEN_TERMS = tokenTerms;
        EXISTING_COMPANY_SHARES = existingCompanyShares;
        MIN_TICKET_EUR_ULPS = minTicketEurUlps;
        MAX_TICKET_EUR_ULPS = maxTicketEurUlps;
        ENABLE_TRANSFERS_ON_SUCCESS = enableTransfersOnSuccess;
        INVESTMENT_AGREEMENT_TEMPLATE_URL = investmentAgreementTemplateUrl;
        PROSPECTUS_URL = prospectusUrl;
        SHAREHOLDER_RIGHTS = shareholderRights;
        EQUITY_TOKEN_NAME = equityTokenName;
        EQUITY_TOKEN_SYMBOL = equityTokenSymbol;
        SHARE_NOMINAL_VALUE_EUR_ULPS = shareNominalValueEurUlps;
        WHITELIST_DISCOUNT_FRAC = whitelistDiscountFrac;
        WHITELIST_MANAGER = msg.sender;
    }

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

    // get mincap in EUR
    function ESTIMATED_MIN_CAP_EUR_ULPS() public constant returns(uint256) {
        return calculateEurUlpsAmount(0, MIN_NUMBER_OF_TOKENS);
    }

    // get max cap in EUR
    function ESTIMATED_MAX_CAP_EUR_ULPS() public constant returns(uint256) {
        return calculateEurUlpsAmount(0, MAX_NUMBER_OF_TOKENS);
    }

    function addWhitelisted(
        address[] investors,
        uint256[] discountAmountsEurUlps,
        uint256[] discountsFrac
    )
        external
        onlyWhitelistManager
    {
        require(investors.length == discountAmountsEurUlps.length);
        require(investors.length == discountsFrac.length);

        for (uint256 i = 0; i < investors.length; i += 1) {
            addWhitelistInvestorPrivate(investors[i], discountAmountsEurUlps[i], discountsFrac[i]);
        }
    }

    function whitelistTicket(address investor)
        public
        constant
        returns (bool isWhitelisted, uint256 discountAmountEurUlps, uint256 fullTokenPriceFrac)
    {
        WhitelistTicket storage wlTicket = _whitelist[investor];
        isWhitelisted = wlTicket.fullTokenPriceFrac > 0;
        discountAmountEurUlps = wlTicket.discountAmountEurUlps;
        fullTokenPriceFrac = wlTicket.fullTokenPriceFrac;
    }

    // calculate contribution of investor
    function calculateContribution(
        address investor,
        uint256 totalContributedEurUlps,
        uint256 existingInvestorContributionEurUlps,
        uint256 newInvestorContributionEurUlps,
        bool applyWhitelistDiscounts
    )
        public
        constant
        returns (
            bool isWhitelisted,
            uint256 minTicketEurUlps,
            uint256 maxTicketEurUlps,
            uint256 equityTokenInt,
            uint256 fixedSlotEquityTokenInt
            )
    {
        uint256 discountedAmount;
        minTicketEurUlps = MIN_TICKET_EUR_ULPS;
        maxTicketEurUlps = MAX_TICKET_EUR_ULPS;
        // whitelist use discount is possible
        if (applyWhitelistDiscounts) {
            WhitelistTicket storage wlTicket = _whitelist[investor];
            // check if has access to discount
            isWhitelisted = wlTicket.fullTokenPriceFrac > 0;
            maxTicketEurUlps = max(wlTicket.discountAmountEurUlps, MAX_TICKET_EUR_ULPS);
            if (existingInvestorContributionEurUlps < wlTicket.discountAmountEurUlps) {
                discountedAmount = min(newInvestorContributionEurUlps, wlTicket.discountAmountEurUlps - existingInvestorContributionEurUlps);
                // discount is fixed so use base token price
                if (discountedAmount > 0) {
                    fixedSlotEquityTokenInt = divRound(discountedAmount, decimalFraction(wlTicket.fullTokenPriceFrac, TOKEN_PRICE_EUR_ULPS));
                }
            }
        }
        // if any amount above discount
        uint256 remainingAmount = newInvestorContributionEurUlps - discountedAmount;
        if (remainingAmount > 0) {
            if (applyWhitelistDiscounts && WHITELIST_DISCOUNT_FRAC > 0) {
                // will not overflow, WHITELIST_DISCOUNT_FRAC < Q18 from constructor
                equityTokenInt = divRound(remainingAmount, decimalFraction(10**18 - WHITELIST_DISCOUNT_FRAC, TOKEN_PRICE_EUR_ULPS));
            } else {
                // use pricing along the curve
                equityTokenInt = calculateTokenAmount(totalContributedEurUlps + discountedAmount, remainingAmount);
            }
        }
        // should have all issued tokens
        equityTokenInt += fixedSlotEquityTokenInt;
    }

    function equityTokensToShares(uint256 amount)
        public
        constant
        returns (uint256)
    {
        return divRound(amount, TOKEN_TERMS.EQUITY_TOKENS_PER_SHARE());
    }

    /// @notice checks terms against platform terms, reverts on invalid
    function requireValidTerms(PlatformTerms platformTerms)
        public
        constant
    {
        require(MIN_TICKET_EUR_ULPS >= platformTerms.MIN_TICKET_EUR_ULPS(), "ETO_TERMS_MIN_TICKET_EUR_ULPS");
        // at least one share sold
        require(MIN_NUMBER_OF_TOKENS >= TOKEN_TERMS.EQUITY_TOKENS_PER_SHARE(), "ETO_TERMS_ONE_SHARE");
        // duration checks
        require(DURATION_TERMS.WHITELIST_DURATION() >= platformTerms.MIN_WHITELIST_DURATION(), "ETO_TERMS_WL_D_MIN");
        require(DURATION_TERMS.WHITELIST_DURATION() <= platformTerms.MAX_WHITELIST_DURATION(), "ETO_TERMS_WL_D_MAX");

        require(DURATION_TERMS.PUBLIC_DURATION() >= platformTerms.MIN_PUBLIC_DURATION(), "ETO_TERMS_PUB_D_MIN");
        require(DURATION_TERMS.PUBLIC_DURATION() <= platformTerms.MAX_PUBLIC_DURATION(), "ETO_TERMS_PUB_D_MAX");

        uint256 totalDuration = DURATION_TERMS.WHITELIST_DURATION() + DURATION_TERMS.PUBLIC_DURATION();
        require(totalDuration >= platformTerms.MIN_OFFER_DURATION(), "ETO_TERMS_TOT_O_MIN");
        require(totalDuration <= platformTerms.MAX_OFFER_DURATION(), "ETO_TERMS_TOT_O_MAX");

        require(DURATION_TERMS.SIGNING_DURATION() >= platformTerms.MIN_SIGNING_DURATION(), "ETO_TERMS_SIG_MIN");
        require(DURATION_TERMS.SIGNING_DURATION() <= platformTerms.MAX_SIGNING_DURATION(), "ETO_TERMS_SIG_MAX");

        require(DURATION_TERMS.CLAIM_DURATION() >= platformTerms.MIN_CLAIM_DURATION(), "ETO_TERMS_CLAIM_MIN");
        require(DURATION_TERMS.CLAIM_DURATION() <= platformTerms.MAX_CLAIM_DURATION(), "ETO_TERMS_CLAIM_MAX");
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x3468b14073c33fa00ee7f8a289b14f4a10c78ab72726033b27003c31c47b3f6a, 0);
    }

    ////////////////////////
    // Private methods
    ////////////////////////

    function addWhitelistInvestorPrivate(
        address investor,
        uint256 discountAmountEurUlps,
        uint256 fullTokenPriceFrac
    )
        private
    {
        // Validate
        require(investor != address(0));
        require(fullTokenPriceFrac > 0 && fullTokenPriceFrac <= 10**18, "DISCOUNT_RANGE");
        require(discountAmountEurUlps < 2**128);


        _whitelist[investor] = WhitelistTicket({
            discountAmountEurUlps: uint128(discountAmountEurUlps),
            fullTokenPriceFrac: uint128(fullTokenPriceFrac)
        });

        emit LogInvestorWhitelisted(investor, discountAmountEurUlps, fullTokenPriceFrac);
    }

}
