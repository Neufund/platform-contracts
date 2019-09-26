pragma solidity 0.4.26;

import "../Math.sol";
import "../Standards/IContractId.sol";

// version history as per contract id
// 0 - initial version
// 1 - added SHARE_NOMINAL_VALUE_ULPS, SHARE_NOMINAL_VALUE_EUR_ULPS, TOKEN_NAME, TOKEN_SYMBOL, SHARE_PRICE


/// @title sets terms for tokens in ETO
contract ETOTokenTerms is Math, IContractId {

    ////////////////////////
    // Constants state
    ////////////////////////

    bytes32 private constant EMPTY_STRING_HASH = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;
    // equity tokens decimals (precision)
    uint8 public constant EQUITY_TOKENS_PRECISION = 0; // indivisible

    ////////////////////////
    // Immutable state
    ////////////////////////

    // equity token metadata
    string public EQUITY_TOKEN_NAME;
    string public EQUITY_TOKEN_SYMBOL;

    // minimum number of tokens being offered. will set min cap
    uint256 public MIN_NUMBER_OF_TOKENS;
    // maximum number of tokens being offered. will set max cap
    uint256 public MAX_NUMBER_OF_TOKENS;
    // base token price in EUR-T, without any discount scheme
    uint256 public TOKEN_PRICE_EUR_ULPS;
    // maximum number of tokens in whitelist phase
    uint256 public MAX_NUMBER_OF_TOKENS_IN_WHITELIST;
    // sets nominal value of newly issued shares in currency of share capital as per ISHA
    // will be embedded in the equity token (IEquityToken interface)
    uint256 public SHARE_NOMINAL_VALUE_ULPS;
    // sets nominal value of newly issued shares in euro, used to withdraw share capital to Nominee
    uint256 public SHARE_NOMINAL_VALUE_EUR_ULPS;
    // equity tokens per share
    uint256 public EQUITY_TOKENS_PER_SHARE;


    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        string equityTokenName,
        string equityTokenSymbol,
        uint256 minNumberOfTokens,
        uint256 maxNumberOfTokens,
        uint256 tokenPriceEurUlps,
        uint256 maxNumberOfTokensInWhitelist,
        uint256 shareNominalValueUlps,
        uint256 shareNominalValueEurUlps,
        uint256 equityTokensPerShare
    )
        public
    {
        require(maxNumberOfTokens >= maxNumberOfTokensInWhitelist, "NF_WL_TOKENS_GT_MAX_TOKENS");
        require(maxNumberOfTokens >= minNumberOfTokens, "NF_MIN_TOKENS_GT_MAX_TOKENS");
        // min cap must be > single share
        require(minNumberOfTokens >= equityTokensPerShare, "NF_ETO_TERMS_ONE_SHARE");
        // maximum number of tokens are full shares
        require(maxNumberOfTokens % equityTokensPerShare == 0, "NF_MAX_TOKENS_FULL_SHARES");
        require(shareNominalValueUlps > 0);
        require(shareNominalValueEurUlps > 0);
        require(equityTokensPerShare > 0);
        require(keccak256(abi.encodePacked(equityTokenName)) != EMPTY_STRING_HASH);
        require(keccak256(abi.encodePacked(equityTokenSymbol)) != EMPTY_STRING_HASH);
        // overflows cannot be possible
        require(maxNumberOfTokens < 2**56, "NF_TOO_MANY_TOKENS");
        require(mul(tokenPriceEurUlps, maxNumberOfTokens) < 2**112, "NF_TOO_MUCH_FUNDS_COLLECTED");

        MIN_NUMBER_OF_TOKENS = minNumberOfTokens;
        MAX_NUMBER_OF_TOKENS = maxNumberOfTokens;
        TOKEN_PRICE_EUR_ULPS = tokenPriceEurUlps;
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST = maxNumberOfTokensInWhitelist;
        SHARE_NOMINAL_VALUE_EUR_ULPS = shareNominalValueEurUlps;
        SHARE_NOMINAL_VALUE_ULPS = shareNominalValueUlps;
        EQUITY_TOKEN_NAME = equityTokenName;
        EQUITY_TOKEN_SYMBOL = equityTokenSymbol;
        EQUITY_TOKENS_PER_SHARE = equityTokensPerShare;
    }

    ////////////////////////
    // Public methods
    ////////////////////////

    function SHARE_PRICE_EUR_ULPS() public constant returns (uint256) {
        return mul(TOKEN_PRICE_EUR_ULPS, EQUITY_TOKENS_PER_SHARE);
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x591e791aab2b14c80194b729a2abcba3e8cce1918be4061be170e7223357ae5c, 1);
    }
}
