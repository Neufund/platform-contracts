pragma solidity 0.4.26;

import "../SnapshotToken/Helpers/TokenMetadata.sol";


contract EquityTokenMetadata is TokenMetadata {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // ISIN https://www.investopedia.com/terms/i/isin.asp
    string private _ISIN;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        string tokenName,
        uint8 decimalUnits,
        string tokenSymbol,
        string version,
        string isin
    )
        public
        TokenMetadata(tokenName, decimalUnits, tokenSymbol, version)
    {
        _ISIN = isin;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function ISIN() public constant returns (string) {
        return _ISIN;
    }
}
